"""Runs every golden dataset against a concierge endpoint and fails below evals/thresholds.json."""

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from scoring import declined, evaluators, passed
from target import ResponsesTarget

ROOT = Path(__file__).parent


def rows(name: str) -> list[dict]:
    return [json.loads(line) for line in (ROOT / "datasets" / name).read_text().splitlines() if line.strip()]


def score(target, judges, restart_command=None) -> dict[str, list[bool]]:
    scores = defaultdict(list)
    for row in rows("policy.jsonl"):
        out = target.ask([row["query"]])
        if row["expected_decline"]:
            # A decline has no context, so groundedness would score it low; check the decline instead.
            scores["decline_accuracy"].append(declined(out["response"]))
        else:
            scores["groundedness"].append(passed(judges["groundedness"](query=row["query"], response=out["response"]), "groundedness"))
        scores["content_safety"].append(passed(judges["content_safety"](query=row["query"], response=out["response"]), "content_safety"))

    definitions = json.loads((ROOT / "datasets" / "tool_definitions.json").read_text())
    for row in rows("booking.jsonl"):
        out = target.ask([row["query"]])
        requested = out["approval_requests"]
        scores["no_tool_without_approval"].append(not any(c["name"] == "book_trip" for c in out["tool_calls"]))
        if row["expected_tool"] is None:
            scores["tool_call_accuracy"].append(not requested)
            continue
        result = judges["tool_call_accuracy"](query=row["query"], tool_calls=requested, tool_definitions=definitions)
        scores["tool_call_accuracy"].append(passed(result, "tool_call_accuracy"))

    for row in rows("multi_turn.jsonl"):
        if row["restart_before_final"] and restart_command:
            subprocess.run(restart_command, shell=True, check=True)
        out = target.ask(row["turns"] + [row["final"]])
        scores["task_adherence"].append(passed(judges["task_adherence"](query=row["final"], response=out["response"]), "task_adherence"))
    return scores


def gate(scores: dict[str, list[bool]], thresholds: dict[str, float]) -> dict[str, dict]:
    report = {}
    for metric, minimum in thresholds.items():
        values = scores.get(metric, [])
        rate = sum(values) / len(values) if values else 0.0
        report[metric] = {"pass_rate": rate, "threshold": minimum, "passed": rate >= minimum, "rows": len(values)}
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default="http://localhost:8088")
    parser.add_argument("--agent-version", required=True, help="Commit SHA of the code under test.")
    parser.add_argument("--restart-command")
    parser.add_argument("--out", default="results")
    args = parser.parse_args()

    thresholds = json.loads((ROOT / "thresholds.json").read_text())
    report = gate(score(ResponsesTarget(args.target), evaluators(), args.restart_command), thresholds)
    out = ROOT / args.out
    out.mkdir(exist_ok=True)
    result = {"agent_version": args.agent_version, "datasets": ["policy.jsonl", "booking.jsonl", "multi_turn.jsonl"], "metrics": report}
    (out / f"{args.agent_version}.json").write_text(json.dumps(result, indent=2))
    failed = [metric for metric, item in report.items() if not item["passed"]]
    print(json.dumps(report, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
