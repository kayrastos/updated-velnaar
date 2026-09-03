from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.evaluation.reporting import OutputCollisionError
from kayra_ai.evaluation.runner import (
    EvaluationFailure,
    load_eval_cases,
    run_evaluation,
    validate_run_result_against_manifest,
)
from kayra_ai.runtime.contracts import (
    BackendCapabilities,
    GenerationResponse,
    PreflightResult,
    ProfileExecutionState,
    TimingMetrics as RuntimeTiming,
    TokenUsage as RuntimeUsage,
)
from kayra_ai.runtime.errors import CapabilityUnavailableFailure, ConnectionFailure
from kayra_ai.validation.common import ValidationIssue
from kayra_ai.validation.model_artifact import load_model_artifact
from kayra_ai.validation.models import RunResult, RunSummary
from kayra_ai.validation.validate_dataset import validate_dataset


CONFIG = ROOT / "configs" / "runtime.yaml"
NATIVE_CONFIG = ROOT / "configs" / "runtime.lm-studio.yaml"
EVAL = ROOT / "data" / "eval" / "seed.jsonl"
SMOKE = ROOT / "data" / "eval" / "stage2-smoke.jsonl"
EXPECTED_EVAL_SHA256 = "cfb2f683977b7178d3f4ed4f2b1008e7013531686d97fd546104b8784cd53d89"
EXPECTED_MODEL_SHA256 = "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0"


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
            source="static_backend" if self.runtime_name == "mock" else "unverified",
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
            usage=RuntimeUsage(
                source=(
                    "mock_deterministic" if self.runtime_name == "mock" else "unavailable"
                )
            ),
            timing=RuntimeTiming(
                total_ms=0.0,
                total_ms_source=(
                    "mock_deterministic" if self.runtime_name == "mock" else "client_measured"
                ),
                ttft_ms=None,
                ttft_ms_source="unavailable",
            ),
            effective_profile=request.requested_profile,
            finish_reason=self.response_finish_reason,
        )


class CapturingRemoteBackend(CapturingMockBackend):
    runtime_name = "lm_studio"
    runtime_version = None
    model_id = "MODEL-ENV-VALUE-CANARY-41a"
    model_revision = "REVISION-ENV-VALUE-CANARY-52b"


