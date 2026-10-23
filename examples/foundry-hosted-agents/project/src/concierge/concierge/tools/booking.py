from datetime import date
from typing import Annotated, Literal

from agent_framework import tool
from pydantic import Field

from concierge.booking_client import BookingClient
from concierge.fencing import fence


def book(client: BookingClient, trip: dict) -> str:
    result = client.book(trip)
    return fence("booking_result", f"Booked. Reference {result['reference']}, status {result['status']}.")


def make_book_trip(client: BookingClient):
    @tool(approval_mode="always_require")
    def book_trip(
        traveller_id: Annotated[str, Field(description="Employee ID of the traveller.")],
        origin: Annotated[str, Field(description="IATA code of the departure airport.")],
        destination: Annotated[str, Field(description="IATA code of the arrival airport.")],
        depart_date: Annotated[date, Field(description="Outbound date.")],
        return_date: Annotated[date, Field(description="Return date.")],
        cabin: Annotated[Literal["economy", "premium_economy", "business"], Field(description="Cabin class.")],
    ) -> str:
        """Book a return flight for the traveller. Runs only after the traveller approves this exact trip."""
        trip = {
            "travellerId": traveller_id,
            "origin": origin,
            "destination": destination,
            "departDate": depart_date.isoformat(),
            "returnDate": return_date.isoformat(),
            "cabin": cabin,
        }
        return book(client, trip)

    return book_trip
