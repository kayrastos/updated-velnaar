"""Unit and contract tests for run_fulgor_v3_0_a234_dev30_inference_v6.py."""

from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import run_fulgor_v3_0_a234_dev30_inference_v6 as runner_v6
from training.fulgor_ray_v3.a234_inference import canonical_hash
from training.fulgor_ray_v3.schemas import DiagnosisV1, PlanStep, RepairPlanV1


class MockGate:
    def dry_run(self, diff: str):
        return True, "OK"


def mock_verifier(blinded_id: str):
    return json.dumps({
        "schema_version": "fulgor.verifier_score.v1",
        "blinded_id": blinded_id,
        "diagnosis_consistency": 4,
        "plan_consistency": 4,
        "localization_confidence": 4,
        "likely_repair_benefit": 4,
        "pass_to_pass_safety": 4,
        "minimality": 4,
        "unnecessary_edit_absence": 4,
        "broad_edit_safety": 4,
        "reasons": ["excellent bounded fix"],
        "fatal_concerns": [],
    })


class TestA234RunnerV6(unittest.TestCase):
    def test_preflight_is_non_inferencing(self):
        res = runner_v6.preflight()
        self.assertEqual(res["status"], "PASS_A234_V6_GPU_RUNNER_PREFLIGHT")
        self.assertFalse(res["model_loaded"])
        self.assertFalse(res["inference_executed"])
        self.assertEqual(res["candidate_reserved_tokens"], 2048)
        self.assertTrue(res["closed_world_target_validation"])

    def test_runner_exposes_run_without_executing(self):
        self.assertTrue(callable(runner_v6.run))
        self.assertFalse(runner_v6.MARKER.exists())

    def test_process_candidates_v6_flow(self):
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            src_file = "calc.py"
            (repo / src_file).write_text("def add(a, b):\n    return a - b\n", encoding="utf-8")
            repo_files = (src_file,)

            diag = DiagnosisV1((src_file,), (), "failure", "cause", ("preserve",), "fix")
            d_hash = canonical_hash(asdict(diag))
            plan = RepairPlanV1(d_hash, (PlanStep(1, src_file, None, "fix"),), ("post",), (), "test", ("preserve",))
            p_hash = canonical_hash(asdict(plan))

            ids = ["candidate-" + hashlib.sha256(f"inst\0{i}".encode()).hexdigest()[:16] for i in range(3)]
            raws = []
            for cid in ids:
                payload = {
                    "schema_version": "fulgor.semantic_patch_intent.v2",
                    "candidate_id": cid,
                    "diagnosis_hash": d_hash,
                    "plan_hash": p_hash,
                    "edits": [
                        {
                            "kind": "replace",
                            "file": src_file,
                            "start_line": 2,
                            "end_line": 2,
                            "replacement_text": "    return a + b\n",
                        }
                    ],
                    "rationale": "fix operator",
                    "expected_fail_to_pass_effect": "passes add test",
                    "regression_risks": [],
                }
                raws.append(json.dumps(payload))

            outcomes, selected = runner_v6.process_candidates_v6(
                instance_id="inst",
                repository_root=str(repo),
                repository_files=repo_files,
                diagnosis=diag,
                plan=plan,
                raw_by_slot=raws,
                apply_gate=MockGate(),
                verify_generate=lambda c, p, g, b: mock_verifier(b),
            )

            self.assertEqual(len(outcomes), 3)
            self.assertTrue(all(o.failure_code is None for o in outcomes))
            self.assertTrue(all(o.gate.accepted for o in outcomes))
            self.assertTrue(all(o.score is not None for o in outcomes))
            self.assertIsNotNone(selected)
            self.assertFalse(isinstance(selected, runner_v6.NoPrimary))


if __name__ == "__main__":
    unittest.main()
