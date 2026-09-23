# Codebase text-search contract

Text search applies to the opened review directory, including unchanged files.
Rvw currently requires this directory to be a Git worktree root. The core passes
that root to the provider. A request cannot select another directory. Searches
read working-tree content, including when the review uses a commit range or PR.

## Request

The frontend calls `searchText(query, mode)` in `frontend/src/review/api.js`.
The native bridge passes this object to the core. HTTP clients send the same
object as JSON to `POST /api/search/text`:

```json
{"type":"search_text","query":"needle","mode":"ignore-aware"}
```

Both `query` and `mode` are required strings. Supported modes are:

- `ignore-aware`: respect ignore rules.
- `all-files`: bypass ignore rules.

Queries are case-sensitive literal text, not regular expressions. Spaces are
significant. Queries must be valid UTF-8 and must not contain NUL, CR, or LF.
An empty query succeeds with no matches and `truncated: false` in either mode.
File-selection details, such as hidden files and symlinks, belong to the provider
implementation in issue #185.

## Result

```json
{
  "matches": [
    {
      "path": "src/雪.txt",
      "lineNumber": 12,
      "lineText": "a😀é",
      "spans": [{"start": 1, "end": 3}]
    }
  ],
  "truncated": false
}
```

Each match represents one file line. `path` is canonical and relative to the
opened directory. It uses `/` separators and has no leading `/`, `.` segment,
or `..` segment. `lineNumber` starts at 1 in the working-tree file. `lineText`
is valid Unicode text without its LF or CRLF terminator. Do not normalize Unicode
or expand tabs: offsets refer to the text as returned.

`spans` contains the matches within that line, in ascending order. Each span has
a zero-based start and an exclusive end, measured in UTF-16 code units. A span
must fit within `lineText` and must not split a surrogate pair. Providers must
convert any UTF-8 byte offsets to UTF-16 offsets. For example, the span `[1, 3)`
in `a😀é` selects the emoji. JavaScript can use `lineText.slice(start, end)`.

`truncated: true` means a result or output limit stopped the search. Returned
matches are valid but incomplete. It does not indicate a total match count or
provide a continuation token. A successful search with no matches returns an
empty array and `truncated: false`. Consumers must not depend on result order.

## Errors and transport shapes

HTTP success returns the result directly. Native core success returns
`{"ok":true,"data":RESULT}`; the Swift bridge resolves the frontend promise
with `data`. HTTP errors return `{"error":{"code":CODE,"message":MESSAGE}}`.
Native core errors add `"ok":false` to that shape. Both frontend transports
reject with the error message. Error codes are available in the wire response;
the current frontend error interface exposes the message only.

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `malformed_request` | 400 | Required fields are absent, have the wrong type, or use an unsupported mode. |
| `invalid_search_query` | 400 | The query has invalid UTF-8, NUL, or line breaks. |
| `search_not_implemented` | 501 | The current provider is a stub. |
| `search_unavailable` | 503 | Ripgrep is missing, cannot be found, or cannot execute. |
| `search_failed` | 500 | Search execution failed. |
| `internal_error` | 500 | An unexpected internal failure occurred. |

An error does not return partial results. A limit returns a successful result
with `truncated: true` instead.

## Provider and stub

`TextSearchProvider` uses the existing context and vtable pattern. Its `search`
method accepts `std.Io`, the directory supplied by the core, and the typed
request. Input strings are borrowed only for the call. The provider owns all
result slices and strings until its next search call or destruction. The host
must serialize calls and copy or serialize a result before another search.
Provider implementations own their cleanup; the interface does not free data.

Both native and HTTP startup install `StubProvider`. It returns
`search_not_implemented` for nonempty queries in either mode. Empty queries
return the empty success result. The stub does not read files or invoke ripgrep.
Search execution, UI, and navigation are separate work.
