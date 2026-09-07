"""Trusted candidate host binding layer v1.

Binds model-facing SemanticPatchIntentV2 to existing strict Serializer-compatible SemanticPatchV1.
The model describes WHAT edit it intends; the trusted host proves WHAT BYTES are actually edited.

All cryptographic hashes and anchor provenance are strictly derived by trusted host code
directly from immutable repository bytes.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path, PurePosixPath
from typing import Dict, List, Sequence, Tuple, Union

from .patch_serializer import SerializationError, _read_repository_file, _safe_path
from .schemas import ContractError, EditKind, SemanticEdit, SemanticPatchV1
from .semantic_patch_intent_v2 import SemanticEditIntent, SemanticPatchIntentV2


class CandidateHostBindingError(ContractError):
    """Base error for failures during candidate host binding."""


class CandidateFileMembershipError(CandidateHostBindingError):
    """Candidate file is outside the closed repository inventory."""


class CandidateLineSpanError(CandidateHostBindingError):
    """Edit line span is out of bounds or violates span invariants."""


class CandidateAnchorDerivationError(CandidateHostBindingError):
    """Failed to derive a unique, unambiguous anchor for the declared edit span."""


@dataclass(frozen=True)
class HostBoundEditProvenance:
    file: str
    kind: EditKind
    requested_start_line: int
    requested_end_line: int
    bound_start_line: int
    bound_end_line: int
    preimage_sha256: str
    anchor_derivation_version: str = "v1_span_exact"
    repository_file_membership_passed: bool = True


def _derive_anchor(text: str, preimage: str, candidate_lines: Sequence[str], path: str) -> str:
    """Deterministically derive a unique anchor from the validated span bytes.

    Priority 1: Full preimage if unique in text.
    Priority 2: First unique single line in candidate_lines.
    Fails closed if no unique anchor exists within the validated span.
    """
    if text.count(preimage) == 1:
        return preimage

    for line in candidate_lines:
        if line.strip() and text.count(line) == 1:
            return line

    raise CandidateAnchorDerivationError(
        f"cannot derive unique anchor for edit in {path!r}: declared span contents appear multiple times in file"
    )


def bind_candidate_intent_to_host_patch(
    repository_root: Union[str, Path],
    repository_files: Sequence[str],
    intent: SemanticPatchIntentV2,
    allowed_files: Sequence[str],
) -> Tuple[SemanticPatchV1, Tuple[HostBoundEditProvenance, ...]]:
    """Bind a parsed semantic patch intent into a verified, serializer-compatible SemanticPatchV1.

    Validates:
    - Target files strictly belong to repository_files inventory.
    - Target files strictly belong to allowed_files (diagnosis scope).
    - Line spans are within valid bounds.
    - Preimage bytes and expected_preimage_sha256 are computed host-side.
    - Anchors are deterministically derived from validated span bytes.
    - Insert operations are converted to line-bound replacement representations producing exact unified diffs.
    """
    root = Path(repository_root)
    if not root.is_dir():
        raise CandidateHostBindingError(f"repository root is not a directory: {root}")

    repo_files_set = set(repository_files)
    allowed_files_set = set(allowed_files)

    host_edits: List[SemanticEdit] = []
    provenances: List[HostBoundEditProvenance] = []

    for edit in intent.edits:
        # 1. Closed-world inventory check
        if edit.file not in repo_files_set:
            raise CandidateFileMembershipError(
                f"candidate edit targets file outside repository inventory: {edit.file!r}"
            )
        if edit.file not in allowed_files_set:
            raise CandidateFileMembershipError(
                f"candidate edit targets file outside diagnosis scope: {edit.file!r}"
            )

        # 2. Read file text using strict newline/UTF-8 semantics
        try:
            base_text = _read_repository_file(root, edit.file)
        except SerializationError as exc:
            raise CandidateHostBindingError(f"failed to read repository file: {exc}") from exc

        original = base_text.splitlines(keepends=True)
        n_lines = len(original)

        if edit.kind is EditKind.REPLACE or edit.kind is EditKind.DELETE:
            # Span must be within 1 <= start <= end <= n_lines
            if edit.start_line < 1 or edit.end_line > n_lines or edit.end_line < edit.start_line:
                raise CandidateLineSpanError(
                    f"invalid span {edit.start_line}-{edit.end_line} for {edit.file} (total lines: {n_lines})"
                )

            start_idx = edit.start_line - 1
            stop_idx = edit.end_line
            span_lines = original[start_idx:stop_idx]
            preimage = "".join(span_lines)
            preimage_sha256 = hashlib.sha256(preimage.encode("utf-8")).hexdigest()
            anchor = _derive_anchor(base_text, preimage, span_lines, edit.file)

            replacement = "" if edit.kind is EditKind.DELETE else edit.replacement_text
            bound_edit = SemanticEdit(
                kind=edit.kind,
                file=edit.file,
                start_line=edit.start_line,
                end_line=edit.end_line,
                expected_preimage_sha256=preimage_sha256,
                replacement_text=replacement,
                anchor=anchor,
            )
            prov = HostBoundEditProvenance(
                file=edit.file,
                kind=edit.kind,
                requested_start_line=edit.start_line,
                requested_end_line=edit.end_line,
                bound_start_line=edit.start_line,
                bound_end_line=edit.end_line,
                preimage_sha256=preimage_sha256,
            )
            host_edits.append(bound_edit)
            provenances.append(prov)

        elif edit.kind is EditKind.INSERT:
            # Model convention: end_line == start_line - 1 indicates insertion before start_line
            if edit.end_line != edit.start_line - 1 or edit.start_line < 1 or edit.start_line > n_lines + 1:
                raise CandidateLineSpanError(
                    f"invalid insert position start={edit.start_line}, end={edit.end_line} for {edit.file} (lines: {n_lines})"
                )

            if edit.start_line <= n_lines:
                # Insert before existing line L (1 <= L <= n_lines)
                bound_line = edit.start_line
                target_line_text = original[bound_line - 1]
                preimage = target_line_text
                preimage_sha256 = hashlib.sha256(preimage.encode("utf-8")).hexdigest()
                anchor = _derive_anchor(base_text, preimage, [target_line_text], edit.file)
                bound_replacement = edit.replacement_text + target_line_text

                bound_edit = SemanticEdit(
                    kind=EditKind.REPLACE,
                    file=edit.file,
                    start_line=bound_line,
                    end_line=bound_line,
                    expected_preimage_sha256=preimage_sha256,
                    replacement_text=bound_replacement,
                    anchor=anchor,
                )
                prov = HostBoundEditProvenance(
                    file=edit.file,
                    kind=EditKind.INSERT,
                    requested_start_line=edit.start_line,
                    requested_end_line=edit.end_line,
                    bound_start_line=bound_line,
                    bound_end_line=bound_line,
                    preimage_sha256=preimage_sha256,
                )
                host_edits.append(bound_edit)
                provenances.append(prov)
            else:
                # Insert at EOF (after line n_lines)
                if n_lines == 0:
                    raise CandidateLineSpanError(f"cannot insert at EOF of empty file {edit.file}")
                bound_line = n_lines
                target_line_text = original[bound_line - 1]
                preimage = target_line_text
                preimage_sha256 = hashlib.sha256(preimage.encode("utf-8")).hexdigest()
                anchor = _derive_anchor(base_text, preimage, [target_line_text], edit.file)
                bound_replacement = target_line_text + edit.replacement_text

                bound_edit = SemanticEdit(
                    kind=EditKind.REPLACE,
                    file=edit.file,
                    start_line=bound_line,
                    end_line=bound_line,
                    expected_preimage_sha256=preimage_sha256,
                    replacement_text=bound_replacement,
                    anchor=anchor,
                )
                prov = HostBoundEditProvenance(
                    file=edit.file,
                    kind=EditKind.INSERT,
                    requested_start_line=edit.start_line,
                    requested_end_line=edit.end_line,
                    bound_start_line=bound_line,
                    bound_end_line=bound_line,
                    preimage_sha256=preimage_sha256,
                )
                host_edits.append(bound_edit)
                provenances.append(prov)

    bound_patch = SemanticPatchV1(
        candidate_id=intent.candidate_id,
        diagnosis_hash=intent.diagnosis_hash,
        plan_hash=intent.plan_hash,
        edits=tuple(host_edits),
        rationale=intent.rationale,
        expected_fail_to_pass_effect=intent.expected_fail_to_pass_effect,
        regression_risks=intent.regression_risks,
    )
    return bound_patch, tuple(provenances)
