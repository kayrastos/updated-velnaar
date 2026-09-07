"""Unit and contract tests for stage_contract_prompts_v4.py."""

import json
import unittest

from training.fulgor_ray_v3.stage_contract_prompts_v4 import (
    COMMON_SYNTAX_CONTRACT,
    build_stage_messages,
    get_stage_system_prompt,
)


class TestStageContractPromptsV4(unittest.TestCase):
    def test_syntax_contract_contains_root_closure_rule(self):
        self.assertIn("BEFORE EOS: The root JSON object MUST be closed", COMMON_SYNTAX_CONTRACT)
        self.assertIn("ALWAYS emit the final '}' closing the root JSON object", COMMON_SYNTAX_CONTRACT)

    def test_diagnosis_prompt_enforces_closed_world_inventory(self):
        prompt = get_stage_system_prompt("diagnosis")
        self.assertIn("CRITICAL CLOSED-WORLD INVENTORY RULE", prompt)
        self.assertIn("EXACT string match of a file path from the provided repository_files list", prompt)
        self.assertIn("fulgor.diagnosis.v1", prompt)

    def test_plan_prompt_preserves_schema(self):
        prompt = get_stage_system_prompt("plan", diagnosis_hash="d" * 64)
        self.assertIn("fulgor.repair_plan.v1", prompt)
        self.assertIn("d" * 64, prompt)

    def test_candidate_prompt_uses_semantic_patch_intent_v2(self):
        prompt = get_stage_system_prompt(
            "candidate",
            candidate_id="cid-test",
            diagnosis_hash="d" * 64,
            plan_hash="p" * 64,
        )
        self.assertIn("fulgor.semantic_patch_intent.v2", prompt)
        self.assertIn("cid-test", prompt)
        self.assertIn("d" * 64, prompt)
        self.assertIn("p" * 64, prompt)
        self.assertIn("DO NOT emit expected_preimage_sha256 or anchor fields", prompt)
        self.assertIn("The trusted host derives all cryptographic hashes and anchors", prompt)

    def test_verifier_prompt_preserves_schema(self):
        prompt = get_stage_system_prompt("verifier", blinded_id="blind-test")
        self.assertIn("fulgor.verifier_score.v1", prompt)
        self.assertIn("blind-test", prompt)

    def test_all_stage_exemplars_parse_as_valid_json(self):
        for stage in ("diagnosis", "plan", "candidate", "verifier"):
            prompt = get_stage_system_prompt(
                stage,
                candidate_id="c1",
                diagnosis_hash="d" * 64,
                plan_hash="p" * 64,
                blinded_id="b1",
            )
            # Find the exemplar block after CANONICAL STRUCTURAL SHAPE EXEMPLAR:
            parts = prompt.split("CANONICAL STRUCTURAL SHAPE EXEMPLAR:\n")
            self.assertEqual(len(parts), 2, f"exemplar block missing for {stage}")
            exemplar_text = parts[1].strip()
            parsed = json.loads(exemplar_text)
            self.assertIsInstance(parsed, dict)
            self.assertIn("schema_version", parsed)

    def test_build_stage_messages(self):
        msgs = build_stage_messages("candidate", {"problem": "fix this"}, candidate_id="c1", diagnosis_hash="d"*64, plan_hash="p"*64)
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0]["role"], "system")
        self.assertEqual(msgs[1]["role"], "user")
        self.assertIn("fulgor.semantic_patch_intent.v2", msgs[0]["content"])
        self.assertIn("fix this", msgs[1]["content"])


if __name__ == "__main__":
    unittest.main()
