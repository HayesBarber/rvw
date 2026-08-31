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

## V1 event contract

Each structured line has these fields:

- `timestamp`: Unix time in milliseconds, assigned by the backend when the
  event is written.
- `level`: `debug`, `info`, `warning`, or `error`; the event's diagnostic
  severity.
- `source`: the component that emitted the event. V1 structured events use
  `backend` because browser-originated logging is not part of the V1 surface.
- `message`: a short, stable event description. It must not contain user or
  repository content.
- `context`: optional event-specific diagnostic dimensions. It is an object
  and is omitted when the event has no dimensions.

The retained and added V1 events are deliberately limited to:

| Event | Level | Context | Purpose |
| --- | --- | --- | --- |
| `application started` | `info` | `configurationStatus`; when configuration fallback is used, `configurationDiagnosticCode`, `configurationDiagnosticMessage`, and `configurationPath` | Confirm launch and diagnose rejected or unreadable configuration. |
| `application start failed` | `error` | `stage`, `errorCode` | Identify which production initialization stage failed without exposing the repository path. |
| `request failed` | `error` | `operation`, `errorCode` | Diagnose unexpected backend failures without recording request payloads. Expected validation and not-found responses are not logged. |

`configurationPath` intentionally exposes the path of the configuration file
that could not be used; it is needed to correct that file. Structured events do
not include repository or file paths, request URLs, comment bodies, file
contents, configuration contents, credentials, or environment values.

The former frontend `logEvent` transport, `/api/logs` endpoint, `frontend`
source value, and `metrics` field were unused and are not part of V1. HTTP
access logs were also removed because they duplicated development-server output
and could include repository-relative paths in query strings.

## stderr diagnostics

Command-line parsing and launch errors, development-server listener status,
unexpected HTTP failures, and Unix-socket diagnostics stay on stderr through
Zig's standard logger. They describe the CLI or development transport rather
than the application session, so they are not duplicated in application JSONL
files. Development commands may intentionally print a selected repository or
temporary worktree path to make the active fixture unambiguous.
