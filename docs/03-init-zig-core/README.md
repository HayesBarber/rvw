# 03 - Init Zig Core

With the frontend stubbed out, we should have the info we need to start building the Zig core to fulfill the frontend's needs.

The Zig core will be agnostic to the communication mechanism, but rather will wire up to a request/response dispatcher interface/adapter. This way we can implement dispatchers for HTTP, Unix Socket, C ABI, etc.

The core will also run in detached/daemon form, or at least be designed for that to be an option. This may not be super important for MVP, but hopefully sets us up for future integrations. For example, an AI harness or other tooling could interact with the APIs.

For starters, since we are still serving the UI from a browser, we will focus on:

- Request/resonse structures
- Building the dispatcher interface
- App logic serving reqeusts from the dispatch queue
- HTTP dispatcher implementation
- C ABI dispatcher implementation (probs unused for now)

