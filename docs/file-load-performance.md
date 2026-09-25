# File-load performance

## Run the benchmark

Install Zig 0.16, Node.js, Git, and Google Chrome. Install the frontend dependencies:

```sh
npm ci --prefix frontend
npm run benchmark:file-load --prefix frontend -- /tmp/file-load-results.json
```

To use Playwright Chromium instead of Chrome, first run
`cd frontend && npx playwright install chromium`. Then set
`RVW_BENCH_BROWSER=chromium` for the benchmark command.

The command creates a temporary Git repository, starts a ReleaseFast HTTP
service, builds the production benchmark page, and opens headless Chrome at
1440 × 900. It removes the temporary repository and stops its services on exit.
Run benchmarks one at a time. Keep the machine idle and use the same browser,
viewport, and build settings for comparisons.

The fixed workload has six JavaScript files: changed and unchanged files with
100, 1,000, and 8,000 lines. Every twentieth line in a changed file has one changed
number. The source size ranges from about 2.7 KiB to 238 KiB, below the review
limit. The command runs:

- One initial open of each file in a fresh browser context.
- Five passes that reopen every file in the same order.
- Five rapid-switch passes. Each selection waits only for request scheduling;
  the last selection in each pass waits for visible content.

Initial opens share one browser context. Thus, only the first file has a cold
JavaScript highlighter. OS file caches are not cleared. Repeated opens retain the
review generation, so future caches can reuse data. The benchmark uses the same
`useReviewFile` hook and `DiffSurface` as the application. It excludes the file
tree, comments, startup, and development StrictMode.

The JSON output contains the environment, workload sizes, samples, frontend
and correlated backend events, aggregate statistics, per-file statistics, and
animation-frame gap statistics. Durations are in milliseconds. The median is
p50. The slow-case value is the nearest-rank p95; the maximum is also retained.
Small sample groups need repeated runs before drawing conclusions. Rapid-switch
visible timings include only loads that reached the visible marker. Compare
superseded counts as well as timings. Frame gaps measure main-thread stalls in
the benchmark page; they are not an input-latency measurement.

## Read the traces

Start the app or HTTP service with `--log-level debug` or `LOG_LEVEL=debug`.
See [Logging](logging.md) for the JSONL location. Configuration and overview
responses expose the effective timing flag. The overview flag enables timing
before the first automatic file selection. Default error-level operation does
not allocate traces, read timing clocks, inspect token markup, or send timing
log requests.

Each traced file request has an opaque ID in `traceId`. It uses a UUID when
the WebView supports that API, or a generated ASCII ID otherwise. The HTTP query or native JSON
request carries this ID to the backend. Events use the fixed message
`file load timing`, debug severity, and selected numeric fields. They do not
include file paths, source text, diffs, or exception messages.

| Stage | Measurement |
| --- | --- |
| `request_schedule` | Explicit file selection to the request effect. Automatic selections start at the effect. |
| `http_headers` | Fetch start to response headers, including server work. |
| `response_read_parse` | HTTP body read and JSON parsing, measured together. |
| `native_roundtrip` | WebKit request to reply, including queue, core, and JSON work. |
| `native_queue` | Time waiting on the serial native request queue. |
| `native_request_serialize` | Native request JSON encoding. |
| `native_response_parse` | Native response JSON decoding and envelope validation. |
| `backend_file` | Core file request, including provider lookup or filesystem read. |
| `response_serialize` | Backend JSON encoding; `bytes` is the encoded response size. |
| `response_ready` | Selection to accepted response. |
| `render_first` | Accepted response to the first renderer callback, including React scheduling, diff parsing, and rendering. |
| `highlight_tokens` | Accepted response to the first callback with styled token markup. |
| `visible` | Selection to two animation frames after the first renderer callback. |
| `completed` | Selection ended after the visible marker. |
| `superseded` | Selection ended before the visible marker. |
| `error` / `unavailable` | Request failed or content cannot be displayed. |

`render_update` records the first post-render callback as an additional marker.
Each stage runs on a local monotonic clock. Do not subtract wall-clock JSONL
timestamps to calculate cross-process durations. Stages overlap; do not add
all durations. Native timing events use the shared log relay and are therefore
marked as frontend events.

`visible` is a paint approximation, not a browser paint receipt.
`highlight_tokens` detects token markup in the renderer's shadow root without
reading text or private renderer fields. Plain text and unavailable files can
have no token marker. The fixed JavaScript workload requires both visible and
token markers. The current MultiFileDiff API combines parsing and rendering;
these stages do not claim separate parser or highlighter CPU time. Their timing
includes waits for asynchronous highlighting. A late callback from a superseded
request does not produce a completion event.

The current Git provider reads changed-file contents when it creates the review
snapshot. File selection then measures a snapshot lookup, not a new Git command.
Unchanged-file loads measure the filesystem provider. Snapshot construction and
Git subprocess startup are outside this file-selection baseline. Debug logging
adds work, particularly on the native serial queue. Keep it enabled in both
comparison runs.

## Baseline and target

The recorded baseline and environment are in
[file-load-baseline.json](file-load-baseline.json). It retains summaries and
per-file values; run the command to retain full events for a new comparison.
The baseline uses the issue #188 instrumentation on the recorded base revision.
On an Apple M1 with Chrome 154, the measured selection-to-visible times were:

| Workload | Median | p95 |
| --- | ---: | ---: |
| Initial diff open | 141.0 ms | 853.7 ms |
| Initial unchanged-file open | 65.8 ms | 399.0 ms |
| Repeated diff open | 123.9 ms | 839.5 ms |
| Repeated unchanged-file open | 60.5 ms | 399.9 ms |

The 8,000-line repeated-open medians were 820.5 ms for diffs and 388.9 ms for
unchanged files. Frame-gap p95 was 783.2 ms. The rapid-switch passes recorded
11 superseded loads out of 30 selections. This single run identifies rendering
as the largest measured cost; it does not establish a stable statistical limit.

For #189–#192, target at least a 50% reduction in repeated-open p95
selection-to-visible time for both diffs and unchanged files on this workload.
Also target a 50% reduction in the 8,000-line repeated-open median. Keep
initial-open p95 and frame-gap p95 within 10% of this baseline. Confirm changes
with at least three runs on the same machine. These are comparison targets,
not claims about native WebKit performance.

## Native follow-up

Build and open the macOS app with debug logging. Open a changed file and an
unchanged file. Switch files quickly, then reload the review. Check that content
matches the selected file and that JSONL events share a trace ID across native
queue, core, serialization, reply, and render stages. Repeat at the default log
level and confirm that no `file load timing` events are written. Native UI tests
are a manual follow-up; the automated baseline uses HTTP and Chrome.
