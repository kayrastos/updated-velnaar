# Fulgor Ray V3 A234 Pre-A3 Failure Root Cause Forensic Audit (Corrected Evidence Edition)

## 1. Executive Summary & Evidence Boundaries

- **Status**: `PASS_PRE_A3_ROOT_CAUSE_AUDIT`
- **Canonical Checkpoint**: Commit `e3190887ee4bae02e952f39b5e8834693c65d8d8` on branch `fulgor/a234-v6-handoff-20260906`
- **Source Recovery Manifest**: `training/reports/fulgor_ray_v3_0_a234_execution_source_recovery_manifest.json` (`PASS_A234_EXECUTION_SOURCE_RECOVERY`)
- **Sealed Results Dataset SHA256**: `29e5935280052513a7bdb2c6203c76591f47c5e8ec9116adff5a6e6849670747`
- **Post-Run Final Seal SHA256**: `c2f2273b3ce438d73ef3c4f0ec4ae93fa2b2bfb19b145ff6974c0c0914d243a9`
- **Operating Boundaries**: LOCAL WINDOWS ONLY. Zero model inference, zero GPU, zero network/SSH/GCP, zero modification to production code or recovered source modules, zero git commit/push, and **zero inspection of protected DEV30 semantic outputs**.

### Three-Level Evidence Separation Framework
To ensure forensic rigor, every conclusion in this audit is categorized into one of three distinct evidentiary levels:
1. **Level A: `OBSERVED_AGGREGATE_FACT`**: Aggregate counts and statuses documented in sealed pre-audit reports and receipts without exposing protected semantic content.
2. **Level B: `CODE_REACHABLE_REJECTION_CONDITION`**: Specific programmatic branch conditions verified by static code analysis of the canonical V6 runtime source.
3. **Level C: `OBSERVED_SUBCAUSE_PROVEN`**: A conclusion claiming that a specific Level B condition directly caused a Level A count. **Level B conditions are never asserted as Level C facts without non-semantic proof.** Where proof is absent, `OBSERVED_SUBCAUSE_PROVEN = false`.

---

## 2. Critical Contradiction: Candidate-Level A234ContractError Provenance

The authoritative sealed pre-audit reports record:
- **Gate-Accepted Candidates**: `0 / 27`
- **A3 Verifier Invocations**: `0 / 27`
- **Candidate-Level A234ContractError Outcomes**: `17`

### Code Reachability Analysis
Static audit of `run_fulgor_v3_0_a234_dev30_inference_v6.py:process_candidates_v6` reveals a fundamental reachability contradiction:
1. The budget check `if len(raw_by_slot) != CANDIDATE_BUDGET:` raises `A234ContractError` **outside** the per-candidate try-except loop.
2. Inside the per-candidate try-except loop:
   - `parse_semantic_patch_intent` raises `SemanticIntentError`, not `A234ContractError`.
   - `bind_candidate_intent_to_host_patch` raises subclasses of `CandidateHostBindingError` (`CandidateFileMembershipError`, `CandidateLineSpanError`, `CandidateAnchorDerivationError`). `SemanticEdit` and `SemanticPatchV1` post-init checks raise `schemas.ContractError`, not `a234_inference.A234ContractError`.
   - `serialize` raises `SerializationError`, not `A234ContractError`.
   - `evaluate` returns a `GateResult` and does not raise `A234ContractError`.
   - The only site inside `process_candidates_v6` that raises `A234ContractError` is `parse_verifier`, which is strictly enclosed within:
     ```python
     if gate.accepted:
         score = parse_verifier(verify_generate(...))
     ```
3. Because `gate.accepted == 0` across all 27 candidates, the verifier block was **never executed**.

### Reconciliation & Audit Limitation
Without opening `results.jsonl` or inspecting protected semantic fields (strictly forbidden by data governance), this contradiction cannot be reconciled from canonical V6 source code.
Therefore, this audit records:
**`CANDIDATE_A234_CONTRACT_ERROR_COUNT_PROVENANCE = UNRESOLVED_OR_INCONSISTENT_WITH_V6_REACHABILITY`**
This represents an explicit audit limitation and unresolved telemetry anomaly. The count 17 is preserved as an aggregate historical report metric, but is **not** asserted as a code-proven V6 causal mechanism.

---

## 3. Authoritative Aggregate Execution Facts (Level A)

