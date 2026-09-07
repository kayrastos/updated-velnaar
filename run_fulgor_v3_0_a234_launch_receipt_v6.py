#!/usr/bin/env python3
"""Persist a runner-bound A234 v6 gate receipt and optionally launch once."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from training.fulgor_ray_v3.a234_launch_receipt_v6 import (
    LaunchReceiptError,
    evaluate_gate,
    launch_after_record,
    record_gate,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Human-gated launch receipt for A234 v6")
    parser.add_argument(
        "--run",
        action="store_true",
        help="persist READY receipt and delegate to runner (FUTURE HUMAN-GATED USE ONLY)",
    )
    parser.add_argument(
        "--record",
        action="store_true",
        help="persist durable receipt without delegating",
    )
    parser.add_argument(
        "--inspect",
        action="store_true",
        help="inspect gate without persisting receipt (default non-executing mode)",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parent

    try:
        if args.run:
            record, path = record_gate(root)
            print(json.dumps({
                "status": record["status"],
                "record_path": str(path),
                "record_sha256": record["record_sha256"],
            }, sort_keys=True))
            return launch_after_record(root, path)

        if args.record:
            record, path = record_gate(root)
            print(json.dumps({
                "status": record["status"],
                "record_path": str(path),
                "record_sha256": record["record_sha256"],
            }, sort_keys=True))
            return 0 if record["status"] == "READY" else 1

        # Default inspection / preflight mode: zero side-effects
        gate = evaluate_gate(root)
        print(json.dumps({
            "status": gate["status"],
            "schema": gate["schema"],
            "checks": gate["checks"],
            "receipt_sha256": gate["receipt_sha256"],
            "runner_name": gate["runner_name"],
            "runner_sha256": gate["runner_sha256"],
            "stage_contract_prompts_v4_sha256": gate["stage_contract_prompts_v4_sha256"],
            "semantic_patch_intent_v2_sha256": gate["semantic_patch_intent_v2_sha256"],
            "candidate_host_binding_v1_sha256": gate["candidate_host_binding_v1_sha256"],
            "context_budget_v2_sha256": gate["context_budget_v2_sha256"],
            "candidate_v6_seal_sha256": gate["candidate_v6_seal_sha256"],
            "e2e_synthetic_smoke_summary_sha256": gate["e2e_synthetic_smoke_summary_sha256"],
            "model_revision": gate["model_revision"],
            "inference_executed": False,
            "marker_written": False,
            "training_started": False,
            "dev30_only": True,
        }, indent=2, sort_keys=True))
        return 0 if gate["status"] == "READY" else 1

    except LaunchReceiptError as exc:
        print(json.dumps({"status": "UNSAFE", "error": str(exc)}, sort_keys=True))
        return 73


if __name__ == "__main__":
    raise SystemExit(main())
