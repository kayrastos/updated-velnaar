from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.validation.common import ValidationIssue
from kayra_ai.validation.models import ModeResolution, RunResult, RunSummary
from kayra_ai.validation.validate_dataset import validate_dataset


def load_jsonl_fixture(name: str) -> dict[str, object]:
    text = (ROOT / "tests" / "fixtures" / name).read_text(encoding="utf-8").strip()
    return json.loads(text)


class RunResultContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.success = load_jsonl_fixture("run_result_success.jsonl")
        self.failure = load_jsonl_fixture("run_result_error.jsonl")

    def test_success_and_failure_fixtures_are_valid(self) -> None:
        success = RunResult.model_validate(self.success)
        failure = RunResult.model_validate(self.failure)
        self.assertTrue(success.success)
        self.assertEqual("pipeline_only", success.evaluation.kind)
        self.assertFalse(failure.success)
        self.assertEqual("connection", failure.error.type if failure.error else None)

    def test_generation_contract_rejects_unknown_backend_parameter(self) -> None:
        record = deepcopy(self.success)
        record["generation"]["top_k"] = 20
        with self.assertRaises(ValueError):
            RunResult.model_validate(record)

    def test_response_content_hash_is_verified(self) -> None:
        record = deepcopy(self.success)
        record["response"]["content_sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            RunResult.model_validate(record)

    def test_not_retained_response_cannot_keep_content_hash_or_finish_reason(self) -> None:
        for field, value in (
            ("content", "sunucu gövdesi"),
            ("content_sha256", "0" * 64),
            ("finish_reason", "error"),
        ):
            with self.subTest(field=field):
                record = deepcopy(self.failure)
                record["response"][field] = value
                with self.assertRaises(ValueError):
                    RunResult.model_validate(record)

    def test_success_and_typed_error_must_agree(self) -> None:
        record = deepcopy(self.success)
        record["success"] = False
        with self.assertRaises(ValueError):
            RunResult.model_validate(record)

        record = deepcopy(self.failure)
        record["success"] = True
        with self.assertRaises(ValueError):
            RunResult.model_validate(record)

    def test_mock_result_cannot_claim_semantic_quality(self) -> None:
        record = deepcopy(self.success)
        record["evaluation"] = {
            "kind": "semantic_quality",
            "semantic_scoring_performed": True,
            "rubric_scores": [
                {"criterion": "correctness", "score": 1.0, "judge": "judge-a", "notes": None}
            ],
        }
        with self.assertRaises(ValueError):
            RunResult.model_validate(record)

    def test_same_case_can_have_multiple_unique_results(self) -> None:
        second = deepcopy(self.success)
        second["result_id"] = "stage1-mock-fixture.eval-tr-001.thinking.1"
        second["requested_profile"] = "thinking"
        second["mode_resolution"]["effective_profile"] = "thinking"
        second_content = "mock:eval-tr-001:thinking"
        second["response"]["content"] = second_content
        second["response"]["content_sha256"] = hashlib.sha256(
            second_content.encode("utf-8")
        ).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            path.write_text(
                "\n".join(json.dumps(item, ensure_ascii=False) for item in (self.success, second))
                + "\n",
                encoding="utf-8",
            )
            self.assertEqual(2, validate_dataset(path, "run-result"))

    def test_duplicate_result_id_is_rejected(self) -> None:
        duplicate = deepcopy(self.success)
        duplicate["case_id"] = "eval-tr-002"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            path.write_text(
                "\n".join(json.dumps(item, ensure_ascii=False) for item in (self.success, duplicate))
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValidationIssue):
                validate_dataset(path, "run-result")

    def test_secret_and_raw_diagnostic_fields_are_forbidden(self) -> None:
        for container, key in (
            ("response", "raw_body"),
            ("error", "exception_repr"),
            ("error", "authorization"),
        ):
            with self.subTest(key=key):
                record = deepcopy(self.failure)
                record[container][key] = "Bearer secret-canary"
                with self.assertRaises(ValueError):
                    RunResult.model_validate(record)

    def test_redirect_status_can_be_recorded_without_a_response_body(self) -> None:
        record = deepcopy(self.failure)
        record["error"] = {
            "type": "http_status",
            "message": "Yerel çalışma zamanı başarısız bir HTTP durumu döndürdü.",
            "retryable": False,
            "http_status": 302,
        }
        result = RunResult.model_validate(record)
        self.assertEqual(302, result.error.http_status if result.error else None)

    def test_mode_resolution_accepts_only_coherent_capability_states(self) -> None:
        valid = (
            ("supported", "thinking", False),
            ("supported", "non_thinking", False),
            ("unsupported", "unknown", False),
            ("unknown", "backend_default", True),
        )
        for capability, effective, fallback in valid:
            with self.subTest(valid=(capability, effective, fallback)):
                ModeResolution.model_validate(
                    {
                        "capability_status": capability,
                        "effective_profile": effective,
                        "fallback_used": fallback,
                    }
                )

        invalid = (
            ("unsupported", "thinking", False),
            ("unknown", "non_thinking", False),
            ("supported", "unknown", False),
            ("supported", "backend_default", True),
        )
        for capability, effective, fallback in invalid:
            with self.subTest(invalid=(capability, effective, fallback)), self.assertRaises(ValueError):
                ModeResolution.model_validate(
                    {
                        "capability_status": capability,
                        "effective_profile": effective,
                        "fallback_used": fallback,
                    }
                )

        record = deepcopy(self.success)
        record["requested_profile"] = "thinking"
        record["mode_resolution"]["effective_profile"] = "non_thinking"
        with self.assertRaises(ValueError):
            RunResult.model_validate(record)


class RunSummaryContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.summary = json.loads(
            (ROOT / "tests" / "fixtures" / "run_summary.json").read_text(encoding="utf-8")
        )

    def test_summary_fixture_is_valid(self) -> None:
        summary = RunSummary.model_validate(self.summary)
        self.assertEqual(40, summary.distinct_case_count)
        self.assertEqual(54, summary.execution_count)
        self.assertFalse(summary.semantic_scoring_performed)
        self.assertIsNone(summary.benchmark)

    def test_summary_counts_and_error_rate_are_reconciled(self) -> None:
        for field, value in (("execution_count", 53), ("success_count", 53), ("error_rate", 0.5)):
            with self.subTest(field=field):
                summary = deepcopy(self.summary)
                summary[field] = value
                with self.assertRaises(ValueError):
                    RunSummary.model_validate(summary)

    def test_summary_result_path_is_fixed_and_relative(self) -> None:
        summary = deepcopy(self.summary)
        summary["result_reference"]["path"] = "/tmp/results.jsonl"
        with self.assertRaises(ValueError):
            RunSummary.model_validate(summary)

    def test_mock_summary_rejects_benchmark_metrics(self) -> None:
        summary = deepcopy(self.summary)
        summary["benchmark"] = {
            "sample_count": 5,
            "warmup_count": 1,
            "ram_baseline_mib": None,
            "ram_idle_mib": None,
            "ram_peak_mib": None,
            "vram_baseline_mib": None,
            "vram_idle_mib": None,
            "vram_peak_mib": None,
            "tokens_per_second": 100.0,
            "first_token_ms": 10.0,
            "total_ms": 50.0,
        }
        with self.assertRaises(ValueError):
            RunSummary.model_validate(summary)


if __name__ == "__main__":
    unittest.main()