```
Total DEV30 Result Records:                         30
Failed at Pre-Candidate Stages:                     21 (70.0%)
Reached Candidate Attempt Processing:                9 (30.0%)
Total Candidate Slots Evaluated (K=3 per record):   27
Gate-Accepted Candidates:                            0 (0.0%)
A3 Verifier Invocations:                             0 (0.0%)
Primary Candidates Selected:                         0 (0.0% - all NoPrimary)
A4 Eligible Records:                                 0 (0.0%)
```

### Pre-Candidate Aggregate Failures (21 Records)
- `StructuredOutputRecoveryError`: 10
- `SemanticIntentError`: 6
- `A234ContractError`: 3
- `DiagnosisTargetMembershipError`: 2

### Candidate-Outcome Aggregate Failures (27 Slots across 9 Records)
- `A234ContractError`: 17 (Unresolved provenance / code-inconsistent)
- `CandidateAnchorDerivationError`: 4
- `CandidateLineSpanError`: 3
- `CandidateHostBindingError`: 3

---

## 4. Pipeline Progression Map

| Boundary ID | Pipeline Stage | Module / Function | Accepted Input Contract | Output Contract | Exceptions & Handling | Prevents A3? | Recovery Exists? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **B01** | Input Ingest | `run()` lines 410-413 | JSONL with exact keys: `instance_id`, `problem_statement`, `repository_root` | Row dicts (30 rows) | `RuntimeError`, `JSONDecodeError`; unhandled, aborts | Yes | No |
| **B02** | Context Prep | `LocalRepositoryProvider` | Valid local repo directory | Read-only provider; file list (max 4000) | `A1ContractError`; caught at record level (line 522) | Yes | No |
| **B03** | Diagnosis Gen | `_generate()` | Prompt, reserve 1024 tokens, budget 8192 | Raw string + metadata | `RuntimeError`; caught at record level (line 522) | Yes | No |
| **B04** | Diagnosis Recovery | `normalize_single_json_object` -> `parse_diagnosis` | Raw string matching `fulgor.diagnosis.v1` (8 keys, 1-3 targets, symbols) | `DiagnosisV1` instance | `StructuredOutputRecoveryError`, `A234ContractError`; caught at record level | Yes | Yes (markdown fence extraction only) |
| **B05** | Closed-World Inventory | `run()` lines 444-449 | `diagnosis.target_files` in `repo_files_set` | Validated target files | `DiagnosisTargetMembershipError`; caught at record level | Yes | No |
| **B06** | Plan Gen | `_generate()` | Problem, diagnosis dict, diagnosis hash, target files, reserve 1024 | Raw string + metadata | `RuntimeError`; caught at record level (line 522) | Yes | No |
| **B07** | Plan Recovery | `normalize_single_json_object` -> `parse_plan` | Raw string matching `fulgor.repair_plan.v1` (lineage hash, 1..N steps, constraints) | `RepairPlanV1` instance | `StructuredOutputRecoveryError`, `A234ContractError`; caught at record level | Yes | Yes (markdown fence extraction only) |
| **B08** | Candidate Gen & Intent Parse | `_generate()` -> `parse_semantic_patch_intent` | Problem, diagnosis, plan, slot directive; reserve 2048; `fulgor.semantic_patch_intent.v2` | `SemanticPatchIntentV2` instance | `StructuredOutputRecoveryError`, `SemanticIntentError`, `A234ContractError`; **caught at record level** | Yes | Yes (markdown fence extraction only) |
| **B09** | Host Binding | `bind_candidate_intent_to_host_patch` | `SemanticPatchIntentV2`, repo root, repo files, target files | `SemanticPatchV1` with host-derived preimage & anchors | `CandidateFileMembershipError`, `CandidateLineSpanError`, `CandidateAnchorDerivationError`, `CandidateHostBindingError`; caught per slot | Yes | No |
| **B10** | Serialization | `serialize()` | Host-bound `SemanticPatchV1`, repo root | `SerializedPatchV1` with diff & `DiffStats` | `SerializationError`; caught per slot | Yes | No |
| **B11** | Static Gate | `evaluate()` | `SemanticPatchV1`, `SerializedPatchV1`, allowed files, dry run | `GateResult` (accepted, reason_codes) | Non-raising under contract | Yes (if not accepted) | No |
| **B12** | Verifier Eligibility | `process_candidates_v6` (line 385) | `gate.accepted == True` | `VerifierScoreV1` | Skipped if `gate.accepted` is False | Yes | No |
| **B13** | Primary Selection | `select_primary()` | Iterable of `SelectableCandidate` | Best candidate or `NoPrimary(('NO_GATE_SURVIVORS',))` | Non-raising; fails safe | Yes | No |
| **B14** | A4 Execution | `FeedbackController` | Primary selected candidate with gate acceptance & verifier score | `ExecutionResult` | Frozen / unexecuted | N/A | No |

