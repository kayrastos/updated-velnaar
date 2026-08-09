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
from kayra_ai.validation.models import (
    ModeResolution,
    PINNED_STAGE2_ARTIFACT_SHA256,
    RunResult,
    RunSummary,
    TimingMetrics,
    TokenUsage,
)
from kayra_ai.validation.validate_dataset import validate_dataset


def load_jsonl_fixture(name: str) -> dict[str, object]:
    text = (ROOT / "tests" / "fixtures" / name).read_text(encoding="utf-8").strip()
    return json.loads(text)


class RunResultContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.success = load_jsonl_fixture("run_result_success.jsonl")
        self.failure = load_jsonl_fixture("run_result_error.jsonl")

    def native_success(self, profile: str = "thinking") -> dict[str, object]:
        record = deepcopy(self.success)
        record["runtime"] = {"name": "lm_studio", "version": None, "platform": "windows"}
        record["model"] = {
            "id": f"sha256:{'1' * 64}",
            "revision": f"sha256:{'2' * 64}",
            "artifact_sha256": PINNED_STAGE2_ARTIFACT_SHA256,
        }
        record["requested_profile"] = profile
        requested_reasoning = "on" if profile == "thinking" else "off"
        observed = "present" if profile == "thinking" else "absent"
        record["mode_resolution"] = {
            "capability_status": "supported",
            "effective_profile": "unknown",
            "fallback_used": False,
            "requested_reasoning": requested_reasoning,
            "advertised_reasoning_options": ["off", "on"],
            "advertised_reasoning_default": "off",
            "observed_reasoning_output": observed,
            "resolved_reasoning_state": "unknown",
            "verification_status": "behaviorally_consistent",
            "evidence_source": "lm_studio_native_v1_response",
        }
        record["usage"] = {
            "source": "lm_studio_native_v1",
            "prompt_tokens": 20,
            "completion_tokens": 8,
            "total_tokens": None,
            "reasoning_tokens": 3 if profile == "thinking" else 0,
        }
        record["timing"] = {
            "first_token_ms": 12.5,
            "first_token_ms_source": "lm_studio_native_v1",
            "generation_ms": None,
            "generation_ms_source": "unavailable",
            "total_ms": 80.0,
            "total_ms_source": "client_measured",
            "tokens_per_second": 30.0,
            "tokens_per_second_source": "lm_studio_native_v1",
            "model_load_ms": None,
            "model_load_ms_source": "unavailable",
        }
        return record

    def fallback_success(self) -> dict[str, object]:
        record = deepcopy(self.success)
        record["runtime"] = {"name": "llama_cpp", "version": None, "platform": "offline"}
        record["model"] = {
            "id": f"sha256:{'3' * 64}",
            "revision": None,
            "artifact_sha256": None,
        }
        record["mode_resolution"] = {
            "capability_status": "unsupported",
            "effective_profile": "backend_default",
            "fallback_used": True,
            "requested_reasoning": None,
            "advertised_reasoning_options": None,
            "advertised_reasoning_default": None,
            "observed_reasoning_output": "unknown",
            "resolved_reasoning_state": None,
            "verification_status": "fallback",
            "evidence_source": "unverified",
        }
        record["usage"] = {
            "source": "unavailable",
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "reasoning_tokens": None,
        }
        record["timing"] = {
            "first_token_ms": None,
            "first_token_ms_source": "unavailable",
            "generation_ms": None,
            "generation_ms_source": "unavailable",
            "total_ms": 10.0,
            "total_ms_source": "client_measured",
            "tokens_per_second": None,
            "tokens_per_second_source": "unavailable",
            "model_load_ms": None,
            "model_load_ms_source": "unavailable",
        }
        return record

    def test_success_and_failure_fixtures_are_valid(self) -> None:
        success = RunResult.model_validate(self.success)
        failure = RunResult.model_validate(self.failure)
        self.assertTrue(success.success)
        self.assertEqual("pipeline_only", success.evaluation.kind)
        self.assertFalse(failure.success)
        self.assertEqual("connection", failure.error.type if failure.error else None)

    def test_json_schema_21_required_fields_match_pydantic_contracts(self) -> None:
        schema = json.loads(
            (ROOT / "schemas" / "run-result.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual("2.1", schema["properties"]["schema_version"]["const"])
        self.assertEqual(
            {name for name, field in RunResult.model_fields.items() if field.is_required()},
            set(schema["required"]),
        )
        for model, definition in (
            (ModeResolution, "mode_resolution"),
            (TokenUsage, "usage"),
            (TimingMetrics, "timing"),
        ):
            with self.subTest(definition=definition):
                expected = {
                    name for name, field in model.model_fields.items() if field.is_required()
                }
                self.assertEqual(expected, set(schema["$defs"][definition]["required"]))

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
            {
                "capability_status": "supported",
                "effective_profile": "thinking",
                "fallback_used": False,
                "requested_reasoning": None,
                "advertised_reasoning_options": None,
                "advertised_reasoning_default": None,
                "observed_reasoning_output": "unknown",
                "resolved_reasoning_state": None,
                "verification_status": "static_verified",
                "evidence_source": "static_backend",
            },
            {
                "capability_status": "supported",
                "effective_profile": "unknown",
                "fallback_used": False,
                "requested_reasoning": "on",
                "advertised_reasoning_options": ["off", "on"],
                "advertised_reasoning_default": "off",
                "observed_reasoning_output": "present",
                "resolved_reasoning_state": "unknown",
                "verification_status": "behaviorally_consistent",
                "evidence_source": "lm_studio_native_v1_response",
            },
            {
                "capability_status": "unsupported",
                "effective_profile": "unknown",
                "fallback_used": False,
                "requested_reasoning": None,
                "advertised_reasoning_options": None,
                "advertised_reasoning_default": None,
                "observed_reasoning_output": "unknown",
                "resolved_reasoning_state": None,
                "verification_status": "unknown",
                "evidence_source": "unverified",
            },
            {
                "capability_status": "unknown",
                "effective_profile": "backend_default",
                "fallback_used": True,
                "requested_reasoning": None,
                "advertised_reasoning_options": None,
                "advertised_reasoning_default": None,
                "observed_reasoning_output": "unknown",
                "resolved_reasoning_state": None,
                "verification_status": "fallback",
                "evidence_source": "unverified",
            },
        )
        for value in valid:
            with self.subTest(valid=value):
                ModeResolution.model_validate(value)

        invalid = (
            {**valid[0], "capability_status": "unsupported"},
            {**valid[0], "effective_profile": "unknown"},
            {**valid[1], "effective_profile": "thinking"},
            {**valid[1], "resolved_reasoning_state": None},
            {**valid[2], "requested_reasoning": "off"},
            {**valid[3], "verification_status": "unknown"},
        )
        for value in invalid:
            with self.subTest(invalid=value), self.assertRaises(ValueError):
                ModeResolution.model_validate(value)

        record = deepcopy(self.success)
        record["requested_profile"] = "thinking"
        record["mode_resolution"]["effective_profile"] = "non_thinking"
        with self.assertRaises(ValueError):
            RunResult.model_validate(record)

    def test_native_reasoning_evidence_keeps_effective_state_unknown(self) -> None:
        record = self.native_success()
        result = RunResult.model_validate(record)
        self.assertEqual("unknown", result.mode_resolution.effective_profile)
        self.assertEqual("unknown", result.mode_resolution.resolved_reasoning_state)
        self.assertIsNone(result.usage.total_tokens)

        for field, value in (
            ("effective_profile", "thinking"),
            ("resolved_reasoning_state", None),
            ("observed_reasoning_output", "absent"),
        ):
            with self.subTest(field=field):
                broken = deepcopy(record)
                broken["mode_resolution"][field] = value
                with self.assertRaises(ValueError):
                    RunResult.model_validate(broken)

    def test_native_behavior_is_bound_to_pinned_execution_and_metric_contract(self) -> None:
        loaded = self.native_success()
        loaded["timing"]["model_load_ms"] = 40.0
        loaded["timing"]["model_load_ms_source"] = "lm_studio_native_v1"
        RunResult.model_validate(loaded)

        mutations = (
            ("context", (("generation.context_length", 2048),)),
            ("stream", (("generation.stream", True),)),
            ("artifact", (("model.artifact_sha256", "0" * 64),)),
            ("usage", (("usage.source", "backend_reported"),)),
            ("ttft", (("timing.first_token_ms_source", "mock_deterministic"),)),
            (
                "generation",
                (
                    ("timing.generation_ms", 10.0),
                    ("timing.generation_ms_source", "client_measured"),
                ),
            ),
            ("total", (("timing.total_ms_source", "mock_deterministic"),)),
            ("tps", (("timing.tokens_per_second_source", "backend_reported"),)),
        )
        for label, changes in mutations:
            with self.subTest(label=label):
                broken = self.native_success()
                for dotted_path, value in changes:
                    container, field = dotted_path.split(".")
                    broken[container][field] = value
                with self.assertRaises(ValueError):
                    RunResult.model_validate(broken)

    def test_real_runtime_model_id_and_revision_are_one_way_sha256_identities(self) -> None:
        RunResult.model_validate(self.native_success())
        for field in ("id", "revision"):
            with self.subTest(field=field):
                record = self.native_success()
                record["model"][field] = "raw-environment-value"
                with self.assertRaises(ValueError):
                    RunResult.model_validate(record)

        failure = deepcopy(self.failure)
        failure["model"]["id"] = "configured-model"
        with self.assertRaises(ValueError):
            RunResult.model_validate(failure)

    def test_successful_unknown_profile_verification_is_forbidden(self) -> None:
        record = self.fallback_success()
        record["mode_resolution"] = {
            "capability_status": "unsupported",
            "effective_profile": "unknown",
            "fallback_used": False,
            "requested_reasoning": None,
            "advertised_reasoning_options": None,
            "advertised_reasoning_default": None,
            "observed_reasoning_output": "unknown",
            "resolved_reasoning_state": None,
            "verification_status": "unknown",
            "evidence_source": "unverified",
        }
        with self.assertRaises(ValueError):
            RunResult.model_validate(record)

    def test_fallback_is_limited_to_llama_cpp(self) -> None:
        RunResult.model_validate(self.fallback_success())
        for runtime_name in ("lm_studio", "mock"):
            with self.subTest(runtime=runtime_name):
                record = self.fallback_success()
                record["runtime"]["name"] = runtime_name
                with self.assertRaises(ValueError):
                    RunResult.model_validate(record)

    def test_successful_mock_uses_only_static_mock_evidence_and_safe_metrics(self) -> None:
        mutations = (
            ("evidence", (("mode_resolution.evidence_source", "unverified"),)),
            ("usage", (("usage.source", "backend_reported"),)),
            (
                "ttft",
                (
                    ("timing.first_token_ms", 1.0),
                    ("timing.first_token_ms_source", "mock_deterministic"),
                ),
            ),
            (
                "generation",
                (
                    ("timing.generation_ms", 1.0),
                    ("timing.generation_ms_source", "mock_deterministic"),
                ),
            ),
            ("total", (("timing.total_ms_source", "client_measured"),)),
            (
                "tps",
                (
                    ("timing.tokens_per_second", 1.0),
                    ("timing.tokens_per_second_source", "mock_deterministic"),
                ),
            ),
            (
                "model_load",
                (
                    ("timing.model_load_ms", 1.0),
                    ("timing.model_load_ms_source", "lm_studio_native_v1"),
                ),
            ),
        )
        for label, changes in mutations:
            with self.subTest(label=label):
                record = deepcopy(self.success)
                for dotted_path, value in changes:
                    container, field = dotted_path.split(".")
                    record[container][field] = value
                with self.assertRaises(ValueError):
                    RunResult.model_validate(record)

    def test_failed_result_metrics_are_fail_closed(self) -> None:
        mutations = (
            (
                "usage",
                (
                    ("usage.source", "backend_reported"),
                    ("usage.prompt_tokens", 2),
                    ("usage.completion_tokens", 1),
                    ("usage.total_tokens", 3),
                ),
            ),
            (
                "ttft",
                (
                    ("timing.first_token_ms", 1.0),
                    ("timing.first_token_ms_source", "lm_studio_native_v1"),
                ),
            ),
            (
                "generation",
                (
                    ("timing.generation_ms", 1.0),
                    ("timing.generation_ms_source", "client_measured"),
                ),
            ),
            ("total", (("timing.total_ms_source", "mock_deterministic"),)),
            (
                "tps",
                (
                    ("timing.tokens_per_second", 1.0),
                    ("timing.tokens_per_second_source", "backend_reported"),
                ),
            ),
            (
                "model_load",
                (
                    ("timing.model_load_ms", 1.0),
                    ("timing.model_load_ms_source", "lm_studio_native_v1"),
                ),
            ),
        )
        for label, changes in mutations:
            with self.subTest(label=label):
                record = deepcopy(self.failure)
                for dotted_path, value in changes:
                    container, field = dotted_path.split(".")
                    record[container][field] = value
                with self.assertRaises(ValueError):
                    RunResult.model_validate(record)

    def test_json_schema_contains_fail_closed_runtime_conditions(self) -> None:
        self.assertEqual(
            "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0",
            PINNED_STAGE2_ARTIFACT_SHA256,
        )
        schema = json.loads(
            (ROOT / "schemas" / "run-result.schema.json").read_text(encoding="utf-8")
        )
        serialized = json.dumps(schema, sort_keys=True)
        self.assertIn(PINNED_STAGE2_ARTIFACT_SHA256, serialized)
        self.assertIn(r"^sha256:[a-f0-9]{64}$", serialized)
        self.assertIn('"const": "mock_deterministic"', serialized)
        self.assertIn('"const": "llama_cpp"', serialized)
        self.assertIn(
            '"enum": ["static_verified", "behaviorally_consistent", "fallback"]',
            serialized,
        )

    def test_failed_result_cannot_claim_requested_or_observed_profile(self) -> None:
        for field, value in (
            ("effective_profile", "non_thinking"),
            ("requested_reasoning", "off"),
            ("observed_reasoning_output", "absent"),
            ("resolved_reasoning_state", "unknown"),
            ("verification_status", "behaviorally_consistent"),
        ):
            with self.subTest(field=field):
                record = deepcopy(self.failure)
                record["mode_resolution"][field] = value
                with self.assertRaises(ValueError):
                    RunResult.model_validate(record)

    def test_metric_value_and_source_must_agree(self) -> None:
        for field, value in (
            ("first_token_ms_source", "mock_deterministic"),
            ("total_ms_source", "unavailable"),
            ("tokens_per_second_source", "backend_reported"),
            ("model_load_ms_source", "lm_studio_native_v1"),
        ):
            with self.subTest(field=field):
                record = deepcopy(self.success)
                record["timing"][field] = value
                with self.assertRaises(ValueError):
                    RunResult.model_validate(record)


class RunSummaryContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.summary = json.loads(
            (ROOT / "tests" / "fixtures" / "run_summary.json").read_text(encoding="utf-8")
        )

    def test_summary_fixture_is_valid(self) -> None:
        summary = RunSummary.model_validate(self.summary)
        self.assertEqual("1.1", summary.schema_version)
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

    def test_summary_distinct_cases_cannot_exceed_execution_count(self) -> None:
        summary = deepcopy(self.summary)
        summary["distinct_case_count"] = summary["execution_count"] + 1
        with self.assertRaises(ValueError):
            RunSummary.model_validate(summary)

    def test_real_runtime_summary_uses_one_way_sha256_model_identity(self) -> None:
        summary = deepcopy(self.summary)
        summary["runtime"] = {"name": "lm_studio", "version": None, "platform": "windows"}
        summary["model"] = {
            "id": f"sha256:{'4' * 64}",
            "revision": f"sha256:{'5' * 64}",
            "artifact_sha256": PINNED_STAGE2_ARTIFACT_SHA256,
        }
        RunSummary.model_validate(summary)

        for field in ("id", "revision"):
            with self.subTest(field=field):
                broken = deepcopy(summary)
                broken["model"][field] = "raw-environment-value"
                with self.assertRaises(ValueError):
                    RunSummary.model_validate(broken)

        schema = json.loads(
            (ROOT / "schemas" / "run-summary.schema.json").read_text(encoding="utf-8")
        )
        self.assertIn(r"^sha256:[a-f0-9]{64}$", json.dumps(schema, sort_keys=True))

    def test_summary_result_path_is_fixed_and_relative(self) -> None:
        summary = deepcopy(self.summary)
        summary["result_reference"]["path"] = "/tmp/results.jsonl"
        with self.assertRaises(ValueError):
            RunSummary.model_validate(summary)

    def test_summary_rejects_inline_benchmark_metrics_for_every_runtime(self) -> None:
        summary = deepcopy(self.summary)
        summary["runtime"] = {"name": "lm_studio", "version": None, "platform": "windows"}
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

    def test_summary_is_always_content_free_pipeline_only_metadata(self) -> None:
        summary = deepcopy(self.summary)
        summary["runtime"] = {"name": "lm_studio", "version": None, "platform": "windows"}
        summary["semantic_scoring_performed"] = True
        with self.assertRaises(ValueError):
            RunSummary.model_validate(summary)

        schema = json.loads(
            (ROOT / "schemas" / "run-summary.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual("1.1", schema["properties"]["schema_version"]["const"])
        self.assertEqual(
            {name for name, field in RunSummary.model_fields.items() if field.is_required()},
            set(schema["required"]),
        )
        self.assertEqual({"type": "null"}, schema["properties"]["benchmark"])
        self.assertEqual(False, schema["properties"]["semantic_scoring_performed"]["const"])


if __name__ == "__main__":
    unittest.main()
