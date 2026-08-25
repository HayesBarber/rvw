# 04 - CLI Scaffolding

For the MVP I am thinking that the only way to launch the app will be the CLI. I would like to flush out some of those details, and then get some scaffolding in place.

## CLI Args

To launch `rvw`:

```zsh
rvw [dir] [-r --range]
```

If `dir` is not provided it will default to `.`. `-r` will be for a commit range (e.g. `main..HEAD`), and will default to uncommitted changes (staged and unstaged).

## Starup Procedure

The entrypoint will need to do a few things:

- Parse args and exit accordingly
- Check if core process is running
  - Yes? Launch UI
  - No? Launch core (fork/exec) and wait for it to startup before launching UI
  - How to tell if the core is running? Pre-defined UNIX socket and TCP port?
- Launch UI
  - MacOS
    - Start app binary that uses native window
    - Swift will talk to core process over Unix socket
  - Linux
    - Launch browser tab
    - Browser will talk to core process via HTTP
    - Core will serve the UI
  - We will need the frontend to be able to discover what communication mechanism it should use
    - If JS bridge APIs exist on the window object -> use them, otherwise use TCP
    - May want to consider a session token since the core would be listening on a TCP port
  - It is ok to launch multiple UIs for different directories/sessions

## Packaging

On MacOS, I guess there will be two executables? The CLI and the GUI. The CLI binary could live in the resources folder of the app bundle and be symlinked to the user's `$PATH`.

On Linux this can just be one binary until we introduce a native window in which case it may align with the MacOS structure. I am still not sure if the MVP will include a native Linux window, and we can remove the HTTP adapter.

## Post Implementation

I ended up not changeing the CLI for now. I think it is too early and there are still some decisions to be flushed out. For example, I am not sure if the core will run detached for MVP, and may instead be in-process via C-ABI. Additionally, I am not sure if I want the HTTP/Browser dispatcher.

For now, I created a UNIX socket dispatcher that obtains a lock file so we can detect if the core is running (detached). I also swapped the HTTP dispatcher to use [http.zig](https://github.com/karlseguin/http.zig) to make things a bit cleaner/more concise (especially if HTTP is going to be removed anyways).

