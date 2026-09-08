# Fulgor Ray V3 A234 — Phase R1 Safe Observability Implementation Report (Corrected Edition)

## 1. Executive Summary

- **Status**: `PASS_A234_R1_SAFE_OBSERVABILITY_IMPLEMENTATION`
- **Canonical Base Commit**: `e78325c076748c6135255ab71fc01f968939205e`
- **Branch**: `fulgor/a234-v6-handoff-20260906`
- **Authorization Phase**: `PHASE_R1_SAFE_OBSERVABILITY` ONLY
- **Code Review Status**: Blocker corrections applied and verified.
- **R1 Canonical Commit Eligible**: `true`
- **Sealed Legacy Source Files Modified**: 0 (all 11 sealed V1–V6 files remain 100% byte-identical)
- **Files in R1 Scope**: Exactly 6 untracked files (2 runtime modules, 2 unit test modules, 2 reports)

This report certifies the successful correction and completion of Phase R1 (Safe Observability) following the independent adversarial code review. All telemetry-integrity defects, stage-subcode cross-pairing vulnerabilities, candidate-stage scope leaks, and budget taxonomy ambiguities have been eliminated.

---

## 2. Corrected Review Blockers Summary

The following blockers identified during the adversarial review were corrected:
1. **Stage ↔ Subcode Compatibility Validation**:
   - Implemented authoritative mapping `ALLOWED_SUBCODES_BY_STAGE` and fail-closed validator `validate_stage_subcode(stage, subcode)`.
   - `A234V7ContractError` and its typed subclasses now strictly reject illegal stage/subcode pairings.
   - Default stage inference in subclasses fails closed if the supplied subcode does not match the subclass domain.
2. **Candidate Telemetry Stage Scope Enforcement**:
   - `CandidateTelemetryV1` now strictly restricts `failure_stage` to candidate-level stages (`CANDIDATE_RECOVERY`, `CANDIDATE_INTENT`, `CANDIDATE_HOST_BINDING`, `CANDIDATE_SERIALIZATION`, `CANDIDATE_STATIC_GATE`, `VERIFIER_RECOVERY`, `VERIFIER_CONTRACT`).
   - Rejects `DIAGNOSIS_RECOVERY`, `DIAGNOSIS_CONTRACT`, `DIAGNOSIS_MEMBERSHIP`, `PLAN_RECOVERY`, `PLAN_CONTRACT`, and `PRIMARY_SELECTION`.
3. **Terminal Failure-Stage ↔ Milestone Compatibility**:
   - Enforced exact required milestone states for each failure stage (`REQUIRED_FAILURE_MILESTONES`).
   - Rejects contradictory downstream milestone assertions (e.g. `failure_stage=CANDIDATE_INTENT` with `host_bound=True`).
4. **Gate Budget Taxonomy Disambiguation**:
   - Retired broad `GATE_BUDGET_EXCEEDED` code completely (fails closed).
   - Replaced with granular codes: `GATE_FILE_BUDGET_EXCEEDED`, `GATE_HUNK_BUDGET_EXCEEDED`, and `GATE_CHANGED_LINE_BUDGET_EXCEEDED`.
5. **Comprehensive Unit Test Expansion**:
   - Expanded test suite from 18 to 24 tests, thoroughly testing illegal pairings, contradictory milestones, half-defined failure states, and budget subcodes.

---

## 3. Additive Typed Error Hierarchy (`a234_contracts_v7.py`)

A new, independent exception hierarchy rooted at `A234V7ContractError(ValueError)` was created:

```
ValueError
 └── A234V7ContractError
      ├── DiagnosisContractErrorV7
      ├── PlanContractErrorV7
      ├── CandidateContractErrorV7
      └── VerifierContractErrorV7
```

### Key Invariants:
- `failure_stage`: Strictly validated against `ALL_STAGES`.
- `failure_subcode`: Strictly validated against `ALL_FAILURE_SUBCODES`.
- `validate_stage_subcode`: Enforces that `failure_subcode in ALLOWED_SUBCODES_BY_STAGE[failure_stage]`.
- `structural_diagnostics`: Strictly non-semantic allowlist (`int | bool | None`).
- `__str__`: Formatted strictly as `<stage>:<subcode>`. Prohibits free-form message persistence.

---

## 4. Canonical Stage & Subcode Taxonomy

