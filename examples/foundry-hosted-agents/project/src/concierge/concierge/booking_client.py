import hashlib
import json

import httpx
from azure.core.credentials import TokenCredential

RETRIES = 3


def idempotency_key(trip: dict) -> str:
    """Same trip, same key: a retried POST cannot book twice."""
    return hashlib.sha256(json.dumps(trip, sort_keys=True).encode()).hexdigest()


class BookingClient:
    """Calls the internal booking API through API Management with the agent identity's token."""

    def __init__(self, base_url: str, scope: str, credential: TokenCredential, transport: httpx.BaseTransport | None = None):
        self._scope = scope
        self._credential = credential
        self._http = httpx.Client(base_url=base_url, timeout=30, transport=transport)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._credential.get_token(self._scope).token}"}

    def book(self, trip: dict) -> dict:
        headers = {**self._headers(), "Idempotency-Key": idempotency_key(trip)}
        response = None
        for _ in range(RETRIES):
            response = self._http.post("/trips", json=trip, headers=headers)
            if response.status_code < 500:
                break
        response.raise_for_status()
        return response.json()
