from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any


WORD_RE = re.compile(r"\w+", flags=re.UNICODE)


class ValidationIssue(ValueError):
    """A validation error carrying source location information."""


def iter_jsonl(path: Path) -> Iterator[tuple[int, dict[str, Any]]]:
    """Yield non-empty JSONL records with one-based line numbers."""
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            if not raw_line.strip():
                continue
            try:
                value = json.loads(raw_line)
            except json.JSONDecodeError as exc:
                raise ValidationIssue(
                    f"{path}:{line_number}: geçersiz JSON: {exc.msg} (sütun {exc.colno})"
                ) from exc
            if not isinstance(value, dict):
                raise ValidationIssue(f"{path}:{line_number}: kayıt bir JSON nesnesi olmalı")
            yield line_number, value


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_for(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def strings_in(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for nested in value.values():
            yield from strings_in(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from strings_in(nested)


def normalized_text(value: str) -> str:
    return " ".join(WORD_RE.findall(value.casefold()))


def token_ngrams(value: str, size: int = 5) -> set[tuple[str, ...]]:
    tokens = WORD_RE.findall(value.casefold())
    if not tokens:
        return set()
    if len(tokens) < size:
        return {tuple(tokens)}
    return {tuple(tokens[index : index + size]) for index in range(len(tokens) - size + 1)}


def jaccard(left: set[Any], right: set[Any]) -> float:
    if not left and not right:
        return 1.0
    union = left | right
    return len(left & right) / len(union) if union else 0.0


def prompt_text(record: dict[str, Any]) -> str:
    """Extract user-visible prompt text from supported record types."""
    messages: Iterable[dict[str, Any]] = record.get("messages") or record.get("prompt_messages") or []
    contents = [
        str(message.get("content", ""))
        for message in messages
        if message.get("role") in {"system", "user"}
    ]
    return "\n".join(contents)

