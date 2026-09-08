"""Unit tests for A234 candidate telemetry data structure, invariants, and strict deserialization.

Phase R1: Safe Observability (Strict Deserialization Edition).

Verifies:
1. Canonical to_dict -> from_dict roundtrip PASS
2. Canonical to_json -> from_json roundtrip PASS
3. Each missing required persisted field fails closed (iterating all 12 canonical fields)
4. Extra unknown field fails (failure_message, source_code, raw_model_output, path)
5. Missing schema_version fails
6. Wrong schema_version fails
7. Duplicate JSON key fails
8. Non-object JSON fails ([], null, "string", 123)
9. from_failure requires explicit six milestone flags
10. from_failure exact valid host-binding failure succeeds with I=1 H=0 S=0 G=0 A=0 V=0
11. from_failure contradictory explicit milestone flags reject
12. from_failure cannot accept unknown kwargs (failure_message, raw_error, source_code, etc.)
13. from_dict cannot silently infer failure_stage/failure_subcode
14. Existing stage/subcode and milestone progression tests continue passing
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
    CANONICAL_PERSISTED_FIELDS,
    REQUIRED_FAILURE_MILESTONES,
    SCHEMA_VERSION,
    VALID_SLOT_INDICES,
    CandidateTelemetryV1,
    hash_candidate_id,
    validate_candidate_id_hash,
)


class TestA234TelemetryV1(unittest.TestCase):
    """Tests for CandidateTelemetryV1 data structure, invariants, and strict deserialization."""

    def setUp(self) -> None:
        self.sample_raw_id = "test_candidate_a234_slot0"
        self.sample_hash = hashlib.sha256(self.sample_raw_id.encode("utf-8")).hexdigest()
        self.valid_canonical_dict = {
            "schema_version": SCHEMA_VERSION,
            "slot_index": 0,
            "candidate_id_hash": self.sample_hash,
            "intent_parsed": True,
            "host_bound": True,
            "serialized": True,
            "gate_evaluated": True,
            "gate_accepted": False,
            "verifier_invoked": False,
            "failure_stage": "CANDIDATE_STATIC_GATE",
            "failure_subcode": "GATE_FILE_BUDGET_EXCEEDED",
            "structural_diagnostics": {"target_file_count": 12},
        }

    # --------------------------------------------------------------------------
    # 1. Canonical to_dict -> from_dict roundtrip PASS
    # --------------------------------------------------------------------------
    def test_canonical_to_dict_from_dict_roundtrip(self) -> None:
        """Verify perfect roundtrip between dataclass and plain dictionary."""
        telem = CandidateTelemetryV1.from_dict(self.valid_canonical_dict)
        d = telem.to_dict()
        self.assertEqual(d, self.valid_canonical_dict)
        telem_roundtrip = CandidateTelemetryV1.from_dict(d)
        self.assertEqual(telem_roundtrip, telem)

    # --------------------------------------------------------------------------
    # 2. Canonical to_json -> from_json roundtrip PASS
    # --------------------------------------------------------------------------
    def test_canonical_to_json_from_json_roundtrip(self) -> None:
        """Verify perfect deterministic roundtrip between dataclass and JSON string."""
        telem = CandidateTelemetryV1.from_dict(self.valid_canonical_dict)
        json_str = telem.to_json()
        telem_from_json = CandidateTelemetryV1.from_json(json_str)
        self.assertEqual(telem_from_json, telem)

    # --------------------------------------------------------------------------
    # 3. Each missing required persisted field fails closed
    # --------------------------------------------------------------------------
    def test_each_missing_required_field_fails_closed(self) -> None:
        """Verify omitting any single canonical field from from_dict() raises ValueError."""
        self.assertEqual(len(CANONICAL_PERSISTED_FIELDS), 12)
        for missing_field in CANONICAL_PERSISTED_FIELDS:
            incomplete = dict(self.valid_canonical_dict)
            del incomplete[missing_field]
            with self.assertRaises(ValueError) as ctx:
                CandidateTelemetryV1.from_dict(incomplete)
            self.assertIn("missing required persisted telemetry fields", str(ctx.exception))
            self.assertIn(missing_field, str(ctx.exception))

    # --------------------------------------------------------------------------
    # 4. Extra unknown field fails
    # --------------------------------------------------------------------------
    def test_extra_unknown_field_fails(self) -> None:
        """Verify presence of any unauthorized extra field raises ValueError."""
        forbidden_extras = [
            "failure_message",
            "source_code",
            "raw_model_output",
            "path",
            "extra_metadata",
            "arbitrary_field",
        ]
        for extra in forbidden_extras:
            polluted = dict(self.valid_canonical_dict)
            polluted[extra] = "UNAUTHORIZED_VALUE"
            with self.assertRaises(ValueError) as ctx:
                CandidateTelemetryV1.from_dict(polluted)
            self.assertIn("unrecognized extra telemetry fields", str(ctx.exception))
            self.assertIn(extra, str(ctx.exception))

    # --------------------------------------------------------------------------
    # 5 & 6. Missing and wrong schema_version fail
    # --------------------------------------------------------------------------
    def test_missing_and_wrong_schema_version_fail(self) -> None:
        """Verify schema_version is strictly enforced in from_dict()."""
        # Missing schema_version
        no_version = dict(self.valid_canonical_dict)
        del no_version["schema_version"]
        with self.assertRaises(ValueError):
            CandidateTelemetryV1.from_dict(no_version)

        # Wrong schema_version
        wrong_version = dict(self.valid_canonical_dict)
        wrong_version["schema_version"] = "fulgor.candidate_telemetry.v2"
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1.from_dict(wrong_version)
        self.assertIn("Invalid schema_version", str(ctx.exception))

    # --------------------------------------------------------------------------
    # 7. Duplicate JSON key fails
    # --------------------------------------------------------------------------
    def test_duplicate_json_key_fails(self) -> None:
        """Verify duplicate keys in telemetry JSON string fail closed with ValueError."""
        duplicate_json = (
            '{"schema_version":"fulgor.candidate_telemetry.v1",'
            '"slot_index":0,"slot_index":1,'
            f'"candidate_id_hash":"{self.sample_hash}",'
            '"intent_parsed":false,"host_bound":false,"serialized":false,'
            '"gate_evaluated":false,"gate_accepted":false,"verifier_invoked":false,'
            '"failure_stage":null,"failure_subcode":null,"structural_diagnostics":{}}'
        )
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1.from_json(duplicate_json)
        self.assertIn("Duplicate JSON object key detected", str(ctx.exception))

    # --------------------------------------------------------------------------
    # 8. Non-object JSON fails
    # --------------------------------------------------------------------------
    def test_non_object_json_fails(self) -> None:
        """Verify non-object JSON payloads ([], null, string, number) raise ValueError/TypeError."""
        invalid_json_payloads = [
            "[]",
            "null",
            '"string"',
            "123",
            "true",
        ]
        for payload in invalid_json_payloads:
            with self.assertRaises((ValueError, TypeError)):
                CandidateTelemetryV1.from_json(payload)

    # --------------------------------------------------------------------------
    # 9. from_failure requires explicit six milestone flags
    # --------------------------------------------------------------------------
    def test_from_failure_requires_explicit_milestone_flags(self) -> None:
        """Verify from_failure() requires all 6 milestone progression flags keyword-only."""
        err = CandidateContractErrorV7(
            failure_subcode="HOST_BINDING_REPO_MEMBERSHIP_FAILED",
            failure_stage="CANDIDATE_HOST_BINDING",
        )
        # Calling without milestone keyword arguments must raise TypeError
        with self.assertRaises(TypeError):
            CandidateTelemetryV1.from_failure(
                0,
                self.sample_hash,
                err,  # type: ignore
            )

    # --------------------------------------------------------------------------
    # 10. from_failure exact valid host-binding failure succeeds
    # --------------------------------------------------------------------------
    def test_from_failure_valid_host_binding_succeeds(self) -> None:
        """Verify from_failure() with exact valid flags for host binding succeeds."""
        err = CandidateContractErrorV7(
            failure_subcode="HOST_BINDING_READ_FAILED",
            failure_stage="CANDIDATE_HOST_BINDING",
            structural_diagnostics={"slot_index": 0},
        )
        telem = CandidateTelemetryV1.from_failure(
            slot_index=0,
            candidate_id_hash=self.sample_hash,
            error=err,
            intent_parsed=True,
            host_bound=False,
            serialized=False,
            gate_evaluated=False,
            gate_accepted=False,
            verifier_invoked=False,
        )
        self.assertEqual(telem.failure_stage, "CANDIDATE_HOST_BINDING")
        self.assertEqual(telem.failure_subcode, "HOST_BINDING_READ_FAILED")
        self.assertTrue(telem.intent_parsed)
        self.assertFalse(telem.host_bound)

    # --------------------------------------------------------------------------
    # 11. from_failure contradictory explicit milestone flags reject
    # --------------------------------------------------------------------------
    def test_from_failure_contradictory_milestones_rejected(self) -> None:
        """Verify from_failure() validates and rejects contradictory explicit flags."""
        err = CandidateContractErrorV7(
            failure_subcode="HOST_BINDING_READ_FAILED",
            failure_stage="CANDIDATE_HOST_BINDING",
        )
        # host_bound=True contradicts CANDIDATE_HOST_BINDING failure
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1.from_failure(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                error=err,
                intent_parsed=True,
                host_bound=True,
                serialized=False,
                gate_evaluated=False,
                gate_accepted=False,
                verifier_invoked=False,
            )
        self.assertIn("milestone contradiction", str(ctx.exception))

    # --------------------------------------------------------------------------
    # 12. from_failure rejects unknown kwargs
    # --------------------------------------------------------------------------
    def test_from_failure_rejects_unknown_kwargs(self) -> None:
        """Verify from_failure() rejects arbitrary extra keyword arguments with TypeError."""
        err = CandidateContractErrorV7(
            failure_subcode="HOST_BINDING_READ_FAILED",
            failure_stage="CANDIDATE_HOST_BINDING",
        )
        forbidden_kwargs = [
            {"failure_message": "SECRET"},
            {"raw_error": "RAW_ERROR"},
            {"source_code": "def foo(): pass"},
            {"replacement_text": "new_code"},
            {"anchor": "def bar"},
            {"raw_model_output": "output"},
        ]
        for kw in forbidden_kwargs:
            with self.assertRaises(TypeError):
                CandidateTelemetryV1.from_failure(
                    slot_index=0,
                    candidate_id_hash=self.sample_hash,
                    error=err,
                    intent_parsed=True,
                    host_bound=False,
                    serialized=False,
                    gate_evaluated=False,
                    gate_accepted=False,
                    verifier_invoked=False,
                    **kw,  # type: ignore
                )

    # --------------------------------------------------------------------------
    # 13. from_dict cannot silently infer failure_stage/failure_subcode
    # --------------------------------------------------------------------------
    def test_from_dict_cannot_infer_failure_fields(self) -> None:
        """Verify from_dict() rejects omission of failure_stage or failure_subcode."""
        omitted_stage = dict(self.valid_canonical_dict)
        del omitted_stage["failure_stage"]
        with self.assertRaises(ValueError):
            CandidateTelemetryV1.from_dict(omitted_stage)

        omitted_subcode = dict(self.valid_canonical_dict)
        del omitted_subcode["failure_subcode"]
        with self.assertRaises(ValueError):
            CandidateTelemetryV1.from_dict(omitted_subcode)

    # --------------------------------------------------------------------------
    # 14. Existing tests: stage/subcode, milestones, hash, bounds, sanitization
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

    def test_half_defined_failure_states_rejected(self) -> None:
        """Verify half-defined failure states fail closed."""
        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                failure_stage="CANDIDATE_INTENT",
                failure_subcode=None,
            )
        self.assertIn("Half-defined failure state violation", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            CandidateTelemetryV1(
                slot_index=0,
                candidate_id_hash=self.sample_hash,
                failure_stage=None,
                failure_subcode="CANDIDATE_MALFORMED_SYNTAX",
            )
        self.assertIn("Half-defined failure state violation", str(ctx.exception))

    def test_valid_progression_states_without_failure(self) -> None:
        """Verify normal progression and partial states remain valid when no failure is set."""
        valid_chains = [
            (False, False, False, False, False, False),
            (True, False, False, False, False, False),
            (True, True, False, False, False, False),
            (True, True, True, False, False, False),
            (True, True, True, True, False, False),
            (True, True, True, True, True, False),
            (True, True, True, True, True, True),
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

    def test_candidate_id_hash_validation(self) -> None:
        """Verify lowercase hex accepted, uppercase, non-hex, wrong length rejected."""
        self.assertEqual(validate_candidate_id_hash(self.sample_hash), self.sample_hash)

        with self.assertRaises(ValueError):
            validate_candidate_id_hash(self.sample_hash.upper())

        with self.assertRaises(ValueError):
            validate_candidate_id_hash("g" * 64)

        with self.assertRaises(ValueError):
            validate_candidate_id_hash(self.sample_hash[:-1])
        with self.assertRaises(ValueError):
            validate_candidate_id_hash(self.sample_hash + "a")

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
