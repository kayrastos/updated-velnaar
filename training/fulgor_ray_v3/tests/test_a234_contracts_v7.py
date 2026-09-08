"""Unit tests for A234 V7 additive contracts and taxonomy.

Phase R1: Safe Observability (Corrected Edition).

Verifies:
1. Every allowed stage/subcode pair accepts
2. Cross-stage known subcode rejects
3. Unknown stage rejects
4. Unknown subcode rejects
5. Diagnosis subclass rejects Plan/Candidate/Verifier subcodes
6. Plan subclass rejects Diagnosis/Candidate/Verifier subcodes
7. Candidate subclass rejects Diagnosis/Plan/Verifier subcodes
8. Verifier subclass rejects Diagnosis/Plan/Candidate subcodes
9. Retired GATE_BUDGET_EXCEEDED rejects
10. Three new gate budget subcodes accept only under CANDIDATE_STATIC_GATE
11. Diagnostic strings rejected
12. Arbitrary diagnostic keys rejected
13. Integer bounds preserved
14. Exception string remains only stage:subcode
"""

from __future__ import annotations

import unittest

from training.fulgor_ray_v3.a234_contracts_v7 import (
    ALL_FAILURE_SUBCODES,
    ALL_STAGES,
    ALLOWED_STRUCTURAL_DIAGNOSTIC_KEYS,
    ALLOWED_SUBCODES_BY_STAGE,
    A234Stage,
    A234V7ContractError,
    CandidateContractErrorV7,
    DiagnosisContractErrorV7,
    GATE_CHANGED_LINE_BUDGET_EXCEEDED,
    GATE_FILE_BUDGET_EXCEEDED,
    GATE_HUNK_BUDGET_EXCEEDED,
    MAX_DIAGNOSTIC_KEYS,
    MAX_INT_VALUE,
    MIN_INT_VALUE,
    PlanContractErrorV7,
    SUBCODE_TO_STAGE,
    VerifierContractErrorV7,
    validate_stage_subcode,
    validate_structural_diagnostics,
)


