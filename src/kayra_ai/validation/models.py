from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ID_PATTERN = r"^[a-z0-9][a-z0-9._-]{2,127}$"
EVAL_ID_PATTERN = r"^eval-[a-z0-9][a-z0-9._-]{2,119}$"
SHA256_PATTERN = r"^[a-f0-9]{64}$"


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
    revision: str = Field(min_length=1, max_length=200)
    artifact_sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)


class RuntimeIdentity(StrictModel):
    name: Literal["lm_studio", "llama_cpp", "mock"]
    version: str = Field(min_length=1, max_length=100)
    platform: str = Field(min_length=2, max_length=100)


class RubricScore(StrictModel):
    criterion: str = Field(min_length=1, max_length=500)
    score: float = Field(ge=0, le=1)
    judge: str = Field(min_length=2, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)


class GenerationParameters(StrictModel):
    model_config = ConfigDict(extra="allow")

    context_length: int = Field(ge=512)
    temperature: float = Field(ge=0, le=2)


class RunResult(StrictModel):
    schema_version: Literal["1.0"]
    run_id: str = Field(pattern=ID_PATTERN)
    case_id: str = Field(pattern=EVAL_ID_PATTERN)
    model: ModelIdentity
    runtime: RuntimeIdentity
    parameters: GenerationParameters
    output: str = Field(max_length=131072)
    rubric_scores: list[RubricScore]
    latency_ms: float = Field(ge=0)
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    created_at: datetime
    success: bool
    error: str | None = Field(default=None, max_length=4000)

DATASET_MODELS = {
    "sft": SFTExample,
    "preference": PreferenceExample,
    "eval": EvalCase,
    "run-result": RunResult,
}
