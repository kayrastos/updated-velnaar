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

from kayra_ai.runtime import ChatMessage, GenerationRequest, GenerationSettings, build_backend
from kayra_ai.runtime.backends.base import Backend
from kayra_ai.runtime.config import (
    MockBackendConfig,
    RuntimeConfig,
    load_runtime_config,
    normalize_api_root,
)
from kayra_ai.runtime.contracts import ProfileName
from kayra_ai.runtime.errors import MalformedResponseFailure, PrivacyPolicyFailure, RuntimeFailure
from kayra_ai.runtime.http_transport import TransportFactory
from kayra_ai.validation.common import ValidationIssue, iter_jsonl
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


def _config_digest(runtime_bytes: bytes, assistant_bytes: bytes) -> str:
    payload = b"kayra-runtime\0" + runtime_bytes + b"\0kayra-assistant\0" + assistant_bytes
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


def _result_id(run_id: str, case_id: str, profile: ProfileName, attempt: int) -> str:
    material = f"{run_id}\0{case_id}\0{profile}\0{attempt}".encode("utf-8")
    return f"result-{hashlib.sha256(material).hexdigest()[:32]}"


def _model_identity(config: RuntimeConfig, backend: Backend, backend_name: str) -> ModelIdentity:
    artifact_sha256 = None
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
    resolved = [values.get(name) for name in names if name]
    raw_api_root = values.get(configured.base_url_env)
    if raw_api_root:
        resolved.append(normalize_api_root(raw_api_root))
    return tuple(dict.fromkeys(value for value in resolved if value))


def _mode_resolution(
    *,
    config: RuntimeConfig,
    backend: Backend,
    profile: ProfileName,
    effective_profile: str | None,
) -> ModeResolution:
    status = backend.capabilities.status_for_profile(profile)
    fallback = effective_profile == "backend_default"
    if effective_profile is None:
        policy = config.profiles.get(profile).unsupported_capability
        fallback = status != "supported" and policy == "backend_default"
        effective_profile = "backend_default" if fallback else (profile if status == "supported" else "unknown")
    return ModeResolution(
        capability_status=status,
        effective_profile=effective_profile,
        fallback_used=fallback,
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
    response,
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
    has_usage = any(
        value is not None
        for value in (
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
            response.usage.total_tokens,
        )
    )
    usage_source = "mock_deterministic" if runtime.name == "mock" and has_usage else (
        "backend_reported" if has_usage else "unavailable"
    )
    timing_source = "mock_deterministic" if runtime.name == "mock" else "measured"
    return RunResult(
        schema_version="2.0",
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
            effective_profile=response.effective_profile,
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
        ),
        timing=TimingMetrics(
            source=timing_source,
            first_token_ms=response.timing.ttft_ms,
            generation_ms=None,
            total_ms=response.timing.total_ms,
            tokens_per_second=None,
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
        schema_version="2.0",
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
            effective_profile=None,
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
        ),
        timing=TimingMetrics(
            source="measured",
            first_token_ms=None,
            generation_ms=None,
            total_ms=elapsed_ms,
            tokens_per_second=None,
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
) -> EvaluationRun:
    if re.fullmatch(ID_PATTERN, run_id) is None:
        raise EvaluationFailure("Run kimliği geçersiz.")
    if profiles not in {"all", "thinking", "non_thinking"}:
        raise EvaluationFailure("Profil seçimi geçersiz.")

    runtime_bytes = _file_bytes(config_path, "Runtime yapılandırması")
    input_bytes = _file_bytes(eval_path, "Eval dosyası")
    config = load_runtime_config(config_path)

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

    run_directory = output_root / run_id
    if run_directory.exists():
        raise OutputCollisionError(f"Koşu dizini zaten var: {run_id}")

    selected_backend = backend_name or config.active_backend
    backend = backend_factory(
        config,
        selected_backend,
        environ=environ,
        transport_factory=transport_factory,
        clock=clock,
    )
    backend.preflight()

    input_sha256 = sha256_bytes(input_bytes)
    config_sha256 = _config_digest(runtime_bytes, assistant_bytes)
    model = _model_identity(config, backend, selected_backend)
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
        schema_version="1.0",
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
