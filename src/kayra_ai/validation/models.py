from __future__ import annotations

from datetime import datetime
import hashlib
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ID_PATTERN = r"^[a-z0-9][a-z0-9._-]{2,127}$"
EVAL_ID_PATTERN = r"^eval-[a-z0-9][a-z0-9._-]{2,119}$"
SHA256_PATTERN = r"^[a-f0-9]{64}$"
HASHED_RUNTIME_ID_PATTERN = r"^sha256:[a-f0-9]{64}$"
PINNED_STAGE2_ARTIFACT_SHA256 = (
    "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0"
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Message(StrictModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=65536)


class PromptMessage(StrictModel):
    role: Literal["system", "user"]
    content: str = Field(min_length=1, max_length=32768)


class Provenance(StrictModel):
    kind: Literal["human", "synthetic", "mixed"]
    source_id: str = Field(min_length=2, max_length=256)
    license: str = Field(min_length=2, max_length=128)
    created_at: datetime
    generator: str | None = Field(default=None, max_length=200)
    critic: str | None = Field(default=None, max_length=200)
    prompt_version: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def synthetic_trace_is_complete(self) -> "Provenance":
        if self.kind in {"synthetic", "mixed"}:
            missing = [
                name
                for name, value in (
                    ("generator", self.generator),
                    ("critic", self.critic),
                    ("prompt_version", self.prompt_version),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"sentetik provenance alanları eksik: {', '.join(missing)}")
            if self.generator == self.critic:
                raise ValueError("generator ve critic aynı tek model olamaz")
        return self


class PIIStatus(StrictModel):
    contains_personal_data: Literal[False]
    reviewed: bool
    notes: str | None = Field(default=None, max_length=500)


class Quality(StrictModel):
    status: Literal["candidate", "accepted", "rejected"]
    scores: dict[str, float]
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def scores_are_bounded(self) -> "Quality":
        if any(score < 0 or score > 1 for score in self.scores.values()):
            raise ValueError("quality scores 0 ile 1 arasında olmalı")
        return self


class SFTExample(StrictModel):
    schema_version: Literal["1.0"]
    id: str = Field(pattern=ID_PATTERN)
    split: Literal["train", "validation"]
    language: Literal["tr", "en", "mixed"]
    category: str = Field(min_length=2, max_length=80)
    messages: list[Message] = Field(min_length=2, max_length=32)
    provenance: Provenance
    content_sha256: str = Field(pattern=SHA256_PATTERN)
    pii: PIIStatus
    quality: Quality | None = None
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def conversation_shape(self) -> "SFTExample":
        if not any(message.role == "user" for message in self.messages):
            raise ValueError("en az bir user mesajı gerekli")
        if self.messages[-1].role != "assistant":
            raise ValueError("son mesaj assistant olmalı")
        for previous, current in zip(self.messages, self.messages[1:]):
            if previous.role == current.role and current.role != "system":
                raise ValueError("user/assistant rolleri art arda tekrar edemez")
        return self


class PreferenceExample(StrictModel):
    schema_version: Literal["1.0"]
    id: str = Field(pattern=ID_PATTERN)
    split: Literal["train", "validation"]
    language: Literal["tr", "en", "mixed"]
    category: str = Field(min_length=2, max_length=80)
    prompt_messages: list[PromptMessage] = Field(min_length=1, max_length=31)
    chosen: str = Field(min_length=1, max_length=65536)
    rejected: str = Field(min_length=1, max_length=65536)
    preference_reason: str = Field(min_length=10, max_length=4000)
    provenance: Provenance
    content_sha256: str = Field(pattern=SHA256_PATTERN)
    pii: PIIStatus
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def responses_are_distinct(self) -> "PreferenceExample":
        if self.chosen.strip() == self.rejected.strip():
            raise ValueError("chosen ve rejected aynı olamaz")
        return self


class RubricItem(StrictModel):
    criterion: str = Field(min_length=10, max_length=500)
    weight: float = Field(gt=0, le=1)


class EvalProvenance(StrictModel):
    kind: Literal["human", "synthetic", "mixed"]
    generator: str | None = Field(default=None, min_length=2, max_length=200)
    generator_model: str | None = Field(default=None, min_length=2, max_length=200)
    human_reviewed: bool
    license: str = Field(min_length=2, max_length=128)
    created_at: datetime
    review_status: Literal["draft/unreviewed", "reviewed", "locked"]

    @model_validator(mode="after")
    def provenance_is_consistent(self) -> "EvalProvenance":
        if self.kind in {"synthetic", "mixed"} and (not self.generator or not self.generator_model):
            raise ValueError("sentetik eval için generator ve generator_model gerekli")
        if not self.human_reviewed and self.review_status != "draft/unreviewed":
            raise ValueError("insan incelemesi yoksa review_status draft/unreviewed olmalı")
        if self.review_status in {"reviewed", "locked"} and not self.human_reviewed:
            raise ValueError("reviewed/locked durumları insan incelemesi gerektirir")
        return self


class EvalCase(StrictModel):
    schema_version: Literal["1.0"]
    id: str = Field(pattern=EVAL_ID_PATTERN)
    language: Literal["tr", "en", "mixed"]
    category: Literal[
        "turkish",
        "instruction_following",
        "reasoning",
        "coding",
        "summarization",
        "honesty",
        "privacy",
        "safety",
        "format",
        "rag_boundary",
        "persona",
    ]
    difficulty: Literal["easy", "medium", "hard"]
    mode: Literal["thinking", "non_thinking", "both"]
    messages: list[PromptMessage] = Field(min_length=1, max_length=16)
    expected_behavior: str = Field(min_length=20, max_length=3000)
    reference_answer: str | None = Field(default=None, max_length=10000)
    rubric: list[RubricItem] = Field(min_length=1, max_length=10)
    tags: list[str] = Field(min_length=1)
    max_output_tokens: int = Field(ge=16, le=4096)
    privacy_sensitivity: Literal["none", "low", "high"]
    provenance: EvalProvenance

    @model_validator(mode="after")
    def rubric_weights_sum_to_one(self) -> "EvalCase":
        total = sum(item.weight for item in self.rubric)
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"rubric ağırlıkları toplamı 1 olmalı; bulunan {total:g}")
        if len(self.tags) != len(set(self.tags)):
            raise ValueError("tags benzersiz olmalı")
        return self


class ModelIdentity(StrictModel):
    id: str = Field(min_length=2, max_length=200)
    revision: str | None = Field(min_length=1, max_length=200)
    artifact_sha256: str | None = Field(pattern=SHA256_PATTERN)


class RuntimeIdentity(StrictModel):
    name: Literal["lm_studio", "llama_cpp", "mock"]
    version: str | None = Field(min_length=1, max_length=100)
    platform: str = Field(min_length=2, max_length=100)


class RubricScore(StrictModel):
    criterion: str = Field(min_length=1, max_length=500)
    score: float = Field(ge=0, le=1)
    judge: str = Field(min_length=2, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)


class GenerationParameters(StrictModel):
    context_length: int = Field(ge=512)
    temperature: float = Field(ge=0, le=2)
    top_p: float = Field(gt=0, le=1)
    max_output_tokens: int = Field(ge=1, le=4096)
    stream: bool


class ModeResolution(StrictModel):
    capability_status: Literal["supported", "unsupported", "unknown"]
    effective_profile: Literal["thinking", "non_thinking", "backend_default", "unknown"]
    fallback_used: bool
    requested_reasoning: Literal["on", "off"] | None
    advertised_reasoning_options: list[Literal["off", "on", "low", "medium", "high"]] | None
    advertised_reasoning_default: Literal["off", "on", "low", "medium", "high"] | None
    observed_reasoning_output: Literal["present", "absent", "unknown"]
    resolved_reasoning_state: Literal["unknown"] | None
    verification_status: Literal[
        "static_verified",
        "behaviorally_consistent",
        "fallback",
        "unknown",
    ]
    evidence_source: Literal[
        "static_backend",
        "lm_studio_native_v1_models",
        "lm_studio_native_v1_response",
        "unverified",
    ]

    @model_validator(mode="after")
    def fallback_is_explicit(self) -> "ModeResolution":
        options = self.advertised_reasoning_options
        if options is not None and len(options) != len(set(options)):
            raise ValueError("advertised reasoning seçenekleri benzersiz olmalı")
        if (
            self.advertised_reasoning_default is not None
            and options is not None
            and self.advertised_reasoning_default not in options
        ):
            raise ValueError("advertised reasoning default seçenekler içinde olmalı")
        if self.fallback_used and self.effective_profile != "backend_default":
            raise ValueError("fallback kullanıldığında effective_profile backend_default olmalı")
        if not self.fallback_used and self.effective_profile == "backend_default":
            raise ValueError("backend_default effective_profile açık fallback gerektirir")
        if self.capability_status != "supported" and self.effective_profile not in {
            "unknown",
            "backend_default",
        }:
            raise ValueError("desteklenmeyen veya bilinmeyen capability profil iddia edemez")
        if self.verification_status == "static_verified":
            if (
                self.capability_status != "supported"
                or self.effective_profile not in {"thinking", "non_thinking"}
                or self.fallback_used
                or self.requested_reasoning is not None
                or self.advertised_reasoning_options is not None
                or self.advertised_reasoning_default is not None
                or self.observed_reasoning_output != "unknown"
                or self.resolved_reasoning_state is not None
                or self.evidence_source != "static_backend"
            ):
                raise ValueError("static profil doğrulaması kendi kanıt alanlarıyla tutarlı olmalı")
        elif self.verification_status == "behaviorally_consistent":
            if (
                self.capability_status != "supported"
                or self.effective_profile != "unknown"
                or self.fallback_used
                or self.requested_reasoning is None
                or options is None
                or self.requested_reasoning not in options
                or self.observed_reasoning_output == "unknown"
                or self.resolved_reasoning_state != "unknown"
                or self.evidence_source != "lm_studio_native_v1_response"
            ):
                raise ValueError("davranışsal profil kanıtı resolved state iddia edemez")
        elif self.verification_status == "fallback":
            if (
                self.capability_status == "supported"
                or not self.fallback_used
                or self.effective_profile != "backend_default"
                or self.requested_reasoning is not None
                or self.advertised_reasoning_options is not None
                or self.advertised_reasoning_default is not None
                or self.observed_reasoning_output != "unknown"
                or self.resolved_reasoning_state is not None
                or self.evidence_source != "unverified"
            ):
                raise ValueError("fallback profil kanıtı tutarsız")
        elif self.verification_status == "unknown":
            if (
                self.effective_profile != "unknown"
                or self.fallback_used
                or self.requested_reasoning is not None
                or self.observed_reasoning_output != "unknown"
                or self.resolved_reasoning_state is not None
                or self.evidence_source
                not in {"lm_studio_native_v1_models", "unverified"}
            ):
                raise ValueError("bilinmeyen profil doğrulaması effective profil iddia edemez")
            if self.evidence_source == "unverified" and (
                self.advertised_reasoning_options is not None
                or self.advertised_reasoning_default is not None
            ):
                raise ValueError("unverified profil advertised reasoning metadata taşıyamaz")
        return self


class ResponseArtifact(StrictModel):
    retention: Literal["evaluation_artifact", "not_retained"]
    content: str | None = Field(min_length=1, max_length=131072)
    content_sha256: str | None = Field(pattern=SHA256_PATTERN)
    finish_reason: str | None = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def retention_matches_content(self) -> "ResponseArtifact":
        if self.retention == "evaluation_artifact":
            if self.content is None or self.content_sha256 is None:
                raise ValueError("evaluation_artifact için content ve content_sha256 gerekli")
            actual = hashlib.sha256(self.content.encode("utf-8")).hexdigest()
            if actual != self.content_sha256:
                raise ValueError("response content_sha256 içerikle eşleşmiyor")
        elif any(value is not None for value in (self.content, self.content_sha256, self.finish_reason)):
            raise ValueError("not_retained yanıtta content, hash veya finish_reason bulunamaz")
        return self


class TokenUsage(StrictModel):
    source: Literal[
        "backend_reported",
        "lm_studio_native_v1",
        "mock_deterministic",
        "unavailable",
    ]
    prompt_tokens: int | None = Field(ge=0)
    completion_tokens: int | None = Field(ge=0)
    total_tokens: int | None = Field(ge=0)
    reasoning_tokens: int | None = Field(ge=0)

    @model_validator(mode="after")
    def token_counts_are_consistent(self) -> "TokenUsage":
        values = (
            self.prompt_tokens,
            self.completion_tokens,
            self.total_tokens,
            self.reasoning_tokens,
        )
        if self.source == "unavailable" and any(value is not None for value in values):
            raise ValueError("unavailable usage token sayıları içeremez")
        if self.source == "lm_studio_native_v1":
            if (
                self.prompt_tokens is None
                or self.completion_tokens is None
                or self.reasoning_tokens is None
                or self.total_tokens is not None
            ):
                raise ValueError(
                    "native v1 usage input/output/reasoning tokenlarını taşımalı ve total_tokens üretmemeli"
                )
        if self.prompt_tokens is not None and self.completion_tokens is not None:
            expected = self.prompt_tokens + self.completion_tokens
            if self.total_tokens is not None and self.total_tokens != expected:
                raise ValueError("total_tokens prompt_tokens + completion_tokens olmalı")
        return self


class TimingMetrics(StrictModel):
    first_token_ms: float | None = Field(ge=0)
    first_token_ms_source: Literal[
        "lm_studio_native_v1",
        "mock_deterministic",
        "unavailable",
    ]
    generation_ms: float | None = Field(ge=0)
    generation_ms_source: Literal[
        "backend_reported",
        "client_measured",
        "mock_deterministic",
        "unavailable",
    ]
    total_ms: float | None = Field(ge=0)
    total_ms_source: Literal["client_measured", "mock_deterministic", "unavailable"]
    tokens_per_second: float | None = Field(ge=0)
    tokens_per_second_source: Literal[
        "lm_studio_native_v1",
        "backend_reported",
        "mock_deterministic",
        "unavailable",
    ]
    model_load_ms: float | None = Field(ge=0)
    model_load_ms_source: Literal["lm_studio_native_v1", "unavailable"]

    @model_validator(mode="after")
    def timings_are_consistent(self) -> "TimingMetrics":
        pairs = (
            (self.first_token_ms, self.first_token_ms_source),
            (self.generation_ms, self.generation_ms_source),
            (self.total_ms, self.total_ms_source),
            (self.tokens_per_second, self.tokens_per_second_source),
            (self.model_load_ms, self.model_load_ms_source),
        )
        for value, source in pairs:
            if (value is None) != (source == "unavailable"):
                raise ValueError("timing değeri ile ölçüm kaynağı tutarlı olmalı")
        if self.total_ms is not None:
            if self.first_token_ms is not None and self.first_token_ms > self.total_ms:
                raise ValueError("first_token_ms total_ms değerini aşamaz")
            if self.generation_ms is not None and self.generation_ms > self.total_ms:
                raise ValueError("generation_ms total_ms değerini aşamaz")
        return self


class BackendErrorInfo(StrictModel):
    type: Literal[
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
    message: str = Field(min_length=1, max_length=1000)
    retryable: bool
    http_status: int | None = Field(ge=100, le=599)


class EvaluationOutcome(StrictModel):
    kind: Literal["pipeline_only", "semantic_quality"]
    semantic_scoring_performed: bool
    rubric_scores: list[RubricScore] = Field(max_length=50)

    @model_validator(mode="after")
    def evaluation_kind_is_consistent(self) -> "EvaluationOutcome":
        if self.kind == "pipeline_only":
            if self.semantic_scoring_performed or self.rubric_scores:
                raise ValueError("pipeline_only semantik puan veya rubric skoru içeremez")
        elif not self.semantic_scoring_performed or not self.rubric_scores:
            raise ValueError("semantic_quality semantik puanlama ve rubric skoru gerektirir")
        return self


class RunResult(StrictModel):
    schema_version: Literal["2.1"]
    run_id: str = Field(pattern=ID_PATTERN)
    result_id: str = Field(pattern=ID_PATTERN)
    case_id: str = Field(pattern=EVAL_ID_PATTERN)
    requested_profile: Literal["thinking", "non_thinking"]
    attempt: int = Field(ge=1, le=100)
    model: ModelIdentity
    runtime: RuntimeIdentity
    generation: GenerationParameters
    mode_resolution: ModeResolution
    response: ResponseArtifact
    usage: TokenUsage
    timing: TimingMetrics
    evaluation: EvaluationOutcome
    success: bool
    error: BackendErrorInfo | None
    created_at: datetime
    input_sha256: str = Field(pattern=SHA256_PATTERN)
    config_sha256: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def outcome_is_consistent(self) -> "RunResult":
        if self.runtime.name != "mock":
            if re.fullmatch(HASHED_RUNTIME_ID_PATTERN, self.model.id) is None:
                raise ValueError("gerçek runtime model id değeri sha256 kimliği olmalı")
            if self.model.revision is not None and re.fullmatch(
                HASHED_RUNTIME_ID_PATTERN, self.model.revision
            ) is None:
                raise ValueError("gerçek runtime model revision değeri sha256 kimliği olmalı")
        if self.success and self.error is not None:
            raise ValueError("başarılı sonuç error içeremez")
        if not self.success and self.error is None:
            raise ValueError("başarısız sonuç tipli error içermeli")
        if not self.success:
            if self.response.retention != "not_retained" or self.response.content is not None:
                raise ValueError("başarısız sonuç response içeriği saklayamaz")
            if (
                self.mode_resolution.effective_profile != "unknown"
                or self.mode_resolution.fallback_used
                or self.mode_resolution.requested_reasoning is not None
                or self.mode_resolution.observed_reasoning_output != "unknown"
                or self.mode_resolution.resolved_reasoning_state is not None
                or self.mode_resolution.verification_status != "unknown"
            ):
                raise ValueError("başarısız sonuç profil yürütme iddiası içeremez")
            if self.usage.source != "unavailable":
                raise ValueError("başarısız sonuç token kullanımı iddia edemez")
            if (
                self.timing.first_token_ms_source != "unavailable"
                or self.timing.generation_ms_source != "unavailable"
                or self.timing.tokens_per_second_source != "unavailable"
                or self.timing.model_load_ms_source != "unavailable"
                or self.timing.total_ms_source not in {"client_measured", "unavailable"}
            ):
                raise ValueError(
                    "başarısız sonuç yalnız istemci toplam süresini veya unavailable timing taşıyabilir"
                )
        elif self.mode_resolution.verification_status == "unknown":
            raise ValueError("başarılı sonuç unknown profil doğrulaması taşıyamaz")
        if self.mode_resolution.fallback_used and self.runtime.name != "llama_cpp":
            raise ValueError("profil fallback yalnız llama_cpp runtime ile kullanılabilir")
        if self.mode_resolution.capability_status == "supported":
            if self.mode_resolution.verification_status == "static_verified":
                if self.mode_resolution.effective_profile != self.requested_profile:
                    raise ValueError("statik desteklenen mod istenen profile çözülmeli")
            elif self.mode_resolution.verification_status == "behaviorally_consistent":
                expected_reasoning = "on" if self.requested_profile == "thinking" else "off"
                expected_observation = "present" if self.requested_profile == "thinking" else "absent"
                if (
                    self.mode_resolution.requested_reasoning != expected_reasoning
                    or self.mode_resolution.observed_reasoning_output != expected_observation
                ):
                    raise ValueError("native reasoning kanıtı istenen profille uyuşmuyor")
                if self.requested_profile == "thinking":
                    if self.usage.reasoning_tokens is None or self.usage.reasoning_tokens <= 0:
                        raise ValueError("thinking davranış kanıtı pozitif reasoning token gerektirir")
                elif self.usage.reasoning_tokens != 0:
                    raise ValueError("non-thinking davranış kanıtı sıfır reasoning token gerektirir")
                if (
                    self.runtime.name != "lm_studio"
                    or self.generation.context_length != 4096
                    or self.generation.stream
                    or self.model.artifact_sha256 != PINNED_STAGE2_ARTIFACT_SHA256
                    or self.usage.source != "lm_studio_native_v1"
                    or self.timing.first_token_ms_source != "lm_studio_native_v1"
                    or self.timing.generation_ms_source != "unavailable"
                    or self.timing.tokens_per_second_source != "lm_studio_native_v1"
                    or self.timing.total_ms_source != "client_measured"
                    or self.timing.model_load_ms_source
                    not in {"lm_studio_native_v1", "unavailable"}
                ):
                    raise ValueError(
                        "native davranış kanıtı pinli artifact, 4096 context, non-stream ve native v1 metrikleri gerektirir"
                    )
            elif self.success:
                raise ValueError("başarılı supported sonuç doğrulama kanıtı gerektirir")
        if self.runtime.name == "mock":
            if (
                self.evaluation.kind != "pipeline_only"
                or self.evaluation.semantic_scoring_performed
                or self.evaluation.rubric_scores
            ):
                raise ValueError("mock sonucu yalnız pipeline_only olabilir")
            if self.mode_resolution.capability_status != "supported":
                raise ValueError("mock backend iki profili de desteklemeli")
            if self.mode_resolution.fallback_used:
                raise ValueError("mock backend fallback kullanamaz")
            if self.success:
                if self.mode_resolution.effective_profile != self.requested_profile:
                    raise ValueError("mock effective_profile istenen profille aynı olmalı")
                if (
                    self.mode_resolution.verification_status != "static_verified"
                    or self.mode_resolution.evidence_source != "static_backend"
                ):
                    raise ValueError("mock backend statik profil doğrulaması kullanmalı")
                if self.usage.source != "mock_deterministic":
                    raise ValueError("mock backend yalnız mock_deterministic usage taşımalı")
                if (
                    self.timing.first_token_ms_source != "unavailable"
                    or self.timing.generation_ms_source != "unavailable"
                    or self.timing.total_ms_source != "mock_deterministic"
                    or self.timing.tokens_per_second_source != "unavailable"
                    or self.timing.model_load_ms_source != "unavailable"
                ):
                    raise ValueError("mock backend yalnız güvenli deterministik timing kaynakları taşımalı")
        if self.timing.tokens_per_second is not None:
            if self.usage.completion_tokens is None:
                raise ValueError("tokens_per_second için completion_tokens gerekli")
        return self


class ProfileSummary(StrictModel):
    profile: Literal["thinking", "non_thinking"]
    execution_count: int = Field(ge=0)
    success_count: int = Field(ge=0)
    failure_count: int = Field(ge=0)
    skipped_count: int = Field(ge=0)
    error_rate: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def counts_are_consistent(self) -> "ProfileSummary":
        if self.success_count + self.failure_count + self.skipped_count != self.execution_count:
            raise ValueError("profil sayımları execution_count ile eşleşmiyor")
        expected_rate = self.failure_count / self.execution_count if self.execution_count else 0.0
        if abs(self.error_rate - expected_rate) > 1e-9:
            raise ValueError("profil error_rate failure_count / execution_count olmalı")
        return self


class ErrorSummary(StrictModel):
    type: Literal[
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
    count: int = Field(ge=1)


class ResultReference(StrictModel):
    path: Literal["results.jsonl"]
    sha256: str = Field(pattern=SHA256_PATTERN)
    record_count: int = Field(ge=1)


PIPELINE_WARNING = (
    "Pipeline-only evaluation; results are not semantic quality scores or model benchmarks."
)


class RunSummary(StrictModel):
    schema_version: Literal["1.1"]
    run_id: str = Field(pattern=ID_PATTERN)
    started_at: datetime
    finished_at: datetime
    duration_ms: float = Field(ge=0)
    model: ModelIdentity
    runtime: RuntimeIdentity
    input_sha256: str = Field(pattern=SHA256_PATTERN)
    config_sha256: str = Field(pattern=SHA256_PATTERN)
    result_reference: ResultReference
    distinct_case_count: int = Field(ge=1)
    execution_count: int = Field(ge=1)
    success_count: int = Field(ge=0)
    failure_count: int = Field(ge=0)
    skipped_count: int = Field(ge=0)
    error_rate: float = Field(ge=0, le=1)
    profiles: list[ProfileSummary] = Field(min_length=1, max_length=2)
    errors: list[ErrorSummary]
    semantic_scoring_performed: Literal[False]
    pipeline_warning: Literal[
        "Pipeline-only evaluation; results are not semantic quality scores or model benchmarks."
    ]
    benchmark: None

    @model_validator(mode="after")
    def summary_is_consistent(self) -> "RunSummary":
        if self.runtime.name != "mock":
            if re.fullmatch(HASHED_RUNTIME_ID_PATTERN, self.model.id) is None:
                raise ValueError("gerçek runtime özet model id değeri sha256 kimliği olmalı")
            if self.model.revision is not None and re.fullmatch(
                HASHED_RUNTIME_ID_PATTERN, self.model.revision
            ) is None:
                raise ValueError("gerçek runtime özet model revision değeri sha256 kimliği olmalı")
        if self.finished_at < self.started_at:
            raise ValueError("finished_at started_at değerinden önce olamaz")
        if self.distinct_case_count > self.execution_count:
            raise ValueError("distinct_case_count execution_count değerini aşamaz")
        if self.success_count + self.failure_count + self.skipped_count != self.execution_count:
            raise ValueError("özet sayımları execution_count ile eşleşmiyor")
        if self.result_reference.record_count != self.execution_count:
            raise ValueError("result_reference.record_count execution_count ile eşleşmiyor")
        expected_rate = self.failure_count / self.execution_count
        if abs(self.error_rate - expected_rate) > 1e-9:
            raise ValueError("error_rate failure_count / execution_count olmalı")
        profiles = [item.profile for item in self.profiles]
        if len(profiles) != len(set(profiles)):
            raise ValueError("profiles benzersiz olmalı")
        for field_name in (
            "execution_count",
            "success_count",
            "failure_count",
            "skipped_count",
        ):
            profile_total = sum(getattr(item, field_name) for item in self.profiles)
            if profile_total != getattr(self, field_name):
                raise ValueError(f"profil {field_name} toplamı özetle eşleşmiyor")
        if sum(item.count for item in self.errors) != self.failure_count:
            raise ValueError("error kırılımı failure_count ile eşleşmiyor")
        error_types = [item.type for item in self.errors]
        if len(error_types) != len(set(error_types)):
            raise ValueError("error türleri benzersiz olmalı")
        return self

DATASET_MODELS = {
    "sft": SFTExample,
    "preference": PreferenceExample,
    "eval": EvalCase,
    "run-result": RunResult,
}
