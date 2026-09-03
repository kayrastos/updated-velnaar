from __future__ import annotations

import hashlib
import os
import re
import time
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import ValidationError

from kayra_ai.environment import resolve_environment_value
from kayra_ai.runtime import ChatMessage, GenerationRequest, GenerationSettings, build_backend
from kayra_ai.runtime.backends.base import Backend
from kayra_ai.runtime.config import (
    LMStudioBackendConfig,
    MockBackendConfig,
    RuntimeConfig,
    load_runtime_config,
    normalize_lm_studio_native_api_root,
    normalize_api_root,
    validate_model_manifest_path,
)
from kayra_ai.runtime.contracts import GenerationResponse, ProfileExecutionState, ProfileName
from kayra_ai.runtime.errors import MalformedResponseFailure, PrivacyPolicyFailure, RuntimeFailure
from kayra_ai.runtime.http_transport import TransportFactory
from kayra_ai.validation.common import ValidationIssue, iter_jsonl
from kayra_ai.validation.model_artifact import (
    ModelArtifact,
    ModelArtifactValidationError,
    load_model_artifact,
)
from kayra_ai.validation.models import (
    BackendErrorInfo,
    ErrorSummary,
    EvalCase,
    EvaluationOutcome,
    GenerationParameters,
    ID_PATTERN,
    ModeResolution,
    ModelIdentity,
    PIPELINE_WARNING,
    ProfileSummary,
    ResponseArtifact,
    ResultReference,
    RunResult,
    RunSummary,
    RuntimeIdentity,
    TimingMetrics,
    TokenUsage,
)
from kayra_ai.validation.validate_assistant import validate_assistant
from kayra_ai.validation.validate_dataset import validate_dataset

from .reporting import OutputCollisionError, serialize_results, sha256_bytes, write_run_artifacts


ProfileSelection = Literal["all", "thinking", "non_thinking"]
BackendFactory = Callable[..., Backend]
NowFactory = Callable[[], datetime]
Clock = Callable[[], float]

_STAGE2_ARTIFACT_ID = "qwen3-14b-q4-k-m"
_STAGE2_ARTIFACT_REPOSITORY = "Qwen/Qwen3-14B-GGUF"
_STAGE2_ARTIFACT_COMMIT = "c75e7b2d0234068f674a1bacf548ea32e27ccd29"
_STAGE2_ARTIFACT_LICENSE = "Apache-2.0"
_STAGE2_ARTIFACT_FILENAME = "Qwen3-14B-Q4_K_M.gguf"
_STAGE2_ARTIFACT_SHA256 = (
    "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0"
)
_STAGE2_SMOKE_SHA256 = "605ecf339774b5130c9214fbaa126202f2f91b20327092f3d44cb9df8111751d"


class EvaluationFailure(ValueError):
    """A safe evaluation-level error suitable for the CLI."""


@dataclass(frozen=True)
class EvaluationRun:
    run_directory: Path
    results: tuple[RunResult, ...]
    summary: RunSummary


