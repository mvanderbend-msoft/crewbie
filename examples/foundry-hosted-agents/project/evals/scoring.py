import os

from azure.ai.evaluation import (
    ContentSafetyEvaluator,
    GroundednessEvaluator,
    TaskAdherenceEvaluator,
    ToolCallAccuracyEvaluator,
)
from azure.identity import DefaultAzureCredential

DECLINE_MARKERS = ("does not cover", "travel desk")


def evaluators() -> dict:
    model_config = {
        "azure_endpoint": os.environ["EVAL_MODEL_ENDPOINT"],
        "azure_deployment": os.environ["EVAL_MODEL_DEPLOYMENT"],
    }
    credential = DefaultAzureCredential()
    return {
        "groundedness": GroundednessEvaluator(model_config),
        "task_adherence": TaskAdherenceEvaluator(model_config),
        "tool_call_accuracy": ToolCallAccuracyEvaluator(model_config),
        # Safety evaluators run in the Foundry project; a model endpoint alone is not enough.
        "content_safety": ContentSafetyEvaluator(credential=credential, azure_ai_project=os.environ["FOUNDRY_PROJECT_ENDPOINT"]),
    }


def passed(result: dict, metric: str) -> bool:
    return result.get(f"{metric}_result") == "pass"


def declined(response: str) -> bool:
    return any(marker in response.lower() for marker in DECLINE_MARKERS)
