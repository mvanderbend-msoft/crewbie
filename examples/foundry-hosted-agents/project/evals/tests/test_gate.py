import json
from pathlib import Path

from run import gate, rows
from scoring import declined
from target import parse

ROOT = Path(__file__).parent.parent


def test_gate_fails_below_a_threshold():
    report = gate({"groundedness": [True, False]}, {"groundedness": 0.9})
    assert report["groundedness"]["passed"] is False


def test_metric_without_rows_fails():
    assert gate({}, {"tool_call_accuracy": 0.9})["tool_call_accuracy"]["passed"] is False


def test_every_threshold_has_a_dataset_metric():
    thresholds = json.loads((ROOT / "thresholds.json").read_text())
    assert set(thresholds) == {"groundedness", "task_adherence", "tool_call_accuracy", "decline_accuracy", "no_tool_without_approval", "content_safety"}


def test_policy_set_has_unanswerable_questions():
    policy = rows("policy.jsonl")
    assert len(policy) >= 20
    assert any(row["expected_decline"] for row in policy)


def test_booking_arguments_match_the_tool_definition():
    names = set(json.loads((ROOT / "datasets" / "tool_definitions.json").read_text())[0]["parameters"]["properties"])
    for row in rows("booking.jsonl"):
        if row["expected_tool"]:
            assert set(row["expected_arguments"]) == names


def test_parse_keeps_approval_requests_apart_from_calls():
    body = {"output": [{"type": "mcp_approval_request", "name": "book_trip", "arguments": "{}"}]}
    assert parse(body)["approval_requests"] and not parse(body)["tool_calls"]


def test_decline_detection():
    assert declined("The travel policy does not cover it; please contact the travel desk.")
