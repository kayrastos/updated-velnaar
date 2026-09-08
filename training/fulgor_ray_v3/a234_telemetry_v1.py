"""Fulgor Ray V3 A234 Candidate Telemetry Data Structure.

Phase R1: Safe Observability (Corrected Edition).

PURPOSE:
Provides a safe, immutable, future-facing candidate-stage telemetry data structure
for future V7 execution. Enforces strict forward monotonic progression invariants,
terminal failure-stage compatibility, candidate stage scoping, bounded slot indices,
cryptographic hash safety, bounded non-semantic structural diagnostics, and
deterministic JSON serialization.

SAFETY & INTEGRITY POLICIES:
- Candidate stage scoping: failure_stage is restricted to candidate-level stages
  only (rejection of DIAGNOSIS_*, PLAN_*, and PRIMARY_SELECTION).
- Stage ↔ subcode compatibility: enforces legal stage/subcode pairings.
- Terminal failure-stage compatibility: enforces exact expected milestone state
  for any declared failure stage, preventing contradictory telemetry.
- Zero semantic leakage: NO source code, repository paths, anchors, replacement
  content, model reasoning, model output, or raw exception strings.
- NO failure_message, raw_error, or exception_text fields permitted in the schema.
- candidate_id_hash must be a 64-character lowercase hex SHA-256 string, never
  raw candidate IDs or prompt texts.
- Deterministic JSON output: sort_keys=True, compact separators, no timestamps.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import re
from typing import Any, Mapping

from training.fulgor_ray_v3.a234_contracts_v7 import (
    ALL_FAILURE_SUBCODES,
    ALL_STAGES,
    A234Stage,
    A234V7ContractError,
    validate_stage_subcode,
    validate_structural_diagnostics,
)

SCHEMA_VERSION: str = "fulgor.candidate_telemetry.v1"
VALID_SLOT_INDICES: tuple[int, ...] = (0, 1, 2)
_HEX_64_PATTERN: re.Pattern[str] = re.compile(r"^[0-9a-f]{64}$")

# Authorized Candidate Failure Stages (Candidate-level telemetry scope)
ALLOWED_CANDIDATE_FAILURE_STAGES: frozenset[str] = frozenset({
    A234Stage.CANDIDATE_RECOVERY.value,
    A234Stage.CANDIDATE_INTENT.value,
    A234Stage.CANDIDATE_HOST_BINDING.value,
    A234Stage.CANDIDATE_SERIALIZATION.value,
    A234Stage.CANDIDATE_STATIC_GATE.value,
    A234Stage.VERIFIER_RECOVERY.value,
    A234Stage.VERIFIER_CONTRACT.value,
})

# Exact expected milestone state (I, H, S, G, A, V) for declared failure stages
REQUIRED_FAILURE_MILESTONES: dict[str, tuple[bool, bool, bool, bool, bool, bool]] = {
    A234Stage.CANDIDATE_RECOVERY.value: (False, False, False, False, False, False),
    A234Stage.CANDIDATE_INTENT.value: (False, False, False, False, False, False),
    A234Stage.CANDIDATE_HOST_BINDING.value: (True, False, False, False, False, False),
    A234Stage.CANDIDATE_SERIALIZATION.value: (True, True, False, False, False, False),
    A234Stage.CANDIDATE_STATIC_GATE.value: (True, True, True, True, False, False),
    A234Stage.VERIFIER_RECOVERY.value: (True, True, True, True, True, True),
    A234Stage.VERIFIER_CONTRACT.value: (True, True, True, True, True, True),
}


def hash_candidate_id(raw_id: str) -> str:
    """Compute deterministic SHA-256 hex digest for candidate ID.

    Ensures that raw candidate IDs are never persisted or transmitted.
    """
    if not isinstance(raw_id, str):
        raise TypeError(f"raw_id must be str, got {type(raw_id).__name__}")
    if not raw_id:
        raise ValueError("raw_id cannot be empty")
    return hashlib.sha256(raw_id.encode("utf-8")).hexdigest()


def validate_candidate_id_hash(candidate_id_hash: str) -> str:
    """Validate that candidate_id_hash is a valid 64-character lowercase hex SHA-256 string."""
    if not isinstance(candidate_id_hash, str):
        raise TypeError(f"candidate_id_hash must be str, got {type(candidate_id_hash).__name__}")
    if not _HEX_64_PATTERN.match(candidate_id_hash):
        raise ValueError(
            f"candidate_id_hash must be a 64-character lowercase hex SHA-256 digest, got {candidate_id_hash!r}"
        )
    return candidate_id_hash


@dataclass(frozen=True)
class CandidateTelemetryV1:
    """Immutable, non-semantic candidate telemetry record for A234 V7 pipeline.

    Carries milestone progression booleans, slot index, hash-safe candidate ID,
    optional failure stage/subcode, and safe structural diagnostics.
    """

    slot_index: int
    candidate_id_hash: str
    intent_parsed: bool = False
    host_bound: bool = False
    serialized: bool = False
    gate_evaluated: bool = False
    gate_accepted: bool = False
    verifier_invoked: bool = False
    failure_stage: str | None = None
    failure_subcode: str | None = None
    structural_diagnostics: dict[str, int | bool | None] = field(default_factory=dict)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        # Schema version check
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(
                f"Invalid schema_version {self.schema_version!r}, expected {SCHEMA_VERSION!r}"
            )

        # Slot index bounds: K=3 positions [0, 1, 2]
        # In Python, isinstance(True, int) is True, so check type strictly
        if type(self.slot_index) is not int:
            raise TypeError(f"slot_index must be int, got {type(self.slot_index).__name__}")
        if self.slot_index not in VALID_SLOT_INDICES:
            raise ValueError(
                f"slot_index {self.slot_index} out of bounds. Must be one of {VALID_SLOT_INDICES}"
            )

        # Candidate ID hash validation
        validate_candidate_id_hash(self.candidate_id_hash)

        # Ensure milestone flags are strictly bools
        milestone_flags = (
            ("intent_parsed", self.intent_parsed),
            ("host_bound", self.host_bound),
            ("serialized", self.serialized),
            ("gate_evaluated", self.gate_evaluated),
            ("gate_accepted", self.gate_accepted),
            ("verifier_invoked", self.verifier_invoked),
        )
        for name, val in milestone_flags:
            if type(val) is not bool:
                raise TypeError(f"Milestone flag {name} must be bool, got {type(val).__name__}")

        # 1. Forward monotonic progression invariants: fail closed
        if self.host_bound and not self.intent_parsed:
            raise ValueError("Monotonic invariant violation: host_bound requires intent_parsed=True")
        if self.serialized and not self.host_bound:
            raise ValueError("Monotonic invariant violation: serialized requires host_bound=True")
        if self.gate_evaluated and not self.serialized:
            raise ValueError("Monotonic invariant violation: gate_evaluated requires serialized=True")
        if self.gate_accepted and not self.gate_evaluated:
            raise ValueError("Monotonic invariant violation: gate_accepted requires gate_evaluated=True")
        if self.verifier_invoked and not self.gate_accepted:
            raise ValueError("Monotonic invariant violation: verifier_invoked requires gate_accepted=True")

        # 2. Failure fields validation
        if (self.failure_stage is None) != (self.failure_subcode is None):
            raise ValueError(
                f"Half-defined failure state violation: failure_stage ({self.failure_stage!r}) "
                f"and failure_subcode ({self.failure_subcode!r}) must both be None or both be set"
            )

        if self.failure_stage is not None and self.failure_subcode is not None:
            # Enforce candidate-level telemetry scope
            if self.failure_stage not in ALLOWED_CANDIDATE_FAILURE_STAGES:
                raise ValueError(
                    f"CandidateTelemetryV1 failure_stage {self.failure_stage!r} is out of scope. "
                    f"Candidate telemetry accepts only: {sorted(ALLOWED_CANDIDATE_FAILURE_STAGES)}"
                )

            # Enforce stage ↔ subcode compatibility
            validate_stage_subcode(self.failure_stage, self.failure_subcode)

            # 3. Terminal failure-stage ↔ milestone state machine compatibility
            current_flags = (
                self.intent_parsed,
                self.host_bound,
                self.serialized,
                self.gate_evaluated,
                self.gate_accepted,
                self.verifier_invoked,
            )
            required_flags = REQUIRED_FAILURE_MILESTONES[self.failure_stage]
            if current_flags != required_flags:
                flag_names = ("intent_parsed", "host_bound", "serialized", "gate_evaluated", "gate_accepted", "verifier_invoked")
                mismatches = [
                    f"{name}={cur} (expected {exp})"
                    for name, cur, exp in zip(flag_names, current_flags, required_flags)
                    if cur != exp
                ]
                raise ValueError(
                    f"Terminal failure-stage milestone contradiction for {self.failure_stage}: "
                    f"{', '.join(mismatches)}"
                )

        # Validate structural diagnostics through strict policy
        validated_diag = validate_structural_diagnostics(self.structural_diagnostics)
        # Because dataclass is frozen, set using object.__setattr__
        object.__setattr__(self, "structural_diagnostics", validated_diag)

    @classmethod
    def from_failure(
        cls,
        slot_index: int,
        candidate_id_hash: str,
        error: A234V7ContractError,
        extra_diagnostics: Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> CandidateTelemetryV1:
        """Construct a CandidateTelemetryV1 from an A234V7ContractError.

        SAFETY INVARIANT:
        This factory extracts ONLY machine-readable failure_stage, failure_subcode,
        and structural_diagnostics from the error. It NEVER extracts or persists
        str(error), repr(error), or developer messages.
        """
        if not isinstance(error, A234V7ContractError):
            raise TypeError(
                f"error must be an instance of A234V7ContractError, got {type(error).__name__}"
            )

        if error.failure_stage not in ALLOWED_CANDIDATE_FAILURE_STAGES:
            raise ValueError(
                f"Error failure_stage {error.failure_stage!r} is not an allowed candidate failure stage"
            )

        combined_diag: dict[str, Any] = dict(error.structural_diagnostics)
        if extra_diagnostics:
            combined_diag.update(extra_diagnostics)

        req_flags = REQUIRED_FAILURE_MILESTONES[error.failure_stage]
        i, h, s, g, a, v = req_flags

        # Allow explicit kwargs if consistent, otherwise use required milestones
        return cls(
            slot_index=slot_index,
            candidate_id_hash=candidate_id_hash,
            intent_parsed=kwargs.get("intent_parsed", i),
            host_bound=kwargs.get("host_bound", h),
            serialized=kwargs.get("serialized", s),
            gate_evaluated=kwargs.get("gate_evaluated", g),
            gate_accepted=kwargs.get("gate_accepted", a),
            verifier_invoked=kwargs.get("verifier_invoked", v),
            failure_stage=error.failure_stage,
            failure_subcode=error.failure_subcode,
            structural_diagnostics=combined_diag,
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert telemetry to a deterministic plain dictionary.

        Deterministic order and plain types only.
        """
        return {
            "schema_version": self.schema_version,
            "slot_index": self.slot_index,
            "candidate_id_hash": self.candidate_id_hash,
            "intent_parsed": self.intent_parsed,
            "host_bound": self.host_bound,
            "serialized": self.serialized,
            "gate_evaluated": self.gate_evaluated,
            "gate_accepted": self.gate_accepted,
            "verifier_invoked": self.verifier_invoked,
            "failure_stage": self.failure_stage,
            "failure_subcode": self.failure_subcode,
            "structural_diagnostics": dict(self.structural_diagnostics),
        }

    def to_json(self) -> str:
        """Serialize to deterministic compact JSON string.

        Uses sort_keys=True, compact separators (',', ':'), no timestamps,
        no environment data, no filesystem paths.
        """
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> CandidateTelemetryV1:
        """Reconstruct telemetry from dictionary with full validation."""
        if not isinstance(data, (dict, Mapping)):
            raise TypeError(f"data must be dict/Mapping, got {type(data).__name__}")
        return cls(
            schema_version=data.get("schema_version", SCHEMA_VERSION),
            slot_index=data["slot_index"],
            candidate_id_hash=data["candidate_id_hash"],
            intent_parsed=data.get("intent_parsed", False),
            host_bound=data.get("host_bound", False),
            serialized=data.get("serialized", False),
            gate_evaluated=data.get("gate_evaluated", False),
            gate_accepted=data.get("gate_accepted", False),
            verifier_invoked=data.get("verifier_invoked", False),
            failure_stage=data.get("failure_stage"),
            failure_subcode=data.get("failure_subcode"),
            structural_diagnostics=data.get("structural_diagnostics", {}),
        )

    @classmethod
    def from_json(cls, json_str: str) -> CandidateTelemetryV1:
        """Reconstruct telemetry from JSON string with full validation."""
        if not isinstance(json_str, str):
            raise TypeError(f"json_str must be str, got {type(json_str).__name__}")
        return cls.from_dict(json.loads(json_str))