---

## 5. Failure Class Analysis with Evidence-Level Separation

### 5.1 StructuredOutputRecoveryError
- **Level A (Observed Fact)**: 10 pre-candidate failures (33.3% of records).
- **Level B (Reachable Conditions)**:
  - Output is empty or whitespace only (`structured_output_recovery.py:40`).
  - Output contains generic markdown code fences (```` ``` ````) or uppercase tags (```` ```JSON ````).
  - Output contains conversational preamble before the opening fence or postamble after the closing fence.
  - Output contains multiple JSON objects or root array.
  - JSON syntax errors (trailing commas, single quotes, unescaped quotes).
- **Level C (`OBSERVED_SUBCAUSE_PROVEN`)**: `false`.
  Non-semantic telemetry does not record which specific condition caused each of the 10 failures.
- **Classification**: `RECOVERY_LAYER_LIMITATION` + `MODEL_OUTPUT_CONTRACT_NONCOMPLIANCE_POSSIBLE`.
- **Note on Prompt Alignment**: The prompt explicitly commands: *"7. NEVER emit markdown fences... 8. NEVER emit conversational prose... 5. NEVER emit trailing commas"*. The recovery layer enforces these rules. Rejections reflect model non-compliance with the common syntax contract, not a prompt/runtime contradiction.

### 5.2 SemanticIntentError
- **Level A (Observed Fact)**: 6 pre-candidate failures (20.0% of records).
- **Level B (Reachable Conditions)**:
  - Top-level keys != 8 expected schema keys.
  - Parent hash lineage mismatch (`diagnosis_hash` or `plan_hash`).
  - Edits list is missing or empty.
  - Edit keys != exact 5 keys (e.g. model emits `expected_preimage_sha256` or `anchor`, or omits `replacement_text`).
  - Insert convention violation (`end_line != start_line - 1`).
  - Replace/insert `replacement_text` missing trailing `
`.
  - Delete `replacement_text != ""`.
- **Level C (`OBSERVED_SUBCAUSE_PROVEN`)**: `false`.
- **Classification**: `CONTRACT_STRICTNESS` + `MODEL_OUTPUT_CONTRACT_NONCOMPLIANCE_POSSIBLE`.
- **Note on Prompt Alignment**: Prompt and parser are fully aligned on the 5-key schema, coordinate rules, and LF requirements. Failures represent model non-compliance with strict contract rules.

### 5.3 A234ContractError
- **Level A (Observed Fact)**: 20 failures total (3 pre-candidate, 17 candidate outcomes).
- **Level B (Reachable Conditions)**:
  - Pre-candidate: Diagnosis/plan schema version mismatch, diagnosis hash lineage mismatch, target count > 3, non-consecutive steps, missing preservation constraints.
  - Candidate outcomes: In V6 code, only `parse_verifier` raises `A234ContractError` in `process_candidates_v6`, but requires `gate.accepted == True`.
- **Level C (`OBSERVED_SUBCAUSE_PROVEN`)**: `false`.
- **Classification**: `CONTRACT_STRICTNESS` + `TELEMETRY_GRANULARITY_DEFICIT` + `UNRESOLVED_PROVENANCE`.
- **Provenance Assessment**: The 17 candidate outcome failures are code-inconsistent with V6 reachability under 0 gate accepts.

### 5.4 DiagnosisTargetMembershipError
- **Level A (Observed Fact)**: 2 pre-candidate failures.
- **Level B (Reachable Conditions)**: Target file in `diagnosis.target_files` does not exist in `repo_files_set`.
- **Level C (`OBSERVED_SUBCAUSE_PROVEN`)**: `true`.
  This error has a single raising site (`run()` line 447) with a single deterministic condition: LLM target path hallucination.
- **Classification**: `MODEL_OUTPUT_CONTRACT_NONCOMPLIANCE`.

### 5.5 CandidateAnchorDerivationError
- **Level A (Observed Fact)**: 4 candidate outcome failures.
- **Level B (Reachable Conditions)**: Neither the full preimage nor any individual line in the edit span is globally unique in the target file (`candidate_host_binding_v1.py:65`).
- **Level C (`OBSERVED_SUBCAUSE_PROVEN`)**: `true`.
  Single raising site with single condition: non-unique span content on repetitive code patterns.