def _file_bytes(path: Path, description: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        raise EvaluationFailure(f"{description} okunamadı.") from None


def _config_digest(
    runtime_bytes: bytes,
    assistant_bytes: bytes,
    model_manifest_bytes: bytes | None,
) -> str:
    payload = b"kayra-runtime\0" + runtime_bytes + b"\0kayra-assistant\0" + assistant_bytes
    if model_manifest_bytes is not None:
        payload += b"\0kayra-model-manifest\0" + model_manifest_bytes
    return hashlib.sha256(payload).hexdigest()


def load_eval_cases(path: Path) -> list[EvalCase]:
    validate_dataset(path, "eval")
    cases: list[EvalCase] = []
    for line_number, record in iter_jsonl(path):
        try:
            cases.append(EvalCase.model_validate(record))
        except ValidationError as exc:
            locations = ", ".join(
                ".".join(str(part) for part in error["loc"]) or "root"
                for error in exc.errors(include_input=False, include_context=False)
            )
            raise ValidationIssue(f"{path}:{line_number}: geçersiz eval alanları: {locations}") from None
    return cases


def expand_case_profiles(
    cases: list[EvalCase], selection: ProfileSelection
) -> list[tuple[EvalCase, ProfileName]]:
    executions: list[tuple[EvalCase, ProfileName]] = []
    for case in cases:
        available: tuple[ProfileName, ...]
        if case.mode == "both":
            available = ("thinking", "non_thinking")
        else:
            available = (case.mode,)
        for profile in available:
            if selection == "all" or selection == profile:
                executions.append((case, profile))
    return executions


def _prioritize_native_profile_probe(
    cases: list[EvalCase],
    executions: list[tuple[EvalCase, ProfileName]],
    selection: ProfileSelection,
) -> list[tuple[EvalCase, ProfileName]]:
    """Put one existing both-mode case first as an on/off fail-closed gate."""

    if selection != "all":
        raise EvaluationFailure(
            "LM Studio native v1 değerlendirmesi eşleştirilmiş iki profili gerektirir."
        )
    probe_case = next((case for case in cases if case.mode == "both"), None)
    if probe_case is None:
        raise EvaluationFailure(
            "LM Studio native v1 için both modunda profil probu vakası gerekli."
        )
    probe = [(probe_case, "thinking"), (probe_case, "non_thinking")]
    remaining = [item for item in executions if item[0].id != probe_case.id]
    return [*probe, *remaining]


def _result_id(run_id: str, case_id: str, profile: ProfileName, attempt: int) -> str:
    material = f"{run_id}\0{case_id}\0{profile}\0{attempt}".encode("utf-8")
    return f"result-{hashlib.sha256(material).hexdigest()[:32]}"


def _model_identity(
    config: RuntimeConfig,
    backend: Backend,
    backend_name: str,
    model_artifact: ModelArtifact | None,
) -> ModelIdentity:
    artifact_sha256 = model_artifact.files[0].sha256 if model_artifact is not None else None
    configured = config.backends.get(backend_name)
    if isinstance(configured, MockBackendConfig):
        artifact_sha256 = configured.model.artifact_sha256
        model_id = backend.model_id
        model_revision = backend.model_revision
    else:
        # Real backend identifiers are resolved from environment variables and
        # are needed at the HTTP boundary. Artifacts retain stable one-way
        # identities without persisting those resolved values.
        model_id = f"sha256:{hashlib.sha256(backend.model_id.encode('utf-8')).hexdigest()}"
        model_revision = (
            f"sha256:{hashlib.sha256(backend.model_revision.encode('utf-8')).hexdigest()}"
            if backend.model_revision is not None
            else None
        )
    return ModelIdentity(
        id=model_id,
        revision=model_revision,
        artifact_sha256=artifact_sha256,
    )


def _runtime_identity(backend: Backend) -> RuntimeIdentity:
    return RuntimeIdentity(
        name=backend.runtime_name,
        version=backend.runtime_version,
        platform="offline" if backend.runtime_name == "mock" else "not_reported",
    )


def _generation_parameters(settings: GenerationSettings) -> GenerationParameters:
    return GenerationParameters(
        context_length=settings.context_length,
        temperature=settings.temperature,
        top_p=settings.top_p,
        max_output_tokens=settings.max_output_tokens,
        stream=settings.stream,
    )


def _resolved_runtime_values(
    config: RuntimeConfig,
    backend_name: str,
    environ: Mapping[str, str] | None,
) -> tuple[str, ...]:
    configured = config.backends.get(backend_name)
    if isinstance(configured, MockBackendConfig):
        return ()
    values = os.environ if environ is None else environ
    names = (
        configured.base_url_env,
        configured.model_id_env,
        configured.model_revision_env,
        configured.api_key_env,
    )
    resolved = [resolve_environment_value(values, name) for name in names if name]
    raw_api_root = resolve_environment_value(values, configured.base_url_env)
    if raw_api_root:
        normalizer = (
            normalize_lm_studio_native_api_root
            if isinstance(configured, LMStudioBackendConfig)
            and configured.api_mode == "native_v1"
            else normalize_api_root
        )
        resolved.append(normalizer(raw_api_root))
    return tuple(dict.fromkeys(value for value in resolved if value))


def _selected_model_artifact(
    *,
    config: RuntimeConfig,
    backend_name: str,
) -> tuple[ModelArtifact | None, bytes | None]:
    configured = config.backends.get(backend_name)
    if not isinstance(configured, LMStudioBackendConfig) or configured.api_mode != "native_v1":
        return None, None
    if configured.model_manifest is None or configured.native_v1 is None:
        raise EvaluationFailure("LM Studio native v1 model manifest yapılandırması eksik.")

    try:
        manifest_path = validate_model_manifest_path(configured.model_manifest)
    except ValueError as exc:
        raise EvaluationFailure(f"Model artifact manifest yolu geçersiz: {exc}") from None
    try:
        artifact = load_model_artifact(manifest_path)
    except ModelArtifactValidationError as exc:
        raise EvaluationFailure(f"Model artifact manifesti geçersiz: {exc}") from None
    manifest_bytes = _file_bytes(manifest_path, "Model artifact manifesti")
    artifact_file = artifact.files[0]
    expected = configured.native_v1
    if (
        artifact.schema_version != "1.0"
        or artifact.format.casefold() != expected.model_format.casefold()
        or artifact.quantization != expected.quantization
        or artifact_file.size_bytes != expected.size_bytes
        or artifact.context_length != expected.context_length
    ):
        raise EvaluationFailure(
            "Runtime native v1 beklentileri model artifact manifestiyle uyuşmuyor."
        )
    return artifact, manifest_bytes


def validate_run_result_against_manifest(
    result: RunResult,
    artifact: ModelArtifact | None,
    expected_native: LMStudioNativeV1Config | None = None,
) -> None:
    """Validate that RunResult artifact evidence matches the exact run-scoped manifest."""
    if artifact is None:
        return
    artifact_file = artifact.files[0]
    if result.model.artifact_sha256 != artifact_file.sha256:
        raise ValueError(
            f"RunResult artifact SHA-256 ({result.model.artifact_sha256}) "
            f"seçilen model manifesti ({artifact_file.sha256}) ile uyuşmuyor"
        )
    if result.generation.context_length != artifact.context_length:
        raise ValueError(
            f"RunResult context_length ({result.generation.context_length}) "
            f"model manifesti ({artifact.context_length}) ile uyuşmuyor"
        )
    if expected_native is not None:
        if artifact.format.casefold() != expected_native.model_format.casefold():
            raise ValueError(
                f"Model formatı ({artifact.format}) native_v1 beklentisiyle "
                f"({expected_native.model_format}) uyuşmuyor"
            )
        if artifact.quantization != expected_native.quantization:
            raise ValueError(
                f"Quantization ({artifact.quantization}) native_v1 beklentisiyle "
                f"({expected_native.quantization}) uyuşmuyor"
            )
        if artifact_file.size_bytes != expected_native.size_bytes:
            raise ValueError(
                f"Size bytes ({artifact_file.size_bytes}) native_v1 beklentisiyle "
                f"({expected_native.size_bytes}) uyuşmuyor"
            )


def _mode_resolution(
    *,
    config: RuntimeConfig,
    backend: Backend,
    profile: ProfileName,
    response: GenerationResponse | None,
) -> ModeResolution:
    capabilities = backend.capabilities
    status = capabilities.status_for_profile(profile)
    capability_source = capabilities.source
    native_lm_studio = (
        backend.runtime_name == "lm_studio"
        and config.backends.lm_studio.api_mode == "native_v1"
    )
    if response is None:
        advertised_options = capabilities.advertised_reasoning_options
        return ModeResolution(
            capability_status=status,
            effective_profile="unknown",
            fallback_used=False,
            requested_reasoning=None,
            advertised_reasoning_options=(
                list(advertised_options) if advertised_options is not None else None
            ),
            advertised_reasoning_default=capabilities.advertised_reasoning_default,
            observed_reasoning_output="unknown",
            resolved_reasoning_state=None,
            verification_status="unknown",
            evidence_source=(
                "lm_studio_native_v1_models"
                if capability_source == "lm_studio_native_v1_models"
                else "unverified"
            ),
        )

    profile_state: ProfileExecutionState | None = response.profile_state
    if profile_state is not None:
        expected_reasoning = "on" if profile == "thinking" else "off"
        expected_observation = "present" if profile == "thinking" else "absent"
        if (
            profile_state.requested_profile != profile
            or profile_state.capability_status != status
            or profile_state.requested_reasoning != expected_reasoning
            or profile_state.observed_reasoning_output != expected_observation
            or profile_state.resolved_reasoning_state != "unknown"
            or profile_state.verification_status != "behaviorally_consistent"
            or profile_state.source != "lm_studio_native_v1_response"
            or profile_state.advertised_reasoning_options
            != capabilities.advertised_reasoning_options
            or profile_state.advertised_reasoning_default
            != capabilities.advertised_reasoning_default
            or response.effective_profile != "unknown"
            or not native_lm_studio
            or capability_source != "lm_studio_native_v1_models"
        ):
            raise MalformedResponseFailure(
                "LM Studio native v1 profil kanıtı istenen profille uyuşmuyor."
            )
        return ModeResolution(
            capability_status=status,
            effective_profile="unknown",
            fallback_used=False,
            requested_reasoning=profile_state.requested_reasoning,
            advertised_reasoning_options=list(profile_state.advertised_reasoning_options),
            advertised_reasoning_default=profile_state.advertised_reasoning_default,
            observed_reasoning_output=profile_state.observed_reasoning_output,
            resolved_reasoning_state="unknown",
            verification_status="behaviorally_consistent",
            evidence_source="lm_studio_native_v1_response",
        )

    if native_lm_studio:
        raise MalformedResponseFailure(
            "LM Studio native v1 yanıtı profil yürütme kanıtı içermiyor."
        )

    effective_profile = response.effective_profile
    fallback = effective_profile == "backend_default"
    if fallback:
        return ModeResolution(
            capability_status=status,
            effective_profile="backend_default",
            fallback_used=True,
            requested_reasoning=None,
            advertised_reasoning_options=None,
            advertised_reasoning_default=None,
            observed_reasoning_output="unknown",
            resolved_reasoning_state=None,
            verification_status="fallback",
            evidence_source="unverified",
        )
    if status != "supported" or effective_profile != profile:
        raise MalformedResponseFailure("Backend profil çözümü doğrulanamadı.")
    return ModeResolution(
        capability_status=status,
        effective_profile=effective_profile,
        fallback_used=False,
        requested_reasoning=None,
        advertised_reasoning_options=None,
        advertised_reasoning_default=None,
        observed_reasoning_output="unknown",
        resolved_reasoning_state=None,
        verification_status="static_verified",
        evidence_source="static_backend",
    )


def _request_for(case: EvalCase, profile: ProfileName, config: RuntimeConfig, system_prompt: str) -> GenerationRequest:
    profile_config = config.profiles.get(profile)
    settings = GenerationSettings(
        context_length=config.execution.context_length,
        temperature=profile_config.temperature,
        top_p=profile_config.top_p,
        max_output_tokens=min(profile_config.max_output_tokens, case.max_output_tokens),
        stream=False,
    )
    messages = [ChatMessage(role="system", content=system_prompt)]
    messages.extend(ChatMessage(role=item.role, content=item.content) for item in case.messages)
    return GenerationRequest(messages=messages, settings=settings, requested_profile=profile)


def _successful_result(
    *,
    run_id: str,
    case: EvalCase,
    profile: ProfileName,
    request: GenerationRequest,
    response: GenerationResponse,
    config: RuntimeConfig,
    backend: Backend,
    model: ModelIdentity,
    runtime: RuntimeIdentity,
    input_sha256: str,
    config_sha256: str,
    created_at: datetime,
    sensitive_values: tuple[str, ...],
) -> RunResult:
    if not response.content:
        raise MalformedResponseFailure("Yerel çalışma zamanı boş assistant içeriği döndürdü.")
    retained_backend_strings = (response.content, response.finish_reason or "")
    if any(
        sensitive in retained_value
        for retained_value in retained_backend_strings
        for sensitive in sensitive_values
    ):
        raise PrivacyPolicyFailure(
            "Yanıt, çözümlenmiş runtime yapılandırma değeri içerdiği için saklanmadı."
        )
    content_sha256 = hashlib.sha256(response.content.encode("utf-8")).hexdigest()
    usage_source = response.usage.source
    if usage_source == "client_measured":
        raise MalformedResponseFailure("Token kullanımı istemci ölçümü olarak raporlanamaz.")
    if usage_source == "unavailable" and any(
        value is not None
        for value in (
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
            response.usage.total_tokens,
            response.usage.reasoning_tokens,
        )
    ):
        raise MalformedResponseFailure("Token kullanımı kaynağı ve değerleri tutarsız.")
    return RunResult(
        schema_version="2.1",
        run_id=run_id,
        result_id=_result_id(run_id, case.id, profile, 1),
        case_id=case.id,
        requested_profile=profile,
        attempt=1,
        model=model,
        runtime=runtime,
        generation=_generation_parameters(request.settings),
        mode_resolution=_mode_resolution(
            config=config,
            backend=backend,
            profile=profile,
            response=response,
        ),
        response=ResponseArtifact(
            retention="evaluation_artifact",
            content=response.content,
            content_sha256=content_sha256,
            finish_reason=response.finish_reason or None,
        ),
        usage=TokenUsage(
            source=usage_source,
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
            total_tokens=response.usage.total_tokens,
            reasoning_tokens=response.usage.reasoning_tokens,
        ),
        timing=TimingMetrics(
            first_token_ms=response.timing.ttft_ms,
            first_token_ms_source=response.timing.ttft_ms_source,
            generation_ms=None,
            generation_ms_source="unavailable",
            total_ms=response.timing.total_ms,
            total_ms_source=response.timing.total_ms_source,
            tokens_per_second=response.timing.tokens_per_second,
            tokens_per_second_source=response.timing.tokens_per_second_source,
            model_load_ms=response.timing.model_load_ms,
            model_load_ms_source=response.timing.model_load_ms_source,
        ),
        evaluation=EvaluationOutcome(
            kind="pipeline_only",
            semantic_scoring_performed=False,
            rubric_scores=[],
        ),
        success=True,
        error=None,
        created_at=created_at,
        input_sha256=input_sha256,
        config_sha256=config_sha256,
    )


def _failed_result(
    *,
    run_id: str,
    case: EvalCase,
    profile: ProfileName,
    request: GenerationRequest,
    config: RuntimeConfig,
    backend: Backend,
    model: ModelIdentity,
    runtime: RuntimeIdentity,
    input_sha256: str,
    config_sha256: str,
    created_at: datetime,
    elapsed_ms: float,
    failure: RuntimeFailure | None,
) -> RunResult:
    if failure is None:
        error = BackendErrorInfo(
            type="internal",
            message="Beklenmeyen bir değerlendirme çalışma zamanı hatası oluştu.",
            retryable=False,
            http_status=None,
        )
    else:
        error = BackendErrorInfo(
            type=failure.info.kind,
            message=failure.info.message,
            retryable=failure.info.retryable,
            http_status=failure.info.status_code,
        )
    return RunResult(
        schema_version="2.1",
        run_id=run_id,
        result_id=_result_id(run_id, case.id, profile, 1),
        case_id=case.id,
        requested_profile=profile,
        attempt=1,
        model=model,
        runtime=runtime,
        generation=_generation_parameters(request.settings),
        mode_resolution=_mode_resolution(
            config=config,
            backend=backend,
            profile=profile,
            response=None,
        ),
        response=ResponseArtifact(
            retention="not_retained",
            content=None,
            content_sha256=None,
            finish_reason=None,
        ),
        usage=TokenUsage(
            source="unavailable",
            prompt_tokens=None,
            completion_tokens=None,
            total_tokens=None,
            reasoning_tokens=None,
        ),
        timing=TimingMetrics(
            first_token_ms=None,
            first_token_ms_source="unavailable",
            generation_ms=None,
            generation_ms_source="unavailable",
            total_ms=elapsed_ms,
            total_ms_source="client_measured",
            tokens_per_second=None,
            tokens_per_second_source="unavailable",
            model_load_ms=None,
            model_load_ms_source="unavailable",
        ),
        evaluation=EvaluationOutcome(
            kind="pipeline_only",
            semantic_scoring_performed=False,
            rubric_scores=[],
        ),
        success=False,
        error=error,
        created_at=created_at,
        input_sha256=input_sha256,
        config_sha256=config_sha256,
    )


def _profile_summaries(results: list[RunResult]) -> list[ProfileSummary]:
    summaries: list[ProfileSummary] = []
    for profile in ("thinking", "non_thinking"):
        selected = [item for item in results if item.requested_profile == profile]
        if not selected:
            continue
        failures = sum(not item.success for item in selected)
        summaries.append(
            ProfileSummary(
                profile=profile,
                execution_count=len(selected),
                success_count=len(selected) - failures,
                failure_count=failures,
                skipped_count=0,
                error_rate=failures / len(selected),
            )
        )
    return summaries


def run_evaluation(
    *,
    config_path: Path,
    eval_path: Path,
    backend_name: str | None,
    profiles: ProfileSelection,
    run_id: str,
    output_root: Path = Path("reports/runs"),
    environ: Mapping[str, str] | None = None,
    transport_factory: TransportFactory | None = None,
    backend_factory: BackendFactory = build_backend,
    clock: Clock = time.monotonic,
    now: NowFactory = lambda: datetime.now().astimezone(),
    allow_native_non_smoke_eval: bool = False,
) -> EvaluationRun:
    if re.fullmatch(ID_PATTERN, run_id) is None:
        raise EvaluationFailure("Run kimliği geçersiz.")
    if profiles not in {"all", "thinking", "non_thinking"}:
        raise EvaluationFailure("Profil seçimi geçersiz.")

    runtime_bytes = _file_bytes(config_path, "Runtime yapılandırması")
    input_bytes = _file_bytes(eval_path, "Eval dosyası")
    input_sha256 = sha256_bytes(input_bytes)
    config = load_runtime_config(config_path)
    selected_backend = backend_name or config.active_backend
    model_artifact, model_manifest_bytes = _selected_model_artifact(
        config=config,
        backend_name=selected_backend,
    )

    assistant_path = Path(config.assistant_config)
    assistant_bytes = _file_bytes(assistant_path, "Asistan yapılandırması")
    try:
        assistant = validate_assistant(assistant_path)
    except Exception:
        raise EvaluationFailure("Asistan yapılandırması geçersiz.") from None

    cases = load_eval_cases(eval_path)
    executions = expand_case_profiles(cases, profiles)
    if not executions:
        raise EvaluationFailure("Seçilen profil için eval yürütmesi bulunamadı.")
    configured_backend = config.backends.get(selected_backend)
    native_lm_studio = (
        isinstance(configured_backend, LMStudioBackendConfig)
        and configured_backend.api_mode == "native_v1"
    )
    if allow_native_non_smoke_eval and not native_lm_studio:
        raise EvaluationFailure(
            "Native non-smoke eval izni yalnız LM Studio native v1 için kullanılabilir."
        )
    if native_lm_studio:
        if not allow_native_non_smoke_eval and input_sha256 != _STAGE2_SMOKE_SHA256:
            raise EvaluationFailure(
                "LM Studio native v1 varsayılan olarak yalnız sabit Aşama 2 smoke setini çalıştırır; "
                "non-smoke eval ayrıca G-FULL ve açık CLI interlock'u gerektirir."
            )
        executions = _prioritize_native_profile_probe(cases, executions, profiles)

    run_directory = output_root / run_id
    if run_directory.exists():
        raise OutputCollisionError(f"Koşu dizini zaten var: {run_id}")

    backend = backend_factory(
        config,
        selected_backend,
        environ=environ,
        transport_factory=transport_factory,
        clock=clock,
    )
    backend.preflight()

    config_sha256 = _config_digest(runtime_bytes, assistant_bytes, model_manifest_bytes)
    model = _model_identity(config, backend, selected_backend, model_artifact)
    runtime = _runtime_identity(backend)
    sensitive_values = _resolved_runtime_values(config, selected_backend, environ)

    started_at = now()
    run_started = clock()
    results: list[RunResult] = []
    for case, profile in executions:
        request = _request_for(case, profile, config, assistant.system_prompt)
        request_started = clock()
        try:
            response = backend.generate(request)
            result = _successful_result(
                run_id=run_id,
                case=case,
                profile=profile,
                request=request,
                response=response,
                config=config,
                backend=backend,
                model=model,
                runtime=runtime,
                input_sha256=input_sha256,
                config_sha256=config_sha256,
                created_at=now(),
                sensitive_values=sensitive_values,
            )
        except RuntimeFailure as exc:
            if native_lm_studio:
                # A native profile probe or response-contract failure revokes the
                # whole run. No later prompt and no partial artifact is allowed.
                raise
            elapsed_ms = max(0.0, (clock() - request_started) * 1000)
            result = _failed_result(
                run_id=run_id,
                case=case,
                profile=profile,
                request=request,
                config=config,
                backend=backend,
                model=model,
                runtime=runtime,
                input_sha256=input_sha256,
                config_sha256=config_sha256,
                created_at=now(),
                elapsed_ms=elapsed_ms,
                failure=exc,
            )
        except Exception:
            if native_lm_studio:
                raise EvaluationFailure(
                    "LM Studio native v1 profil doğrulaması güvenli biçimde durduruldu."
                ) from None
            elapsed_ms = max(0.0, (clock() - request_started) * 1000)
            result = _failed_result(
                run_id=run_id,
                case=case,
                profile=profile,
                request=request,
                config=config,
                backend=backend,
                model=model,
                runtime=runtime,
                input_sha256=input_sha256,
                config_sha256=config_sha256,
                created_at=now(),
                elapsed_ms=elapsed_ms,
                failure=None,
            )
        if native_lm_studio and model_artifact is not None and result.success:
            configured_backend = config.backends.get(selected_backend)
            expected_native = (
                configured_backend.native_v1
                if isinstance(configured_backend, LMStudioBackendConfig)
                else None
            )
            validate_run_result_against_manifest(
                result, model_artifact, expected_native
            )
        results.append(result)

    finished_at = now()
    duration_ms = max(0.0, (clock() - run_started) * 1000)
    results_payload = serialize_results(results)
    result_sha256 = sha256_bytes(results_payload)
    failure_count = sum(not result.success for result in results)
    error_counts = Counter(
        result.error.type for result in results if result.error is not None
    )
    summary = RunSummary(
        schema_version="1.1",
        run_id=run_id,
        started_at=started_at,
        finished_at=finished_at,
        duration_ms=duration_ms,
        model=model,
        runtime=runtime,
        input_sha256=input_sha256,
        config_sha256=config_sha256,
        result_reference=ResultReference(
            path="results.jsonl",
            sha256=result_sha256,
            record_count=len(results),
        ),
        distinct_case_count=len({case.id for case, _ in executions}),
        execution_count=len(results),
        success_count=len(results) - failure_count,
        failure_count=failure_count,
        skipped_count=0,
        error_rate=failure_count / len(results),
        profiles=_profile_summaries(results),
        errors=[ErrorSummary(type=kind, count=count) for kind, count in sorted(error_counts.items())],
        semantic_scoring_performed=False,
        pipeline_warning=PIPELINE_WARNING,
        benchmark=None,
    )
    written_directory = write_run_artifacts(
        output_root=output_root,
        run_id=run_id,
        results_payload=results_payload,
        summary=summary,
    )
    return EvaluationRun(
        run_directory=written_directory,
        results=tuple(results),
        summary=summary,
    )
