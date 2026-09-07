# Fulgor Ray V3 A234 — A4 Sealed-Input Consumer Pre-Audit Report

## 1. Executive Summary & Verification Authority

This report documents the architectural, static, and cryptographic pre-audit for the prospective **A4 Feedback Refinement Phase** of the Fulgor Ray V3 evaluation pipeline.

- **Pre-Audit Status**: `PASS_A234_A4_PREAUDIT` (The static pre-audit completed successfully and established the authoritative architectural state).
- **A4 Execution Decision**: **`NO_GO_A4_EXECUTION_ON_SEALED_V6`** (Execution preconditions are NOT met).
- **Pipeline Progression Classification**: **`A2_OR_PRE_A3_PIPELINE_PROGRESSION_FAILURE`**.
- **Canonical Start HEAD**: Commit `fb03348147676098c7a0d2eb9e1505d148693d58` on branch `fulgor/a234-v6-handoff-20260906`.
- **Authoritative Input Results SHA256**: `29e5935280052513a7bdb2c6203c76591f47c5e8ec9116adff5a6e6849670747`.
- **Authoritative Post-Run Final Seal SHA256**: `c2f2273b3ce438d73ef3c4f0ec4ae93fa2b2bfb19b145ff6974c0c0914d243a9`.
- **Audit Scope**: STATIC ARCHITECTURAL AUDIT & CONSUMER SPECIFICATION ONLY. Zero model evaluation, zero GPU utilization, zero inference.

---

## 2. Observed Structural Pipeline Facts

Without exposing or inspecting protected DEV30 semantic contents (prompts, answers, patches, reasoning, or vulnerability details), static analysis of the sealed V6 DEV30 dataset (`results.jsonl`, 30 records) established the following authoritative structural facts:

- **Total DEV30 Result Records**: 30 valid JSON lines (SHA256: `29e5935280052513a7bdb2c6203c76591f47c5e8ec9116adff5a6e6849670747`).
- **Pre-Candidate Pipeline Failures (21 instances)**:
  - 10 `StructuredOutputRecoveryError`
  - 6 `SemanticIntentError`
  - 3 `A234ContractError`
  - 2 `DiagnosisTargetMembershipError`
- **Candidate Processing Attempts (9 instances, 27 candidate attempts)**:
  - Exactly 9 instances progressed through diagnosis and plan to emit K=3 candidate attempts.
  - Across all 27 candidate attempts, **0 candidates passed static host-binding and gating**:
    - 17 `A234ContractError`
    - 4 `CandidateAnchorDerivationError`
    - 3 `CandidateLineSpanError`
    - 3 `CandidateHostBindingError`
- **Gate-Accepted Candidates**: `0 / 27` (`gate_accepted_candidate_count = 0`).
- **A3 Verifier Invocations**: `0 / 27` (`a3_verifier_invocation_count = 0`). Because verifier execution was gated on `gate.accepted == True`, the verifier model was never invoked.
- **Verifier Scores Present**: `0 / 27` (all candidate outcomes record `score = None`).
- **Primary Candidates Selected**: `0 / 9` (`primary_selection_count = 0`). All 9 candidate-producing instances terminated as `NoPrimary`.
- **A4-Eligible Records**: **`0 / 30`** (`a4_eligible_record_count = 0`).

---

## 3. Pipeline Progression Classification & Root Interpretation

### 3.1 Classification: `A2_OR_PRE_A3_PIPELINE_PROGRESSION_FAILURE`
The execution of V6 DEV30 completed structurally with wrapper exit code 0, 30 valid JSON records, and durable marker recording. However, **no record reached the A3 accepted-candidate verifier path**.

### 3.2 Root Interpretation (A4 Did Not Fail):
- This outcome is **NOT an A4 failure**. A4 never ran.
- A4 is designed strictly as a bounded feedback refinement following an A3 blinded verifier evaluation.
- Running "A4" directly against gate-rejected V6 candidates would effectively attempt to regenerate or repair A2 candidate generation under the A4 label, which would violate the intended `A2 -> A3 -> A4` phase separation.
- **Quality Claim Boundary**: Do NOT infer general model capability or patch correctness from this structural failure. Those questions belong only after an authorized, eligible evaluation pipeline executes.

---

## 4. Formal Blockers to A4 Execution on Sealed V6

Actual execution of A4 on the sealed V6 dataset is blocked by four hard preconditions:

1. **`NO_GATE_ACCEPTED_V6_CANDIDATE`**:
   Zero candidate intents passed static host gating (0/27 accepted).
2. **`NO_A3_VERIFIER_JUDGMENT`**:
   Zero A3 verifier scores exist in the sealed dataset (0 verifier calls made).
3. **`NO_A4_ELIGIBLE_V6_RECORD`**:
   Zero records satisfy the mandatory A4 entry precondition (accepted candidate + verifier judgment + requested refinement).
4. **`A4_RUNTIME_NOT_IMPLEMENTED`**:
   No A4 runner or feedback execution loop exists in the codebase (intentionally decoupled from V6).

**Decision**: **`NO_GO_A4_EXECUTION_ON_SEALED_V6`**.

---

## 5. Evaluation Contamination & Held-Out Data Governance

- **Canonical DEV30 Reuse Prohibited**:
  - `CANONICAL_DEV30_REUSE_AUTHORIZED = false`.
  - The canonical DEV30 dataset has now exposed aggregate structural pipeline failure modes. Hand-crafting repairs against DEV30 would compromise its validity as a benchmark.
- **Remediation Methodology**:
  - All bug fixes and contract adjustments must be engineered using source-code contract analysis, unit tests, schema validators, static gate tests, and dedicated non-DEV30 synthetic fixtures.
- **Fresh Held-Out Evaluation Set Required**:
  - Once the upstream pre-A3 issues are resolved, the pipeline must NOT be re-evaluated on DEV30.
  - A fresh, independently sealed held-out dataset with a new input hash, distinct instance IDs, and independent one-shot cryptographic sealing is mandatory (`fresh_heldout_required_after_remediation = true`).

---

## 6. Recommended Next Engineering Phase

The recommended next phase is **NOT** A4 implementation or execution.

**Recommended Next Phase**: **`LOCAL_ONLY_PRE_A3_FAILURE_ROOT_CAUSE_AUDIT`**

### Recommended Scope:
A dedicated, local-only architectural and unit-test forensic analysis of the 7 observed failure classes:
1. `StructuredOutputRecoveryError` (10 instances): Root JSON closure framing and multi-object extraction.
2. `SemanticIntentError` (6 instances): Coordinate extraction and line-number validation.
3. `A234ContractError` (17 candidate + 3 stage errors): Schema contract enforcement.
4. `DiagnosisTargetMembershipError` (2 instances): Closed-world inventory mapping.
5. `CandidateAnchorDerivationError` (4 instances): Unique anchor derivation from repository bytes.
6. `CandidateLineSpanError` (3 instances): Line count bounds checking.
7. `CandidateHostBindingError` (3 instances): Mapping intents to `SemanticPatchV1`.

*Note: This audit must reproduce and falsify these failure modes using code inspection and synthetic fixtures only, with zero exposure of protected DEV30 semantic contents.*