class TestA234ContractsV7(unittest.TestCase):
    """Tests for additive V7 contracts, taxonomy, pair compatibility, and diagnostics policy."""

    # --------------------------------------------------------------------------
    # 1. Typed error hierarchy
    # --------------------------------------------------------------------------
    def test_typed_error_hierarchy(self) -> None:
        """Verify error inheritance structure and independence from legacy errors."""
        self.assertTrue(issubclass(A234V7ContractError, ValueError))

        subclasses = [
            DiagnosisContractErrorV7,
            PlanContractErrorV7,
            CandidateContractErrorV7,
            VerifierContractErrorV7,
        ]
        for subcls in subclasses:
            self.assertTrue(
                issubclass(subcls, A234V7ContractError),
                f"{subcls.__name__} must inherit from A234V7ContractError",
            )

        # Legacy isolation check: ensure no import or inheritance from legacy A234ContractError
        try:
            from training.fulgor_ray_v3.a234_inference import A234ContractError
            self.assertFalse(
                issubclass(A234V7ContractError, A234ContractError),
                "A234V7ContractError must NOT inherit from legacy A234ContractError",
            )
        except ImportError:
            pass

    # --------------------------------------------------------------------------
    # 2. Stage & Subcode Taxonomy Completeness
    # --------------------------------------------------------------------------
    def test_stage_and_subcode_counts(self) -> None:
        """Verify 13 stages and exactly 44 subcodes (including 3 split gate budget codes)."""
        self.assertEqual(len(ALL_STAGES), 13)
        self.assertEqual(len(ALL_FAILURE_SUBCODES), 44)
        self.assertEqual(len(SUBCODE_TO_STAGE), 44)

    # --------------------------------------------------------------------------
    # 3. Every allowed stage/subcode pair accepts
    # --------------------------------------------------------------------------
    def test_all_valid_stage_subcode_pairs_accepted(self) -> None:
        """Verify every registered stage/subcode pair in ALLOWED_SUBCODES_BY_STAGE accepts."""
        tested_pairs = 0
        for stage, subcodes in ALLOWED_SUBCODES_BY_STAGE.items():
            for subcode in subcodes:
                validate_stage_subcode(stage, subcode)
                err = A234V7ContractError(failure_stage=stage, failure_subcode=subcode)
                self.assertEqual(err.failure_stage, stage)
                self.assertEqual(err.failure_subcode, subcode)
                self.assertEqual(str(err), f"{stage}:{subcode}")
                tested_pairs += 1
        self.assertEqual(tested_pairs, 44)

    # --------------------------------------------------------------------------
    # 4. Cross-stage known subcode rejects
    # --------------------------------------------------------------------------
    def test_cross_stage_known_subcode_rejected(self) -> None:
        """Verify known subcodes paired with an unauthorized stage are strictly rejected."""
        mismatched_pairs = [
            ("CANDIDATE_HOST_BINDING", "VERIFIER_INVALID_SCORE"),
            ("PLAN_CONTRACT", "GATE_PATCH_APPLY_FAILED"),
            ("VERIFIER_CONTRACT", "DIAGNOSIS_TARGET_NOT_IN_INVENTORY"),
            ("CANDIDATE_INTENT", "PLAN_STEPS_INVALID"),
            ("DIAGNOSIS_CONTRACT", "CANDIDATE_MALFORMED_SYNTAX"),
            ("CANDIDATE_STATIC_GATE", "HOST_BINDING_READ_FAILED"),
            ("PRIMARY_SELECTION", "GATE_EMPTY_PATCH"),
        ]
        for stage, subcode in mismatched_pairs:
            with self.assertRaises(ValueError) as ctx:
                validate_stage_subcode(stage, subcode)
            self.assertIn("compatibility violation", str(ctx.exception))

            with self.assertRaises(ValueError):
                A234V7ContractError(failure_stage=stage, failure_subcode=subcode)

    # --------------------------------------------------------------------------
    # 5. Unknown stage and unknown subcode reject
    # --------------------------------------------------------------------------
    def test_unknown_stage_and_subcode_rejected(self) -> None:
        """Verify unknown stage or subcode fails closed."""
        with self.assertRaises(ValueError) as ctx:
            validate_stage_subcode("UNKNOWN_STAGE", "DIAGNOSIS_MALFORMED_SYNTAX")
        self.assertIn("Unknown or unapproved failure stage", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            validate_stage_subcode("DIAGNOSIS_RECOVERY", "UNKNOWN_SUBCODE")
        self.assertIn("Unknown or unapproved failure subcode", str(ctx.exception))

    # --------------------------------------------------------------------------
    # 6. Subclasses enforce stage & subcode domain boundaries
    # --------------------------------------------------------------------------
    def test_diagnosis_subclass_domain_enforcement(self) -> None:
        """Verify DiagnosisContractErrorV7 rejects subcodes outside diagnosis."""
        # Accepts valid diagnosis subcode
        err = DiagnosisContractErrorV7(failure_subcode="DIAGNOSIS_TARGET_NOT_IN_INVENTORY")
        self.assertEqual(err.failure_stage, "DIAGNOSIS_MEMBERSHIP")

        # Rejects plan subcode
        with self.assertRaises(ValueError):
            DiagnosisContractErrorV7(failure_subcode="PLAN_STEPS_INVALID")
        # Rejects candidate subcode
        with self.assertRaises(ValueError):
            DiagnosisContractErrorV7(failure_subcode="CANDIDATE_MALFORMED_SYNTAX")
        # Rejects verifier subcode
        with self.assertRaises(ValueError):
            DiagnosisContractErrorV7(failure_subcode="VERIFIER_INVALID_SCORE")

    def test_plan_subclass_domain_enforcement(self) -> None:
        """Verify PlanContractErrorV7 rejects subcodes outside plan."""
        err = PlanContractErrorV7(failure_subcode="PLAN_STEPS_INVALID")
        self.assertEqual(err.failure_stage, "PLAN_CONTRACT")

        with self.assertRaises(ValueError):
            PlanContractErrorV7(failure_subcode="DIAGNOSIS_MALFORMED_SYNTAX")
        with self.assertRaises(ValueError):
            PlanContractErrorV7(failure_subcode="GATE_EMPTY_PATCH")
        with self.assertRaises(ValueError):
            PlanContractErrorV7(failure_subcode="VERIFIER_INVALID_SCORE")

    def test_candidate_subclass_domain_enforcement(self) -> None:
        """Verify CandidateContractErrorV7 rejects subcodes outside candidate generation/validation."""
        err = CandidateContractErrorV7(failure_subcode="GATE_PATCH_APPLY_FAILED")
        self.assertEqual(err.failure_stage, "CANDIDATE_STATIC_GATE")

        with self.assertRaises(ValueError):
            CandidateContractErrorV7(failure_subcode="DIAGNOSIS_TARGET_NOT_IN_INVENTORY")
        with self.assertRaises(ValueError):
            CandidateContractErrorV7(failure_subcode="PLAN_OUT_OF_SCOPE_STEP")
        with self.assertRaises(ValueError):
            CandidateContractErrorV7(failure_subcode="VERIFIER_INVALID_SCORE")

    def test_verifier_subclass_domain_enforcement(self) -> None:
        """Verify VerifierContractErrorV7 rejects subcodes outside verifier."""
        err = VerifierContractErrorV7(failure_subcode="VERIFIER_INVALID_SCORE")
        self.assertEqual(err.failure_stage, "VERIFIER_CONTRACT")

        with self.assertRaises(ValueError):
            VerifierContractErrorV7(failure_subcode="DIAGNOSIS_SCHEMA_VERSION_MISMATCH")
        with self.assertRaises(ValueError):
            VerifierContractErrorV7(failure_subcode="PLAN_DIAGNOSIS_HASH_MISMATCH")
        with self.assertRaises(ValueError):
            VerifierContractErrorV7(failure_subcode="CANDIDATE_PLAN_HASH_MISMATCH")

    # --------------------------------------------------------------------------
    # 7. Gate Budget Granularity: Retired code rejected, 3 new codes accepted
    # --------------------------------------------------------------------------
    def test_retired_gate_budget_exceeded_rejected(self) -> None:
        """Verify the broad retired code GATE_BUDGET_EXCEEDED fails closed."""
        self.assertNotIn("GATE_BUDGET_EXCEEDED", ALL_FAILURE_SUBCODES)
        with self.assertRaises(ValueError):
            validate_stage_subcode("CANDIDATE_STATIC_GATE", "GATE_BUDGET_EXCEEDED")
        with self.assertRaises(ValueError):
            A234V7ContractError(
                failure_stage="CANDIDATE_STATIC_GATE",
                failure_subcode="GATE_BUDGET_EXCEEDED",
            )

    def test_split_gate_budget_codes_accepted(self) -> None:
        """Verify GATE_FILE_BUDGET_EXCEEDED, GATE_HUNK_BUDGET_EXCEEDED, GATE_CHANGED_LINE_BUDGET_EXCEEDED."""
        split_codes = [
            GATE_FILE_BUDGET_EXCEEDED,
            GATE_HUNK_BUDGET_EXCEEDED,
            GATE_CHANGED_LINE_BUDGET_EXCEEDED,
        ]
        for code in split_codes:
            self.assertIn(code, ALL_FAILURE_SUBCODES)
            # Accepts under CANDIDATE_STATIC_GATE
            validate_stage_subcode("CANDIDATE_STATIC_GATE", code)
            err = CandidateContractErrorV7(failure_subcode=code)
            self.assertEqual(err.failure_stage, "CANDIDATE_STATIC_GATE")
            # Rejects under any other stage
            with self.assertRaises(ValueError):
                validate_stage_subcode("CANDIDATE_INTENT", code)
            with self.assertRaises(ValueError):
                validate_stage_subcode("CANDIDATE_SERIALIZATION", code)

    # --------------------------------------------------------------------------
    # 8. Structural diagnostics policy
    # --------------------------------------------------------------------------
    def test_structural_diagnostics_allowlist(self) -> None:
        """Verify all 16 allowed keys accept valid types and values."""
        sample_diag = {
            "raw_character_count": 1024,
            "brace_balance": 0,
            "bracket_balance": 0,
            "double_quote_parity": True,
            "json_decode_error_position": 42,
            "json_decode_error_line": 3,
            "json_decode_error_column": 12,
            "observed_key_count": 5,
            "target_file_count": 1,
            "step_count": 2,
            "edit_count": 1,
            "repository_file_count": 50,
            "file_line_count": 100,
            "requested_start_line": 10,
            "requested_end_line": 20,
            "slot_index": 0,
        }
        validated = validate_structural_diagnostics(sample_diag)
        self.assertEqual(validated, sample_diag)

        # None values accepted
        none_diag = {"json_decode_error_position": None, "slot_index": 1}
        self.assertEqual(validate_structural_diagnostics(none_diag), none_diag)

        # Boundary integers accepted
        bounds_diag = {"raw_character_count": MAX_INT_VALUE, "brace_balance": MIN_INT_VALUE}
        self.assertEqual(validate_structural_diagnostics(bounds_diag), bounds_diag)

        # Out of bounds rejected
        with self.assertRaises(ValueError):
            validate_structural_diagnostics({"raw_character_count": MAX_INT_VALUE + 1})
        with self.assertRaises(ValueError):
            validate_structural_diagnostics({"brace_balance": MIN_INT_VALUE - 1})

    def test_structural_diagnostics_reject_strings_and_arbitrary_keys(self) -> None:
        """Verify string values and arbitrary keys are rejected."""
        with self.assertRaises(TypeError):
            validate_structural_diagnostics({"raw_character_count": "1024"})
        with self.assertRaises(ValueError):
            validate_structural_diagnostics({"source_code": 1})
        with self.assertRaises(ValueError):
            validate_structural_diagnostics({"file_path": 2})

    # --------------------------------------------------------------------------
    # 9. Exception string safety
    # --------------------------------------------------------------------------
    def test_error_representation_safety(self) -> None:
        """Verify error representation contains strictly '<stage>:<subcode>'."""
        err = CandidateContractErrorV7(
            failure_subcode="GATE_FILE_BUDGET_EXCEEDED",
            failure_stage="CANDIDATE_STATIC_GATE",
            structural_diagnostics={"target_file_count": 15},
        )
        self.assertEqual(str(err), "CANDIDATE_STATIC_GATE:GATE_FILE_BUDGET_EXCEEDED")
        self.assertFalse(hasattr(err, "failure_message"))
        self.assertFalse(hasattr(err, "raw_error"))
        self.assertFalse(hasattr(err, "exception_text"))


if __name__ == "__main__":
    unittest.main()
