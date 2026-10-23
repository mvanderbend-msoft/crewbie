---
applyTo: "src/concierge/**/*.py"
---
# Agent Framework code

- Build the chat client with `FoundryChatClient` and serve through `ResponsesHostServer`; keep `main.py` a thin entry point and put agents, workflow and tools in their own modules.
- Pass `ResponsesHostServer` a zero-argument factory when per-request state is needed; keep workflow names and executor IDs stable, because the host restores checkpoints by them.
- Tools declare typed parameters with `Annotated[..., Field(description=...)]`; the description is what the model sees.
- Tests mock the booking API and the search client; no test calls a live Azure resource.
