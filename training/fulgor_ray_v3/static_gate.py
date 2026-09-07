from typing import Protocol, Tuple
from .constants import MAX_CHANGED_LINES, MAX_FILES_CHANGED, MAX_HUNKS
from .schemas import GateResult, SemanticPatchV1, SerializedPatchV1

class PatchApplyGate(Protocol):
    def dry_run(self, unified_diff: str) -> Tuple[bool, str]: ...

FORBIDDEN_PARTS = ("vendor/", "generated/", ".git/", "node_modules/")

def evaluate(candidate: SemanticPatchV1, patch: SerializedPatchV1,
             allowed_files: Tuple[str, ...], apply_gate: PatchApplyGate) -> GateResult:
    reasons = []
    files = {e.file for e in candidate.edits}
    if not patch.unified_diff: reasons.append("EMPTY_PATCH")
    if not files.issubset(set(allowed_files)): reasons.append("OUTSIDE_DECLARED_SCOPE")
    if any(part in path for path in files for part in FORBIDDEN_PARTS): reasons.append("FORBIDDEN_PATH")
    if patch.stats.files_changed > MAX_FILES_CHANGED: reasons.append("MAX_FILES_EXCEEDED")
    if patch.stats.hunks > MAX_HUNKS: reasons.append("MAX_HUNKS_EXCEEDED")
    if patch.stats.changed_lines > MAX_CHANGED_LINES: reasons.append("MAX_CHANGED_LINES_EXCEEDED")
    applied = None
    if not reasons:
        applied, code = apply_gate.dry_run(patch.unified_diff)
        if not applied: reasons.append(code or "PATCH_APPLY_FAILED")
    return GateResult(not reasons, tuple(reasons), applied)