- **Classification**: `SOURCE_COORDINATE_LIMITATION`. Deterministic and safety-preserving.

### 5.6 CandidateLineSpanError
- **Level A (Observed Fact)**: 3 candidate outcome failures.
- **Level B (Reachable Conditions)**:
  - Replace/delete: `end_line > n_lines` (coordinate exceeds file length).
  - Insert: `start_line > n_lines + 1` (insert position beyond EOF).
  - EOF insert on empty file (`n_lines == 0`).
  *(Note: `start_line < 1` is filtered upstream by `SemanticEditIntent` and cannot reach this site).*
- **Level C (`OBSERVED_SUBCAUSE_PROVEN`)**: `false`.
- **Classification**: `SOURCE_COORDINATE_LIMITATION`.

### 5.7 CandidateHostBindingError
- **Level A (Observed Fact)**: 3 candidate outcome failures.
- **Level B (Reachable Conditions)**:
  - Repository root is not a directory (`candidate_host_binding_v1.py:88`).
  - Wrapped `SerializationError` from `_read_repository_file`: unsafe path, path escaping repository, file not regular, UTF-8 decode failure, carriage returns (`
`), or missing trailing LF (`candidate_host_binding_v1.py:111`).
  *(Note: Candidate file membership failures raise `CandidateFileMembershipError`, not base `CandidateHostBindingError`).*
- **Level C (`OBSERVED_SUBCAUSE_PROVEN`)**: `false`.
- **Classification**: `HOST_BINDING_LIMITATION` + `CONTRACT_STRICTNESS`.

---

## 6. Corrected Static-Gate Accounting

| Telemetry Statement | Evidentiary Status | Rationale |
| :--- | :---: | :--- |
| **Gate-Accepted Candidates = 0 / 27** | `PROVEN` | Authoritative aggregate fact from sealed postrun and pre-audit reports. |
| **A3 Verifier Invocations = 0 / 27** | `PROVEN` | Verifier invocation is gated on `gate.accepted`; 0 invocations recorded. |
| **Primary Candidates Selected = 0 / 9** | `PROVEN` | All 9 candidate-producing instances emitted `NoPrimary`. |
| **Direct Static Gate Rejections = 0** | `SUPPORTED_BY_TELEMETRY` | No static gate rejection codes were recorded in telemetry. |
| **Candidates Reaching Static Gate = 0** | `SUPPORTED_BY_TELEMETRY_BUT_BLOCKED_FROM_PROVEN_DUE_TO_A234_INCONSISTENCY` | Under the assumption that all 27 candidate attempts failed in upstream stages, 0 reached the gate. However, because the 17 `A234ContractError` outcomes cannot be reconciled with V6 reachability, the exact stage at which those 17 candidates halted cannot be definitively proven. |

---

## 7. Corrected Ranked Root-Cause Taxonomy

| Rank | Root Cause ID | Severity | Confidence | Observed Failure Classes | Proven Count | Possible Count | Attribution Confidence | Description & Causal Mechanism |
| :---: | :--- | :---: | :---: | :--- | :---: | :---: | :---: | :--- |
| **1** | **RC1_CONTRACT_STRICTNESS_AND_TELEMETRY_COLLAPSE** | `BLOCKER` | `HIGH` | `A234ContractError` | `null` | 20 | `UNRESOLVED` | 3 pre-candidate errors proven reachable; 17 candidate outcomes code-inconsistent with V6. Telemetry collapses 24 subconditions. |
| **2** | **RC2_STRUCTURED_OUTPUT_RECOVERY_LIMITATION** | `BLOCKER` | `HIGH` | `StructuredOutputRecoveryError` | `null` | 10 | `MEDIUM` | 10 aggregate failures observed; exact envelope subcauses unproven without semantics. Fails closed on minor formatting deviations. |
| **3** | **RC3_MODEL_TO_HOST_COORDINATE_BINDING** | `HIGH` | `HIGH` | `SemanticIntentError`, `CandidateHostBindingError` | `null` | 9 | `MEDIUM` | Strict 5-key schema, coordinate rules, and LF requirements reachable; exact subcondition distribution unproven. |
| **4** | **RC4_ANCHOR_DERIVATION_BRITTLENESS** | `HIGH` | `HIGH` | `CandidateAnchorDerivationError` | 4 | 4 | `HIGH` | Two-tier anchor derivation fails closed on repetitive code blocks, boilerplate, and common language patterns. |
| **5** | **RC5_LINE_SPAN_COORDINATE_BOUNDS** | `HIGH` | `HIGH` | `CandidateLineSpanError` | `null` | 3 | `MEDIUM` | `start_line < 1` filtered upstream; coordinates exceeding repository file length is the primary reachable cause. |
| **6** | **RC6_TELEMETRY_GRANULARITY_DEFICIT** | `HIGH` | `HIGH` | `A234ContractError`, All Candidate Outcomes | `null` | 27 | `HIGH` | Runner captures only `type(exc).__name__` and drops candidate error messages, masking failure subcauses. |
| **7** | **RC7_TARGET_MEMBERSHIP_HALLUCINATION** | `MEDIUM` | `HIGH` | `DiagnosisTargetMembershipError` | 2 | 2 | `HIGH` | Single unambiguous raising site: LLM generated target file paths outside repository inventory. |
| **8** | **RC8_RUNNER_RECORD_LEVEL_CANDIDATE_ABORTION** | `HIGH` | `HIGH` | `SemanticIntentError` | `null` | 6 | `HIGH` | Unhandled parsing exception in candidate slot A inside the record-level loop aborts entire DEV30 instance. |

