# Logging and troubleshooting

Rvw writes structured application events as newline-delimited JSON (JSONL). A
new file is created for each application launch. The preferred directory is:

- macOS: `~/Library/Logs/rvw`
- Linux: `$XDG_STATE_HOME/rvw`, or `~/.local/state/rvw` when
  `XDG_STATE_HOME` is unset

Other platforms, or a failure to use the preferred directory, fall back to the
operating-system temporary directory. If no file can be created, events are
written to stderr. Logging failures are reported to stderr and never stop the
application. Rvw retains the 10 newest `rvw-*.jsonl` files in each directory it
uses.

## Severity and startup

`LOG_LEVEL` is resolved once when the backend starts. Unset or `error` retains
only errors; `warning` retains warnings and errors; `info` adds informational
events; `debug` retains all four levels. Lowercase `warn` and `err` are aliases;
JSONL always uses canonical `warning` and `error`. Empty or invalid values fall
back to error with one fixed stderr diagnostic that never echoes the value.
The shared `Logger.log()` boundary filters before encoding or writing, including
structured stderr output after sink creation or write failures.

```sh
LOG_LEVEL=debug zig build dev -- --directory /path/to/repository
LOG_LEVEL=info rvw /path/to/repository --range main..HEAD
rvw /path/to/repository # errors only
```

Development forwards the environment unchanged. The CLI carries the raw value
through an internal `--log-level` bundle argument, Swift launch configuration,
and the C ABI into the same Zig parser. Swift does not interpret severity.
A missing native level defaults to error.

## Event contract

Each structured line has these fields:

- `timestamp`: Unix time in milliseconds, assigned by the backend when the event is written.
- `level`: `debug`, `info`, `warning`, or `error`; the event's diagnostic severity.
- `source`: `backend` or `frontend`, assigned by the backend.
- `message`: a short, stable event description. It must not contain user or repository content.
- `context`: optional event-specific diagnostic dimensions. It is an object and is omitted when the event has no dimensions.

- `traceId`: optional nonempty opaque operation identifier, omitted when absent. Automatic cross-request propagation is not provided.

The starter events are:

| Event | Level | Context | Purpose |
| --- | --- | --- | --- |
| `application started` | `info` | `configurationStatus`; when configuration fallback is used, `configurationDiagnosticCode`, `configurationDiagnosticMessage`, and `configurationPath` | Confirm launch and diagnose rejected or unreadable configuration. |
| `application start failed` | `error` | `stage`, `errorCode` | Identify which production initialization stage failed without exposing the repository path. |
| `request failed` | `error` | `operation`, `errorCode` | Diagnose unexpected backend failures without recording request payloads. Expected validation and not-found responses are not logged. |

| `request completed` | `debug` | `operation`, `durationMs`, `ok`, and stable `errorCode` on failure | One per non-log backend dispatch, measuring core work with a monotonic clock. |
| `frontend started` | `info` | none | Once per frontend page initialization. |
| `frontend error` / `frontend unhandled rejection` | `error` | none | Fixed global-capture messages; normal browser error behavior remains intact. |
| `api request` | `debug` | `operation: "get_diff_overview"`, `durationMs`, `status: "ok"` or `"error"` | Each overview invocation to settlement, measured monotonically, including stale/unmounted requests. |

`configurationPath` intentionally exposes the path of the configuration file
that could not be used; it is needed to correct that file. This info-level exception is absent at the default threshold. All other
messages, context, and trace IDs must exclude credentials, file/configuration
contents, comment bodies, request payloads, raw exceptions/rejections, stacks,
and arbitrary URLs. Repository-relative paths are permitted only in explicitly
authored debug events; none of the starter events includes them. Selecting debug
does not relax privacy for other severities. Global capture never reads arbitrary
error/rejection properties. Call sites own semantic field selection: generic JSON
validation cannot detect secrets in arbitrary strings.

## stderr diagnostics

Command-line parsing and launch errors, development-server listener status,
unexpected HTTP failures, and Unix-socket diagnostics stay on stderr through
Zig's standard logger. They describe the CLI or development transport rather
than the application session, so they are not duplicated in application JSONL
files. Development commands may intentionally print a selected repository or
temporary worktree path to make the active fixture unambiguous.

## Frontend relay and limits

`sendLogEvent({ level, message, traceId, context })` and the `logError`,
`logWarning`, `logInfo`, `logDebug` helpers submit without frontend filtering.
Development uses `POST /api/log`; native uses WebKit `native.postMessage` and the
existing core JSON protocol. Both validate the same event shape. Level and a
nonblank message are required. Optional trace ID and object context accept null
or absence and are then omitted. Client source/timestamp fields cannot override
the backend. Context retains nested JSON structure.

Named limits in `json_protocol.zig` are inclusive: 16 KiB encoded log payload,
4096 UTF-8 bytes per string (including object keys), 128 bytes per trace ID,
maximum depth 8 (envelope at depth 0), and 512 nodes (object keys count as nodes).
A second decoded budget counts one byte per node plus string bytes, up to 16 KiB.
The native JSON entry point caps all request payloads at 1 MiB before parsing (matching the Unix transport frame limit).
Malformed/oversized submissions return the usual transport/protocol error without
logging the submitted data. HTTP returns `{ "accepted": true }`; native wraps it
in its existing success envelope (the bridge unwraps it for JavaScript).
Acknowledgment means handled, even when filtered or a sink fails. Decoded data
is borrowed only through the synchronous write and never retained.

The relay is best effort: helpers return immediately, swallow serialization,
bridge, promise, and HTTP failures, and never report relay failures via logging.
At most eight submissions are outstanding, excess events drop silently, and
capacity is released on settlement or a five-second timeout. On timeout HTTP is
aborted and further relay submissions are disabled until page reload, bounding
uncancellable stalled native replies as well. There are no retries, durable
queue, or shutdown flush guarantees. Log dispatches bypass ordinary request
instrumentation; each valid submission attempts at most one event write.

The backend sink remains synchronous and non-fatal; this does not promise zero
I/O latency or durable exactly-once delivery. Retaining ten files does not limit
individual file sizes or total disk usage. Rotation, background writes, broad
instrumentation, automatic tracing, and remote telemetry remain out of scope.
