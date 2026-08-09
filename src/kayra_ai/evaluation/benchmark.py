from __future__ import annotations

import json
import math
import re
import statistics
from collections import Counter
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)


SMOKE_SET_PATH = "data/eval/stage2-smoke.jsonl"
SMOKE_SET_SHA256 = "605ecf339774b5130c9214fbaa126202f2f91b20327092f3d44cb9df8111751d"
SMOKE_CASE_IDS = ("eval-tr-001", "eval-if-003", "eval-reason-001")
PROFILE_CASE_IDS = {
    "thinking": frozenset(("eval-if-003", "eval-reason-001")),
    "non_thinking": frozenset(("eval-tr-001", "eval-if-003")),
}
MAX_SERIES_BYTES = 1_048_576

_FORBIDDEN_KEYS = frozenset(
    {
        "api_key",
        "authorization",
        "content",
        "exception",
        "exception_repr",
        "headers",
        "messages",
        "prompt",
        "raw_body",
        "raw_response",
        "response",
        "response_body",
        "secret",
    }
)
_SECRET_VALUE_PATTERNS = (
    re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]{8,}"),
    re.compile(r"(?i)\b(?:api[_ -]?key|authorization)\s*[:=]"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{10,}"),
)

NullReason = Literal[
    "server_field_absent",
    "request_failed",
    "client_measurement_unavailable",
]
ErrorType = Literal[
    "configuration",
    "connection",
    "timeout",
    "http_status",
    "malformed_response",
    "model_unavailable",
    "capability_unavailable",
    "privacy_policy",
    "internal",
]
ReasoningOption = Literal["off", "on", "low", "medium", "high"]