---

## 8. Why A3 Never Ran: Causal Chain

1. **Proximate Cause**: In `run_fulgor_v3_0_a234_dev30_inference_v6.py:385`, A3 verifier generation is strictly guarded by `if gate.accepted:`. Because exactly 0 out of 27 candidate attempts achieved gate acceptance, `verify_generate` was never invoked.
2. **Upstream Causes**:
   - 21/30 records aborted at pre-candidate stages (10 recovery, 6 intent, 3 contract, 2 target membership).
   - In the 9 records that reached candidate processing, 0 candidates achieved gate acceptance.
   - Primary selection safely returned `NoPrimary(("NO_GATE_SURVIVORS",))`.

---

## 9. A4 Status & Eligibility

- **`A4_EXECUTION_GO_NO_GO = NO_GO_A4_EXECUTION_ON_SEALED_V6`** (Strictly Preserved).
- A4 feedback refinement requires a primary candidate with valid test execution telemetry. It cannot rescue pre-A3 generation or gating failures without violating phase boundaries.
- `feedback_iteration_budget = 1` remains a future architecture capability.

---

## 10. Remediation Design Boundary & Future Evaluation Policy

- **`REMEDIATION_DESIGN_ELIGIBLE = true`**
- **`REMEDIATION_IMPLEMENTATION_AUTHORIZED = false`**
- **`CANONICAL_DEV30_REUSE_AUTHORIZED = false`**
- **`FRESH_HELDOUT_REQUIRED_AFTER_REMEDIATION = true`**
- **`V6_RERUN_AUTHORIZED = false`**
- **`A4_EXECUTED = false`**

Canonical DEV30 is permanently consumed. Future validation requires an independently sampled, fresh held-out evaluation dataset.

---

## 11. Final Classification & Verbatim Safety Flags

- **`ROOT_CAUSE_AUDIT_STATUS`**: `PASS_PRE_A3_ROOT_CAUSE_AUDIT`
- **`REMEDIATION_DESIGN_ELIGIBLE`**: `true`
- **`REMEDIATION_IMPLEMENTATION_AUTHORIZED`**: `false`
- **`FRESH_HELDOUT_REQUIRED_AFTER_REMEDIATION`**: `true`
- **`CANONICAL_DEV30_REUSE_AUTHORIZED`**: `false`
- **`V6_RERUN_AUTHORIZED`**: `false`
- **`A4_EXECUTED`**: `false`

```text
V6_RERUN_AUTHORIZED=false
V6_RERUN_EXECUTED=false
A4_EXECUTED=false
CANONICAL_DEV30_REUSE_AUTHORIZED=false
GPU_USED=false
GCP_USED=false
SSH_USED=false
NETWORK_USED=false
MODEL_INFERENCE_USED=false
TRAINING_STARTED=false
PROTECTED_DEV30_SEMANTIC_OUTPUT_REVIEWED=false
PRODUCTION_CODE_MODIFIED=false
RECOVERED_RUNTIME_SOURCE_MODIFIED=false
REMEDIATION_IMPLEMENTED=false
COMMIT_CREATED=false
PUSH_PERFORMED=false
```
