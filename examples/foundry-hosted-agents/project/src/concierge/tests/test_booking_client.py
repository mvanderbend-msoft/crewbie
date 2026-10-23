import httpx
import pytest

from concierge.booking_client import BookingClient, idempotency_key

TRIP = {"travellerId": "E0001", "origin": "AMS", "destination": "SEA", "departDate": "2026-11-02", "returnDate": "2026-11-06", "cabin": "economy"}


def client(api, credential):
    return BookingClient("https://apim.example.net/booking", "api://booking-test/.default", credential, transport=api.transport)


def test_books_with_the_agent_token(booking_api, credential):
    assert client(booking_api, credential).book(TRIP)["reference"] == "TRV-TEST-001"
    assert credential.scopes == ["api://booking-test/.default"]
    assert booking_api.requests[0].headers["Authorization"] == "Bearer test-token"


def test_retries_reuse_the_same_idempotency_key(booking_api, credential):
    booking_api.responses = [503, 502, 201]
    client(booking_api, credential).book(TRIP)
    keys = {request.headers["Idempotency-Key"] for request in booking_api.requests}
    assert len(booking_api.requests) == 3
    assert keys == {idempotency_key(TRIP)}


def test_client_errors_are_not_retried(booking_api, credential):
    booking_api.responses = [409]
    with pytest.raises(httpx.HTTPStatusError):
        client(booking_api, credential).book(TRIP)
    assert len(booking_api.requests) == 1


def test_key_ignores_field_order():
    assert idempotency_key(dict(reversed(list(TRIP.items())))) == idempotency_key(TRIP)
