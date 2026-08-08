from __future__ import annotations

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

from kayra_ai.evaluation.reporting import OutputCollisionError
from kayra_ai.evaluation.runner import load_eval_cases, run_evaluation
from kayra_ai.runtime.contracts import (
    BackendCapabilities,
    GenerationResponse,
    PreflightResult,
    TimingMetrics as RuntimeTiming,
    TokenUsage as RuntimeUsage,
)
from kayra_ai.validation.common import ValidationIssue
from kayra_ai.validation.models import RunResult, RunSummary
from kayra_ai.validation.validate_dataset import validate_dataset


CONFIG = ROOT / "configs" / "runtime.yaml"
EVAL = ROOT / "data" / "eval" / "seed.jsonl"
EXPECTED_EVAL_SHA256 = "cfb2f683977b7178d3f4ed4f2b1008e7013531686d97fd546104b8784cd53d89"


class CapturingMockBackend:
    runtime_name = "mock"
    runtime_version = "capture-v1"
    model_id = "capture-mock"
    model_revision = "capture-v1"

    def __init__(
        self,
        *,
        failure: Exception | None = None,
        response_content: str | None = None,
        response_finish_reason: str = "mock_complete",
    ) -> None:
        self.failure = failure
        self.response_content = response_content
        self.response_finish_reason = response_finish_reason
        self.requests = []
        self._capabilities = BackendCapabilities(
            thinking="supported",
            non_thinking="supported",
            streaming="unsupported",
            token_usage="unsupported",
            model_listing="supported",
        )

    @property
    def capabilities(self):  # type: ignore[no-untyped-def]
        return self._capabilities.model_copy(deep=True)

    def probe(self):  # type: ignore[no-untyped-def]
        return self.capabilities

    def preflight(self):  # type: ignore[no-untyped-def]
        return PreflightResult(
            ok=True,
            backend_name=self.runtime_name,
            model_available=True,
            capabilities=self.capabilities,
        )

    def generate(self, request):  # type: ignore[no-untyped-def]
        self.requests.append(request)
        if self.failure is not None:
            raise self.failure
        return GenerationResponse(
            content=self.response_content or f"capture:{request.requested_profile}",
            usage=RuntimeUsage(),
            timing=RuntimeTiming(total_ms=0.0, ttft_ms=None),
            effective_profile=request.requested_profile,
            finish_reason=self.response_finish_reason,
        )


class CapturingRemoteBackend(CapturingMockBackend):
    runtime_name = "lm_studio"
    runtime_version = None
    model_id = "MODEL-ENV-VALUE-CANARY-41a"
    model_revision = "REVISION-ENV-VALUE-CANARY-52b"