### Stages (13):
- **Diagnosis**: `DIAGNOSIS_RECOVERY`, `DIAGNOSIS_CONTRACT`, `DIAGNOSIS_MEMBERSHIP`
- **Plan**: `PLAN_RECOVERY`, `PLAN_CONTRACT`
- **Candidate Generation & Validation**: `CANDIDATE_RECOVERY`, `CANDIDATE_INTENT`, `CANDIDATE_HOST_BINDING`, `CANDIDATE_SERIALIZATION`, `CANDIDATE_STATIC_GATE`
- **Verifier**: `VERIFIER_RECOVERY`, `VERIFIER_CONTRACT`
- **Selection**: `PRIMARY_SELECTION` (global pipeline stage, no candidate failure subcodes)

### Failure Subcodes (44):
- **Diagnosis (5)**:
  - `DIAGNOSIS_RECOVERY` (1): `DIAGNOSIS_MALFORMED_SYNTAX`
  - `DIAGNOSIS_CONTRACT` (3): `DIAGNOSIS_SCHEMA_VERSION_MISMATCH`, `DIAGNOSIS_TARGET_COUNT_INVALID`, `DIAGNOSIS_SYMBOLS_INVALID`
  - `DIAGNOSIS_MEMBERSHIP` (1): `DIAGNOSIS_TARGET_NOT_IN_INVENTORY`
- **Plan (6)**:
  - `PLAN_RECOVERY` (1): `PLAN_MALFORMED_SYNTAX`
  - `PLAN_CONTRACT` (5): `PLAN_SCHEMA_VERSION_MISMATCH`, `PLAN_DIAGNOSIS_HASH_MISMATCH`, `PLAN_STEPS_INVALID`, `PLAN_OUT_OF_SCOPE_STEP`, `PLAN_PRESERVATION_CONSTRAINTS_INVALID`
- **Candidate Recovery (1)**: `CANDIDATE_MALFORMED_SYNTAX`
- **Candidate Semantic Intent (10)**: `CANDIDATE_SCHEMA_VERSION_MISMATCH`, `CANDIDATE_ID_MISMATCH`, `CANDIDATE_DIAGNOSIS_HASH_MISMATCH`, `CANDIDATE_PLAN_HASH_MISMATCH`, `CANDIDATE_EDITS_MISSING`, `CANDIDATE_EDIT_KIND_INVALID`, `CANDIDATE_EDIT_SPAN_INVALID`, `CANDIDATE_DUPLICATE_SPAN`, `CANDIDATE_OUT_OF_SCOPE_FILE`, `CANDIDATE_REPLACEMENT_CONTRACT_VIOLATION`
- **Host Binding (5)**: `HOST_BINDING_REPO_MEMBERSHIP_FAILED`, `HOST_BINDING_DIAGNOSIS_MEMBERSHIP_FAILED`, `HOST_BINDING_READ_FAILED`, `HOST_BINDING_LINE_SPAN_OUT_OF_BOUNDS`, `HOST_BINDING_ANCHOR_DERIVATION_FAILED`
- **Serialization (6)**: `SERIALIZATION_PATH_FAILED`, `SERIALIZATION_UNSUPPORTED_NEWLINE`, `SERIALIZATION_OVERLAPPING_EDITS`, `SERIALIZATION_PREIMAGE_MISMATCH`, `SERIALIZATION_ANCHOR_MISMATCH`, `SERIALIZATION_BUDGET_EXCEEDED`
- **Static Gate (7)**: `GATE_EMPTY_PATCH`, `GATE_OUTSIDE_SCOPE`, `GATE_FORBIDDEN_PATH`, `GATE_FILE_BUDGET_EXCEEDED`, `GATE_HUNK_BUDGET_EXCEEDED`, `GATE_CHANGED_LINE_BUDGET_EXCEEDED`, `GATE_PATCH_APPLY_FAILED`
- **Verifier (4)**:
  - `VERIFIER_RECOVERY` (1): `VERIFIER_MALFORMED_SYNTAX`
  - `VERIFIER_CONTRACT` (3): `VERIFIER_SCHEMA_VERSION_MISMATCH`, `VERIFIER_BLINDED_ID_MISMATCH`, `VERIFIER_INVALID_SCORE`

---

## 5. Candidate Telemetry Data Structure (`a234_telemetry_v1.py`)

