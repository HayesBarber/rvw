# 02 - Stub Frontend

Finding a starting point for a project like this is kinda tricky. What should be the first piece? Frontend? Zig core? Browser or desktop window?

Considering the fact that the frontend will be using libraries to render diffs and file trees, I think it makes sense to stub out the frontend since I don't control those API footprints. Starting with the Zig core runs the risk that I create an API that is not compatible with the frontend, and I end up backtracking.

Here is what I am thinking:

- [Vite](https://vite.dev/) for the build tool
- React with Javascript
- No styling past structural layout
- 3 column layout
  - Left column is file tree
  - Middle column is diff view
  - Right column is review panel (holds comments / annotations)
- No styling past structural layout

## Why not Typescript?

I am all for static typing, but I don't really mind being dynamic on the frontend. If anything I think it allows for some flexibility and conciseness that Typescript won't give you.

Also, being as how I am the only dev on this (at least for now), type safety shouldn't be that big of a problem.

Of course the backend will be strongly typed.

