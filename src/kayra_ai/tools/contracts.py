from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, TypeAlias
from uuid import uuid4

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
    model_validator,
)


class StrictToolModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BaseToolRequest(StrictToolModel):
    request_id: str = Field(default_factory=lambda: uuid4().hex, pattern=r"^[0-9a-f]{32}$")
    purpose: str = Field(min_length=3, max_length=300)

    @field_validator("purpose")
    @classmethod
    def normalize_purpose(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("purpose bos olamaz")
        return value


class FileRequest(BaseToolRequest):
    path: str = Field(min_length=1, max_length=4096)

    @field_validator("path")
    @classmethod
    def validate_path_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("path bos olamaz")
        if "\x00" in value:
            raise ValueError("path NUL karakteri iceremez")
        return value


class ListDirectoryRequest(FileRequest):
    tool: Literal["filesystem.list_directory"] = "filesystem.list_directory"
    max_entries: int = Field(default=200, ge=1, le=1000)


class StatPathRequest(FileRequest):
    tool: Literal["filesystem.stat"] = "filesystem.stat"


class ReadTextRequest(FileRequest):
    tool: Literal["filesystem.read_text"] = "filesystem.read_text"
    max_chars: int = Field(default=65536, ge=1, le=1_000_000)


class ReadOnlyCommandRequest(BaseToolRequest):
    tool: Literal["command.run_readonly"] = "command.run_readonly"
    argv: tuple[str, ...] = Field(min_length=1, max_length=64)
    cwd: str = Field(min_length=1, max_length=4096)
    timeout_seconds: float = Field(default=10.0, gt=0, le=30.0)
    max_output_chars: int = Field(default=65536, ge=1, le=1_000_000)

    @field_validator("argv")
    @classmethod
    def validate_argv(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not argument or "\x00" in argument for argument in value):
            raise ValueError("argv bos veya NUL iceren arguman barindiramaz")
        return value

    @field_validator("cwd")
    @classmethod
    def validate_cwd(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("cwd bos olamaz")
        if "\x00" in value:
            raise ValueError("cwd NUL karakteri iceremez")
        return value


ToolRequest: TypeAlias = Annotated[
    ListDirectoryRequest | StatPathRequest | ReadTextRequest | ReadOnlyCommandRequest,
    Field(discriminator="tool"),
]
TOOL_REQUEST_ADAPTER = TypeAdapter(ToolRequest)


class ToolPreview(StrictToolModel):
    request: ToolRequest
    request_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    effect: Literal["read_only"] = "read_only"
    requires_user_confirmation: Literal[True] = True
    summary: str = Field(min_length=3, max_length=500)

    @model_validator(mode="after")
    def digest_matches_request(self) -> "ToolPreview":
        if self.request_digest != tool_request_digest(self.request):
            raise ValueError("preview ozeti istekle eslesmiyor")
        return self


class ToolAuthorization(StrictToolModel):
    authorization_id: str = Field(
        default_factory=lambda: uuid4().hex,
        pattern=r"^[0-9a-f]{32}$",
    )
    confirmed_by_user: Literal[True]
    request_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirmed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime

    @field_validator("confirmed_at", "expires_at")
    @classmethod
    def timestamps_are_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("tool onay zamanlari timezone bilgisi icermeli")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def validity_window_is_short_and_forward(self) -> "ToolAuthorization":
        if self.expires_at <= self.confirmed_at:
            raise ValueError("expires_at confirmed_at sonrasinda olmali")
        if self.expires_at - self.confirmed_at > timedelta(minutes=5):
            raise ValueError("tool onayi en fazla bes dakika gecerli olabilir")
        return self


def tool_request_digest(request: ToolRequest) -> str:
    payload = request.model_dump(mode="json", exclude_none=False)
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def build_tool_preview(request: ToolRequest, *, summary: str) -> ToolPreview:
    return ToolPreview(
        request=request,
        request_digest=tool_request_digest(request),
        summary=summary,
    )
