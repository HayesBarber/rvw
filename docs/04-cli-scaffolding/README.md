# 04 - CLI Scaffolding

For the MVP I am thinking that the only way to launch the app will be the CLI. I would like to flush out some of those details, and then get some scaffolding in place.

## CLI Args

To launch `rvw`:

```zsh
rvw [dir] [-r --range]
```

If `dir` is not provided it will default to `.`. `-r` will be for a commit range (e.g. `main..HEAD`), and will default to uncommitted changes (staged and unstaged).

## Starup Procedure



