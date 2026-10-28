# Repository API

List up to 30 commits reachable from the repository's current `HEAD`:

- HTTP: `GET /api/repository/commits`
- Native JSON: `{"type":"list_commits"}`

The HTTP response contains a `commits` array. The native response wraps the
same data in `{"ok":true,"data":...}`.

```json
{
  "commits": [
    {
      "sha": "0123456789abcdef0123456789abcdef01234567",
      "subject": "Add repository history",
      "authorName": "Example Author",
      "commitDate": "2026-10-27T18:00:00-04:00"
    }
  ]
}
```

Each commit includes its full SHA, the first message line, the author name,
and the committer date in ISO 8601 format. UTC dates can end in `Z`.
`HEAD` comes first. The remaining commits follow Git's date order: children
precede their parents, and other commits follow commit date order. Merge
history includes both parents. Commits on other branches are excluded unless
they are reachable from `HEAD`.

Each request reads current history. Detached `HEAD` works. An unborn branch
returns `{"commits":[]}`. Listing commits does not change the active review,
comments, index, or working-tree files. The application still requires an
existing commit to open a review session.

Errors use these codes:

| Code | HTTP status | Cause |
| --- | --- | --- |
| `repository_unavailable` | 503 | Git cannot be found or executed. |
| `repository_failed` | 500 | Git execution fails or output exceeds the supported limit. |
| `invalid_commit_history` | 500 | Git returns incomplete records or invalid UTF-8. |

HTTP errors use `{"error":{"code":"...","message":"..."}}`. Native errors
add `"ok":false` to the same object.

The shared Zig response owns its result storage. Call `response.deinit()` after
use. Both transports release that storage after serialization, including when
serialization fails.
