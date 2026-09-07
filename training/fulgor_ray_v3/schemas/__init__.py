"""Immutable, versioned runtime schemas."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Optional, Tuple


class ContractError(ValueError):
    pass


def _path(value: str) -> str:
    parts = value.split("/")
    if (not value or value.startswith("/") or "\\" in value or
            any(part in ("", ".", "..") for part in parts)):
        raise ContractError(f"path is not normalized and repository-relative: {value!r}")
    return value


@dataclass(frozen=True)
class SymbolRef:
    file: str
    qualified_name: str
    def __post_init__(self) -> None:
        _path(self.file)
        if not self.qualified_name:
            raise ContractError("qualified_name is required")


@dataclass(frozen=True)
class DiagnosisV1:
    target_files: Tuple[str, ...]
    symbols: Tuple[SymbolRef, ...]
    observed_failure: str
    likely_cause: str
    constraints: Tuple[str, ...]
    minimal_edit_intent: str
    uncertainties: Tuple[str, ...] = ()
    schema_version: str = field(default="fulgor.diagnosis.v1", init=False)
    def __post_init__(self) -> None:
        if not self.target_files or any(not x for x in (self.observed_failure, self.likely_cause, self.minimal_edit_intent)):
            raise ContractError("diagnosis requires targets, failure, cause, and intent")
        targets = {_path(p) for p in self.target_files}
        if any(s.file not in targets for s in self.symbols):
            raise ContractError("symbol is outside target files")


@dataclass(frozen=True)
class PlanStep:
    order: int
    file: str
    symbol: Optional[str]
    intent: str
    def __post_init__(self) -> None:
        _path(self.file)
        if self.order < 1 or not self.intent:
            raise ContractError("invalid plan step")


@dataclass(frozen=True)
class RepairPlanV1:
    diagnosis_hash: str
    steps: Tuple[PlanStep, ...]
    behavioral_postconditions: Tuple[str, ...]
    regression_risks: Tuple[str, ...]
    test_intent: str
    preservation_constraints: Tuple[str, ...]
    schema_version: str = field(default="fulgor.repair_plan.v1", init=False)
    def __post_init__(self) -> None:
        if not self.diagnosis_hash or not self.steps or not self.test_intent or not self.preservation_constraints:
            raise ContractError("plan is incomplete")
        if tuple(s.order for s in self.steps) != tuple(range(1, len(self.steps) + 1)):
            raise ContractError("plan steps must be consecutively ordered")


class EditKind(str, Enum):
    REPLACE = "replace"
    INSERT = "insert"
    DELETE = "delete"


@dataclass(frozen=True)
class SemanticEdit:
    kind: EditKind
    file: str
    start_line: int
    end_line: int
    expected_preimage_sha256: str
    replacement_text: str
    anchor: str
    def __post_init__(self) -> None:
        _path(self.file)
        if self.start_line < 1 or self.end_line < self.start_line - 1 or not self.anchor:
            raise ContractError("invalid semantic edit span or anchor")
        if len(self.expected_preimage_sha256) != 64:
            raise ContractError("expected preimage SHA256 is required")
        if self.kind is EditKind.DELETE and self.replacement_text:
            raise ContractError("delete edit cannot have replacement text")


@dataclass(frozen=True)
class SemanticPatchV1:
    candidate_id: str
    diagnosis_hash: str
    plan_hash: str
    edits: Tuple[SemanticEdit, ...]
    rationale: str
    expected_fail_to_pass_effect: str
    regression_risks: Tuple[str, ...]
    schema_version: str = field(default="fulgor.semantic_patch.v1", init=False)
    def __post_init__(self) -> None:
        if not self.candidate_id or not self.diagnosis_hash or not self.plan_hash or not self.edits:
            raise ContractError("semantic candidate is incomplete")
        spans = [(e.file, e.start_line, e.end_line) for e in self.edits]
        if len(spans) != len(set(spans)):
            raise ContractError("duplicate edit spans")


@dataclass(frozen=True)
class DiffStats:
    files_changed: int
    hunks: int
    changed_lines: int


@dataclass(frozen=True)
class SerializedPatchV1:
    candidate_id: str
    unified_diff: str
    stats: DiffStats
    serializer_version: str


@dataclass(frozen=True)
class GateResult:
    accepted: bool
    reason_codes: Tuple[str, ...]
    patch_apply_success: Optional[bool] = None


@dataclass(frozen=True)
class VerifierScoreV1:
    candidate_id: str
    diagnosis_consistency: int
    plan_consistency: int
    localization_confidence: int
    likely_repair_benefit: int
    pass_to_pass_safety: int
    minimality: int
    unnecessary_edit_absence: int
    broad_edit_safety: int
    reasons: Tuple[str, ...] = ()
    fatal_concerns: Tuple[str, ...] = ()
    aggregate_score: int = field(init=False)
    schema_version: str = field(default="fulgor.verifier_score.v1", init=False)
    def __post_init__(self) -> None:
        vals = (self.diagnosis_consistency, self.plan_consistency, self.localization_confidence,
                self.likely_repair_benefit, self.pass_to_pass_safety, self.minimality,
                self.unnecessary_edit_absence, self.broad_edit_safety)
        if any(v < 0 or v > 4 for v in vals):
            raise ContractError("verifier subscores must be integers from 0 to 4")
        total = (100*self.likely_repair_benefit + 80*self.pass_to_pass_safety +
                 40*self.diagnosis_consistency + 30*self.plan_consistency +
                 25*self.localization_confidence + 20*self.minimality +
                 20*self.unnecessary_edit_absence + 20*self.broad_edit_safety -
                 500*len(self.fatal_concerns))
        object.__setattr__(self, "aggregate_score", total)
    @property
    def pass_to_pass_regression_risk(self) -> int:
        return 4 - self.pass_to_pass_safety
    @property
    def unnecessary_edit_risk(self) -> int:
        return 4 - self.unnecessary_edit_absence
    @property
    def broad_edit_risk(self) -> int:
        return 4 - self.broad_edit_safety
    @property
    def final_aggregate_score(self) -> int:
        return self.aggregate_score


class FailureOrigin(str, Enum):
    MODEL = "model"
    INFRASTRUCTURE = "infrastructure"


@dataclass(frozen=True)
class ExecutionResult:
    patch_applied: bool
    fail_to_pass_total: int
    fail_to_pass_passing: int
    pass_to_pass_regressions: int
    infrastructure_status: str
    timed_out: bool = False
    failure_origin: Optional[FailureOrigin] = None
    failure_code: Optional[str] = None
    failing_test_ids: Tuple[str, ...] = ()
    bounded_messages: Tuple[str, ...] = ()
    @property
    def resolved(self) -> bool:
        return (self.patch_applied and self.fail_to_pass_total > 0 and
                self.fail_to_pass_passing == self.fail_to_pass_total and
                self.pass_to_pass_regressions == 0 and self.failure_origin is None)


@dataclass(frozen=True)
class NoPrimary:
    reason_codes: Tuple[str, ...]
    kind: str = field(default="NO_PRIMARY", init=False)


@dataclass(frozen=True)
class MetricEventV1:
    sequence: int
    instance_id: str
    arm: str
    stage: str
    attempt: str
    values: Mapping[str, Any]
    schema_version: str = field(default="fulgor.metric_event.v1", init=False)


@dataclass(frozen=True)
class MetricsPayloadV1:
    analysis_valid: Optional[bool] = None
    plan_valid: Optional[bool] = None
    candidate_generation_success: Optional[bool] = None
    semantic_candidate_valid: Optional[bool] = None
    serialized_diff_valid: Optional[bool] = None
    patch_apply_success: Optional[bool] = None
    tests_executed: Optional[bool] = None
    resolved: Optional[bool] = None
    pass_to_pass_regression: Optional[bool] = None
    fail_to_pass_progress: Optional[float] = None
    candidate_diversity: Optional[Mapping[str, float]] = None
    verifier_scores: Tuple[VerifierScoreV1, ...] = ()
    oracle_best_of_k: Optional[bool] = None
    selected_candidate: Optional[str] = None
    selection_regret: Optional[float] = None
    first_attempt_resolved: Optional[bool] = None
    post_feedback_resolved: Optional[bool] = None
    feedback_rescue: Optional[bool] = None
    feedback_regression: Optional[bool] = None
    token_count: Optional[int] = None
    latency: Optional[float] = None
    execution_count: Optional[int] = None
    failure_origin: Optional[FailureOrigin] = None
    schema_version: str = field(default="fulgor.metrics_payload.v1", init=False)
