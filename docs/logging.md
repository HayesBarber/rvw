# Application logging

`rvw` creates one timestamped JSON Lines log file for each process launch. On
macOS, logs are written to `~/Library/Logs/rvw/`. On Linux, they are written to
`$XDG_STATE_HOME/rvw/`, or `~/.local/state/rvw/` when `XDG_STATE_HOME` is not
set.

If the preferred directory cannot be created or opened, `rvw` uses the OS
temporary directory (`$TMPDIR` when provided, otherwise `/tmp` on Unix). If a
log file still cannot be created, or a later write fails, logging remains
non-fatal and the event is written to standard error when possible.

During shutdown, request producers are stopped before the logger is destroyed.
The logger rejects new writes and waits for all admitted concurrent writes
before closing its file.

Every line is one structured wide event with a backend-generated `timestamp`,
`level`, `source`, `message`, `context`, and `metrics`. Frontend events use the
same format and transport validation as backend events, and cannot choose the
log destination.
