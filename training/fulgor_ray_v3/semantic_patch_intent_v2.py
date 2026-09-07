"""Model-facing candidate semantic patch intent v2 schema and parser.

Decouples model-generated repair intent from cryptographic hashing and anchor discovery.
Model provides WHAT to edit and WHERE (coordinates); host binds to exact repository bytes.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
import json
from pathlib import PurePosixPath
from typing import Any, Mapping, Sequence, Tuple

from .a234_inference import canonical_hash
from .schemas import ContractError, DiagnosisV1, EditKind, RepairPlanV1


class SemanticIntentError(ContractError):
    """Raised when semantic patch intent fails structural or contract validation."""


def _path(value: str) -> str:
    if not isinstance(value, str):
        raise SemanticIntentError("path must be a string")
    parts = PurePosixPath(value).parts
    if (not value or value.startswith("/") or "\\" in value or
            any(part in ("", ".", "..") for part in parts)):
        raise SemanticIntentError(f"path is not normalized and repository-relative: {value!r}")
    return value


def _strings(value: object, field_name: str, allow_empty: bool = True) -> Tuple[str, ...]:
    if not isinstance(value, list) or (not allow_empty and not value) or any(
            not isinstance(x, str) or not x for x in value):
        raise SemanticIntentError(f"{field_name}: expected list of non-empty strings")
    return tuple(value)


@dataclass(frozen=True)
class SemanticEditIntent:
    kind: EditKind
    file: str
    start_line: int
    end_line: int
    replacement_text: str

    def __post_init__(self) -> None:
        _path(self.file)
        if not isinstance(self.start_line, int) or not isinstance(self.end_line, int):
            raise SemanticIntentError("start_line and end_line must be integers")
        if self.start_line < 1:
            raise SemanticIntentError(f"start_line must be >= 1, got {self.start_line}")

        if self.kind is EditKind.INSERT:
            # Insert convention: end_line == start_line - 1 represents insertion before start_line
            if self.end_line != self.start_line - 1:
                raise SemanticIntentError(
                    f"insert edit requires end_line == start_line - 1, got start={self.start_line}, end={self.end_line}"
                )
            if self.replacement_text and not self.replacement_text.endswith("\n"):
                raise SemanticIntentError("insert replacement_text must end with newline LF")
        elif self.kind is EditKind.DELETE:
            if self.end_line < self.start_line:
                raise SemanticIntentError(
                    f"delete edit requires end_line >= start_line, got start={self.start_line}, end={self.end_line}"
                )
            if self.replacement_text != "":
                raise SemanticIntentError("delete edit cannot have non-empty replacement_text")
        elif self.kind is EditKind.REPLACE:
            if self.end_line < self.start_line:
                raise SemanticIntentError(
                    f"replace edit requires end_line >= start_line, got start={self.start_line}, end={self.end_line}"
                )
            if self.replacement_text and not self.replacement_text.endswith("\n"):
                raise SemanticIntentError("replace replacement_text must end with newline LF")
        else:
            raise SemanticIntentError(f"unsupported edit kind: {self.kind!r}")


@dataclass(frozen=True)
class SemanticPatchIntentV2:
    candidate_id: str
    diagnosis_hash: str
    plan_hash: str
    edits: Tuple[SemanticEditIntent, ...]
    rationale: str
    expected_fail_to_pass_effect: str
    regression_risks: Tuple[str, ...]
    schema_version: str = field(default="fulgor.semantic_patch_intent.v2", init=False)

    def __post_init__(self) -> None:
        if not self.candidate_id or not self.diagnosis_hash or not self.plan_hash or not self.edits:
            raise SemanticIntentError("semantic candidate intent is incomplete")
        if not self.rationale or not self.expected_fail_to_pass_effect:
            raise SemanticIntentError("rationale and expected_fail_to_pass_effect must be non-empty strings")
        spans = [(e.file, e.start_line, e.end_line) for e in self.edits]
        if len(spans) != len(set(spans)):
            raise SemanticIntentError("duplicate edit spans in candidate intent")


def _object(raw: str, keys: set[str], stage: str) -> dict:
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise SemanticIntentError(f"{stage}: malformed JSON: {exc}") from exc
    if not isinstance(value, dict) or set(value) != keys:
        raise SemanticIntentError(f"{stage}: object keys do not match schema")
    return value


def parse_semantic_patch_intent(
    raw: str,
    candidate_id: str,
    diagnosis: DiagnosisV1,
    plan: RepairPlanV1,
) -> SemanticPatchIntentV2:
    """Parse and validate model-generated semantic patch intent v2.

    Strictly enforces absence of expected_preimage_sha256 and anchor.
    """
    top_keys = {
        "schema_version",
        "candidate_id",
        "diagnosis_hash",
        "plan_hash",
        "edits",
        "rationale",
        "expected_fail_to_pass_effect",
        "regression_risks",
    }
    obj = _object(raw, top_keys, "candidate_intent")
    plan_hash = canonical_hash(asdict(plan))

    if obj["schema_version"] != "fulgor.semantic_patch_intent.v2":
        raise SemanticIntentError(f"wrong schema_version: expected 'fulgor.semantic_patch_intent.v2', got {obj['schema_version']!r}")
    if obj["candidate_id"] != candidate_id:
        raise SemanticIntentError(f"candidate_id mismatch: expected {candidate_id!r}, got {obj['candidate_id']!r}")
    if obj["diagnosis_hash"] != plan.diagnosis_hash:
        raise SemanticIntentError("diagnosis_hash mismatch with plan")
    if obj["plan_hash"] != plan_hash:
        raise SemanticIntentError("plan_hash mismatch with plan")

    if not isinstance(obj["edits"], list) or not obj["edits"]:
        raise SemanticIntentError("candidate_intent: edits required")

    edit_keys = {"kind", "file", "start_line", "end_line", "replacement_text"}
    edits = []
    for item in obj["edits"]:
        if not isinstance(item, dict) or set(item) != edit_keys:
            raise SemanticIntentError(f"candidate_intent: edit keys must match exactly {sorted(edit_keys)}")
        try:
            kind = EditKind(item["kind"])
        except ValueError as exc:
            raise SemanticIntentError(f"invalid edit kind: {item.get('kind')!r}") from exc

        edit = SemanticEditIntent(
            kind=kind,
            file=item["file"],
            start_line=item["start_line"],
            end_line=item["end_line"],
            replacement_text=item["replacement_text"],
        )
        if edit.file not in diagnosis.target_files:
            raise SemanticIntentError(f"candidate_intent edit targets out-of-scope file: {edit.file!r}")
        edits.append(edit)

    return SemanticPatchIntentV2(
        candidate_id=candidate_id,
        diagnosis_hash=plan.diagnosis_hash,
        plan_hash=plan_hash,
        edits=tuple(edits),
        rationale=obj["rationale"],
        expected_fail_to_pass_effect=obj["expected_fail_to_pass_effect"],
        regression_risks=_strings(obj["regression_risks"], "regression_risks"),
    )
