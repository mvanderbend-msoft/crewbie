from agent_framework import Agent, AgentExecutor, WorkflowBuilder
from agent_framework.foundry import FoundryChatClient
from azure.identity import DefaultAzureCredential
from azure.search.documents import SearchClient

from concierge.booking_client import BookingClient
from concierge.config import load_settings
from concierge.instructions import BOOKING, POLICY
from concierge.tools.booking import make_book_trip
from concierge.tools.policy_search import make_policy_search

# The host restores checkpoints by executor ID; renaming one strands conversations in flight.
POLICY_STEP = "policy"
BOOKING_STEP = "booking"


def build_tools(search_client: SearchClient, booking_client: BookingClient) -> dict:
    return {
        "search_policy": make_policy_search(search_client),
        "book_trip": make_book_trip(booking_client),
    }


def build_workflow(chat_client, tools: dict):
    def agent(name: str, instructions: str, tool_names: list[str]) -> Agent:
        return Agent(
            client=chat_client,
            name=name,
            instructions=instructions,
            tools=[tools[t] for t in tool_names],
            default_options={"store": False},
        )

    policy = AgentExecutor(agent("policy", POLICY, ["search_policy"]), id=POLICY_STEP)
    booking = AgentExecutor(agent("booking", BOOKING, ["book_trip"]), id=BOOKING_STEP)
    return WorkflowBuilder(start_executor=policy).add_edge(policy, booking).build()


def create_concierge():
    """Zero-argument factory for ResponsesHostServer; runs per request."""
    settings = load_settings()
    credential = DefaultAzureCredential()
    chat_client = FoundryChatClient(project_endpoint=settings.project_endpoint, model=settings.model, credential=credential)
    tools = build_tools(
        SearchClient(settings.search_endpoint, settings.search_index, credential),
        BookingClient(settings.booking_base_url, settings.booking_scope, credential),
    )
    return build_workflow(chat_client, tools).as_agent(name="concierge")
