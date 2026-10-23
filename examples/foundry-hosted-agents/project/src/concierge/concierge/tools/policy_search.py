from typing import Annotated, Iterable

from agent_framework import tool
from azure.search.documents import SearchClient
from pydantic import Field

from concierge.fencing import fence

NO_MATCH = "NO_MATCHING_POLICY"


def format_hits(hits: Iterable[dict]) -> str:
    excerpts = [fence("policy_excerpt", hit["content"], title=hit["title"], section=hit["section"]) for hit in hits]
    return "\n".join(excerpts) if excerpts else NO_MATCH


def make_policy_search(client: SearchClient):
    @tool
    def search_policy(
        query: Annotated[str, Field(description="The traveller's policy question in plain words.")],
    ) -> str:
        """Search the Contoso travel policy. Returns excerpts with their title and section, or NO_MATCHING_POLICY."""
        hits = client.search(search_text=query, top=3, select=["title", "section", "content"])
        return format_hits(hits)

    return search_policy
