from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.validation.check_overlap import find_overlaps
from kayra_ai.validation.check_pii import check_file, scan_text
from kayra_ai.validation.common import ValidationIssue, sha256_for
from kayra_ai.validation.models import EvalProvenance, PreferenceExample
from kayra_ai.validation.validate_assistant import validate_assistant
from kayra_ai.validation.validate_dataset import validate_dataset
from kayra_ai.validation.validate_jsonl import validate_jsonl


class SchemaTests(unittest.TestCase):
    def test_all_json_schemas_parse(self) -> None:
        schema_paths = sorted((ROOT / "schemas").glob("*.schema.json"))
        self.assertEqual(
            {
                "assistant.schema.json",
                "benchmark-series.schema.json",
                "eval-case.schema.json",
                "model-artifact.schema.json",
                "preference-example.schema.json",
                "run-result.schema.json",
                "run-summary.schema.json",
                "runtime-config.schema.json",
                "sft-example.schema.json",
            },
            {path.name for path in schema_paths},
        )
        for path in schema_paths:
            with self.subTest(path=path.name), path.open("r", encoding="utf-8") as handle:
                value = json.load(handle)
                self.assertEqual("https://json-schema.org/draft/2020-12/schema", value["$schema"])


class AssistantTests(unittest.TestCase):
    def test_assistant_definition_is_valid(self) -> None:
        assistant = validate_assistant(ROOT / "configs" / "assistant.yaml")
        self.assertEqual("Kayra", assistant.name)
        self.assertEqual(4096, assistant.generation_defaults["context_length"])
        self.assertFalse(assistant.privacy["embed_personal_data_in_weights"])


class DatasetTests(unittest.TestCase):
    def test_seed_eval_is_valid_and_has_expected_size(self) -> None:
        count = validate_dataset(ROOT / "data" / "eval" / "seed.jsonl", "eval")
        self.assertEqual(40, count)

    def test_seed_eval_provenance_is_synthetic_and_unreviewed(self) -> None:
        records = [
            json.loads(line)
            for line in (ROOT / "data" / "eval" / "seed.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual(40, len(records))
        for record in records:
            with self.subTest(case_id=record["id"]):
                provenance = record["provenance"]
                self.assertEqual("synthetic", provenance["kind"])
                self.assertEqual("OpenAI Codex", provenance["generator"])
                self.assertEqual("not_recorded", provenance["generator_model"])
                self.assertIs(False, provenance["human_reviewed"])
                self.assertEqual("draft/unreviewed", provenance["review_status"])
                self.assertNotIn("author", provenance)

    def test_seed_eval_has_no_known_pii_pattern(self) -> None:
        count, findings = check_file(ROOT / "data" / "eval" / "seed.jsonl")
        self.assertEqual(40, count)
        self.assertEqual([], findings)

    def test_jsonl_syntax_validator_rejects_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.jsonl"
            path.write_text('{"id": 1}\nnot-json\n', encoding="utf-8")
            with self.assertRaises(ValidationIssue):
                validate_jsonl(path)

    def test_duplicate_id_is_rejected(self) -> None:
        first = json.loads((ROOT / "data" / "eval" / "seed.jsonl").read_text(encoding="utf-8").splitlines()[0])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.jsonl"
            path.write_text(
                json.dumps(first, ensure_ascii=False) + "\n" + json.dumps(first, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValidationIssue):
                validate_dataset(path, "eval")

    def test_sft_hash_is_checked(self) -> None:
        messages = [
            {"role": "user", "content": "İki ile ikiyi topla."},
            {"role": "assistant", "content": "Dört."},
        ]
        record = {
            "schema_version": "1.0",
            "id": "sft-fixture-001",
            "split": "train",
            "language": "tr",
            "category": "arithmetic",
            "messages": messages,
            "provenance": {
                "kind": "human",
                "source_id": "unit-test",
                "license": "project-internal",
                "created_at": "2026-08-08T00:00:00+03:00",
                "generator": None,
                "critic": None,
                "prompt_version": None,
            },
            "content_sha256": sha256_for(messages),
            "pii": {"contains_personal_data": False, "reviewed": True},
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sft.jsonl"
            path.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
            self.assertEqual(1, validate_dataset(path, "sft"))
            record["content_sha256"] = "0" * 64
            path.write_text(json.dumps(record, ensure_ascii=False) + "\n", encoding="utf-8")
            with self.assertRaises(ValidationIssue):
                validate_dataset(path, "sft")

    def test_same_synthetic_generator_and_critic_is_rejected(self) -> None:
        data = {
            "schema_version": "1.0",
            "id": "pref-fixture-001",
            "split": "train",
            "language": "tr",
            "category": "style",
            "prompt_messages": [{"role": "user", "content": "Kısa yanıt ver."}],
            "chosen": "Kısa yanıt.",
            "rejected": "Gereksiz derecede uzun bir yanıt.",
            "preference_reason": "Seçilen yanıt talimatı daha iyi izliyor.",
            "provenance": {
                "kind": "synthetic",
                "source_id": "unit-test",
                "license": "project-internal",
                "created_at": "2026-08-08T00:00:00+03:00",
                "generator": "teacher-a",
                "critic": "teacher-a",
                "prompt_version": "v1",
            },
            "content_sha256": "0" * 64,
            "pii": {"contains_personal_data": False, "reviewed": False},
        }
        with self.assertRaises(ValueError):
            PreferenceExample.model_validate(data)

    def test_unreviewed_eval_cannot_be_marked_reviewed(self) -> None:
        with self.assertRaises(ValueError):
            EvalProvenance.model_validate(
                {
                    "kind": "synthetic",
                    "generator": "OpenAI Codex",
                    "generator_model": "not_recorded",
                    "human_reviewed": False,
                    "license": "project-internal",
                    "created_at": "2026-08-08T00:00:00+03:00",
                    "review_status": "reviewed",
                }
            )


class PrivacyAndLeakageTests(unittest.TestCase):
    def test_email_is_detected_and_redacted_in_finding(self) -> None:
        findings = scan_text("İletişim: deneme.kullanici@example.org")
        self.assertEqual("email", findings[0].kind)
        self.assertNotIn("deneme.kullanici", findings[0].preview)

    def test_pii_fixture_fails_scan(self) -> None:
        count, findings = check_file(ROOT / "tests" / "fixtures" / "pii.jsonl")
        self.assertEqual(1, count)
        self.assertTrue(findings)

    def test_exact_train_eval_overlap_is_detected(self) -> None:
        findings = find_overlaps(
            ROOT / "tests" / "fixtures" / "overlap_train.jsonl",
            ROOT / "tests" / "fixtures" / "overlap_eval.jsonl",
        )
        self.assertEqual(1, len(findings))
        self.assertTrue(findings[0].startswith("exact:"))


if __name__ == "__main__":
    unittest.main()
