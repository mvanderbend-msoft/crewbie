import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    project_endpoint: str
    model: str
    search_endpoint: str
    search_index: str
    booking_base_url: str
    booking_scope: str


def load_settings() -> Settings:
    model = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME") or os.getenv("FOUNDRY_MODEL_NAME")
    if not model:
        raise RuntimeError("Set AZURE_AI_MODEL_DEPLOYMENT_NAME or FOUNDRY_MODEL_NAME.")
    return Settings(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=model,
        search_endpoint=os.environ["AZURE_AI_SEARCH_ENDPOINT"],
        search_index=os.environ["AZURE_AI_SEARCH_INDEX"],
        booking_base_url=os.environ["BOOKING_API_BASE_URL"],
        booking_scope=os.environ["BOOKING_API_SCOPE"],
    )
