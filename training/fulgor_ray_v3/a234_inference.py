"""Additive, CPU-safe contracts for V3 A2/A3/A4 model-mediated stages.

The frozen A1 implementation is intentionally not imported or modified.  Callers
provide model generation and a read-only repository provider.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import hashlib
import json
from typing import Callable, Mapping, Sequence

from .candidate_generator import CandidateBatch, SLOTS
from .constants import CANDIDATE_BUDGET, MAX_FEEDBACK_REFINEMENTS
from .feedback_controller import FeedbackEvidence
from .patch_serializer import SerializationError, serialize
from .schemas import (DiagnosisV1, EditKind, GateResult, PlanStep, RepairPlanV1,
                      SemanticEdit, SemanticPatchV1, SerializedPatchV1,
                      SymbolRef, VerifierScoreV1)
from .selector import SelectableCandidate, select_primary
from .static_gate import evaluate


class A234ContractError(ValueError):
    pass


def canonical_hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     default=str).encode()).hexdigest()


def _object(raw: str, keys: set[str], stage: str) -> dict:
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise A234ContractError(f"{stage}: malformed JSON") from exc
    if not isinstance(value, dict) or set(value) != keys:
        raise A234ContractError(f"{stage}: object keys do not match schema")
    return value


def _strings(value: object, field: str, allow_empty: bool = True) -> tuple[str, ...]:
    if not isinstance(value, list) or (not allow_empty and not value) or any(
            not isinstance(x, str) or not x for x in value):
        raise A234ContractError(f"{field}: expected strings")
    return tuple(value)


def parse_diagnosis(raw: str) -> DiagnosisV1:
    keys = {"schema_version", "target_files", "symbols", "observed_failure", "likely_cause",
            "constraints", "minimal_edit_intent", "uncertainties"}
    obj = _object(raw, keys, "diagnosis")
    if obj["schema_version"] != "fulgor.diagnosis.v1":
        raise A234ContractError("diagnosis: wrong schema")
    targets = _strings(obj["target_files"], "target_files", False)
    if len(targets) > 3 or len(set(targets)) != len(targets):
        raise A234ContractError("diagnosis: invalid target count")
    if not isinstance(obj["symbols"], list):
        raise A234ContractError("diagnosis: symbols must be a list")
    try:
        symbols = tuple(SymbolRef(x["file"], x["qualified_name"]) for x in obj["symbols"]
                        if isinstance(x, dict) and set(x) == {"file", "qualified_name"})
        if len(symbols) != len(obj["symbols"]):
            raise A234ContractError("diagnosis: invalid symbol")
        return DiagnosisV1(targets, symbols, obj["observed_failure"], obj["likely_cause"],
                           _strings(obj["constraints"], "constraints"), obj["minimal_edit_intent"],
                           _strings(obj["uncertainties"], "uncertainties"))
    except (KeyError, TypeError, ValueError) as exc:
        raise A234ContractError(f"diagnosis: {exc}") from exc


def parse_plan(raw: str, diagnosis: DiagnosisV1) -> RepairPlanV1:
    keys = {"schema_version", "diagnosis_hash", "steps", "behavioral_postconditions",
            "regression_risks", "test_intent", "preservation_constraints"}
    obj = _object(raw, keys, "plan")
    expected = canonical_hash(asdict(diagnosis))
    if obj["schema_version"] != "fulgor.repair_plan.v1" or obj["diagnosis_hash"] != expected:
        raise A234ContractError("plan: schema or diagnosis hash mismatch")
    if not isinstance(obj["steps"], list):
        raise A234ContractError("plan: steps must be a list")
    try:
        steps = tuple(PlanStep(x["order"], x["file"], x["symbol"], x["intent"])
                      for x in obj["steps"] if isinstance(x, dict) and
                      set(x) == {"order", "file", "symbol", "intent"})
        if len(steps) != len(obj["steps"]) or any(x.file not in diagnosis.target_files for x in steps):
            raise A234ContractError("plan: invalid or out-of-scope step")
        return RepairPlanV1(expected, steps,
            _strings(obj["behavioral_postconditions"], "behavioral_postconditions"),
            _strings(obj["regression_risks"], "regression_risks"), obj["test_intent"],
            _strings(obj["preservation_constraints"], "preservation_constraints", False))
    except (KeyError, TypeError, ValueError) as exc:
        raise A234ContractError(f"plan: {exc}") from exc


def parse_candidate(raw: str, candidate_id: str, diagnosis: DiagnosisV1,
                    plan: RepairPlanV1) -> SemanticPatchV1:
    keys = {"schema_version", "candidate_id", "diagnosis_hash", "plan_hash", "edits",
            "rationale", "expected_fail_to_pass_effect", "regression_risks"}
    obj = _object(raw, keys, "candidate")
    plan_hash = canonical_hash(asdict(plan))
    if (obj["schema_version"] != "fulgor.semantic_patch.v1" or obj["candidate_id"] != candidate_id
            or obj["diagnosis_hash"] != plan.diagnosis_hash or obj["plan_hash"] != plan_hash):
        raise A234ContractError("candidate: schema, ID, or parent hash mismatch")
    if not isinstance(obj["edits"], list) or not obj["edits"]:
        raise A234ContractError("candidate: edits required")
    edit_keys = {"kind", "file", "start_line", "end_line", "expected_preimage_sha256",
                 "replacement_text", "anchor"}
    try:
        edits = tuple(SemanticEdit(EditKind(x["kind"]), x["file"], x["start_line"], x["end_line"],
                                   x["expected_preimage_sha256"], x["replacement_text"], x["anchor"])
                      for x in obj["edits"] if isinstance(x, dict) and set(x) == edit_keys)
        if len(edits) != len(obj["edits"]) or any(x.file not in diagnosis.target_files for x in edits):
            raise A234ContractError("candidate: invalid or out-of-scope edit")
        return SemanticPatchV1(candidate_id, plan.diagnosis_hash, plan_hash, edits, obj["rationale"],
                               obj["expected_fail_to_pass_effect"],
                               _strings(obj["regression_risks"], "regression_risks"))
    except (KeyError, TypeError, ValueError) as exc:
        raise A234ContractError(f"candidate: {exc}") from exc


def parse_verifier(raw: str, blinded_id: str) -> VerifierScoreV1:
    names = ("diagnosis_consistency", "plan_consistency", "localization_confidence",
             "likely_repair_benefit", "pass_to_pass_safety", "minimality",
             "unnecessary_edit_absence", "broad_edit_safety")
    obj = _object(raw, {"schema_version", "blinded_id", *names, "reasons", "fatal_concerns"}, "verifier")
    if obj["schema_version"] != "fulgor.verifier_score.v1" or obj["blinded_id"] != blinded_id:
        raise A234ContractError("verifier: schema or blinded ID mismatch")
    try:
        return VerifierScoreV1(blinded_id, *(obj[x] for x in names),
                               _strings(obj["reasons"], "reasons"),
                               _strings(obj["fatal_concerns"], "fatal_concerns"))
    except (TypeError, ValueError) as exc:
        raise A234ContractError(f"verifier: {exc}") from exc


def blind_id(instance_id: str, candidate_id: str) -> str:
    return "blind-" + hashlib.sha256(f"v3-a3\0{instance_id}\0{candidate_id}".encode()).hexdigest()[:20]


@dataclass(frozen=True)
class CandidateOutcome:
    candidate: SemanticPatchV1 | None
    patch: SerializedPatchV1 | None
    gate: GateResult | None
    score: VerifierScoreV1 | None
    failure_code: str | None = None


def process_candidates(instance_id: str, repository_root: str, diagnosis: DiagnosisV1,
                       plan: RepairPlanV1, raw_by_slot: Sequence[str], apply_gate,
                       verify_generate: Callable[[SemanticPatchV1, SerializedPatchV1, GateResult, str], str]
                       ) -> tuple[tuple[CandidateOutcome, ...], object]:
    if len(raw_by_slot) != CANDIDATE_BUDGET:
        raise A234ContractError("exactly K=3 candidate outputs required")
    ids = tuple("candidate-" + hashlib.sha256(f"{instance_id}\0{i}".encode()).hexdigest()[:16]
                for i in range(CANDIDATE_BUDGET))
    outcomes = []
    selectable = []
    for cid, raw in zip(ids, raw_by_slot):
        try:
            candidate = parse_candidate(raw, cid, diagnosis, plan)
            patch = serialize(repository_root, candidate)
            gate = evaluate(candidate, patch, diagnosis.target_files, apply_gate)
            score = None
            if gate.accepted:
                bid = blind_id(instance_id, cid)
                score = parse_verifier(verify_generate(replace(candidate, candidate_id=bid),
                                                       replace(patch, candidate_id=bid), gate, bid), bid)
                real_score = replace(score, candidate_id=cid)
                selectable.append(SelectableCandidate(real_score, patch.stats))
                score = real_score
            outcomes.append(CandidateOutcome(candidate, patch, gate, score))
        except (A234ContractError, SerializationError, ValueError) as exc:
            outcomes.append(CandidateOutcome(None, None, None, None, type(exc).__name__))
    selected = select_primary(selectable)
    return tuple(outcomes), selected


def validate_feedback_candidate(candidate: SemanticPatchV1, original: DiagnosisV1,
                                original_plan: RepairPlanV1, evidence: FeedbackEvidence) -> None:
    if MAX_FEEDBACK_REFINEMENTS != 1:
        raise A234ContractError("feedback budget changed")
    if any(edit.file not in original.target_files for edit in candidate.edits):
        raise A234ContractError("feedback escaped original diagnosis scope")
    if len(evidence.bounded_messages) > 8 or any(len(x) > 1000 for x in evidence.bounded_messages):
        raise A234ContractError("feedback messages exceed frozen bound")
    if candidate.diagnosis_hash != original_plan.diagnosis_hash:
        raise A234ContractError("feedback changed diagnosis lineage")


def diversity_metrics(candidates: Sequence[SemanticPatchV1]) -> Mapping[str, float]:
    if len(candidates) != CANDIDATE_BUDGET:
        raise A234ContractError("diversity requires exactly K=3")
    pairs = [(candidates[i], candidates[j]) for i in range(3) for j in range(i + 1, 3)]
    distances = []
    for left, right in pairs:
        a, b = {e.file for e in left.edits}, {e.file for e in right.edits}
        distances.append(1.0 - len(a & b) / len(a | b))
    identical = sum(canonical_hash([asdict(e) for e in a.edits]) ==
                    canonical_hash([asdict(e) for e in b.edits]) for a, b in pairs)
    return {"mean_touched_file_jaccard_distance": sum(distances) / 3,
            "identical_pair_rate": identical / 3}
