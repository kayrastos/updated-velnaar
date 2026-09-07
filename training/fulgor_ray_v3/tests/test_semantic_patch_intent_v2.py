"""Unit and contract tests for semantic_patch_intent_v2.py."""

from dataclasses import asdict
import json
import unittest

from training.fulgor_ray_v3.a234_inference import canonical_hash
from training.fulgor_ray_v3.schemas import DiagnosisV1, EditKind, PlanStep, RepairPlanV1
from training.fulgor_ray_v3.semantic_patch_intent_v2 import (
    SemanticEditIntent,
    SemanticIntentError,
    SemanticPatchIntentV2,
    parse_semantic_patch_intent,
)


def make_diagnosis():
    return DiagnosisV1(
        target_files=("pkg/module.py",),
        symbols=(),
        observed_failure="failure",
        likely_cause="cause",
        constraints=("c1",),
        minimal_edit_intent="intent",
        uncertainties=(),
    )


def make_plan(diag):
    d_hash = canonical_hash(asdict(diag))
    return RepairPlanV1(
        diagnosis_hash=d_hash,
        steps=(PlanStep(1, "pkg/module.py", None, "fix"),),
        behavioral_postconditions=("post",),
        regression_risks=(),
        test_intent="test",
        preservation_constraints=("preserve",),
    )


def valid_payload(cid, diag, plan):
    return {
        "schema_version": "fulgor.semantic_patch_intent.v2",
        "candidate_id": cid,
        "diagnosis_hash": plan.diagnosis_hash,
        "plan_hash": canonical_hash(asdict(plan)),
        "edits": [
            {
                "kind": "replace",
                "file": "pkg/module.py",
                "start_line": 5,
                "end_line": 6,
                "replacement_text": "new code\n",
            }
        ],
        "rationale": "fixes issue",
        "expected_fail_to_pass_effect": "passes test",
        "regression_risks": [],
    }


class TestSemanticPatchIntentV2(unittest.TestCase):
    def setUp(self):
        self.diag = make_diagnosis()
        self.plan = make_plan(self.diag)
        self.cid = "candidate-1234"

    def test_valid_replace_intent(self):
        raw = json.dumps(valid_payload(self.cid, self.diag, self.plan))
        parsed = parse_semantic_patch_intent(raw, self.cid, self.diag, self.plan)
        self.assertEqual(parsed.schema_version, "fulgor.semantic_patch_intent.v2")
        self.assertEqual(parsed.candidate_id, self.cid)
        self.assertEqual(len(parsed.edits), 1)
        self.assertEqual(parsed.edits[0].kind, EditKind.REPLACE)
        self.assertEqual(parsed.edits[0].start_line, 5)
        self.assertEqual(parsed.edits[0].end_line, 6)
        self.assertEqual(parsed.edits[0].replacement_text, "new code\n")

    def test_valid_insert_intent(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"] = [{
            "kind": "insert",
            "file": "pkg/module.py",
            "start_line": 10,
            "end_line": 9,
            "replacement_text": "inserted\n",
        }]
        parsed = parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)
        self.assertEqual(parsed.edits[0].kind, EditKind.INSERT)
        self.assertEqual(parsed.edits[0].start_line, 10)
        self.assertEqual(parsed.edits[0].end_line, 9)

    def test_valid_delete_intent(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"] = [{
            "kind": "delete",
            "file": "pkg/module.py",
            "start_line": 10,
            "end_line": 12,
            "replacement_text": "",
        }]
        parsed = parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)
        self.assertEqual(parsed.edits[0].kind, EditKind.DELETE)
        self.assertEqual(parsed.edits[0].replacement_text, "")

    def test_rejection_of_expected_preimage_sha256(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"][0]["expected_preimage_sha256"] = "0" * 64
        with self.assertRaises(SemanticIntentError):
            parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)

    def test_rejection_of_anchor(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"][0]["anchor"] = "anchor_line\n"
        with self.assertRaises(SemanticIntentError):
            parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)

    def test_rejection_of_wrong_schema(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["schema_version"] = "fulgor.semantic_patch.v1"
        with self.assertRaises(SemanticIntentError):
            parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)

    def test_rejection_of_out_of_scope_file(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"][0]["file"] = "other/file.py"
        with self.assertRaises(SemanticIntentError):
            parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)

    def test_rejection_of_invalid_insert_span(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"] = [{
            "kind": "insert",
            "file": "pkg/module.py",
            "start_line": 10,
            "end_line": 10,  # Must be 9 for insert
            "replacement_text": "inserted\n",
        }]
        with self.assertRaises(SemanticIntentError):
            parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)

    def test_rejection_of_delete_with_replacement_text(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"] = [{
            "kind": "delete",
            "file": "pkg/module.py",
            "start_line": 10,
            "end_line": 12,
            "replacement_text": "not empty\n",
        }]
        with self.assertRaises(SemanticIntentError):
            parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)

    def test_rejection_of_missing_newline(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"][0]["replacement_text"] = "no newline"
        with self.assertRaises(SemanticIntentError):
            parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)

    def test_rejection_of_duplicate_edit_spans(self):
        p = valid_payload(self.cid, self.diag, self.plan)
        p["edits"] = [
            {"kind": "replace", "file": "pkg/module.py", "start_line": 5, "end_line": 6, "replacement_text": "r1\n"},
            {"kind": "replace", "file": "pkg/module.py", "start_line": 5, "end_line": 6, "replacement_text": "r2\n"},
        ]
        with self.assertRaises(SemanticIntentError):
            parse_semantic_patch_intent(json.dumps(p), self.cid, self.diag, self.plan)


if __name__ == "__main__":
    unittest.main()
