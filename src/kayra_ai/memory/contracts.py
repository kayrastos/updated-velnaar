from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


MemoryKind = Literal["fact", "preference", "project", "note"]
Sensitivity = Literal["private", "sensitive"]


class StrictMemoryModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WriteAuthorization(StrictMemoryModel):
    """Proof that the user explicitly authorized a persistent mutation."""

    confirmed_by_user: Literal[True]
    purpose: str = Field(min_length=3, max_length=300)
    confirmed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("confirmed_at")
    @classmethod
    def confirmed_at_is_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("confirmed_at timezone bilgisi icermeli")
        return value.astimezone(timezone.utc)


class MemoryDraft(StrictMemoryModel):
    content: str = Field(min_length=1, max_length=8000)
    kind: MemoryKind
    sensitivity: Sensitivity = "private"
    source: str = Field(min_length=1, max_length=300)
    tags: tuple[str, ...] = Field(default=(), max_length=20)
    expires_at: datetime | None = None

    @field_validator("content", "source")
    @classmethod
    def strip_non_empty_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("deger bos olamaz")
        return value

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(dict.fromkeys(tag.strip().casefold() for tag in value if tag.strip()))
        if any(len(tag) > 80 for tag in normalized):
            raise ValueError("etiket en fazla 80 karakter olabilir")
        return normalized

    @field_validator("expires_at")
    @classmethod
    def expires_at_is_timezone_aware(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expires_at timezone bilgisi icermeli")
        return value.astimezone(timezone.utc)


class MemoryRecord(StrictMemoryModel):
    id: str = Field(pattern=r"^[0-9a-f]{32}$")
    content: str = Field(min_length=1, max_length=8000)
    kind: MemoryKind
    sensitivity: Sensitivity
    source: str = Field(min_length=1, max_length=300)
    tags: tuple[str, ...] = Field(default=(), max_length=20)
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None = None
    deleted_at: datetime | None = None


class MemoryQuery(StrictMemoryModel):
    text: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    kinds: tuple[MemoryKind, ...] | None = None


class RetrievedMemory(StrictMemoryModel):
    record: MemoryRecord
    score: float = Field(gt=0)
    matched_terms: tuple[str, ...]
