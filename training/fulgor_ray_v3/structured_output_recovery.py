"""Conservative, additive recovery for structured model output envelopes.

This module does not alter the frozen A1 parser.  It only removes a single,
well-formed Markdown JSON fence before delegating to the existing strict
schema parsers.  It deliberately does not repair JSON, infer missing fields,
select among multiple objects, or accept surrounding prose.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Callable, TypeVar


class StructuredOutputRecoveryError(ValueError):
    """The response cannot be normalized without semantic judgment."""


_JSON_FENCE = re.compile(r"\A[ \t]*```json[ \t]*\r?\n(?P<body>.*?)\r?\n```[ \t]*\Z", re.DOTALL)
T = TypeVar("T")


@dataclass(frozen=True)
class RecoveryResult:
    normalized_json: str
    envelope: str
    original_sha256: str
    normalized_sha256: str


def normalize_single_json_object(raw: str) -> RecoveryResult:
    """Return one syntactically valid JSON object in a known-safe envelope.

    Plain JSON is accepted byte-for-byte after outer whitespace trimming.
    The sole recovery is an exact, case-sensitive ``json`` Markdown fence.
    """
    if not isinstance(raw, str) or not raw.strip():
        raise StructuredOutputRecoveryError("output is empty or not text")

    import hashlib

    stripped = raw.strip()
    match = _JSON_FENCE.fullmatch(raw)
    if match is None:
        match = _JSON_FENCE.fullmatch(stripped)
    if match is not None:
        normalized = match.group("body").strip()
        envelope = "markdown_json_fence"
    else:
        normalized = stripped
        envelope = "plain_json"

    try:
        value = json.loads(normalized)
    except json.JSONDecodeError as exc:
        raise StructuredOutputRecoveryError("normalized output is malformed JSON") from exc
    if not isinstance(value, dict):
        raise StructuredOutputRecoveryError("normalized JSON is not an object")

    return RecoveryResult(
        normalized_json=normalized,
        envelope=envelope,
        original_sha256=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        normalized_sha256=hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
    )


def parse_recovered(raw: str, strict_parser: Callable[[str], T]) -> tuple[T, RecoveryResult]:
    """Normalize an envelope, then retain all validation in ``strict_parser``."""
    recovery = normalize_single_json_object(raw)
    return strict_parser(recovery.normalized_json), recovery
