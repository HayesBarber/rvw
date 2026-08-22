# 01 - Init

I started using a tool called [tuicr](https://github.com/agavra/tuicr) recently. It is a code review tool with Vim bindings. One of my main use cases for this tool is actually not PR review, but AI generated code review during active development. `tuicr` has a feature where you can copy the review to your clipboard in structured markdown, and then I paste that review into whatever AI tool I am using. For example, `tuicr -w` opens up all uncommitted changes where I can do a code review and quickly iterate with an agent before I commit anything. Additionally, you can specify a range of commits like `tuicr -r main..HEAD`, where I may do one last review before opening a PR.

This workflow has felt ___really___ good, and has had me pondering on building something similar. Something along the lines of an Integrated _Reviewer_ Environment (IRE).

## Why?

If nothing else to learn and to have fun. I now find myself reviewing more code than ever before, but still want to be __heavily__ involved in the coding process. I feel it is critical to review/understand every change being made, but I must admit that AI can output text faster than I can type. Sometimes even for small/trivial changes I could easily make myself, but want to keep that context with the AI.
 
There are also some things about the aforementioned workflow where I find myself wanting more:
 
For starters, while I live in the terminal, I find myself wanting a more rich GUI for diffs. Idk what it is - maybe I haven't refined my themes/fonts enough, but the diffs in the terminal just don't hit the same for me. I often find myself opening up GitHub for diffs. I even have a function in my `.zshrc` called [compare](https://github.com/HayesBarber/dotfiles/blob/main/zshrc/.zshrc#L133) that opens the diff in GitHub.

Secondly, diffs are obvisouly centered around files that _changed_. What if I am framing changes I intend to make? What if there is a file I ancipated should change, but didn't? What if I am simply exploring a code base and asking questions? This is to say that I believe there are use cases for commenting/annotating a code base when there is no diff.

## MVP

I think v1.0 of this project should be able to do the following:

- Review uncommitted changes
- Review range of commits
- Open files that were not changed
- Annoate/comment on a line/range/file
- Export the review to the clipboard
- Vim bindings

There is plenty more I could think of, but I am not the biggest fan of projects never reaching v1.0, so I will stop here.

## Tech Stack

There is a diffs library, [Diffs by The Pierre Computer Co.](https://diffs.com/), that looks promising. The same company also has a [file tree library](https://trees.software/). The frontend will almost certainly revolve around these two libraries.

Being as how these are javascript libraries, we will need to serve the UI either in a browser tab or in webview via a desktop application. I would like to design this in such a way that both could work.

Some of the most popular desktop frameworks ([Electron](https://www.electronjs.org/), [Tauri](https://v2.tauri.app/), etc) work by having a web UI process and a native process that communicate via IPC. I have been liking Zig lately, so will likely skip using these frameworks but use the same architecutre just with a Zig native process. 

There are webview libraries ([webview](https://github.com/webview/webview), [webui](https://github.com/webui-dev/webui)), but again I think I am going to skip these. We can use FFI and spin up the window/webview with the native platform APIs, and serve it in the browser as a fallback. My primary machine is a Mac Mini, and also have a ThinkPad running Linux (Pop!_OS) that is my couch/travel computer. Those will be the primary platforms I have in mind for MVP.

While one could argure I should just use a desktop framework, one of my primary objectives with my open-source projects is to learn. Making some of these design decisions is the fun part! Not to mention the more granular control of using the native APIs.

I think Tauri and [Ghostty](https://github.com/ghostty-org/ghostty) are going to be two wonderful references for this project. Tauri for obvious reasons: being a webview based desktop framework. And Ghostty because it is designed as a Zig core with GUI consumers. Per the [Ghostty docs](https://ghostty.org/docs/about#libghostty):

```txt
The Ghostty GUI applications are consumers of libghostty. The macOS app is written in Swift, uses AppKit and SwiftUI, and links against the libghostty C API. The Linux app is written in Zig, uses the GTK4 C API, and also links against libghostty.
```

