"""Normalized, source-preserving cyber knowledge contracts."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_CWE_RE = re.compile(r"^CWE-[1-9][0-9]*$")
_CVE_RE = re.compile(r"^CVE-[0-9]{4}-[0-9]{4,}$")
_CAPEC_RE = re.compile(r"^CAPEC-[1-9][0-9]*$")


CyberCategory = Literal[
    "weakness",
    "attack_pattern",
    "vulnerability",
    "known_exploited_vulnerability",
    "secure_guidance",
    "security_patch",
]

CyberSourceKey = Literal["cwe", "capec", "nvd", "cisa_kev", "owasp", "patch_corpus"]


class StrictCyberModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class CyberKnowledgeRecord(StrictCyberModel):
    """One normalized record while preserving its authoritative source identity."""

    schema_version: Literal["1.0"] = "1.0"
    source: CyberSourceKey
    source_id: str = Field(min_length=1, max_length=200)
    category: CyberCategory
    source_status: str = Field(default="unknown", min_length=1, max_length=50)

    title: str = Field(min_length=1, max_length=500)
    summary: str = Field(min_length=1, max_length=20_000)
    source_description_missing: bool = False

    cwe_ids: tuple[str, ...] = ()
    cve_ids: tuple[str, ...] = ()
    attack_pattern_ids: tuple[str, ...] = ()

    vulnerable_condition: str | None = Field(default=None, max_length=20_000)
    root_cause: str | None = Field(default=None, max_length=20_000)
    impact: str | None = Field(default=None, max_length=20_000)
    detection: str | None = Field(default=None, max_length=20_000)
    remediation: str | None = Field(default=None, max_length=20_000)

    references: tuple[str, ...] = ()
    license: str = Field(min_length=1, max_length=500)
    retrieved_at: datetime

    training_eligible: bool
    rag_eligible: bool
    content_sha256: str = Field(min_length=64, max_length=64)

    @field_validator("source_id", "source_status", "title", "summary", "license")
    @classmethod
    def _reject_control_characters(cls, value: str) -> str:
        if any(ord(char) < 32 and char not in "\n\t" for char in value):
            raise ValueError("kontrol karakterleri kabul edilmez")
        return value

    @field_validator("cwe_ids")
    @classmethod
    def _validate_cwe_ids(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(value.upper() for value in values)
        if any(_CWE_RE.fullmatch(value) is None for value in normalized):
            raise ValueError("CWE kimligi CWE-<pozitif-sayi> biciminde olmali")
        if len(set(normalized)) != len(normalized):
            raise ValueError("CWE kimlikleri tekrar edemez")
        return normalized

    @field_validator("cve_ids")
    @classmethod
    def _validate_cve_ids(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(value.upper() for value in values)
        if any(_CVE_RE.fullmatch(value) is None for value in normalized):
            raise ValueError("CVE kimligi CVE-YYYY-NNNN+ biciminde olmali")
        if len(set(normalized)) != len(normalized):
            raise ValueError("CVE kimlikleri tekrar edemez")
        return normalized

    @field_validator("attack_pattern_ids")
    @classmethod
    def _validate_attack_pattern_ids(
        cls,
        values: tuple[str, ...],
    ) -> tuple[str, ...]:
        normalized = tuple(value.upper() for value in values)
        if any(_CAPEC_RE.fullmatch(value) is None for value in normalized):
            raise ValueError("CAPEC kimligi CAPEC-<pozitif-sayi> biciminde olmali")
        if len(set(normalized)) != len(normalized):
            raise ValueError("CAPEC kimlikleri tekrar edemez")
        return normalized

    @field_validator("references")
    @classmethod
    def _validate_references(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(values)) != len(values):
            raise ValueError("referanslar tekrar edemez")
        for value in values:
            if not value.startswith(("https://", "http://")):
                raise ValueError("referanslar mutlak HTTP(S) URL olmali")
        return values

    @field_validator("content_sha256")
    @classmethod
    def _validate_sha256(cls, value: str) -> str:
        normalized = value.lower()
        if _SHA256_RE.fullmatch(normalized) is None:
            raise ValueError("content_sha256 64 karakterlik hexadecimal SHA-256 olmali")
        return normalized

    @field_validator("retrieved_at")
    @classmethod
    def _require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("retrieved_at timezone bilgisi icermeli")
        return value

    @model_validator(mode="after")
    def _enforce_source_identity(self) -> "CyberKnowledgeRecord":
        if self.source == "cwe" and _CWE_RE.fullmatch(self.source_id.upper()) is None:
            raise ValueError("CWE kaynaginda source_id CWE-* olmali")
        if self.source == "capec" and _CAPEC_RE.fullmatch(self.source_id.upper()) is None:
            raise ValueError("CAPEC kaynaginda source_id CAPEC-* olmali")
        if self.source in {"nvd", "cisa_kev"} and _CVE_RE.fullmatch(
            self.source_id.upper()
        ) is None:
            raise ValueError("NVD/CISA KEV kaynaginda source_id CVE-* olmali")
        return self
