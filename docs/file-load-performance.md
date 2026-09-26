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

- One initial open of each file in a fresh browser context, with a 250 ms
  reading interval after each visible file to allow nearby warming.
- Five passes that reopen every file in the same order.
- Five rapid-switch passes. Each selection waits only for request scheduling;
  the last selection in each pass waits for visible content.

Initial opens share one browser context. Thus, only the first file has a cold
JavaScript highlighter. OS file caches are not cleared. Repeated opens retain the
review generation, so the file cache can reuse data. The benchmark uses the same
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
| `cache_hit` / `cache_miss` | Cache lookup outcome for one selection. Count these events to measure reuse. |
| `cache_eviction` | One least-recently-used entry was removed after a load. |
| `response_ready` | Selection to prepared content, including diff parsing on a cache miss. |
| `render_first` | Accepted response to the first renderer callback, including React scheduling and rendering. |
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
token markers. The file loader parses old/new inputs with `parseDiffFromFile` on a cache miss.
`DiffSurface` passes this metadata to `FileDiff`. Parsing is now included in
`response_ready`, rather than `render_first`. These stages do not claim separate
parser or highlighter CPU time. Their timing
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

## Explicit parsing comparison (#189)

[file-load-explicit-parsing.json](file-load-explicit-parsing.json) records three
runs before and three runs after the switch to `FileDiff`. All six runs used
the same Apple M1, Chrome 154, dependencies, and fixed workload. The report
retains each run's environment, stage summaries, per-file values, and frame gaps.
The before runs use revision `cf9aa9f`; the after runs add the `DiffSurface`
change in the pull request that contains this report.

The table shows the median of the three p95 values, in milliseconds:

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial diff open | 857.9 | 846.0 |
| Initial unchanged-file open | 392.3 | 388.3 |
| Repeated diff open | 837.5 | 839.2 |
| Repeated unchanged-file open | 397.5 | 391.6 |
| Frame gap | 783.4 | 783.2 |

The median of the three 8,000-line repeated-open medians changed from
822.6 to 828.3 ms for diffs and from 386.8 to 384.9 ms for unchanged files.
Rapid-switch superseded counts were 10, 12, and 13 before, and 12, 12, and 13
after, out of 30 selections per run. These results show no material regression.
They do not establish a performance improvement. Caching, warming, and
highlighter preloading remain separate work.

## File cache policy (#190)

Each mounted review session retains at most 20 files in one LRU cache. Changed
and unchanged files share this limit. Entries contain parsed `FileDiffMetadata`
and its source inputs, or unchanged file content. The snapshot identity contains
the backend diff ID and reload generation. File identity contains the canonical
path and whether the file is changed. Thus, the same path cannot reuse content
from another snapshot or from the other file kind.

A hit moves the entry to the most-recent position. A successful miss inserts
an entry and removes the least-recent entry if the count exceeds 20. Errors and
unavailable content are not cached. This is an entry limit, not a byte limit;
large files consume more memory than small files. The backend content-size
limits still apply. Each selection has a separate timing object, while source
content and parsed metadata remain shared.

A successful `review.reload` clears the cache before the session updates its
generation. Snapshot changes and unmount also clear it. Each pending load holds
an invalidation token. A late response from an older token is discarded before
parsing or insertion. Selection guards also prevent a response for a previously
selected file from replacing the current file. Unchanged content remains fixed
while cached; use Reload to read filesystem changes. Nearby-file warming and
pending-request deduplication are described below.

The cache events use the existing opt-in timing trace. They contain no file
identity or content. Their event counts are the hit, miss, and eviction counts;
their duration is elapsed selection time, not cache CPU time.

## File cache comparison (#190)

[file-load-cache.json](file-load-cache.json) records three runs before and three
runs after the cache change. All six runs used the same Apple M1, Chrome 154,
dependencies, and fixed workload. Before uses revision `13f5094`; after adds the
source changes in the pull request that contains this report. One preliminary
after run overlapped compilation and was excluded. The retained runs were
sequential, without concurrent builds or tests.

The table shows the median of the three p95 values, in milliseconds:

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial diff open | 848.3 | 859.0 |
| Initial unchanged-file open | 389.1 | 390.0 |
| Repeated diff open | 830.5 | 802.8 |
| Repeated unchanged-file open | 393.9 | 408.2 |
| Repeated diff content ready | 6.9 | 1.4 |
| Repeated unchanged content ready | 8.5 | 2.2 |
| Frame gap | 783.3 | 750.0 |

The 8,000-line repeated-open median changed from 823.5 to 783.8 ms for diffs
and from 384.2 to 380.7 ms for unchanged files. These values are the median
of each run's median. Diff repeated-open timings improved modestly. Unchanged
file results are mixed: the large-file median decreased, but p95 increased
3.6%. The runs do not establish a clear unchanged-file rendering improvement.
Cold-load and frame-gap p95 remain within the 10% comparison limit.

Each after run recorded six initial misses and 60 hits across repeated and
rapid selections. None of those 60 selections had a backend file request.
The six-file workload fits within the capacity and caused no eviction; unit
tests verify eviction separately. Rapid-switch superseded counts were 10, 12,
and 11 before, and 8 in each after run, out of 30 selections per run.

