# 01 - Init

I started using a tool called [tuicr](https://github.com/agavra/tuicr) recently. It is a code review tool with Vim bindings. One of my main use cases for this tool is actually not PR review, but AI generated code review during active development. `tuicr` has a feature where you can copy the review to your clipboard in structured markdown, and then I paste that review into whatever AI tool I am using. For example, `tuicr -w` opens up all uncommitted changes where I can do a code review and quickly iterate with an agent before I commit anything. Additionally, you can specify a range of commits like `tuicr -r main..HEAD`, where I may do one last review before opening a PR.

This workflow has felt ___really___ good, and has had me pondering on building something similar. Something along the lines of an Integrated _Reviewer_ Environment (IRE).

## Why?

If nothing else to learn and to have fun. I now find myself reviewing more code than ever before, but still want to be __heavily__ involved in the coding process. I feel it is critical to review/understand every change being made, but I must admit that AI can output text faster than I can type. Sometimes even for small/trivial changes I could easily make myself, but want to keep that context with the AI.
 
There are also some things about the aforementioned workflow where I find myself wanting more:
 
For starters, while I live in the terminal, I find myself wanting a more rich GUI for diffs. Idk what it is - maybe I haven't refined my themes/fonts enough, but the diffs in the terminal just don't hit the same for me. I often find myself opening up GitHub for diffs. I even have a function in my `.zshrc` called [compare](https://github.com/HayesBarber/dotfiles/blob/main/zshrc/.zshrc#L133) that opens the diff in GitHub.

Secondly, diffs are obvisouly centered around files that _changed_. What if I am framing changes I intend to make? What if there is a file I ancipated should change, but didn't? What if I am simply exploring a code base and asking questions? This is to say that I believe there are use cases for commenting/annotating a code base when there is no diff.
