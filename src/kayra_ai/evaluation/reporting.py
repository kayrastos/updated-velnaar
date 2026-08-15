from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Iterable

from kayra_ai.validation.models import RunResult, RunSummary


class OutputCollisionError(ValueError):
    """Raised when a run would overwrite an existing output path."""


def serialize_results(results: Iterable[RunResult]) -> bytes:
    lines = [
        json.dumps(
            result.model_dump(mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        for result in results
    ]
    return (("\n".join(lines) + "\n") if lines else "").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def summary_json_bytes(summary: RunSummary) -> bytes:
    value = json.dumps(
        summary.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
    )
    return (value + "\n").encode("utf-8")


def summary_markdown_bytes(summary: RunSummary) -> bytes:
    profiles = "\n".join(
        (
            f"| {item.profile} | {item.execution_count} | {item.success_count} | "
            f"{item.failure_count} | {item.error_rate:.6f} |"
        )
        for item in summary.profiles
    )
    errors = (
        "\n".join(f"- `{item.type}`: {item.count}" for item in summary.errors)
        if summary.errors
        else "- Yok"
    )
    text = f"""# Fulgor AI değerlendirme koşusu özeti

- Run kimliği: `{summary.run_id}`
- Benzersiz vaka: {summary.distinct_case_count}
- Yürütme: {summary.execution_count}
- Başarılı: {summary.success_count}
- Hatalı: {summary.failure_count}
- Atlanan: {summary.skipped_count}
- Hata oranı: {summary.error_rate:.6f}
- Semantik puanlama: hayır
- Sonuç artifact'i: `{summary.result_reference.path}`
- Sonuç SHA-256: `{summary.result_reference.sha256}`

> {summary.pipeline_warning}

## Profil kırılımı

| Profil | Yürütme | Başarılı | Hatalı | Hata oranı |
|---|---:|---:|---:|---:|
{profiles}

## Hata türleri

{errors}
"""
    return text.encode("utf-8")


def ensure_new_run_directory(output_root: Path, run_id: str) -> Path:
    run_directory = output_root / run_id
    if run_directory.exists():
        raise OutputCollisionError(f"Koşu dizini zaten var: {run_id}")
    try:
        run_directory.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        raise OutputCollisionError(f"Koşu dizini zaten var: {run_id}") from None
    return run_directory


def write_run_artifacts(
    *,
    output_root: Path,
    run_id: str,
    results_payload: bytes,
    summary: RunSummary,
) -> Path:
    """Write a complete run into a fresh directory without replacing any path."""

    run_directory = ensure_new_run_directory(output_root, run_id)
    artifacts = {
        "results.jsonl": results_payload,
        "summary.json": summary_json_bytes(summary),
        "summary.md": summary_markdown_bytes(summary),
    }
    for name, payload in artifacts.items():
        target = run_directory / name
        with target.open("xb") as handle:
            handle.write(payload)
    return run_directory
