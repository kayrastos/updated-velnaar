"""Normalize official MITRE CWE and CAPEC XML snapshots."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

from .schema import CyberKnowledgeRecord

CWE_LICENSE = (
    "MITRE CWE Terms of Use: non-exclusive royalty-free use for research, "
    "development and commercial purposes; copies must reproduce MITRE copyright "
    "designation and license."
)
CAPEC_LICENSE = (
    "MITRE CAPEC Terms of Use: non-exclusive royalty-free use for research, "
    "development and commercial purposes; copies must reproduce MITRE copyright "
    "designation and license."
)

MAX_XML_BYTES = 128 * 1024 * 1024
_WHITESPACE_RE = re.compile(r"\s+")


class CyberIngestError(ValueError):
    pass


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _descendants(element: ET.Element, local_name: str) -> list[ET.Element]:
    return [child for child in element.iter() if _local_name(child.tag) == local_name]


def _clean_text(value: str | None) -> str:
    if not value:
        return ""
    return _WHITESPACE_RE.sub(" ", value).strip()


def _element_text(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return _clean_text(" ".join(element.itertext()))


def _first_descendant_text(element: ET.Element, local_name: str) -> str:
    matches = _descendants(element, local_name)
    return _element_text(matches[0]) if matches else ""


def _join_descendant_text(element: ET.Element, local_name: str) -> str | None:
    values: list[str] = []
    for child in _descendants(element, local_name):
        value = _element_text(child)
        if value and value not in values:
            values.append(value)
        if len(values) >= 32:
            break
    return "; ".join(values) if values else None


def _stable_sha256(payload: dict[str, object]) -> str:
    serialized = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def _hash_fields(record: dict[str, object]) -> dict[str, object]:
    return {
        key: value
        for key, value in record.items()
        if key not in {"retrieved_at", "content_sha256"}
    }


def normalize_cwe_xml(
    xml_bytes: bytes,
    *,
    retrieved_at: datetime,
) -> tuple[CyberKnowledgeRecord, ...]:
    if len(xml_bytes) > MAX_XML_BYTES:
        raise CyberIngestError("CWE XML guvenli boyut sinirini asiyor")
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise CyberIngestError("CWE XML parse edilemedi") from exc

    records: list[CyberKnowledgeRecord] = []
    for weakness in _descendants(root, "Weakness"):
        raw_id = weakness.attrib.get("ID", "")
        name = _clean_text(weakness.attrib.get("Name"))
        source_status = _clean_text(weakness.attrib.get("Status")) or "unknown"
        if source_status.casefold() == "deprecated":
            continue
        if not raw_id.isdigit() or not name:
            continue

        source_id = f"CWE-{int(raw_id)}"
        description = _first_descendant_text(weakness, "Description")
        if not description:
            continue

        capec_ids = tuple(
            dict.fromkeys(
                f"CAPEC-{int(raw)}"
                for item in _descendants(weakness, "Related_Attack_Pattern")
                if (raw := item.attrib.get("CAPEC_ID", "")).isdigit()
            )
        )
        impacts = tuple(
            dict.fromkeys(
                value
                for value in (
                    _element_text(item) for item in _descendants(weakness, "Impact")
                )
                if value
            )
        )

        data: dict[str, object] = {
            "source": "cwe",
            "source_id": source_id,
            "category": "weakness",
            "source_status": source_status,
            "title": name,
            "summary": description,
            "cwe_ids": (source_id,),
            "cve_ids": (),
            "attack_pattern_ids": capec_ids,
            "vulnerable_condition": None,
            "root_cause": None,
            "impact": "; ".join(impacts) if impacts else None,
            "detection": _join_descendant_text(weakness, "Detection_Method"),
            "remediation": _join_descendant_text(weakness, "Mitigation"),
            "references": (f"https://cwe.mitre.org/data/definitions/{raw_id}.html",),
            "license": CWE_LICENSE,
            "retrieved_at": retrieved_at,
            "training_eligible": True,
            "rag_eligible": True,
        }
        data["content_sha256"] = _stable_sha256(_hash_fields(data))
        records.append(CyberKnowledgeRecord.model_validate(data))

    if not records:
        raise CyberIngestError("CWE XML icinde normalize edilebilir Weakness bulunamadi")
    return tuple(records)


def normalize_capec_xml(
    xml_bytes: bytes,
    *,
    retrieved_at: datetime,
) -> tuple[CyberKnowledgeRecord, ...]:
    if len(xml_bytes) > MAX_XML_BYTES:
        raise CyberIngestError("CAPEC XML guvenli boyut sinirini asiyor")
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise CyberIngestError("CAPEC XML parse edilemedi") from exc

    records: list[CyberKnowledgeRecord] = []
    for pattern in _descendants(root, "Attack_Pattern"):
        raw_id = pattern.attrib.get("ID", "")
        name = _clean_text(pattern.attrib.get("Name"))
        source_status = _clean_text(pattern.attrib.get("Status")) or "unknown"
        if source_status.casefold() == "deprecated":
            continue
        if not raw_id.isdigit() or not name:
            continue

        source_id = f"CAPEC-{int(raw_id)}"
        description = _first_descendant_text(pattern, "Description")
        source_description_missing = not bool(description)
        if source_description_missing:
            description = (
                "Authoritative CAPEC source does not provide a description "
                "for this attack-pattern entry."
            )

        cwe_ids = tuple(
            dict.fromkeys(
                f"CWE-{int(raw)}"
                for item in _descendants(pattern, "Related_Weakness")
                if (raw := item.attrib.get("CWE_ID", "")).isdigit()
            )
        )
        impacts = tuple(
            dict.fromkeys(
                value
                for value in (
                    _element_text(item) for item in _descendants(pattern, "Impact")
                )
                if value
            )
        )

        data: dict[str, object] = {
            "source": "capec",
            "source_id": source_id,
            "category": "attack_pattern",
            "source_status": source_status,
            "title": name,
            "summary": description,
            "source_description_missing": source_description_missing,
            "cwe_ids": cwe_ids,
            "cve_ids": (),
            "attack_pattern_ids": (source_id,),
            "vulnerable_condition": _join_descendant_text(pattern, "Prerequisite"),
            "root_cause": None,
            "impact": "; ".join(impacts) if impacts else None,
            "detection": None,
            "remediation": _join_descendant_text(pattern, "Mitigation"),
            "references": (f"https://capec.mitre.org/data/definitions/{raw_id}.html",),
            "license": CAPEC_LICENSE,
            "retrieved_at": retrieved_at,
            "training_eligible": (
                not source_description_missing
                and source_status.casefold() != "obsolete"
            ),
            "rag_eligible": (
                not source_description_missing
                and source_status.casefold() != "obsolete"
            ),
        }
        data["content_sha256"] = _stable_sha256(_hash_fields(data))
        records.append(CyberKnowledgeRecord.model_validate(data))

    if not records:
        raise CyberIngestError(
            "CAPEC XML icinde normalize edilebilir Attack_Pattern bulunamadi"
        )
    return tuple(records)


def _read_single_xml_from_zip(path: str | Path) -> bytes:
    try:
        with ZipFile(path) as archive:
            infos = [
                info for info in archive.infolist()
                if not info.is_dir() and info.filename.casefold().endswith(".xml")
            ]
            if len(infos) != 1:
                raise CyberIngestError(
                    "snapshot arsivi tam olarak bir XML icerigi tasimali"
                )
            info = infos[0]
            if (
                info.file_size <= 0
                or info.file_size > MAX_XML_BYTES
                or ".." in Path(info.filename).parts
                or Path(info.filename).is_absolute()
            ):
                raise CyberIngestError("snapshot XML girdisi guvenli degil")
            return archive.read(info)
    except BadZipFile as exc:
        raise CyberIngestError("snapshot gecerli bir ZIP arsivi degil") from exc


def normalize_snapshot_zip(
    source: str,
    path: str | Path,
    *,
    retrieved_at: datetime,
) -> tuple[CyberKnowledgeRecord, ...]:
    xml_bytes = _read_single_xml_from_zip(path)
    if source == "cwe":
        return normalize_cwe_xml(xml_bytes, retrieved_at=retrieved_at)
    if source == "capec":
        return normalize_capec_xml(xml_bytes, retrieved_at=retrieved_at)
    raise ValueError(f"bu normalizer icin desteklenmeyen cyber kaynagi: {source}")


def records_to_jsonl(records: Iterable[CyberKnowledgeRecord]) -> str:
    return "".join(
        record.model_dump_json(exclude_none=True) + "\n"
        for record in records
    )