class EvaluationPipelineTests(unittest.TestCase):
    def test_seed_hash_and_profile_matrix_are_stable(self) -> None:
        self.assertEqual(EXPECTED_EVAL_SHA256, hashlib.sha256(EVAL.read_bytes()).hexdigest())
        cases = load_eval_cases(EVAL)
        self.assertEqual(40, len(cases))
        thinking = sum(case.mode in {"thinking", "both"} for case in cases)
        non_thinking = sum(case.mode in {"non_thinking", "both"} for case in cases)
        self.assertEqual((29, 25), (thinking, non_thinking))

    def test_full_mock_run_produces_54_valid_pipeline_results_without_network(self) -> None:
        transport_calls = 0

        def forbidden_transport(_network):
            nonlocal transport_calls
            transport_calls += 1
            raise AssertionError("mock transport must never be constructed")

        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory) / "runs"
            completed = run_evaluation(
                config_path=CONFIG,
                eval_path=EVAL,
                backend_name="mock",
                profiles="all",
                run_id="stage1-test-full",
                output_root=output_root,
                transport_factory=forbidden_transport,
            )
            self.assertEqual(0, transport_calls)
            self.assertEqual(40, completed.summary.distinct_case_count)
            self.assertEqual(54, completed.summary.execution_count)
            self.assertEqual(54, completed.summary.success_count)
            self.assertEqual(0, completed.summary.failure_count)
            self.assertFalse(completed.summary.semantic_scoring_performed)
            self.assertIsNone(completed.summary.benchmark)
            self.assertEqual(
                {"thinking": 29, "non_thinking": 25},
                {item.profile: item.execution_count for item in completed.summary.profiles},
            )

            results_path = completed.run_directory / "results.jsonl"
            self.assertEqual(54, validate_dataset(results_path, "run-result"))
            records = [json.loads(line) for line in results_path.read_text(encoding="utf-8").splitlines()]
            validated = [RunResult.model_validate(record) for record in records]
            self.assertEqual(54, len({item.result_id for item in validated}))
            self.assertEqual(40, len({item.case_id for item in validated}))
            self.assertTrue(all(item.evaluation.kind == "pipeline_only" for item in validated))
            self.assertTrue(all(not item.evaluation.rubric_scores for item in validated))
            self.assertTrue(all(item.response.retention == "evaluation_artifact" for item in validated))

            summary_path = completed.run_directory / "summary.json"
            summary = RunSummary.model_validate_json(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(
                hashlib.sha256(results_path.read_bytes()).hexdigest(),
                summary.result_reference.sha256,
            )
            summary_text = summary_path.read_text(encoding="utf-8") + (
                completed.run_directory / "summary.md"
            ).read_text(encoding="utf-8")
            self.assertNotIn("pipeline-ok", summary_text)
            self.assertIn("pipeline-ok", results_path.read_text(encoding="utf-8"))

    def test_existing_run_directory_is_preserved_before_backend_construction(self) -> None:
        backend_calls = 0
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory) / "runs"
            run_directory = output_root / "stage1-existing"
            run_directory.mkdir(parents=True)
            sentinel = run_directory / "keep.txt"
            sentinel.write_text("koru", encoding="utf-8")

            def forbidden_backend(*_args, **_kwargs):
                nonlocal backend_calls
                backend_calls += 1
                raise AssertionError("backend must not be constructed for a collision")

            with self.assertRaises(OutputCollisionError):
                run_evaluation(
                    config_path=CONFIG,
                    eval_path=EVAL,
                    backend_name="mock",
                    profiles="all",
                    run_id="stage1-existing",
                    output_root=output_root,
                    backend_factory=forbidden_backend,
                )
            self.assertEqual(0, backend_calls)
            self.assertEqual("koru", sentinel.read_text(encoding="utf-8"))
            self.assertEqual([sentinel], list(run_directory.iterdir()))

    def test_invalid_eval_stops_before_backend_and_output(self) -> None:
        backend_calls = 0
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            broken_eval = root / "broken.jsonl"
            broken_eval.write_text("not-json\n", encoding="utf-8")

            def forbidden_backend(*_args, **_kwargs):
                nonlocal backend_calls
                backend_calls += 1
                raise AssertionError("backend must not be constructed for invalid input")

            with self.assertRaises(ValidationIssue):
                run_evaluation(
                    config_path=CONFIG,
                    eval_path=broken_eval,
                    backend_name="mock",
                    profiles="all",
                    run_id="stage1-invalid",
                    output_root=root / "runs",
                    backend_factory=forbidden_backend,
                )
            self.assertEqual(0, backend_calls)
            self.assertFalse((root / "runs" / "stage1-invalid").exists())

    def test_messages_are_forwarded_with_assistant_system_prompt_without_template(self) -> None:
        backend = CapturingMockBackend()
        first_record = EVAL.read_text(encoding="utf-8").splitlines()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            one_case = root / "one.jsonl"
            one_case.write_text(first_record + "\n", encoding="utf-8")

            def factory(*_args, **_kwargs):
                return backend

            run_evaluation(
                config_path=CONFIG,
                eval_path=one_case,
                backend_name="mock",
                profiles="all",
                run_id="stage1-message-test",
                output_root=root / "runs",
                backend_factory=factory,
            )
        self.assertEqual(1, len(backend.requests))
        request = backend.requests[0]
        self.assertEqual("system", request.messages[0].role)
        self.assertIn("Sen Kayra", request.messages[0].content)
        self.assertEqual("user", request.messages[1].role)
        serialized = request.model_dump_json()
        self.assertNotIn("chat_template", serialized)
        self.assertNotIn("<|im_start|>", serialized)
        self.assertNotIn("/think", serialized)

    def test_unexpected_exception_and_environment_canary_never_reach_artifacts(self) -> None:
        exception_canary = "EXCEPTION-REPR-CANARY-EVAL-91f"
        environment_canary = "ENVIRONMENT-VALUE-CANARY-EVAL-772"
        backend = CapturingMockBackend(failure=RuntimeError(exception_canary))
        first_record = EVAL.read_text(encoding="utf-8").splitlines()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            one_case = root / "one.jsonl"
            one_case.write_text(first_record + "\n", encoding="utf-8")

            def factory(*_args, **_kwargs):
                return backend

            completed = run_evaluation(
                config_path=CONFIG,
                eval_path=one_case,
                backend_name="mock",
                profiles="all",
                run_id="stage1-private-error",
                output_root=root / "runs",
                environ={"UNRELATED_SECRET": environment_canary},
                backend_factory=factory,
            )
            artifact_text = "\n".join(
                path.read_text(encoding="utf-8")
                for path in completed.run_directory.iterdir()
                if path.is_file()
            )
        self.assertNotIn(exception_canary, artifact_text)
        self.assertNotIn(environment_canary, artifact_text)
        self.assertNotIn("RuntimeError(", artifact_text)
        self.assertEqual(1, completed.summary.failure_count)
        self.assertEqual("internal", completed.results[0].error.type if completed.results[0].error else None)

    def test_resolved_remote_environment_values_are_one_way_identified_in_artifacts(self) -> None:
        backend = CapturingRemoteBackend()
        base_url_canary = "http://127.0.0.1:65530/v1"
        api_key_canary = "API-KEY-ENV-VALUE-CANARY-63c"
        first_record = EVAL.read_text(encoding="utf-8").splitlines()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            one_case = root / "one.jsonl"
            one_case.write_text(first_record + "\n", encoding="utf-8")

            def factory(*_args, **_kwargs):
                return backend

            completed = run_evaluation(
                config_path=CONFIG,
                eval_path=one_case,
                backend_name="lm_studio",
                profiles="all",
                run_id="stage1-remote-privacy",
                output_root=root / "runs",
                environ={
                    "KAYRA_LM_STUDIO_BASE_URL": base_url_canary,
                    "KAYRA_LM_STUDIO_MODEL": backend.model_id,
                    "KAYRA_LM_STUDIO_MODEL_REVISION": backend.model_revision,
                    "KAYRA_LM_STUDIO_API_KEY": api_key_canary,
                },
                backend_factory=factory,
            )
            artifact_text = "\n".join(
                path.read_text(encoding="utf-8")
                for path in completed.run_directory.iterdir()
                if path.is_file()
            )
        for canary in (
            base_url_canary,
            backend.model_id,
            backend.model_revision,
            api_key_canary,
            "Authorization",
        ):
            with self.subTest(canary=canary):
                self.assertNotIn(canary, artifact_text)
        self.assertTrue(completed.summary.model.id.startswith("sha256:"))
        self.assertTrue((completed.summary.model.revision or "").startswith("sha256:"))

    def test_response_containing_resolved_secret_is_not_retained(self) -> None:
        api_key_canary = "API-KEY-RESPONSE-LEAK-CANARY-74d"
        backend = CapturingRemoteBackend(response_content=f"unsafe {api_key_canary}")
        first_record = EVAL.read_text(encoding="utf-8").splitlines()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            one_case = root / "one.jsonl"
            one_case.write_text(first_record + "\n", encoding="utf-8")

            def factory(*_args, **_kwargs):
                return backend

            completed = run_evaluation(
                config_path=CONFIG,
                eval_path=one_case,
                backend_name="lm_studio",
                profiles="all",
                run_id="stage1-response-privacy",
                output_root=root / "runs",
                environ={
                    "KAYRA_LM_STUDIO_BASE_URL": "http://localhost:1234/v1",
                    "KAYRA_LM_STUDIO_MODEL": backend.model_id,
                    "KAYRA_LM_STUDIO_MODEL_REVISION": backend.model_revision,
                    "KAYRA_LM_STUDIO_API_KEY": api_key_canary,
                },
                backend_factory=factory,
            )
            artifact_text = "\n".join(
                path.read_text(encoding="utf-8")
                for path in completed.run_directory.iterdir()
                if path.is_file()
            )
        self.assertNotIn(api_key_canary, artifact_text)
        self.assertEqual(1, completed.summary.failure_count)
        result = completed.results[0]
        self.assertEqual("privacy_policy", result.error.type if result.error else None)
        self.assertEqual("not_retained", result.response.retention)

    def test_finish_reason_containing_resolved_secret_is_not_retained(self) -> None:
        api_key_canary = "API-KEY-FINISH-REASON-CANARY-85e"
        backend = CapturingRemoteBackend(response_finish_reason=f"unsafe-{api_key_canary}")
        first_record = EVAL.read_text(encoding="utf-8").splitlines()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            one_case = root / "one.jsonl"
            one_case.write_text(first_record + "\n", encoding="utf-8")

            completed = run_evaluation(
                config_path=CONFIG,
                eval_path=one_case,
                backend_name="lm_studio",
                profiles="all",
                run_id="stage1-finish-reason-privacy",
                output_root=root / "runs",
                environ={
                    "KAYRA_LM_STUDIO_BASE_URL": "http://localhost:1234/v1",
                    "KAYRA_LM_STUDIO_MODEL": backend.model_id,
                    "KAYRA_LM_STUDIO_MODEL_REVISION": backend.model_revision,
                    "KAYRA_LM_STUDIO_API_KEY": api_key_canary,
                },
                backend_factory=lambda *_args, **_kwargs: backend,
            )
            artifact_text = "\n".join(
                path.read_text(encoding="utf-8")
                for path in completed.run_directory.iterdir()
                if path.is_file()
            )

        self.assertNotIn(api_key_canary, artifact_text)
        self.assertEqual(1, completed.summary.failure_count)
        result = completed.results[0]
        self.assertEqual("privacy_policy", result.error.type if result.error else None)
        self.assertEqual("not_retained", result.response.retention)
        self.assertIsNone(result.response.finish_reason)

    def test_normalized_api_root_returned_in_response_is_not_retained(self) -> None:
        raw_api_root = "HTTP://LOCALHOST:1234/v1///"
        normalized_api_root = "http://localhost:1234/v1"
        backend = CapturingRemoteBackend(response_content=f"unsafe {normalized_api_root}")
        first_record = EVAL.read_text(encoding="utf-8").splitlines()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            one_case = root / "one.jsonl"
            one_case.write_text(first_record + "\n", encoding="utf-8")

            completed = run_evaluation(
                config_path=CONFIG,
                eval_path=one_case,
                backend_name="lm_studio",
                profiles="all",
                run_id="stage1-normalized-url-privacy",
                output_root=root / "runs",
                environ={
                    "KAYRA_LM_STUDIO_BASE_URL": raw_api_root,
                    "KAYRA_LM_STUDIO_MODEL": backend.model_id,
                },
                backend_factory=lambda *_args, **_kwargs: backend,
            )
            artifact_text = "\n".join(
                path.read_text(encoding="utf-8")
                for path in completed.run_directory.iterdir()
                if path.is_file()
            )

        self.assertNotIn(raw_api_root, artifact_text)
        self.assertNotIn(normalized_api_root, artifact_text)
        self.assertEqual(1, completed.summary.failure_count)
        self.assertEqual("privacy_policy", completed.results[0].error.type)
        self.assertEqual("not_retained", completed.results[0].response.retention)


if __name__ == "__main__":
    unittest.main()
