from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ProfileName = Literal["thinking", "non_thinking"]
EffectiveProfile = Literal["thinking", "non_thinking", "backend_default"]
CapabilityStatus = Literal["supported", "unsupported", "unknown"]
ErrorKind = Literal[
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


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatMessage(StrictModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=65536)


class GenerationSettings(StrictModel):
    context_length: int = Field(default=4096, ge=512, le=131072)
    temperature: float = Field(default=0.6, ge=0, le=2)
    top_p: float = Field(default=0.95, gt=0, le=1)
    max_output_tokens: int = Field(default=512, ge=1, le=4096)
    stream: bool = False


class GenerationRequest(StrictModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=64)
    settings: GenerationSettings
    requested_profile: ProfileName

    @model_validator(mode="after")
    def has_user_message(self) -> "GenerationRequest":
        if not any(message.role == "user" for message in self.messages):
            raise ValueError("en az bir user mesajı gerekli")
        return self


class TokenUsage(StrictModel):
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def total_is_consistent(self) -> "TokenUsage":
        if (
            self.prompt_tokens is not None
            and self.completion_tokens is not None
            and self.total_tokens is not None
            and self.prompt_tokens + self.completion_tokens != self.total_tokens
        ):
            raise ValueError("token toplamı bileşenlerle uyuşmuyor")
        return self


class TimingMetrics(StrictModel):
    total_ms: float = Field(ge=0)
    ttft_ms: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def ttft_does_not_exceed_total(self) -> "TimingMetrics":
        if self.ttft_ms is not None and self.ttft_ms > self.total_ms:
            raise ValueError("ilk token süresi toplam süreyi aşamaz")
        return self


class BackendCapabilities(StrictModel):
    thinking: CapabilityStatus
    non_thinking: CapabilityStatus
    streaming: CapabilityStatus
    token_usage: CapabilityStatus
    model_listing: CapabilityStatus

    def status_for_profile(self, profile: ProfileName) -> CapabilityStatus:
        return self.thinking if profile == "thinking" else self.non_thinking


class BackendErrorInfo(StrictModel):
    kind: ErrorKind
    message: str = Field(min_length=1, max_length=500)
    retryable: bool = False
    status_code: int | None = Field(default=None, ge=100, le=599)


class GenerationResponse(StrictModel):
    content: str = Field(max_length=131072)
    usage: TokenUsage = Field(default_factory=TokenUsage)
    timing: TimingMetrics
    effective_profile: EffectiveProfile
    finish_reason: str | None = Field(default=None, max_length=100)


class PreflightResult(StrictModel):
    ok: bool
    backend_name: Literal["lm_studio", "llama_cpp", "mock"]
    model_available: bool
    capabilities: BackendCapabilities