class BenchmarkValidationError(ValueError):
    """A stable, content-free validation failure."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class NullableIntegerMetric(StrictModel):
    value: int | None = Field(default=None, ge=0)
    null_reason: NullReason | None = None

    @model_validator(mode="after")
    def value_and_reason_are_exclusive(self) -> "NullableIntegerMetric":
        if (self.value is None) == (self.null_reason is None):
            raise ValueError("metric value ve null_reason alanlarından yalnız biri dolu olmalı")
        return self


class NullableFloatMetric(StrictModel):
    value: float | None = Field(default=None, ge=0)
    null_reason: NullReason | None = None

    @model_validator(mode="after")
    def value_and_reason_are_exclusive(self) -> "NullableFloatMetric":
        if (self.value is None) == (self.null_reason is None):
            raise ValueError("metric value ve null_reason alanlarından yalnız biri dolu olmalı")
        return self


class NativeStats(StrictModel):
    input_tokens: NullableIntegerMetric
    total_output_tokens: NullableIntegerMetric
    reasoning_output_tokens: NullableIntegerMetric
    tokens_per_second: NullableFloatMetric
    time_to_first_token_seconds: NullableFloatMetric
    model_load_time_seconds: NullableFloatMetric

    def metrics(self) -> tuple[NullableIntegerMetric | NullableFloatMetric, ...]:
        return (
            self.input_tokens,
            self.total_output_tokens,
            self.reasoning_output_tokens,
            self.tokens_per_second,
            self.time_to_first_token_seconds,
            self.model_load_time_seconds,
        )


class BenchmarkSample(StrictModel):
    phase: Literal["warmup", "measured"]
    ordinal: int = Field(ge=0, le=5)
    case_id: Literal["eval-tr-001", "eval-if-003", "eval-reason-001"]
    retry_count: Literal[0]
    success: bool
    error_type: ErrorType | None
    observed_reasoning_output: Literal["present", "absent", "unknown"]
    native_stats: NativeStats
    total_request_ms: NullableFloatMetric

    @field_validator("retry_count", mode="before")
    @classmethod
    def retry_count_is_a_json_integer(cls, value: Any) -> Any:
        if type(value) is not int:
            raise ValueError("retry_count JSON integer olmalı")
        return value

    @model_validator(mode="after")
    def status_and_metrics_are_consistent(self) -> "BenchmarkSample":
        if any(
            metric.null_reason == "client_measurement_unavailable"
            for metric in self.native_stats.metrics()
        ):
            raise ValueError("server native stats client null_reason kullanamaz")
        if self.total_request_ms.null_reason in {"server_field_absent", "request_failed"}:
            raise ValueError("client timing server null_reason kullanamaz")
        if self.success:
            if self.error_type is not None:
                raise ValueError("başarılı örnek error_type içeremez")
            if self.observed_reasoning_output == "unknown":
                raise ValueError("başarılı örnek reasoning gözlemini içermeli")
            if any(metric.null_reason == "request_failed" for metric in self.native_stats.metrics()):
                raise ValueError("başarılı örnek request_failed null_reason içeremez")
            required_metrics = (
                self.native_stats.input_tokens,
                self.native_stats.total_output_tokens,
                self.native_stats.reasoning_output_tokens,
                self.native_stats.tokens_per_second,
                self.native_stats.time_to_first_token_seconds,
            )
            if any(metric.value is None for metric in required_metrics):
                raise ValueError("başarılı örnek zorunlu native stats değerlerini içermeli")
            if self.total_request_ms.value is None:
                raise ValueError("başarılı örnek client toplam süresini içermeli")
        else:
            if self.error_type is None:
                raise ValueError("başarısız örnek tipli error_type gerektirir")
            if self.observed_reasoning_output != "unknown":
                raise ValueError("başarısız örnek reasoning gözlemi iddia edemez")
            if any(
                metric.value is not None or metric.null_reason != "request_failed"
                for metric in self.native_stats.metrics()
            ):
                raise ValueError("başarısız örneğin native stats alanları request_failed olmalı")
        return self


class MemoryObservation(StrictModel):
    collector_version: str = Field(min_length=1, max_length=100, pattern=r"^[^\r\n\t]+$")
    sampling_interval_ms: int = Field(ge=100, le=60_000)


class RamObservation(MemoryObservation):
    metric: Literal["available_physical_mib"]
    scope: Literal["windows_system"]
    collector: Literal["powershell_get_counter_memory_available_mbytes"]
    baseline_mib: float = Field(ge=0)
    loaded_idle_mib: float = Field(ge=0)
    measured_minimum_mib: float = Field(ge=0)


class VramObservation(MemoryObservation):
    metric: Literal["used_mib"]
    scope: Literal["gpu_total"]
    collector: Literal["nvidia_smi"]
    gpu_identifier_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    baseline_mib: float = Field(ge=0)
    loaded_idle_mib: float = Field(ge=0)
    measured_peak_mib: float = Field(ge=0)


class ProfileMemory(StrictModel):
    ram: RamObservation
    vram: VramObservation


class ProfileReasoningEvidence(StrictModel):
    requested_reasoning: Literal["on", "off"]
    advertised_reasoning_options: list[ReasoningOption] = Field(min_length=2, max_length=5)
    advertised_reasoning_default: ReasoningOption | None
    observed_reasoning_output: Literal["present", "absent"]
    profile_verification_status: Literal["behaviorally_consistent"]
    resolved_reasoning_state: Literal["unknown"]

    @model_validator(mode="after")
    def advertised_capability_is_consistent(self) -> "ProfileReasoningEvidence":
        options = self.advertised_reasoning_options
        if len(options) != len(set(options)):
            raise ValueError("advertised reasoning seçenekleri benzersiz olmalı")
        if self.requested_reasoning not in options:
            raise ValueError("istenen reasoning değeri advertised seçenekler içinde olmalı")
        if not {"off", "on"}.issubset(options):
            raise ValueError("eşli profil probu advertised off ve on seçeneklerini gerektirir")
        if (
            self.advertised_reasoning_default is not None
            and self.advertised_reasoning_default not in options
        ):
            raise ValueError("advertised reasoning default seçenekler içinde olmalı")
        return self


class BenchmarkProfile(StrictModel):
    profile: Literal["thinking", "non_thinking"]
    warmup_excluded: Literal[True]
    reasoning_evidence: ProfileReasoningEvidence
    memory: ProfileMemory
    samples: list[BenchmarkSample] = Field(min_length=6, max_length=6)

    @field_validator("warmup_excluded", mode="before")
    @classmethod
    def warmup_flag_is_a_json_boolean(cls, value: Any) -> Any:
        if type(value) is not bool:
            raise ValueError("warmup_excluded JSON boolean olmalı")
        return value

    @model_validator(mode="after")
    def sample_plan_is_exact(self) -> "BenchmarkProfile":
        expected = [("warmup", 0), *(("measured", ordinal) for ordinal in range(1, 6))]
        actual = [(sample.phase, sample.ordinal) for sample in self.samples]
        if actual != expected:
            raise ValueError("örnek sırası 1 warmup + 5 measured ve ordinal 0..5 olmalı")
        allowed = PROFILE_CASE_IDS[self.profile]
        if any(sample.case_id not in allowed for sample in self.samples):
            raise ValueError("case_id seçili profile uygun değil")
        expected_request = "on" if self.profile == "thinking" else "off"
        expected_observation = "present" if self.profile == "thinking" else "absent"
        if self.reasoning_evidence.requested_reasoning != expected_request:
            raise ValueError("profil ile requested reasoning eşleşmiyor")
        if self.reasoning_evidence.observed_reasoning_output != expected_observation:
            raise ValueError("profil ile ön probun reasoning gözlemi eşleşmiyor")
        for sample in self.samples:
            if not sample.success:
                continue
            if sample.observed_reasoning_output != expected_observation:
                raise ValueError("başarılı örneğin reasoning gözlemi profile uymalı")
            reasoning_tokens = sample.native_stats.reasoning_output_tokens.value
            if self.profile == "thinking" and (reasoning_tokens is None or reasoning_tokens <= 0):
                raise ValueError("başarılı thinking örneği pozitif reasoning tokeni içermeli")
            if self.profile == "non_thinking" and reasoning_tokens != 0:
                raise ValueError("başarılı non-thinking örneği sıfır reasoning tokeni içermeli")
        return self


class SmokeSetIdentity(StrictModel):
    path: Literal[SMOKE_SET_PATH]
    sha256: Literal[SMOKE_SET_SHA256]
    case_ids: list[Literal["eval-tr-001", "eval-if-003", "eval-reason-001"]]

    @model_validator(mode="after")
    def case_order_is_exact(self) -> "SmokeSetIdentity":
        if tuple(self.case_ids) != SMOKE_CASE_IDS:
            raise ValueError("smoke case_id sırası sabit olmalı")
        return self


class ModelIdentity(StrictModel):
    identifier_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    revision_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    artifact_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    quantization: Literal["Q4_K_M"]


class RuntimeIdentity(StrictModel):
    name: Literal["lm_studio"]
    version: str = Field(min_length=1, max_length=100, pattern=r"^[^\r\n\t]+$")
    engine: str = Field(min_length=1, max_length=100, pattern=r"^[^\r\n\t]+$")
    engine_version: str = Field(min_length=1, max_length=100, pattern=r"^[^\r\n\t]+$")
    platform: Literal["windows"]
    windows_version: str = Field(min_length=1, max_length=100, pattern=r"^[^\r\n\t]+$")
    gpu_driver_version: str = Field(min_length=1, max_length=100, pattern=r"^[^\r\n\t]+$")


class BenchmarkConfiguration(StrictModel):
    endpoint: Literal["/api/v1/chat"]
    store: Literal[False]
    stream: Literal[False]
    context_length: Literal[4096]
    parallel: Literal[1]
    offload_kv_cache_to_gpu: Literal[False]
    retries: Literal[0]
    temperature: float = Field(ge=0, le=2)
    top_p: float = Field(gt=0, le=1)
    max_output_tokens_source: Literal["eval_case"]
    mode_control_method: Literal["native_api_reasoning_parameter"]
    profile_verification_status: Literal["behaviorally_consistent"]
    resolved_reasoning_state: Literal["unknown"]
    runtime_config_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    assistant_config_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @field_validator("store", "stream", "offload_kv_cache_to_gpu", mode="before")
    @classmethod
    def fixed_flags_are_json_booleans(cls, value: Any) -> Any:
        if type(value) is not bool:
            raise ValueError("sabit bayrak JSON boolean olmalı")
        return value

    @field_validator("context_length", "parallel", "retries", mode="before")
    @classmethod
    def fixed_counts_are_json_integers(cls, value: Any) -> Any:
        if type(value) is not int:
            raise ValueError("sabit sayaç JSON integer olmalı")
        return value


class NativeStatsContract(StrictModel):
    source: Literal["lm_studio_native_v1"]
    input_tokens: Literal["stats.input_tokens"]
    total_output_tokens: Literal["stats.total_output_tokens"]
    reasoning_output_tokens: Literal["stats.reasoning_output_tokens"]
    tokens_per_second: Literal["stats.tokens_per_second"]
    time_to_first_token_seconds: Literal["stats.time_to_first_token_seconds"]
    model_load_time_seconds: Literal["stats.model_load_time_seconds"]


class ClientTimingContract(StrictModel):
    source: Literal["client_monotonic"]
    metric: Literal["total_request_ms"]


class MetricContract(StrictModel):
    native_stats: NativeStatsContract
    client_timing: ClientTimingContract


class BenchmarkSeries(StrictModel):
    schema_version: Literal["1.0"]
    series_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{2,127}$")
    started_at: datetime = Field(strict=False)
    finished_at: datetime = Field(strict=False)
    smoke_set: SmokeSetIdentity
    model: ModelIdentity
    runtime: RuntimeIdentity
    configuration: BenchmarkConfiguration
    metric_contract: MetricContract
    profiles: list[BenchmarkProfile] = Field(min_length=2, max_length=2)

    @field_validator("started_at", "finished_at", mode="before")
    @classmethod
    def timestamps_are_json_strings(cls, value: Any) -> Any:
        if type(value) is not str:
            raise ValueError("zaman damgası JSON string olmalı")
        return value

    @model_validator(mode="after")
    def series_is_canonical(self) -> "BenchmarkSeries":
        if self.started_at.utcoffset() is None or self.finished_at.utcoffset() is None:
            raise ValueError("zaman damgaları saat dilimi içermeli")
        if self.finished_at < self.started_at:
            raise ValueError("finished_at started_at değerinden önce olamaz")
        if [profile.profile for profile in self.profiles] != ["thinking", "non_thinking"]:
            raise ValueError("profil sırası thinking, non_thinking olmalı")
        return self


def _assert_content_free(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).strip().lower().replace("-", "_")
            if normalized in _FORBIDDEN_KEYS:
                raise BenchmarkValidationError("forbidden_content_key")
            _assert_content_free(child)
    elif isinstance(value, list):
        for child in value:
            _assert_content_free(child)
    elif isinstance(value, str) and any(pattern.search(value) for pattern in _SECRET_VALUE_PATTERNS):
        raise BenchmarkValidationError("secret_like_value")


def validate_benchmark_payload(payload: Any) -> BenchmarkSeries:
    if not isinstance(payload, Mapping):
        raise BenchmarkValidationError("invalid_root")
    _assert_content_free(payload)
    try:
        return BenchmarkSeries.model_validate(payload)
    except ValidationError:
        raise BenchmarkValidationError("invalid_contract") from None


def load_benchmark_series(path: Path) -> BenchmarkSeries:
    raw = path.read_bytes()
    if len(raw) > MAX_SERIES_BYTES:
        raise BenchmarkValidationError("artifact_too_large")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BenchmarkValidationError("invalid_json") from None
    return validate_benchmark_payload(payload)


def _nearest_rank_p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[math.ceil(0.95 * len(ordered)) - 1]


def _metric_summary(
    metrics: list[NullableIntegerMetric | NullableFloatMetric],
    failed_metrics: list[NullableIntegerMetric | NullableFloatMetric],
) -> dict[str, Any]:
    values = [float(metric.value) for metric in metrics if metric.value is not None]
    null_reasons = Counter(
        metric.null_reason for metric in metrics if metric.value is None and metric.null_reason is not None
    )
    failed_null_reasons = Counter(
        metric.null_reason
        for metric in failed_metrics
        if metric.value is None and metric.null_reason is not None
    )
    return {
        "reported_count": len(values),
        "null_count": len(metrics) - len(values),
        "null_reasons": dict(sorted(null_reasons.items())),
        "failed_reported_count": sum(metric.value is not None for metric in failed_metrics),
        "failed_null_count": sum(metric.value is None for metric in failed_metrics),
        "failed_null_reasons": dict(sorted(failed_null_reasons.items())),
        "median": statistics.median(values) if values else None,
        "p95_nearest_rank": _nearest_rank_p95(values),
    }


def summarize_benchmark_series(series: BenchmarkSeries) -> dict[str, Any]:
    profiles: list[dict[str, Any]] = []
    metric_names = (
        "input_tokens",
        "total_output_tokens",
        "reasoning_output_tokens",
        "tokens_per_second",
        "time_to_first_token_seconds",
        "model_load_time_seconds",
    )
    for profile in series.profiles:
        measured = profile.samples[1:]
        successful = [sample for sample in measured if sample.success]
        failures = [sample for sample in measured if not sample.success]
        errors = Counter(sample.error_type for sample in failures if sample.error_type is not None)
        metrics = {
            name: _metric_summary(
                [getattr(sample.native_stats, name) for sample in successful],
                [getattr(sample.native_stats, name) for sample in failures],
            )
            for name in metric_names
        }
        metrics["total_request_ms"] = _metric_summary(
            [sample.total_request_ms for sample in successful],
            [sample.total_request_ms for sample in failures],
        )
        profiles.append(
            {
                "profile": profile.profile,
                "warmup_excluded": True,
                "planned_measured_count": 5,
                "success_count": 5 - len(failures),
                "failure_count": len(failures),
                "error_rate": len(failures) / 5,
                "errors": dict(sorted(errors.items())),
                "metrics": metrics,
                "reasoning_evidence": profile.reasoning_evidence.model_dump(mode="json"),
                "memory": profile.memory.model_dump(mode="json"),
            }
        )
    return {
        "ok": all(profile["failure_count"] == 0 for profile in profiles),
        "schema_version": "1.0",
        "series_id": series.series_id,
        "started_at": series.started_at.isoformat(),
        "finished_at": series.finished_at.isoformat(),
        "smoke_set": series.smoke_set.model_dump(mode="json"),
        "model": series.model.model_dump(mode="json"),
        "runtime": series.runtime.model_dump(mode="json"),
        "configuration": series.configuration.model_dump(mode="json"),
        "metric_contract": series.metric_contract.model_dump(mode="json"),
        "profiles": profiles,
    }
