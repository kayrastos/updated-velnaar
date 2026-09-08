"""Fulgor Ray V3 A234 V7 Additive Contracts and Failure Taxonomy.

Phase R1: Safe Observability (Corrected Edition).

PURPOSE:
Defines machine-readable, versioned failure taxonomy and typed contract errors
for future V7 runner execution. This module is strictly additive and does NOT
modify or import existing A234ContractError or sealed V1-V6 runtime files.

IMPORTANT ARCHITECTURAL DISTINCTION:
The stages and subcodes defined here constitute a FUTURE TELEMETRY TAXONOMY.
They are NOT a claim or finding that these specific subcodes were the observed
historical DEV30 failure subcauses during the sealed V6 run.

SAFETY & INTEGRITY POLICIES:
- Strict stage ↔ subcode compatibility: every failure subcode belongs to exactly
  one intended execution stage and cannot be arbitrarily cross-paired.
- Zero semantic leakage: strictly NO source snippets, replacement code, anchors,
  prompts, model reasoning, model output, full repo paths, or raw exception text.
- No free-form error message persistence: exceptions serialize strictly to
  '<stage>:<subcode>'. No failure_message=str(exc) is ever stored.
- Structural diagnostics policy enforces a strict key allowlist with bounded
  values restricted to int | bool | None.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Mapping


# ==============================================================================
# STABLE STAGE TAXONOMY
# ==============================================================================

class A234Stage(str, Enum):
    """Stable execution stages for A234 V7 pipeline telemetry."""
    DIAGNOSIS_RECOVERY = "DIAGNOSIS_RECOVERY"
    DIAGNOSIS_CONTRACT = "DIAGNOSIS_CONTRACT"
    DIAGNOSIS_MEMBERSHIP = "DIAGNOSIS_MEMBERSHIP"

    PLAN_RECOVERY = "PLAN_RECOVERY"
    PLAN_CONTRACT = "PLAN_CONTRACT"

    CANDIDATE_RECOVERY = "CANDIDATE_RECOVERY"
    CANDIDATE_INTENT = "CANDIDATE_INTENT"
    CANDIDATE_HOST_BINDING = "CANDIDATE_HOST_BINDING"
    CANDIDATE_SERIALIZATION = "CANDIDATE_SERIALIZATION"
    CANDIDATE_STATIC_GATE = "CANDIDATE_STATIC_GATE"

    VERIFIER_RECOVERY = "VERIFIER_RECOVERY"
    VERIFIER_CONTRACT = "VERIFIER_CONTRACT"

    PRIMARY_SELECTION = "PRIMARY_SELECTION"


ALL_STAGES: frozenset[str] = frozenset(s.value for s in A234Stage)


# ==============================================================================
# STABLE FAILURE SUBCODES (FUTURE V7 TAXONOMY)
# ==============================================================================

# Diagnosis subcodes
DIAGNOSIS_MALFORMED_SYNTAX = "DIAGNOSIS_MALFORMED_SYNTAX"
DIAGNOSIS_SCHEMA_VERSION_MISMATCH = "DIAGNOSIS_SCHEMA_VERSION_MISMATCH"
DIAGNOSIS_TARGET_COUNT_INVALID = "DIAGNOSIS_TARGET_COUNT_INVALID"
DIAGNOSIS_SYMBOLS_INVALID = "DIAGNOSIS_SYMBOLS_INVALID"
DIAGNOSIS_TARGET_NOT_IN_INVENTORY = "DIAGNOSIS_TARGET_NOT_IN_INVENTORY"

# Plan subcodes
PLAN_MALFORMED_SYNTAX = "PLAN_MALFORMED_SYNTAX"
PLAN_SCHEMA_VERSION_MISMATCH = "PLAN_SCHEMA_VERSION_MISMATCH"
PLAN_DIAGNOSIS_HASH_MISMATCH = "PLAN_DIAGNOSIS_HASH_MISMATCH"
PLAN_STEPS_INVALID = "PLAN_STEPS_INVALID"
PLAN_OUT_OF_SCOPE_STEP = "PLAN_OUT_OF_SCOPE_STEP"
PLAN_PRESERVATION_CONSTRAINTS_INVALID = "PLAN_PRESERVATION_CONSTRAINTS_INVALID"

# Candidate semantic intent subcodes
CANDIDATE_MALFORMED_SYNTAX = "CANDIDATE_MALFORMED_SYNTAX"
CANDIDATE_SCHEMA_VERSION_MISMATCH = "CANDIDATE_SCHEMA_VERSION_MISMATCH"
CANDIDATE_ID_MISMATCH = "CANDIDATE_ID_MISMATCH"
CANDIDATE_DIAGNOSIS_HASH_MISMATCH = "CANDIDATE_DIAGNOSIS_HASH_MISMATCH"
CANDIDATE_PLAN_HASH_MISMATCH = "CANDIDATE_PLAN_HASH_MISMATCH"
CANDIDATE_EDITS_MISSING = "CANDIDATE_EDITS_MISSING"
CANDIDATE_EDIT_KIND_INVALID = "CANDIDATE_EDIT_KIND_INVALID"
CANDIDATE_EDIT_SPAN_INVALID = "CANDIDATE_EDIT_SPAN_INVALID"
CANDIDATE_DUPLICATE_SPAN = "CANDIDATE_DUPLICATE_SPAN"
CANDIDATE_OUT_OF_SCOPE_FILE = "CANDIDATE_OUT_OF_SCOPE_FILE"
CANDIDATE_REPLACEMENT_CONTRACT_VIOLATION = "CANDIDATE_REPLACEMENT_CONTRACT_VIOLATION"

# Host binding subcodes
HOST_BINDING_REPO_MEMBERSHIP_FAILED = "HOST_BINDING_REPO_MEMBERSHIP_FAILED"
HOST_BINDING_DIAGNOSIS_MEMBERSHIP_FAILED = "HOST_BINDING_DIAGNOSIS_MEMBERSHIP_FAILED"
HOST_BINDING_READ_FAILED = "HOST_BINDING_READ_FAILED"
HOST_BINDING_LINE_SPAN_OUT_OF_BOUNDS = "HOST_BINDING_LINE_SPAN_OUT_OF_BOUNDS"
HOST_BINDING_ANCHOR_DERIVATION_FAILED = "HOST_BINDING_ANCHOR_DERIVATION_FAILED"

# Serialization subcodes
SERIALIZATION_PATH_FAILED = "SERIALIZATION_PATH_FAILED"
SERIALIZATION_UNSUPPORTED_NEWLINE = "SERIALIZATION_UNSUPPORTED_NEWLINE"
SERIALIZATION_OVERLAPPING_EDITS = "SERIALIZATION_OVERLAPPING_EDITS"
SERIALIZATION_PREIMAGE_MISMATCH = "SERIALIZATION_PREIMAGE_MISMATCH"
SERIALIZATION_ANCHOR_MISMATCH = "SERIALIZATION_ANCHOR_MISMATCH"
SERIALIZATION_BUDGET_EXCEEDED = "SERIALIZATION_BUDGET_EXCEEDED"

# Static gate subcodes (split budget granularity)
GATE_EMPTY_PATCH = "GATE_EMPTY_PATCH"
GATE_OUTSIDE_SCOPE = "GATE_OUTSIDE_SCOPE"
GATE_FORBIDDEN_PATH = "GATE_FORBIDDEN_PATH"
GATE_FILE_BUDGET_EXCEEDED = "GATE_FILE_BUDGET_EXCEEDED"
GATE_HUNK_BUDGET_EXCEEDED = "GATE_HUNK_BUDGET_EXCEEDED"
GATE_CHANGED_LINE_BUDGET_EXCEEDED = "GATE_CHANGED_LINE_BUDGET_EXCEEDED"
GATE_PATCH_APPLY_FAILED = "GATE_PATCH_APPLY_FAILED"

# Verifier subcodes
VERIFIER_MALFORMED_SYNTAX = "VERIFIER_MALFORMED_SYNTAX"
VERIFIER_SCHEMA_VERSION_MISMATCH = "VERIFIER_SCHEMA_VERSION_MISMATCH"
VERIFIER_BLINDED_ID_MISMATCH = "VERIFIER_BLINDED_ID_MISMATCH"
VERIFIER_INVALID_SCORE = "VERIFIER_INVALID_SCORE"

# Authoritative Stage ↔ Subcode Compatibility Mapping
ALLOWED_SUBCODES_BY_STAGE: dict[str, frozenset[str]] = {
    A234Stage.DIAGNOSIS_RECOVERY.value: frozenset({
        DIAGNOSIS_MALFORMED_SYNTAX,
    }),
    A234Stage.DIAGNOSIS_CONTRACT.value: frozenset({
        DIAGNOSIS_SCHEMA_VERSION_MISMATCH,
        DIAGNOSIS_TARGET_COUNT_INVALID,
        DIAGNOSIS_SYMBOLS_INVALID,
    }),
    A234Stage.DIAGNOSIS_MEMBERSHIP.value: frozenset({
        DIAGNOSIS_TARGET_NOT_IN_INVENTORY,
    }),
    A234Stage.PLAN_RECOVERY.value: frozenset({
        PLAN_MALFORMED_SYNTAX,
    }),
    A234Stage.PLAN_CONTRACT.value: frozenset({
        PLAN_SCHEMA_VERSION_MISMATCH,
        PLAN_DIAGNOSIS_HASH_MISMATCH,
        PLAN_STEPS_INVALID,
        PLAN_OUT_OF_SCOPE_STEP,
        PLAN_PRESERVATION_CONSTRAINTS_INVALID,
    }),
    A234Stage.CANDIDATE_RECOVERY.value: frozenset({
        CANDIDATE_MALFORMED_SYNTAX,
    }),
    A234Stage.CANDIDATE_INTENT.value: frozenset({
        CANDIDATE_SCHEMA_VERSION_MISMATCH,
        CANDIDATE_ID_MISMATCH,
        CANDIDATE_DIAGNOSIS_HASH_MISMATCH,
        CANDIDATE_PLAN_HASH_MISMATCH,
        CANDIDATE_EDITS_MISSING,
        CANDIDATE_EDIT_KIND_INVALID,
        CANDIDATE_EDIT_SPAN_INVALID,
        CANDIDATE_DUPLICATE_SPAN,
        CANDIDATE_OUT_OF_SCOPE_FILE,
        CANDIDATE_REPLACEMENT_CONTRACT_VIOLATION,
    }),
    A234Stage.CANDIDATE_HOST_BINDING.value: frozenset({
        HOST_BINDING_REPO_MEMBERSHIP_FAILED,
        HOST_BINDING_DIAGNOSIS_MEMBERSHIP_FAILED,
        HOST_BINDING_READ_FAILED,
        HOST_BINDING_LINE_SPAN_OUT_OF_BOUNDS,
        HOST_BINDING_ANCHOR_DERIVATION_FAILED,
    }),
    A234Stage.CANDIDATE_SERIALIZATION.value: frozenset({
        SERIALIZATION_PATH_FAILED,
        SERIALIZATION_UNSUPPORTED_NEWLINE,
        SERIALIZATION_OVERLAPPING_EDITS,
        SERIALIZATION_PREIMAGE_MISMATCH,
        SERIALIZATION_ANCHOR_MISMATCH,
        SERIALIZATION_BUDGET_EXCEEDED,
    }),
    A234Stage.CANDIDATE_STATIC_GATE.value: frozenset({
        GATE_EMPTY_PATCH,
        GATE_OUTSIDE_SCOPE,
        GATE_FORBIDDEN_PATH,
        GATE_FILE_BUDGET_EXCEEDED,
        GATE_HUNK_BUDGET_EXCEEDED,
        GATE_CHANGED_LINE_BUDGET_EXCEEDED,
        GATE_PATCH_APPLY_FAILED,
    }),
    A234Stage.VERIFIER_RECOVERY.value: frozenset({
        VERIFIER_MALFORMED_SYNTAX,
    }),
    A234Stage.VERIFIER_CONTRACT.value: frozenset({
        VERIFIER_SCHEMA_VERSION_MISMATCH,
        VERIFIER_BLINDED_ID_MISMATCH,
        VERIFIER_INVALID_SCORE,
    }),
    A234Stage.PRIMARY_SELECTION.value: frozenset(),
}

# Inverted mapping for quick lookup and validation
SUBCODE_TO_STAGE: dict[str, str] = {
    subcode: stage
    for stage, subcodes in ALLOWED_SUBCODES_BY_STAGE.items()
    for subcode in subcodes
}

ALL_FAILURE_SUBCODES: frozenset[str] = frozenset(SUBCODE_TO_STAGE.keys())


def validate_stage_subcode(stage: str, subcode: str) -> None:
    """Validate that a failure subcode is authorized and legally paired with a stage.

    Fails closed:
    - Rejects unknown stages.
    - Rejects unknown subcodes (including retired codes).
    - Rejects known subcodes paired with an unauthorized stage.
    """
    if not isinstance(stage, str) or stage not in ALL_STAGES:
        raise ValueError(
            f"Unknown or unapproved failure stage: {stage!r}. Allowed: {sorted(ALL_STAGES)}"
        )
    if not isinstance(subcode, str) or subcode not in ALL_FAILURE_SUBCODES:
        raise ValueError(
            f"Unknown or unapproved failure subcode: {subcode!r}. Allowed: {sorted(ALL_FAILURE_SUBCODES)}"
        )
    allowed_for_stage = ALLOWED_SUBCODES_BY_STAGE.get(stage, frozenset())
    if subcode not in allowed_for_stage:
        expected_stage = SUBCODE_TO_STAGE.get(subcode)
        raise ValueError(
            f"Stage ↔ subcode compatibility violation: subcode {subcode!r} belongs to stage "
            f"{expected_stage!r} and cannot be used under stage {stage!r}."
        )


# ==============================================================================
# STRUCTURAL DIAGNOSTICS POLICY
# ==============================================================================

ALLOWED_STRUCTURAL_DIAGNOSTIC_KEYS: frozenset[str] = frozenset({
    "raw_character_count",
    "brace_balance",
    "bracket_balance",
    "double_quote_parity",
    "json_decode_error_position",
    "json_decode_error_line",
    "json_decode_error_column",
    "observed_key_count",
    "target_file_count",
    "step_count",
    "edit_count",
    "repository_file_count",
    "file_line_count",
    "requested_start_line",
    "requested_end_line",
    "slot_index",
})

MAX_DIAGNOSTIC_KEYS: int = 32
MIN_INT_VALUE: int = -2147483648
MAX_INT_VALUE: int = 2147483647


def validate_structural_diagnostics(
    diagnostics: Mapping[str, Any] | None,
) -> dict[str, int | bool | None]:
    """Validate and sanitize structural diagnostics dictionary according to strict policy.

    Policy rules:
    - Must be a dictionary/mapping or None.
    - Number of keys must not exceed MAX_DIAGNOSTIC_KEYS.
    - All keys must belong to ALLOWED_STRUCTURAL_DIAGNOSTIC_KEYS allowlist.
    - Values must strictly be int, bool, or None. Strings, floats, lists, dicts, etc. are rejected.
    - Integers must be within signed 32-bit integer bounds.

    Returns:
        dict[str, int | bool | None]: Validated dictionary with sorted keys for determinism.
    """
    if diagnostics is None:
        return {}
    if not isinstance(diagnostics, (dict, Mapping)):
        raise TypeError(f"structural_diagnostics must be a dict or Mapping, got {type(diagnostics).__name__}")
    if len(diagnostics) > MAX_DIAGNOSTIC_KEYS:
        raise ValueError(
            f"structural_diagnostics key count ({len(diagnostics)}) exceeds maximum allowed ({MAX_DIAGNOSTIC_KEYS})"
        )

    validated: dict[str, int | bool | None] = {}
    for key, value in diagnostics.items():
        if not isinstance(key, str):
            raise TypeError(f"diagnostic key must be str, got {type(key).__name__}")
        if key not in ALLOWED_STRUCTURAL_DIAGNOSTIC_KEYS:
            raise ValueError(
                f"diagnostic key {key!r} is not permitted by structural diagnostics policy. "
                f"Allowed keys: {sorted(ALLOWED_STRUCTURAL_DIAGNOSTIC_KEYS)}"
            )

        if value is None:
            validated[key] = None
        elif isinstance(value, bool):
            # In Python, bool is a subclass of int. Must check bool before int.
            validated[key] = value
        elif isinstance(value, int):
            if value < MIN_INT_VALUE or value > MAX_INT_VALUE:
                raise ValueError(
                    f"diagnostic value for {key!r} ({value}) is outside signed 32-bit integer bounds "
                    f"[{MIN_INT_VALUE}, {MAX_INT_VALUE}]"
                )
            validated[key] = value
        else:
            raise TypeError(
                f"diagnostic value for {key!r} must be int | bool | None, got {type(value).__name__}"
            )

    return dict(sorted(validated.items()))


# ==============================================================================
# TYPED ERROR HIERARCHY
# ==============================================================================

class A234V7ContractError(ValueError):
    """Base contract exception for A234 V7 contracts.

    Carries stable machine-readable stage code, failure subcode, and bounded
    non-semantic structural diagnostics only. Free-form text and raw exception
    messages are explicitly prohibited.
    """

    def __init__(
        self,
        failure_stage: str,
        failure_subcode: str,
        structural_diagnostics: Mapping[str, Any] | None = None,
    ) -> None:
        validate_stage_subcode(failure_stage, failure_subcode)

        self.failure_stage: str = failure_stage
        self.failure_subcode: str = failure_subcode
        self.structural_diagnostics: dict[str, int | bool | None] = validate_structural_diagnostics(
            structural_diagnostics
        )
        # Base exception representation is strictly '<stage>:<subcode>'
        super().__init__(f"{failure_stage}:{failure_subcode}")

    def __str__(self) -> str:
        return f"{self.failure_stage}:{self.failure_subcode}"

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(failure_stage={self.failure_stage!r}, failure_subcode={self.failure_subcode!r})"


class DiagnosisContractErrorV7(A234V7ContractError):
    """Contract error for diagnosis stage failures."""

    ALLOWED_STAGES: frozenset[str] = frozenset({
        A234Stage.DIAGNOSIS_RECOVERY.value,
        A234Stage.DIAGNOSIS_CONTRACT.value,
        A234Stage.DIAGNOSIS_MEMBERSHIP.value,
    })

    def __init__(
        self,
        failure_subcode: str,
        failure_stage: str | None = None,
        structural_diagnostics: Mapping[str, Any] | None = None,
    ) -> None:
        if failure_stage is None:
            inferred = SUBCODE_TO_STAGE.get(failure_subcode)
            if inferred in self.ALLOWED_STAGES:
                failure_stage = inferred
            else:
                failure_stage = A234Stage.DIAGNOSIS_CONTRACT.value
        if failure_stage not in self.ALLOWED_STAGES:
            raise ValueError(
                f"Invalid stage {failure_stage!r} for DiagnosisContractErrorV7. "
                f"Must be one of {sorted(self.ALLOWED_STAGES)}"
            )
        super().__init__(
            failure_stage=failure_stage,
            failure_subcode=failure_subcode,
            structural_diagnostics=structural_diagnostics,
        )


class PlanContractErrorV7(A234V7ContractError):
    """Contract error for plan stage failures."""

    ALLOWED_STAGES: frozenset[str] = frozenset({
        A234Stage.PLAN_RECOVERY.value,
        A234Stage.PLAN_CONTRACT.value,
    })

    def __init__(
        self,
        failure_subcode: str,
        failure_stage: str | None = None,
        structural_diagnostics: Mapping[str, Any] | None = None,
    ) -> None:
        if failure_stage is None:
            inferred = SUBCODE_TO_STAGE.get(failure_subcode)
            if inferred in self.ALLOWED_STAGES:
                failure_stage = inferred
            else:
                failure_stage = A234Stage.PLAN_CONTRACT.value
        if failure_stage not in self.ALLOWED_STAGES:
            raise ValueError(
                f"Invalid stage {failure_stage!r} for PlanContractErrorV7. "
                f"Must be one of {sorted(self.ALLOWED_STAGES)}"
            )
        super().__init__(
            failure_stage=failure_stage,
            failure_subcode=failure_subcode,
            structural_diagnostics=structural_diagnostics,
        )


class CandidateContractErrorV7(A234V7ContractError):
    """Contract error for candidate generation, intent, binding, serialization, and gate failures."""

    ALLOWED_STAGES: frozenset[str] = frozenset({
        A234Stage.CANDIDATE_RECOVERY.value,
        A234Stage.CANDIDATE_INTENT.value,
        A234Stage.CANDIDATE_HOST_BINDING.value,
        A234Stage.CANDIDATE_SERIALIZATION.value,
        A234Stage.CANDIDATE_STATIC_GATE.value,
    })

    def __init__(
        self,
        failure_subcode: str,
        failure_stage: str | None = None,
        structural_diagnostics: Mapping[str, Any] | None = None,
    ) -> None:
        if failure_stage is None:
            inferred = SUBCODE_TO_STAGE.get(failure_subcode)
            if inferred in self.ALLOWED_STAGES:
                failure_stage = inferred
            else:
                failure_stage = A234Stage.CANDIDATE_INTENT.value
        if failure_stage not in self.ALLOWED_STAGES:
            raise ValueError(
                f"Invalid stage {failure_stage!r} for CandidateContractErrorV7. "
                f"Must be one of {sorted(self.ALLOWED_STAGES)}"
            )
        super().__init__(
            failure_stage=failure_stage,
            failure_subcode=failure_subcode,
            structural_diagnostics=structural_diagnostics,
        )


class VerifierContractErrorV7(A234V7ContractError):
    """Contract error for verifier stage failures."""

    ALLOWED_STAGES: frozenset[str] = frozenset({
        A234Stage.VERIFIER_RECOVERY.value,
        A234Stage.VERIFIER_CONTRACT.value,
    })

    def __init__(
        self,
        failure_subcode: str,
        failure_stage: str | None = None,
        structural_diagnostics: Mapping[str, Any] | None = None,
    ) -> None:
        if failure_stage is None:
            inferred = SUBCODE_TO_STAGE.get(failure_subcode)
            if inferred in self.ALLOWED_STAGES:
                failure_stage = inferred
            else:
                failure_stage = A234Stage.VERIFIER_CONTRACT.value
        if failure_stage not in self.ALLOWED_STAGES:
            raise ValueError(
                f"Invalid stage {failure_stage!r} for VerifierContractErrorV7. "
                f"Must be one of {sorted(self.ALLOWED_STAGES)}"
            )
        super().__init__(
            failure_stage=failure_stage,
            failure_subcode=failure_subcode,
            structural_diagnostics=structural_diagnostics,
        )
