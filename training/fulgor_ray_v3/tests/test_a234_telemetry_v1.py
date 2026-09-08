"""Unit tests for A234 candidate telemetry data structure and invariants.

Phase R1: Safe Observability (Corrected Edition).

Verifies:
A. All valid candidate failure stage/subcode pairs accept
B. Candidate telemetry rejects out-of-scope stages (DIAGNOSIS_*, PLAN_*, PRIMARY_SELECTION)
C. Half-defined failure state rejected in both directions
D. Exact milestone state enforced for each declared failure stage
E. Contradictory milestone/failure states rejected
F. No-failure partial progression remains valid
G. Gate rejection state (I=1 H=1 S=1 G=1 A=0 V=0) without failure remains valid
H. Deterministic serialization (to_dict, to_json, round-trip)
I. Candidate hash validation (lowercase valid, uppercase reject, non-hex reject, length reject)
J. Semantic leakage injection attempts
K. Slot index bounds (0, 1, 2)
"""

from __future__ import annotations

import hashlib
import json
import unittest

from training.fulgor_ray_v3.a234_contracts_v7 import (
    ALLOWED_SUBCODES_BY_STAGE,
    CandidateContractErrorV7,
    VerifierContractErrorV7,
)
from training.fulgor_ray_v3.a234_telemetry_v1 import (
    ALLOWED_CANDIDATE_FAILURE_STAGES,
    REQUIRED_FAILURE_MILESTONES,
    SCHEMA_VERSION,
    VALID_SLOT_INDICES,
    CandidateTelemetryV1,
    hash_candidate_id,
    validate_candidate_id_hash,
)