- `schema_version`: `"fulgor.candidate_telemetry.v1"`
- `slot_index`: Strictly bounded to K=3 positions (`0, 1, 2`).
- `candidate_id_hash`: SHA-256 hex digest (64 lowercase hex chars). Raw candidate IDs are never stored.
- **Allowed Failure Stages**: Restricted to candidate-level stages (`CANDIDATE_RECOVERY`, `CANDIDATE_INTENT`, `CANDIDATE_HOST_BINDING`, `CANDIDATE_SERIALIZATION`, `CANDIDATE_STATIC_GATE`, `VERIFIER_RECOVERY`, `VERIFIER_CONTRACT`).
- **Terminal Milestone Invariants**:
  - `CANDIDATE_RECOVERY`: `(False, False, False, False, False, False)`
  - `CANDIDATE_INTENT`: `(False, False, False, False, False, False)`
  - `CANDIDATE_HOST_BINDING`: `(True, False, False, False, False, False)`
  - `CANDIDATE_SERIALIZATION`: `(True, True, False, False, False, False)`
  - `CANDIDATE_STATIC_GATE`: `(True, True, True, True, False, False)`
  - `VERIFIER_RECOVERY`: `(True, True, True, True, True, True)`
  - `VERIFIER_CONTRACT`: `(True, True, True, True, True, True)`
- **Forward Monotonic Invariants**: `H => I`, `S => H`, `G => S`, `A => G`, `V => A` enforced in all states.
- **Deterministic Serialization**: `to_json()` uses `sort_keys=True` and compact separators `(',', ':')`.

---

## 6. Verification & Unit Tests

All 24 deterministic CPU unit tests pass cleanly:

```
python -m unittest training/fulgor_ray_v3/tests/test_a234_contracts_v7.py training/fulgor_ray_v3/tests/test_a234_telemetry_v1.py
........................
Ran 24 tests in 0.035s
OK
```

### Direct Adversarial Probes:
- `PASS`: `CANDIDATE_HOST_BINDING + VERIFIER_INVALID_SCORE` rejected
- `PASS`: `CANDIDATE_INTENT failure + host_bound=true` rejected
- `PASS`: `VERIFIER_CONTRACT failure + verifier_invoked=false` rejected
- `PASS`: `PRIMARY_SELECTION as CandidateTelemetryV1 failure_stage` rejected
- `PASS`: `GATE_BUDGET_EXCEEDED retired broad subcode` rejected

---

## 7. Created Files and Cryptographic Hashes

| File | SHA-256 | Purpose |
|---|---|---|
| `training/fulgor_ray_v3/a234_contracts_v7.py` | `013dfaa55a6c126fdab907ea8a54a5e92b14265da77b1fa6d3f6d282b64a7d90` | Additive V7 contract exceptions, stage/subcode mapping and validator |
| `training/fulgor_ray_v3/a234_telemetry_v1.py` | `8d230121ce32b686389bfaef50eaf4a050ebed08ddf83545b0319c87108e2f64` | CandidateTelemetryV1 with milestone and stage-scope invariants |
| `training/fulgor_ray_v3/tests/test_a234_contracts_v7.py` | `af22161606ff5bd30eb7bb4ef81662dd3c5d63e95fb29d447df26d1ef441fcdd` | Unit tests for taxonomy, stage-subcode compatibility, diagnostics policy |
| `training/fulgor_ray_v3/tests/test_a234_telemetry_v1.py` | `89cd1fc93be5ee9366fb5266b244959dd7a0c6e48ad720dcd0781109d67468d9` | Unit tests for telemetry dataclass, milestone contradictions, scoping |
| `training/reports/fulgor_ray_v3_0_a234_r1_safe_observability_implementation.json` | Exposed in terminal summary | Machine-readable implementation audit report |
| `training/reports/fulgor_ray_v3_0_a234_r1_safe_observability_implementation.md` | Canonical markdown report | Human-readable canonical implementation report |

---

## 8. Authorization & Safety Flags

```
PHASE_R1_SAFE_OBSERVABILITY_AUTHORIZED=true
PHASE_R2_SYNTHETIC_CONTRACT_HARDENING_AUTHORIZED=false
PHASE_R3_ADDITIVE_V7_IMPLEMENTATION_AUTHORIZED=false
PHASE_R4_FRESH_HELDOUT_PREP_AUTHORIZED=false
PHASE_R5_FRESH_HELDOUT_EXECUTION_AUTHORIZED=false
CANONICAL_DEV30_REUSE_AUTHORIZED=false
V6_RERUN_AUTHORIZED=false

V6_RERUN_EXECUTED=false
A4_EXECUTED=false
GPU_USED=false
GCP_USED=false
SSH_USED=false
NETWORK_USED=false
MODEL_INFERENCE_USED=false
TRAINING_STARTED=false
PROTECTED_DEV30_SEMANTIC_OUTPUT_REVIEWED=false
SEALED_V1_V6_SOURCE_MODIFIED=false
PHASE_R2_STARTED=false
PHASE_R3_STARTED=false
PHASE_R4_STARTED=false
PHASE_R5_STARTED=false
COMMIT_CREATED=false
PUSH_PERFORMED=false
```