class CapturingNativeBackend(CapturingRemoteBackend):
    model_id = "qwen3-14b-q4-k-m"
    model_revision = None

    def __init__(self, *, failure: Exception | None = None) -> None:
        super().__init__(failure=failure)
        self._capabilities = BackendCapabilities(
            thinking="supported",
            non_thinking="supported",
            streaming="unsupported",
            token_usage="supported",
            model_listing="supported",
            source="lm_studio_native_v1_models",
            advertised_reasoning_options=("off", "on"),
            advertised_reasoning_default="off",
        )

    def generate(self, request):  # type: ignore[no-untyped-def]
        self.requests.append(request)
        if self.failure is not None:
            raise self.failure
        requested_reasoning = "on" if request.requested_profile == "thinking" else "off"
        observed = request.requested_profile == "thinking"
        return GenerationResponse(
            content=f"native-capture:{request.requested_profile}",
            usage=RuntimeUsage(
                source="lm_studio_native_v1",
                prompt_tokens=20,
                completion_tokens=8,
                total_tokens=None,
                reasoning_tokens=3 if observed else 0,
            ),
            timing=RuntimeTiming(
                total_ms=80.0,
                total_ms_source="client_measured",
                ttft_ms=12.5,
                ttft_ms_source="lm_studio_native_v1",
                tokens_per_second=30.0,
                tokens_per_second_source="lm_studio_native_v1",
                model_load_ms=None,
                model_load_ms_source="unavailable",
            ),
            effective_profile="unknown",
            finish_reason=None,
            model_instance_id="native-instance-1",
            response_id=None,
            profile_state=ProfileExecutionState(
                capability_status="supported",
                requested_profile=request.requested_profile,
                requested_reasoning=requested_reasoning,
                advertised_reasoning_options=("off", "on"),
                advertised_reasoning_default="off",
                observed_reasoning_output="present" if observed else "absent",
                resolved_reasoning_state="unknown",
                verification_status="behaviorally_consistent",
                source="lm_studio_native_v1_response",
            ),
        )


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

    def test_native_fake_run_carries_manifest_hash_without_transport_or_socket(self) -> None:
        backend = CapturingNativeBackend()
        transport_calls = 0

        def forbidden_transport(_network):
            nonlocal transport_calls
            transport_calls += 1
            raise AssertionError("fake native run must not construct a transport")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch(
                "socket.socket", side_effect=AssertionError("socket use is forbidden")
            ), patch(
                "socket.create_connection",
                side_effect=AssertionError("socket connection is forbidden"),
            ):
                completed = run_evaluation(
                    config_path=NATIVE_CONFIG,
                    eval_path=SMOKE,
                    backend_name="lm_studio",
                    profiles="all",
                    run_id="stage2-native-fake",
                    output_root=root / "runs",
                    environ={
                        "KAYRA_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1",
                        "KAYRA_LM_STUDIO_MODEL": backend.model_id,
                    },
                    transport_factory=forbidden_transport,
                    backend_factory=lambda *_args, **_kwargs: backend,
                )
            native_summary_text = (
                (completed.run_directory / "summary.json").read_text(encoding="utf-8")
                + (completed.run_directory / "summary.md").read_text(encoding="utf-8")
            )

        self.assertEqual(0, transport_calls)
        self.assertEqual(4, len(completed.results))
        self.assertEqual(
            [("eval-if-003", "thinking"), ("eval-if-003", "non_thinking")],
            [
                (item.case_id, item.requested_profile)
                for item in completed.results[:2]
            ],
        )
        self.assertEqual(
            backend.requests[0].messages[-1].content,
            backend.requests[1].messages[-1].content,
        )
        self.assertNotIn("native-capture", native_summary_text)
        self.assertNotIn(backend.model_id, native_summary_text)
        self.assertEqual(EXPECTED_MODEL_SHA256, completed.results[0].model.artifact_sha256)
        resolution = completed.results[0].mode_resolution
        self.assertEqual("unknown", resolution.effective_profile)
        self.assertEqual("unknown", resolution.resolved_reasoning_state)
        self.assertEqual("on", resolution.requested_reasoning)
        self.assertEqual("present", resolution.observed_reasoning_output)
        self.assertEqual("behaviorally_consistent", resolution.verification_status)
        self.assertIsNone(completed.results[0].usage.total_tokens)
        self.assertEqual("lm_studio_native_v1", completed.results[0].timing.first_token_ms_source)

    def test_native_profile_probe_failure_stops_without_later_prompts_or_artifacts(self) -> None:
        backend = CapturingNativeBackend(failure=ConnectionFailure())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output_root = root / "runs"
            with patch(
                "socket.socket", side_effect=AssertionError("socket use is forbidden")
            ), patch(
                "socket.create_connection",
                side_effect=AssertionError("socket connection is forbidden"),
            ):
                with self.assertRaises(ConnectionFailure):
                    run_evaluation(
                        config_path=NATIVE_CONFIG,
                        eval_path=SMOKE,
                        backend_name="lm_studio",
                        profiles="all",
                        run_id="stage2-native-failure",
                        output_root=output_root,
                        environ={
                            "KAYRA_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1",
                            "KAYRA_LM_STUDIO_MODEL": backend.model_id,
                        },
                        transport_factory=lambda _network: (_ for _ in ()).throw(
                            AssertionError("transport use is forbidden")
                        ),
                        backend_factory=lambda *_args, **_kwargs: backend,
                    )

            self.assertEqual(1, len(backend.requests))
            self.assertEqual("thinking", backend.requests[0].requested_profile)
            self.assertFalse((output_root / "stage2-native-failure").exists())

    def test_native_second_profile_failure_stops_before_remaining_smoke_cases(self) -> None:
        class SecondProfileFailureBackend(CapturingNativeBackend):
            def generate(self, request):  # type: ignore[no-untyped-def]
                if request.requested_profile == "non_thinking":
                    self.requests.append(request)
                    raise CapabilityUnavailableFailure(
                        "Eşleştirilmiş non-thinking profil kanıtı doğrulanamadı."
                    )
                return super().generate(request)

        backend = SecondProfileFailureBackend()
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory) / "runs"
            with patch(
                "socket.socket", side_effect=AssertionError("socket use is forbidden")
            ), patch(
                "socket.create_connection",
                side_effect=AssertionError("socket connection is forbidden"),
            ):
                with self.assertRaises(CapabilityUnavailableFailure):
                    run_evaluation(
                        config_path=NATIVE_CONFIG,
                        eval_path=SMOKE,
                        backend_name="lm_studio",
                        profiles="all",
                        run_id="stage2-native-second-profile-failure",
                        output_root=output_root,
                        environ={
                            "KAYRA_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1",
                            "KAYRA_LM_STUDIO_MODEL": backend.model_id,
                        },
                        transport_factory=lambda _network: (_ for _ in ()).throw(
                            AssertionError("transport use is forbidden")
                        ),
                        backend_factory=lambda *_args, **_kwargs: backend,
                    )

            self.assertEqual(
                ["thinking", "non_thinking"],
                [request.requested_profile for request in backend.requests],
            )
            self.assertEqual(
                backend.requests[0].messages[-1].content,
                backend.requests[1].messages[-1].content,
            )
            self.assertFalse(
                (output_root / "stage2-native-second-profile-failure").exists()
            )

    def test_native_run_requires_smoke_or_explicit_full_gate_and_a_profile_pair(self) -> None:
        backend_calls = 0

        def forbidden_backend(*_args, **_kwargs):
            nonlocal backend_calls
            backend_calls += 1
            raise AssertionError("profile gate must run before backend construction")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            one_case = root / "one.jsonl"
            one_case.write_text(
                EVAL.read_text(encoding="utf-8").splitlines()[0] + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(EvaluationFailure):
                run_evaluation(
                    config_path=NATIVE_CONFIG,
                    eval_path=EVAL,
                    backend_name="lm_studio",
                    profiles="all",
                    run_id="stage2-native-no-full-gate",
                    output_root=root / "runs",
                    backend_factory=forbidden_backend,
                )
            with self.assertRaises(EvaluationFailure):
                run_evaluation(
                    config_path=NATIVE_CONFIG,
                    eval_path=SMOKE,
                    backend_name="lm_studio",
                    profiles="thinking",
                    run_id="stage2-native-one-profile",
                    output_root=root / "runs",
                    backend_factory=forbidden_backend,
                )
            with self.assertRaises(EvaluationFailure):
                run_evaluation(
                    config_path=NATIVE_CONFIG,
                    eval_path=one_case,
                    backend_name="lm_studio",
                    profiles="all",
                    run_id="stage2-native-no-both",
                    output_root=root / "runs",
                    backend_factory=forbidden_backend,
                    allow_native_non_smoke_eval=True,
                )

        self.assertEqual(0, backend_calls)

    def test_manifest_mismatch_stops_before_backend_or_transport(self) -> None:
        backend_calls = 0
        transport_calls = 0
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = load_model_artifact(
                ROOT / "configs" / "models" / "qwen3-14b-q4_k_m.yaml"
            )
            mismatches = (
                (
                    "format",
                    artifact.model_copy(update={"format": "safetensors"}),
                ),
                (
                    "quantization",
                    artifact.model_copy(update={"quantization": "Q8_0"}),
                ),
                (
                    "size",
                    artifact.model_copy(
                        update={
                            "files": [artifact.files[0].model_copy(update={"size_bytes": 1})]
                        }
                    ),
                ),
                (
                    "context_length",
                    artifact.model_copy(update={"context_length": 2048}),
                ),
            )

            def forbidden_backend(*_args, **_kwargs):
                nonlocal backend_calls
                backend_calls += 1
                raise AssertionError("manifest mismatch must stop before backend construction")

            def forbidden_transport(_network):
                nonlocal transport_calls
                transport_calls += 1
                raise AssertionError("manifest mismatch must stop before transport construction")

            with patch(
                "socket.socket", side_effect=AssertionError("socket use is forbidden")
            ), patch(
                "socket.create_connection",
                side_effect=AssertionError("socket connection is forbidden"),
            ):
                for label, mismatched_artifact in mismatches:
                    with self.subTest(field=label), patch(
                        "kayra_ai.evaluation.runner.load_model_artifact",
                        return_value=mismatched_artifact,
                    ):
                        with self.assertRaises(EvaluationFailure):
                            run_evaluation(
                                config_path=NATIVE_CONFIG,
                                eval_path=SMOKE,
                                backend_name="lm_studio",
                                profiles="all",
                                run_id=f"stage2-manifest-{label}",
                                output_root=root / "runs",
                                transport_factory=forbidden_transport,
                                backend_factory=forbidden_backend,
                            )

        self.assertEqual(0, backend_calls)
        self.assertEqual(0, transport_calls)

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
        self.assertIn("Sen Fulgor AI", request.messages[0].content)
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

    def _valid_result_fixture(self, artifact_sha: str | None = None) -> RunResult:
        text = (
            (ROOT / "tests" / "fixtures" / "run_result_success.jsonl")
            .read_text(encoding="utf-8")
            .strip()
        )
        data = json.loads(text)
        if artifact_sha is not None:
            data["model"]["artifact_sha256"] = artifact_sha
        return RunResult.model_validate(data)

    def test_mismatched_artifact_sha_rejection(self) -> None:
        artifact = load_model_artifact(
            ROOT / "configs" / "models" / "fulgor-ray-v1-q4_k_m.yaml"
        )
        fake_result = self._valid_result_fixture(artifact_sha="0" * 64)
        with self.assertRaises(ValueError) as caught:
            validate_run_result_against_manifest(fake_result, artifact)
        self.assertIn("artifact SHA-256", str(caught.exception))

    def test_two_different_manifests_in_same_process_without_global_trust_leakage(self) -> None:
        manifest_a = load_model_artifact(
            ROOT / "configs" / "models" / "qwen3-14b-q4_k_m.yaml"
        )
        manifest_b = load_model_artifact(
            ROOT / "configs" / "models" / "fulgor-ray-v1-q4_k_m.yaml"
        )
        self.assertNotEqual(manifest_a.files[0].sha256, manifest_b.files[0].sha256)

        result_a = self._valid_result_fixture(artifact_sha=manifest_a.files[0].sha256)
        result_b = self._valid_result_fixture(artifact_sha=manifest_b.files[0].sha256)

        # Result A validates against Manifest A:
        validate_run_result_against_manifest(result_a, manifest_a)

        # Result A fails against Manifest B (no trust leakage):
        with self.assertRaises(ValueError) as caught:
            validate_run_result_against_manifest(result_a, manifest_b)
        self.assertIn("artifact SHA-256", str(caught.exception))

        # Result B validates against Manifest B:
        validate_run_result_against_manifest(result_b, manifest_b)

        # Result B fails against Manifest A (no trust leakage):
        with self.assertRaises(ValueError) as caught:
            validate_run_result_against_manifest(result_b, manifest_a)
        self.assertIn("artifact SHA-256", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