class TestA234TelemetryV1(unittest.TestCase):
    """Tests for CandidateTelemetryV1 data structure, invariants, and serialization."""

    def setUp(self) -> None:
        self.sample_raw_id = "test_candidate_a234_slot0"
        self.sample_hash = hashlib.sha256(self.sample_raw_id.encode("utf-8")).hexdigest()

    # --------------------------------------------------------------------------
    # A. All valid candidate failure stage/subcode pairs accept
    # --------------------------------------------------------------------------
    def test_all_valid_candidate_failure_pairs_accepted(self) -> None:
        """Verify all valid candidate failure stage/subcode pairs pass validation."""
        tested = 0
        for stage in ALLOWED_CANDIDATE_FAILURE_STAGES:
            subcodes = ALLOWED_SUBCODES_BY_STAGE[stage]
            req_milestones = REQUIRED_FAILURE_MILESTONES[stage]
            i, h, s, g, a, v = req_milestones
            for subcode in subcodes:
                telem = CandidateTelemetryV1(
                    slot_index=0,
                    candidate_id_hash=self.sample_hash,
                    intent_parsed=i,
                    host_bound=h,
                    serialized=s,
                    gate_evaluated=g,
                    gate_accepted=a,
                    verifier_invoked=v,
                    failure_stage=stage,
                    failure_subcode=subcode,
                )
                self.assertEqual(telem.failure_stage, stage)
                self.assertEqual(telem.failure_subcode, subcode)
                tested += 1
        self.assertEqual(tested, 33)

    # --------------------------------------------------------------------------
    # B. Candidate telemetry rejects out-of-scope stages
    # --------------------------------------------------------------------------
    def test_candidate_telemetry_rejects_out_of_scope_stages(self) -> None:
        """Verify candidate telemetry rejects DIAGNOSIS_*, PLAN_*, and PRIMARY_SELECTION."""
        out_of_scope = [
            ("DIAGNOSIS_RECOVERY", "DIAGNOSIS_MALFORMED_SYNTAX"),
            ("DIAGNOSIS_CONTRACT", "DIAGNOSIS_SCHEMA_VERSION_MISMATCH"),
            ("DIAGNOSIS_MEMBERSHIP", "DIAGNOSIS_TARGET_NOT_IN_INVENTORY"),
            ("PLAN_RECOVERY", "PLAN_MALFORMED_SYNTAX"),
            ("PLAN_CONTRACT", "PLAN_STEPS_INVALID"),
            ("PRIMARY_SELECTION", "CANDIDATE_MALFORMED_SYNTAX"),
        ]
        for stage, subcode in out_of_scope:
            with self.assertRaises(ValueError) as ctx:
                CandidateTelemetryV1(
                    slot_index=0,
                    candidate_id_hash=self.sample_hash,
                    failure_stage=stage,
                    failure_subcode=subcode,
                )
            self.assertTrue(
                "out of scope" in str(ctx.exception) or "compatibility violation" in str(ctx.exception)
            )

    # --------------------------------------------------------------------------
    # C. Half-defined failure state rejected in both directions
    # --------------------------------------------------------------------------
    def test_half_defined_failure_states_rejected(self) -> None:
        """Verify half-defined failure states fail closed."""
        # failure_stage set without failure_subcode
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                failure_stage="CANDIDATE_INTENT",
                failure_subcode=None,
            )
        self.assertIn("Half-defined failure state violation", str(ctx.exception))

        # failure_subcode set without failure_stage
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                failure_stage=None,
                failure_subcode="CANDIDATE_MALFORMED_SYNTAX",
            )
        self.assertIn("Half-defined failure state violation", str(ctx.exception))

    # --------------------------------------------------------------------------
    # D. Exact milestone state enforced for each declared failure stage
    # --------------------------------------------------------------------------
    def test_exact_failure_milestone_state_enforced(self) -> None:
        """Verify each candidate failure stage strictly requires its defined milestone tuple."""
        # 1. CANDIDATE_RECOVERY: (0, 0, 0, 0, 0, 0)
        telem = CandidateTelemetryV1(
            slot_index=0,
            candidate_id_hash=self.sample_hash,
            intent_parsed=False,
            failure_stage="CANDIDATE_RECOVERY",
            failure_subcode="CANDIDATE_MALFORMED_SYNTAX",
        )
        self.assertFalse(telem.intent_parsed)

        # 2. CANDIDATE_INTENT: (0, 0, 0, 0, 0, 0)
        telem = CandidateTelemetryV1(
            slot_index=0,
            candidate_id_hash=self.sample_hash,
            failure_stage="CANDIDATE_INTENT",
            failure_subcode="CANDIDATE_SCHEMA_VERSION_MISMATCH",
        )
        self.assertFalse(telem.intent_parsed)

        # 3. CANDIDATE_HOST_BINDING: (1, 0, 0, 0, 0, 0)
        telem = CandidateTelemetryV1(
            slot_index=0,
            candidate_id_hash=self.sample_hash,
            intent_parsed=True,
            failure_stage="CANDIDATE_HOST_BINDING",
            failure_subcode="HOST_BINDING_REPO_MEMBERSHIP_FAILED",
        )
        self.assertTrue(telem.intent_parsed)
        self.assertFalse(telem.host_bound)

        # 4. CANDIDATE_SERIALIZATION: (1, 1, 0, 0, 0, 0)
        telem = CandidateTelemetryV1(
            slot_index=0,
            candidate_id_hash=self.sample_hash,
            intent_parsed=True,
            host_bound=True,
            failure_stage="CANDIDATE_SERIALIZATION",
            failure_subcode="SERIALIZATION_OVERLAPPING_EDITS",
        )
        self.assertTrue(telem.host_bound)
        self.assertFalse(telem.serialized)

        # 5. CANDIDATE_STATIC_GATE: (1, 1, 1, 1, 0, 0)
        telem = CandidateTelemetryV1(
            slot_index=0,
            candidate_id_hash=self.sample_hash,
            intent_parsed=True,
            host_bound=True,
            serialized=True,
            gate_evaluated=True,
            failure_stage="CANDIDATE_STATIC_GATE",
            failure_subcode="GATE_FILE_BUDGET_EXCEEDED",
        )
        self.assertTrue(telem.gate_evaluated)
        self.assertFalse(telem.gate_accepted)

        # 6. VERIFIER_CONTRACT: (1, 1, 1, 1, 1, 1)
        telem = CandidateTelemetryV1(
            slot_index=0,
            candidate_id_hash=self.sample_hash,
            intent_parsed=True,
            host_bound=True,
            serialized=True,
            gate_evaluated=True,
            gate_accepted=True,
            verifier_invoked=True,
            failure_stage="VERIFIER_CONTRACT",
            failure_subcode="VERIFIER_INVALID_SCORE",
        )
        self.assertTrue(telem.verifier_invoked)

    # --------------------------------------------------------------------------
    # E. Contradictory milestone/failure states rejected
    # --------------------------------------------------------------------------
    def test_contradictory_milestone_failure_states_rejected(self) -> None:
        """Verify contradictory states raise ValueError."""
        # failure=CANDIDATE_INTENT + host_bound=true
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                intent_parsed=True,
                host_bound=True,
                failure_stage="CANDIDATE_INTENT",
                failure_subcode="CANDIDATE_SCHEMA_VERSION_MISMATCH",
            )
        self.assertIn("milestone contradiction", str(ctx.exception))

        # failure=CANDIDATE_HOST_BINDING + serialized=true
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                intent_parsed=True,
                host_bound=True,
                serialized=True,
                failure_stage="CANDIDATE_HOST_BINDING",
                failure_subcode="HOST_BINDING_REPO_MEMBERSHIP_FAILED",
            )
        self.assertIn("milestone contradiction", str(ctx.exception))

        # failure=CANDIDATE_SERIALIZATION + gate_evaluated=true
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                intent_parsed=True,
                host_bound=True,
                serialized=True,
                gate_evaluated=True,
                failure_stage="CANDIDATE_SERIALIZATION",
                failure_subcode="SERIALIZATION_PATH_FAILED",
            )
        self.assertIn("milestone contradiction", str(ctx.exception))

        # failure=CANDIDATE_STATIC_GATE + gate_accepted=true
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                intent_parsed=True,
                host_bound=True,
                serialized=True,
                gate_evaluated=True,
                gate_accepted=True,
                failure_stage="CANDIDATE_STATIC_GATE",
                failure_subcode="GATE_FORBIDDEN_PATH",
            )
        self.assertIn("milestone contradiction", str(ctx.exception))

        # failure=VERIFIER_CONTRACT + verifier_invoked=false
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                intent_parsed=True,
                host_bound=True,
                serialized=True,
                gate_evaluated=True,
                gate_accepted=True,
                verifier_invoked=False,
                failure_stage="VERIFIER_CONTRACT",
                failure_subcode="VERIFIER_INVALID_SCORE",
            )
        self.assertIn("milestone contradiction", str(ctx.exception))

    # --------------------------------------------------------------------------
    # F & G. Valid progression states without failure
    # --------------------------------------------------------------------------
    def test_valid_progression_states_without_failure(self) -> None:
        """Verify normal progression and partial states remain valid when no failure is set."""
        valid_chains = [
            (False, False, False, False, False, False),  # 000000
            (True, False, False, False, False, False),   # 100000
            (True, True, False, False, False, False),    # 110000
            (True, True, True, False, False, False),     # 111000
            (True, True, True, True, False, False),      # 111100 (gate rejection without declared error)
            (True, True, True, True, True, False),       # 111110 (gate accepted, pre-verifier)
            (True, True, True, True, True, True),        # 111111 (full progression)
        ]
        for i, h, s, g, a, v in valid_chains:
            telem = CandidateTelemetryV1(
                slot_index=1,
                candidate_id_hash=self.sample_hash,
                intent_parsed=i,
                host_bound=h,
                serialized=s,
                gate_evaluated=g,
                gate_accepted=a,
                verifier_invoked=v,
            )
            self.assertEqual(telem.intent_parsed, i)
            self.assertEqual(telem.host_bound, h)
            self.assertEqual(telem.serialized, s)
            self.assertEqual(telem.gate_evaluated, g)
            self.assertEqual(telem.gate_accepted, a)
            self.assertEqual(telem.verifier_invoked, v)

    # --------------------------------------------------------------------------
    # H. Deterministic Serialization
    # --------------------------------------------------------------------------
    def test_deterministic_serialization(self) -> None:
        """Verify deterministic JSON and dictionary round-trip."""
        telem = CandidateTelemetryV1(
            slot_index=2,
            candidate_id_hash=self.sample_hash,
            intent_parsed=True,
            host_bound=True,
            serialized=True,
            gate_evaluated=True,
            gate_accepted=False,
            failure_stage="CANDIDATE_STATIC_GATE",
            failure_subcode="GATE_FILE_BUDGET_EXCEEDED",
            structural_diagnostics={"target_file_count": 12},
        )
        j1 = telem.to_json()
        j2 = telem.to_json()
        self.assertEqual(j1, j2)

        restored = CandidateTelemetryV1.from_json(j1)
        self.assertEqual(restored, telem)

    # --------------------------------------------------------------------------
    # I. Candidate Hash Validation
    # --------------------------------------------------------------------------
    def test_candidate_id_hash_validation(self) -> None:
        """Verify lowercase hex accepted, uppercase, non-hex, wrong length rejected."""
        self.assertEqual(validate_candidate_id_hash(self.sample_hash), self.sample_hash)

        # Uppercase rejected
        with self.assertRaises(ValueError):
            validate_candidate_id_hash(self.sample_hash.upper())

        # Non-hex rejected
        with self.assertRaises(ValueError):
            validate_candidate_id_hash("g" * 64)

        # Wrong length rejected
        with self.assertRaises(ValueError):
            validate_candidate_id_hash(self.sample_hash[:-1])
        with self.assertRaises(ValueError):
            validate_candidate_id_hash(self.sample_hash + "a")

    # --------------------------------------------------------------------------
    # J. Semantic Leakage Injection Attempts
    # --------------------------------------------------------------------------
    def test_semantic_leakage_rejection(self) -> None:
        """Verify zero leakage into serialized telemetry."""
        err = CandidateContractErrorV7(
            failure_subcode="HOST_BINDING_READ_FAILED",
            failure_stage="CANDIDATE_HOST_BINDING",
            structural_diagnostics={"slot_index": 0},
        )
        telem = CandidateTelemetryV1.from_failure(
            slot_index=0,
            candidate_id_hash=self.sample_hash,
            error=err,
        )
        self.assertEqual(telem.failure_stage, "CANDIDATE_HOST_BINDING")
        self.assertEqual(telem.failure_subcode, "HOST_BINDING_READ_FAILED")
        self.assertTrue(telem.intent_parsed)
        self.assertFalse(telem.host_bound)

        j = telem.to_json()
        for forbidden in ["source_code", "file_path", "failure_message", "exception_text", "raw_error"]:
            self.assertNotIn(forbidden, j)

    # --------------------------------------------------------------------------
    # K. Slot index bounds
    # --------------------------------------------------------------------------
    def test_slot_index_bounds(self) -> None:
        """Verify slot indices 0, 1, 2 accepted, -1, 3 rejected."""
        for slot in (0, 1, 2):
            t = CandidateTelemetryV1(slot_index=slot, candidate_id_hash=self.sample_hash)
            self.assertEqual(t.slot_index, slot)

        for slot in (-1, 3, 4):
            with self.assertRaises(ValueError):
                CandidateTelemetryV1(slot_index=slot, candidate_id_hash=self.sample_hash)


if __name__ == "__main__":
    unittest.main()
