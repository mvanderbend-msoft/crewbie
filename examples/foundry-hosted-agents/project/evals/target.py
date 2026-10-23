import httpx


class ResponsesTarget:
    """Sends one conversation to a Responses endpoint, such as the host started by `uv run python main.py`."""

    def __init__(self, base_url: str, timeout: float = 120):
        self._http = httpx.Client(base_url=base_url, timeout=timeout)

    def ask(self, turns: list[str]) -> dict:
        # Earlier turns are replayed from the dataset, so one weak answer does not derail the final turn.
        messages = [{"role": "user", "content": text} for text in turns]
        response = self._http.post("/responses", json={"input": messages})
        response.raise_for_status()
        return parse(response.json())


def parse(body: dict) -> dict:
    text, calls, approvals = [], [], []
    for item in body.get("output", []):
        kind = item.get("type", "")
        if kind == "message":
            text += [part.get("text", "") for part in item.get("content", []) if part.get("type") == "output_text"]
        elif kind == "function_call":
            calls.append({"name": item["name"], "arguments": item.get("arguments")})
        elif kind.endswith("approval_request"):
            approvals.append({"name": item.get("name"), "arguments": item.get("arguments")})
    return {"response": "\n".join(text), "tool_calls": calls, "approval_requests": approvals}
