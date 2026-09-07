"""CPU-safe contracts for canonical Fulgor Ray V3.0 A1 inference.

Model dependencies are deliberately absent from this module.  A caller supplies a
two-call generator; this module validates both responses and is the only A1 path
to the sealed serializer.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
from typing import Callable, Mapping, Sequence

from .patch_serializer import serialize
from .schemas import DiagnosisV1, EditKind, SemanticEdit, SemanticPatchV1, SymbolRef
from .static_gate import evaluate


A1_CANDIDATE_COUNT = 1
MAX_LOCALIZED_FILES = 3
STAGE1_SCHEMA = "fulgor.diagnosis.v1"
STAGE2_SCHEMA = "fulgor.semantic_patch.v1"
A1_PLAN_HASH = hashlib.sha256(b"fulgor-ray-v3-a1-no-separate-plan-v1").hexdigest()


class A1ContractError(ValueError):
    """A model response or repository access violated the A1 contract."""


def _strict_object(raw: str, keys: set[str], stage: str) -> dict:
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise A1ContractError(f"{stage}: malformed JSON") from exc
    if not isinstance(value, dict) or set(value) != keys:
        raise A1ContractError(f"{stage}: object keys do not match schema")
    return value


def _strings(value: object, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value):
        raise A1ContractError(f"{field}: expected nonempty strings")
    return tuple(value)


def normalized_relative_path(value: object) -> str:
    if not isinstance(value, str):
        raise A1ContractError("path must be a string")
    path = PurePosixPath(value)
    if (not value or path.is_absolute() or "\\" in value or value != path.as_posix()
            or any(part in ("", ".", "..") for part in path.parts)):
        raise A1ContractError(f"unsafe repository path: {value!r}")
    return value


def parse_stage1(raw: str) -> DiagnosisV1:
    keys = {"schema_version", "target_files", "symbols", "observed_failure",
            "likely_cause", "constraints", "minimal_edit_intent", "uncertainties"}
    obj = _strict_object(raw, keys, "stage1")
    if obj["schema_version"] != STAGE1_SCHEMA:
        raise A1ContractError("stage1: wrong schema version")
    targets = _strings(obj["target_files"], "target_files")
    if len(targets) > MAX_LOCALIZED_FILES or len(set(targets)) != len(targets):
        raise A1ContractError("stage1: target paths must be unique and within limit")
    targets = tuple(normalized_relative_path(x) for x in targets)
    if not isinstance(obj["symbols"], list):
        raise A1ContractError("stage1: symbols must be a list")
    symbols = []
    for item in obj["symbols"]:
        if not isinstance(item, dict) or set(item) != {"file", "qualified_name"}:
            raise A1ContractError("stage1: invalid symbol")
        symbols.append(SymbolRef(normalized_relative_path(item["file"]), item["qualified_name"]))
    scalar_names = ("observed_failure", "likely_cause", "minimal_edit_intent")
    if any(not isinstance(obj[name], str) or not obj[name] for name in scalar_names):
        raise A1ContractError("stage1: required diagnosis text missing")
    try:
        return DiagnosisV1(targets, tuple(symbols), obj["observed_failure"], obj["likely_cause"],
                           _strings(obj["constraints"], "constraints"), obj["minimal_edit_intent"],
                           _strings(obj["uncertainties"], "uncertainties"))
    except ValueError as exc:
        raise A1ContractError(f"stage1: {exc}") from exc


def diagnosis_hash(diagnosis: DiagnosisV1) -> str:
    payload = asdict(diagnosis)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def parse_stage2(raw: str, diagnosis: DiagnosisV1) -> SemanticPatchV1:
    keys = {"schema_version", "candidate_id", "diagnosis_hash", "plan_hash", "edits",
            "rationale", "expected_fail_to_pass_effect", "regression_risks"}
    obj = _strict_object(raw, keys, "stage2")
    if obj["schema_version"] != STAGE2_SCHEMA or obj["candidate_id"] != "candidate-A":
        raise A1ContractError("stage2: wrong schema version or candidate ID")
    if obj["diagnosis_hash"] != diagnosis_hash(diagnosis) or obj["plan_hash"] != A1_PLAN_HASH:
        raise A1ContractError("stage2: parent hash mismatch")
    if not isinstance(obj["edits"], list) or not obj["edits"]:
        raise A1ContractError("stage2: edits must be a nonempty list")
    edit_keys = {"kind", "file", "start_line", "end_line", "expected_preimage_sha256",
                 "replacement_text", "anchor"}
    edits = []
    for item in obj["edits"]:
        if not isinstance(item, dict) or set(item) != edit_keys:
            raise A1ContractError("stage2: invalid edit object")
        path = normalized_relative_path(item["file"])
        if path not in diagnosis.target_files:
            raise A1ContractError("stage2: edit outside localized files")
        try:
            kind = EditKind(item["kind"])
            edits.append(SemanticEdit(kind, path, item["start_line"], item["end_line"],
                                      item["expected_preimage_sha256"], item["replacement_text"],
                                      item["anchor"]))
        except (ValueError, TypeError) as exc:
            raise A1ContractError(f"stage2: invalid edit: {exc}") from exc
    text_fields = ("rationale", "expected_fail_to_pass_effect")
    if any(not isinstance(obj[x], str) or not obj[x] for x in text_fields):
        raise A1ContractError("stage2: required candidate text missing")
    try:
        return SemanticPatchV1("candidate-A", obj["diagnosis_hash"], A1_PLAN_HASH, tuple(edits),
                               obj["rationale"], obj["expected_fail_to_pass_effect"],
                               _strings(obj["regression_risks"], "regression_risks"))
    except ValueError as exc:
        raise A1ContractError(f"stage2: {exc}") from exc


class LocalRepositoryProvider:
    """Read-only view over an already prepared clean checkout.

    This narrow boundary accepts SWE-smith worker/cache checkouts without importing
    or running its harness. It follows no symlink outside the checkout.
    """

    def __init__(self, root: os.PathLike[str] | str):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir():
            raise A1ContractError("repository root is not a directory")

    def _resolve_file(self, relative: object) -> Path:
        value = normalized_relative_path(relative)
        candidate = self.root.joinpath(*PurePosixPath(value).parts)
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(self.root)
        except (OSError, ValueError) as exc:
            raise A1ContractError(f"repository path escape or missing file: {value}") from exc
        if not resolved.is_file():
            raise A1ContractError(f"not a regular repository file: {value}")
        return resolved

    def list_files(self, limit: int = 4000) -> tuple[str, ...]:
        found = []
        for directory, dirs, files in os.walk(self.root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d != ".git" and not Path(directory, d).is_symlink())
            for name in sorted(files):
                path = Path(directory, name)
                if path.is_symlink():
                    continue
                relative = path.relative_to(self.root).as_posix()
                self._resolve_file(relative)
                found.append(relative)
                if len(found) >= limit:
                    return tuple(found)
        return tuple(found)

    def read_files(self, relatives: Sequence[str]) -> Mapping[str, str]:
        result = {}
        for relative in relatives:
            path = self._resolve_file(relative)
            try:
                result[relative] = path.read_bytes().decode("utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                raise A1ContractError(f"cannot read UTF-8 repository file: {relative}") from exc
        return result

    def dry_run(self, unified_diff: str) -> tuple[bool, str]:
        completed = subprocess.run(["git", "apply", "--check", "-"], cwd=self.root,
                                   input=unified_diff, text=True, capture_output=True)
        return completed.returncode == 0, "PATCH_APPLY_FAILED"


def stage1_messages(problem: str, repository_files: Sequence[str]) -> list[dict]:
    schema = {"schema_version": STAGE1_SCHEMA, "target_files": ["path.py"],
              "symbols": [{"file": "path.py", "qualified_name": "module.symbol"}],
              "observed_failure": "...", "likely_cause": "...", "constraints": ["..."],
              "minimal_edit_intent": "...", "uncertainties": []}
    return [{"role": "system", "content": "Return only strict JSON diagnosis; never emit a diff."},
            {"role": "user", "content": f"BUG REPORT:\n{problem.strip()}\n\nREPOSITORY FILES:\n" +
             "\n".join(repository_files) + "\n\nSCHEMA:\n" + json.dumps(schema, sort_keys=True)}]


def stage2_messages(problem: str, diagnosis: DiagnosisV1, contents: Mapping[str, str]) -> list[dict]:
    context = "\n\n".join(f"FILE {p}\n{contents[p]}" for p in diagnosis.target_files)
    return [{"role": "system", "content": "Return exactly one strict JSON semantic candidate; never emit a unified diff."},
            {"role": "user", "content": f"BUG REPORT:\n{problem.strip()}\n\nDIAGNOSIS:\n" +
             json.dumps(asdict(diagnosis), sort_keys=True) + f"\nDIAGNOSIS_SHA256: {diagnosis_hash(diagnosis)}" +
             f"\nA1_PLAN_HASH: {A1_PLAN_HASH}\n\nLOCALIZED CONTENTS:\n{context}\n\n" +
             "Use schema fulgor.semantic_patch.v1, candidate_id candidate-A, and exactly one candidate."}]


@dataclass(frozen=True)
class A1Result:
    raw_stage1: str
    diagnosis: DiagnosisV1
    raw_stage2: str
    candidate: SemanticPatchV1
    serialized_patch: object
    gate_result: object


def run_two_stage(problem: str, provider: LocalRepositoryProvider,
                  generate: Callable[[list[dict], str], str]) -> A1Result:
    raw1 = generate(stage1_messages(problem, provider.list_files()), "stage1")
    diagnosis = parse_stage1(raw1)
    contents = provider.read_files(diagnosis.target_files)
    raw2 = generate(stage2_messages(problem, diagnosis, contents), "stage2")
    candidate = parse_stage2(raw2, diagnosis)
    patch = serialize(provider.root, candidate)
    gate = evaluate(candidate, patch, diagnosis.target_files, provider)
    if not gate.accepted:
        raise A1ContractError("edit_gate: " + ",".join(gate.reason_codes))
    return A1Result(raw1, diagnosis, raw2, candidate, patch, gate)
