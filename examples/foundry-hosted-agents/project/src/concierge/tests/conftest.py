import httpx
import pytest


class FakeToken:
    token = "test-token"


class FakeCredential:
    def __init__(self):
        self.scopes = []

    def get_token(self, *scopes):
        self.scopes.extend(scopes)
        return FakeToken()


class FakeSearch:
    def __init__(self, hits):
        self.hits = hits
        self.queries = []

    def search(self, search_text, **_):
        self.queries.append(search_text)
        return iter(self.hits)


@pytest.fixture
def credential():
    return FakeCredential()


@pytest.fixture
def booking_api():
    """Records booking API requests; `responses` is a list of status codes to return in order."""

    class Api:
        def __init__(self):
            self.requests = []
            self.responses = [201]

        def handler(self, request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            status = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
            body = {"reference": "TRV-TEST-001", "status": "confirmed"} if status < 400 else {"error": "x"}
            return httpx.Response(status, json=body)

    api = Api()
    api.transport = httpx.MockTransport(api.handler)
    return api


@pytest.fixture
def settings_env(monkeypatch):
    values = {
        "FOUNDRY_PROJECT_ENDPOINT": "https://example.services.ai.azure.com/api/projects/test",
        "AZURE_AI_MODEL_DEPLOYMENT_NAME": "test-model",
        "AZURE_AI_SEARCH_ENDPOINT": "https://search.example.net",
        "AZURE_AI_SEARCH_INDEX": "travel-policy",
        "BOOKING_API_BASE_URL": "https://apim.example.net/booking",
        "BOOKING_API_SCOPE": "api://booking-test/.default",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    return values
