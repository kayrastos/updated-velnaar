"""Cyber source policy registry.

This module intentionally contains metadata only. Network downloaders are added
separately so schema and policy tests remain deterministic and offline.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


UpdateMode = Literal["snapshot", "incremental", "manual"]


class CyberSourceDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str
    display_name: str
    authority: str
    update_mode: UpdateMode
    default_training_eligible: bool
    default_rag_eligible: bool


CYBER_SOURCES: dict[str, CyberSourceDefinition] = {
    "cwe": CyberSourceDefinition(
        key="cwe",
        display_name="MITRE CWE",
        authority="MITRE",
        update_mode="snapshot",
        default_training_eligible=True,
        default_rag_eligible=True,
    ),
    "capec": CyberSourceDefinition(
        key="capec",
        display_name="MITRE CAPEC",
        authority="MITRE",
        update_mode="snapshot",
        default_training_eligible=True,
        default_rag_eligible=True,
    ),
    "nvd": CyberSourceDefinition(
        key="nvd",
        display_name="NVD CVE",
        authority="NIST",
        update_mode="incremental",
        default_training_eligible=False,
        default_rag_eligible=True,
    ),
    "cisa_kev": CyberSourceDefinition(
        key="cisa_kev",
        display_name="CISA Known Exploited Vulnerabilities",
        authority="CISA",
        update_mode="incremental",
        default_training_eligible=False,
        default_rag_eligible=True,
    ),
    "owasp": CyberSourceDefinition(
        key="owasp",
        display_name="OWASP Security Guidance",
        authority="OWASP",
        update_mode="snapshot",
        default_training_eligible=True,
        default_rag_eligible=True,
    ),
    "patch_corpus": CyberSourceDefinition(
        key="patch_corpus",
        display_name="Curated Security Patch Corpus",
        authority="curated",
        update_mode="manual",
        default_training_eligible=False,
        default_rag_eligible=False,
    ),
}


def get_cyber_source(key: str) -> CyberSourceDefinition:
    try:
        return CYBER_SOURCES[key]
    except KeyError as exc:
        raise ValueError(f"bilinmeyen cyber kaynagi: {key}") from exc
