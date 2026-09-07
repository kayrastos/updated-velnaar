"""Deterministic, fail-closed serialization of semantic repository edits."""

import difflib
import hashlib
from pathlib import Path, PurePosixPath
from typing import Dict, List, Tuple, Union

from .constants import MAX_CHANGED_LINES, MAX_FILES_CHANGED, MAX_HUNKS, SERIALIZER_VERSION
from .schemas import ContractError, DiffStats, EditKind, SemanticPatchV1, SerializedPatchV1


class SerializationError(ContractError):
    """A semantic candidate cannot safely be serialized."""


def _safe_path(repository_root: Path, value: str) -> Path:
    path = PurePosixPath(value)
    if (not value or path.is_absolute() or value != path.as_posix() or
            any(part in ("", ".", "..") for part in path.parts)):
        raise SerializationError(f"unsafe repository path: {value!r}")
    root = repository_root.resolve(strict=True)
    resolved = (root / Path(*path.parts)).resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise SerializationError(f"path escapes repository: {value!r}") from exc
    if not resolved.is_file():
        raise SerializationError(f"not a regular repository file: {value!r}")
    return resolved


def _read_repository_file(repository_root: Path, relative_path: str) -> str:
    path = _safe_path(repository_root, relative_path)
    try:
        text = path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise SerializationError(f"cannot read UTF-8 repository file: {relative_path}") from exc
    if "\r" in text or (text and not text.endswith("\n")):
        raise SerializationError(f"unsupported newline form: {relative_path}")
    return text


def _lines(text: str) -> List[str]:
    return text.splitlines(keepends=True)


def _validate_anchor(text: str, anchor: str, path: str) -> None:
    count = text.count(anchor)
    if count == 0:
        raise SerializationError(f"target anchor does not exist: {path}")
    if count != 1:
        raise SerializationError(f"ambiguous target anchor: {path}")


def _gate(stats: DiffStats) -> None:
    if stats.files_changed > MAX_FILES_CHANGED:
        raise SerializationError("maximum files changed exceeded")
    if stats.hunks > MAX_HUNKS:
        raise SerializationError("maximum hunks exceeded")
    if stats.changed_lines > MAX_CHANGED_LINES:
        raise SerializationError("maximum changed lines exceeded")


def serialize(repository_root: Union[str, Path], candidate: SemanticPatchV1) -> SerializedPatchV1:
    """Serialize a candidate against repository files without mutating them."""
    root = Path(repository_root)
    if not root.is_dir():
        raise SerializationError(f"repository root is not a directory: {root}")

    by_file: Dict[str, list] = {}
    for edit in candidate.edits:
        by_file.setdefault(edit.file, []).append(edit)
    if len(by_file) > MAX_FILES_CHANGED:
        raise SerializationError("maximum files changed exceeded")

    changed: Dict[str, Tuple[List[str], List[str]]] = {}
    for path in sorted(by_file):
        base_text = _read_repository_file(root, path)
        original = _lines(base_text)
        current = list(original)
        last_start = len(original) + 2
        edits = sorted(by_file[path], key=lambda item: (item.start_line, item.end_line), reverse=True)
        for edit in edits:
            if edit.end_line >= last_start:
                raise SerializationError(f"overlapping or conflicting edits: {path}")
            start, stop = edit.start_line - 1, edit.end_line
            if start < 0 or start > len(original) or stop > len(original):
                raise SerializationError(f"edit span outside file: {path}")
            preimage = "".join(original[start:stop])
            _validate_anchor(base_text, edit.anchor, path)
            if edit.anchor not in preimage:
                raise SerializationError(f"anchor is outside declared edit span: {path}")
            if hashlib.sha256(preimage.encode("utf-8")).hexdigest() != edit.expected_preimage_sha256:
                raise SerializationError(f"preimage hash mismatch: {path}")
            replacement = [] if edit.kind is EditKind.DELETE else _lines(edit.replacement_text)
            if edit.kind is not EditKind.DELETE and edit.replacement_text and not edit.replacement_text.endswith("\n"):
                raise SerializationError(f"replacement must end with LF: {path}")
            current[start:stop] = replacement
            last_start = edit.start_line
        if current != original:
            changed[path] = (original, current)

    chunks: List[str] = []
    for path in sorted(changed):
        before, after = changed[path]
        chunks.extend(difflib.unified_diff(
            before, after, fromfile=f"a/{path}", tofile=f"b/{path}", n=3, lineterm="\n"
        ))
    unified_diff = "".join(chunks)
    hunks = sum(line.startswith("@@ ") for line in unified_diff.splitlines())
    changed_lines = sum(
        line[:1] in ("+", "-") and not line.startswith(("+++", "---"))
        for line in unified_diff.splitlines()
    )
    stats = DiffStats(len(changed), hunks, changed_lines)
    _gate(stats)
    return SerializedPatchV1(candidate.candidate_id, unified_diff, stats, SERIALIZER_VERSION)
