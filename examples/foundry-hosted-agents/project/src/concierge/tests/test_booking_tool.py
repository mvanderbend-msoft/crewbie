from concierge.booking_client import BookingClient
from concierge.instructions import BOOKING, DATA_RULE
from concierge.tools.booking import book
from concierge.workflow import build_tools
from tests.conftest import FakeSearch


def tools(api, credential):
    booking = BookingClient("https://apim.example.net/booking", "api://booking-test/.default", credential, transport=api.transport)
    return build_tools(FakeSearch([]), booking)


def test_registered_book_trip_always_requires_approval(booking_api, credential):
    # Check the tool the workflow registers, not a freshly built one.
    assert tools(booking_api, credential)["book_trip"].approval_mode == "always_require"


def test_only_book_trip_has_side_effects(booking_api, credential):
    registered = tools(booking_api, credential)
    assert {name for name, t in registered.items() if t.approval_mode == "always_require"} == {"book_trip"}


def test_building_the_tools_never_calls_the_api(booking_api, credential):
    tools(booking_api, credential)
    assert booking_api.requests == []


def test_booking_result_is_fenced(booking_api, credential):
    client = BookingClient("https://apim.example.net/booking", "api://booking-test/.default", credential, transport=booking_api.transport)
    result = book(client, {"travellerId": "E0001"})
    assert result.startswith("<booking_result>") and "TRV-TEST-001" in result


def test_booking_instructions_refuse_change_and_cancel():
    assert "cannot change or cancel" in BOOKING
    assert DATA_RULE in BOOKING