The cache removes repeated fetching and parsing. It does not remove renderer
or highlighting work. These results do not meet the parent issue's 50%
rendering targets. Warming and highlighter preloading remain separate work.

## Nearby-file warming (#191)

The cache warms up to two files on each side of the selection. It uses the
same ordered paths as keyboard navigation in the current tree mode. The next
file has priority, followed by the previous file, then the two outer neighbors.
The window stops at list boundaries. It never wraps. Changed files use the diff
endpoint; unchanged files use the file endpoint.

Only one speculative load runs at a time. Warming starts in an idle callback
after the selected request completes. Browsers without `requestIdleCallback`
use a 50 ms timer. An active selection starts immediately, or shares an existing
request for that file. Queued neighbors are replaced on selection changes.
Already submitted transport requests cannot be cancelled through the shared API.
An obsolete speculative response is discarded before parsing or insertion.
The physical warming slot stays occupied until that request ends, including
across reloads. Background failures are silent and remain retryable.

The selected entry is excluded from eviction. The window is also limited to
capacity minus one, so a one-entry cache does no warming. Successful speculative
entries share the 20-entry LRU limit with active entries. Reload cancels queued
work and pending idle parsing. The existing generation token rejects late
responses. Per-selection response guards still prevent stale display updates.

Diff parsing runs in a separate idle callback on the UI thread. Selecting a
file whose parse is waiting promotes that parse immediately. The installed
`@pierre/diffs` worker API performs highlighting on already parsed metadata;
it has no public task for `parseDiffFromFile`. A custom module worker could
run the parser, but would add worker startup, source/result cloning, and native
WebView asset-loading requirements. This change retains the shared parser and
measures frame gaps. One synchronous parse cannot be interrupted once started.
The choice does not guarantee a maximum frame time for every repository.
Highlighter preloading remains part of #192.

The benchmark passes the fixed workload order into the production hook. Set
`RVW_BENCH_WARM=0` to disable warming for a comparison run. Both settings use
the same reading interval, cache, renderer, and rapid-switch workload. The first
selection is cold; later initial selections can be warm. This differs from the
initial-open workload in the older reports. Compare paired runs with the same
setting for the reading interval, rather than treating the old reports as a
controlled warming comparison.

## Warming comparison (#191)

[file-load-warming.json](file-load-warming.json) retains three paired runs on
Apple M1 with Chrome 154. Runs alternated warming disabled and enabled, without
concurrent builds or tests. Both settings used the source in this PR and the
250 ms reading interval. The recorded revision is the base revision.

The table shows the median of the three p95 values, in milliseconds:

| Measurement | Disabled | Enabled |
| --- | ---: | ---: |
| Initial diff content ready | 86.0 | 7.2 |
| Initial unchanged content ready | 15.0 | 6.8 |
| Initial diff visible | 896.9 | 841.8 |
| Initial unchanged visible | 429.2 | 422.6 |
| Repeated diff visible | 788.1 | 791.8 |
| Repeated unchanged visible | 385.4 | 387.2 |
| Frame gap | 366.6 | 366.7 |

Each enabled run recorded five initial cache hits after the first cold file,
compared with zero when disabled. Those five selections made no backend file
request and did not parse a diff again. Repeated and rapid selections recorded
60 hits per run with either setting. The cache avoids fetching and parsing;
rendering remains the largest cost. The first cold file's median visible time
was 98.2 ms with warming disabled and 97.6 ms with warming enabled. One enabled
run took 240.0 ms for that first file; the other two took 97.6 and 95.4 ms.
The paired medians show no material active-load or frame-gap regression, but
three runs do not establish a worst-case bound. Frame gaps are not an input
latency measurement, and this benchmark excludes application startup.
These results do not meet the parent issue's 50% rendering targets.

## Cleanup after the targets are met

Complete this cleanup as part of #173, after #189–#192 meet the targets above
in at least three comparable runs. Keep the detailed traces until the final
comparison is recorded. Disabling debug logs alone does not complete cleanup.

- Record the final results, environment, and tested commit beside the original
  baseline. Keep both records and the fixed workload for future comparisons.
- Keep a small benchmark for selection-to-visible time, rapid-switch outcomes,
  and frame gaps. Move its measurement hooks into the benchmark before removing
  the application probes. The benchmark must still exercise the production
  request and renderer paths.
- Remove the temporary stage collector in `frontend/src/review/file-timing.js`
  and its calls in the API, selected-file hook, review session, and `DiffSurface`.
  Remove the styled-token DOM inspection, extra animation-frame callbacks, and
  per-stage log requests from the application.
- Remove the file-timing code from the Zig dispatcher, core, and response
  encoders, and from the Swift request router and bridge. This includes the
  extra native log dispatches used to measure queue and JSON conversion time.
- Remove the `debugTimings` response fields and file-request `traceId` fields,
  validation helpers, and tests if no retained diagnostic uses them. Keep the
  shared JSONL logger, its general `traceId` support, and error logging.
- Update the benchmark report, tests, and this guide to match the retained
  measurements. Remove obsolete stage assertions and instructions. Keep
  Playwright while the browser benchmark uses it; remove dependencies only
  when they have no remaining use.

Run the retained benchmark, repository tests, lint, and app build after cleanup.
Confirm that the targets still hold and that rapid switching and reload still
show the correct file. Record the cleanup commit with the final results.
