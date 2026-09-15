# Logging

Frontend and backend errors share one JSONL file per launch:

- macOS: `~/Library/Logs/rvw`
- Linux: `$XDG_STATE_HOME/rvw` or `~/.local/state/rvw`
- Fallback: the temporary directory, then stderr if no file can be opened.

The 10 newest log files are retained; individual file sizes are not capped.
Logging failures do not stop the application. CLI and development-transport
diagnostics remain on stderr.

Frontend code uses `logError(message, context?, traceId?)`; the shared
`sendLogEvent` API relays through `/api/log` or the native bridge. Use fixed
messages and selected diagnostic fields, never user content or raw exceptions.
Delivery is best effort, bounded, and has no retries.

Application events are errors only. The shared API supports other severities for
future instrumentation. `--log-level` overrides `LOG_LEVEL`, defaulting to `error`;
supported values are `error`/`err`, `warning`/`warn`, `info`, and `debug`.
