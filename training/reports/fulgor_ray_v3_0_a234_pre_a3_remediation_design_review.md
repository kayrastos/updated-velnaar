# Fulgor Ray V3 A234 Pre-A3 Remediation Design Architecture & Safety Review (Corrected Edition)

## 1. Executive Summary & Review Authority

- **Review Status**: `PASS_PRE_A3_REMEDIATION_DESIGN_REVIEW`
- **Canonical Checkpoint**: Commit `b2a3d878d31b3353d32b0eb9f59bbf488182adcb` on branch `fulgor/a234-v6-handoff-20260906`
- **Reviewed Plan**: `docs/fulgor_ray_v3_a234_pre_a3_remediation_plan.md`
- **Reviewed Audit Artifacts**:
  - `training/reports/fulgor_ray_v3_0_a234_pre_a3_root_cause_audit.json`
  - `training/reports/fulgor_ray_v3_0_a234_pre_a3_root_cause_audit.md`
- **Governing Invariants**:
  - **`REMEDIATION_IMPLEMENTATION_AUTHORIZED = false`**
  - **`FRESH_HELDOUT_EXECUTION_AUTHORIZED = false`**
  - **`CANONICAL_DEV30_REUSE_AUTHORIZED = false`**
  - **`V6_RERUN_AUTHORIZED = false`**
  - **`PROTECTED_DEV30_SEMANTIC_OUTPUT_REVIEWED = false`**
  - **LOCAL WINDOWS ONLY**: Zero GPU, zero GCP, zero SSH, zero network, zero model loading.

This corrected architectural review evaluates all remediation proposals (REM01–REM06), strictly enforces additive versioning to preserve sealed V1–V6 source files, rejects all non-deterministic or fuzzy sub-behaviors, and establishes a rigorous synthetic test gate prior to future implementation.

---

## 2. Top-Level Review Classifications

| Item ID | Proposed Remediation Component | Review Classification | Key Rationale & Safety Boundary |
| :--- | :--- | :---: | :--- |
| **REM01** | Telemetry & Typed Exception Hierarchy | `SAFE_NOW` | Additive observability. Free-form `str(exc)` logging is strictly **REJECTED** to prevent semantic leakage. Additive versioned types mandated; zero mutation of sealed files. |
| **REM02** | Structured Output Recovery Robustness | `NEEDS_SYNTHETIC_PROOF` | Multi-fence normalization requires synthetic proof. Leading/trailing prose, balanced brace scanning from mixed text, multi-object selection, truncation completion, and fuzzy repair are strictly **REJECTED**. |
| **REM03** | Runner Slot Fault Isolation | `NEEDS_SYNTHETIC_PROOF` | Changes pipeline control flow. Must be proven by deterministic synthetic tests across all slot failure combinations before deployment. |
| **REM04** | Context-Expanded Anchor Derivation | `NEEDS_SYNTHETIC_PROOF` | Mathematically sound and deterministic, but requires synthetic verification across BOF, EOF, duplicate functions, and whitespace lines. |
| **REM05** | Coordinate & Insertion Alignment | `NEEDS_SYNTHETIC_PROOF` | Intuitive insert conventions and LF normalization eliminate friction. Missing replacement text and coordinate offset guessing are strictly **REJECTED**. Requires versioned schema V3. |
| **REM06** | Fresh Held-Out Evaluation Protocol | `FRESH_HELDOUT_ONLY` | Canonical DEV30 is permanently sealed. Preflight inspection, dataset-neutral runner, and cryptographic receipt gating are mandated prior to execution. |

---

## 3. Comprehensive Rejected Sub-Behaviors List

The following proposed sub-behaviors are strictly **`REJECTED`** to maintain fail-closed safety, determinism, and data governance:

1. **REM01 — Raw `str(exc)` Free-Form Logging**: **`REJECT`**
   - *Reason*: Exception messages frequently contain source snippets, replacement code lines, internal repo paths, and model reasoning. Emitting unredacted exception text into versioned reports leaks protected benchmark content. Machine-readable subcodes and redacted property names must be used.
2. **REM02-E — Leading Conversational Prose Extraction**: **`REJECT`**
   - *Reason*: The host must not extract semantic payloads from arbitrary conversational text. Braces in prose or comments create parsing ambiguity. Recovery remains envelope normalization, not semantic object selection.
3. **REM02-F — Trailing Conversational Prose Extraction**: **`REJECT`**
   - *Reason*: Unbounded trailing text creates ambiguity and risks parsing non-canonical content. Fail closed preserves safety.
4. **REM02-G — First/Outermost Balanced `{...}` Extraction from Mixed Prose**: **`REJECT`**
   - *Reason*: Balanced-brace scanning is vulnerable to braces inside JSON string literals, escaped quotes (`\"`), nested objects, and code in `replacement_text`. Strict schema parsing after extraction does not prove selection was unambiguous.
5. **REM02-H — Multiple JSON Objects Selection**: **`REJECT`**
   - *Reason*: Silently selecting among multiple objects requires non-deterministic heuristic or semantic guessing.
6. **REM02-I — Truncated JSON Completion**: **`REJECT`**
   - *Reason*: Automatically appending closing brackets or braces to incomplete outputs attempts to guess truncated model intent, generating hallucinated or corrupt patches.
7. **REM02-J — Fuzzy Malformed JSON Repair**: **`REJECT`**
   - *Reason*: Inserting missing commas or unescaping quotes introduces heuristic non-determinism and false-accept risks.
8. **REM05-F — Missing `replacement_text` on Delete -> Empty String**: **`REJECT`**
   - *Reason*: A missing required property is not an unambiguous representation. The host must not invent missing model intent.
9. **REM05-G — 0-Based / 1-Based Coordinate Guessing or Offset Correction**: **`REJECT`**
   - *Reason*: Fuzzy coordinate guessing risks shifting edits by 1 line, causing silent semantic repository corruption. The model must emit valid 1-based coordinates.

---

## 4. Deep-Dive Item Evaluations

### 4.1 REM01 — Telemetry & Exception Hierarchy (`SAFE_NOW`)
- **Strict Additive Implementation Rule**:
  REM01 **MUST NOT** modify `training/fulgor_ray_v3/a234_inference.py`, `run_fulgor_v3_0_a234_dev30_inference_v6.py`, or any existing sealed V1–V6 source files. Existing `CandidateOutcome` and `A234ContractError` definitions remain byte-identical.
- **Additive Modules**:
  Future implementation must introduce additive versioned modules:
  - `training/fulgor_ray_v3/a234_contracts_v7.py` (Typed exception classes with explicit subcodes).
  - `training/fulgor_ray_v3/a234_telemetry_v1.py` (Structured telemetry recording and stage reachability flags).
- **Persistent Telemetry Standards**:
  Persistent telemetry must record:
  1. Stable stage code.
  2. Stable failure subcode (e.g. `CONTRACT_PLAN_HASH_MISMATCH`, `SPAN_OUT_OF_BOUNDS`).
  3. Slot index (0, 1, 2).
  4. Candidate ID / hash-safe identifier.
  5. Booleans for stage progression (`intent_parsed`, `host_bound`, `serialized`, `gate_evaluated`, `gate_accepted`, `verifier_invoked`).
  6. Bounded numeric structural diagnostics.
- **Prohibition on Raw Text**:
  Do **NOT** persist raw `str(exc)` by default. Do **NOT** persist source snippets, model reasoning, replacement code, anchors, full repository paths, or protected semantic text.

---

### 4.2 REM02 — Structured Output Recovery (`NEEDS_SYNTHETIC_PROOF`)
Independent evaluation of recovery sub-behaviors:

| Sub-Behavior | Review Classification | Technical & Safety Assessment |
| :--- | :---: | :--- |
| **A. Plain exact single JSON object** | `SAFE_NOW` | Outer whitespace trimming is completely safe. |
| **B. Exact lowercase ```json single fence** | `SAFE_NOW` | Existing conservative V6 behavior. |
| **C. Exact case-insensitive JSON fence** | `NEEDS_SYNTHETIC_PROOF` | Requires synthetic proof that casing variations parse unambiguously. |
| **D. Exact generic single code fence** | `NEEDS_SYNTHETIC_PROOF` | Requires synthetic proof that single untagged code fence containing exactly one JSON object parses cleanly. |
| **E. Leading conversational prose** | **`REJECT`** | Host must not extract from arbitrary prose. |
| **F. Trailing conversational prose** | **`REJECT`** | Host must not ignore trailing text. |
| **G. First/outermost balanced brace extraction** | **`REJECT`** | Brace scanning is vulnerable to braces in strings, escaped quotes, and nested code. |
| **H. Multiple JSON objects** | **`REJECT`** | Selecting among multiple objects requires non-deterministic guessing. |
| **I. Truncated JSON completion** | **`REJECT`** | Guessing missing braces on truncated output produces corrupt patches. |
| **J. Fuzzy syntax repair** | **`REJECT`** | Heuristic syntax repair introduces false accepts. |

---

### 4.3 REM03 — Runner Slot Fault Isolation (`NEEDS_SYNTHETIC_PROOF`)
- **Classification Correction**: Reclassified from `SAFE_NOW` to **`NEEDS_SYNTHETIC_PROOF`**.
- **Rationale**:
  Slot fault isolation changes real pipeline control flow. In V6, candidate parsing occurs in the record-level loop; an error in slot A aborts the instance before slots B and C run. In V7, all fixed K=3 slot identities remain present and independently progress or fail.
- **Required Synthetic Test Verification**:
  Must be proven by deterministic synthetic tests covering:
  - slot A invalid, B/C valid
  - slot B invalid
  - slot C invalid
  - all slots invalid
  - stable candidate IDs across runs
  - stable diversity directives
  - exactly bounded generation count
  - invalid slot never selectable
  - valid slot can still reach host binding/gate
  - verifier only invoked for gate-accepted valid slot
  - selector cannot confuse missing slot with valid candidate
  - all three slot positions preserved in telemetry.

---

### 4.4 REM04 — Context-Expanded Anchor Derivation (`NEEDS_SYNTHETIC_PROOF`)
- **Safety Boundary Requirements**:
  1. **Edit Coordinates Unchanged**: `start_line` and `end_line` remain strictly bound to the actual modified span.
  2. **Preimage Hash Unchanged**: `expected_preimage_sha256` is computed strictly from the validated edit span lines.
  3. **Anchor Uniqueness**: The anchor used by `_validate_anchor` is expanded symmetrically with `w = 1, 2, 3` surrounding lines of immutable repository text until `text.count(expanded_anchor) == 1`.
  4. **Fail-Closed Limit**: If uniqueness cannot be achieved within `w <= 3` lines, derivation fails closed with `CandidateAnchorDerivationError`.
- **Tricky Edge Cases Requiring Synthetic Proof**:
  - **BOF**: Clamping expansion when `start_idx - w < 0`.
  - **EOF**: Clamping expansion when `stop_idx + w > n_lines`.
  - **Repeated Blocks**: Files containing duplicate functions where even `w=3` context is ambiguous must fail closed.
  - **Whitespace Lines**: Adding blank lines (`
`) must not create false uniqueness illusions.

---

### 4.5 REM05 — Coordinate & Insertion Alignment (`NEEDS_SYNTHETIC_PROOF`)
Independent evaluation of normalization components:

| Normalization Component | Review Classification | Technical Rationale |
| :--- | :---: | :--- |
| **A. Insert `end_line == start_line`** | `NEEDS_SYNTHETIC_PROOF` | New explicit insert convention representing zero-width insertion point before line L. |
| **B. Preserve `end_line == start_line - 1`** | `SAFE_NOW` | Preserved as backward-compatible behavior in the new versioned parser. |
| **C. Support both insert conventions** | `NEEDS_SYNTHETIC_PROOF` | Only if both map deterministically to the same unambiguous insertion location. |
| **D. Host-side trailing LF append** | `NEEDS_SYNTHETIC_PROOF` | Append exactly one LF to non-empty replace/insert; must record `trailing_lf_normalized=true` in provenance and never rewrite content. |
| **E. Delete `null` -> `""`** | `NEEDS_SYNTHETIC_PROOF` | Only in new explicit V3 schema where `null` is documented as an accepted delete representation. |
| **F. Missing replacement text -> `""`** | **`REJECT`** | Missing required field is ambiguous; host must not invent intent. |
| **G. Coordinate offset guessing** | **`REJECT`** | Fuzzy 0-based/1-based guessing risks shifting edits by 1 line, corrupting repository code. |

**Versioning Requirement**: Existing `semantic_patch_intent_v2.py` must remain frozen. This capability requires a new versioned schema: `fulgor.semantic_patch_intent.v3` in `semantic_patch_intent_v3.py`.

---

### 4.6 REM06 — Fresh Held-Out Evaluation Policy (`FRESH_HELDOUT_ONLY`)
- **Evaluation**: Canonical DEV30 is permanently consumed and contaminated by aggregate observation.
- **Invariants**:
  - `CANONICAL_DEV30_REUSE_AUTHORIZED = false`
  - `V6_RERUN_AUTHORIZED = false`
  - `FRESH_HELDOUT_EXECUTION_AUTHORIZED = false`
- **Dataset-Independent V7 Runner Naming**:
  The recommendation `run_fulgor_v3_0_a234_dev30_inference_v7.py` is **REMOVED**.
  The runner must be dataset-neutral:
  **`run_fulgor_v3_0_a234_inference_v7.py`**
  The runner must receive a separately sealed evaluation manifest and dataset path rather than encode DEV30 in its filename.
- **Future Fresh-Heldout Bindings**:
  Future execution must bind: dataset SHA256, instance IDs, repository snapshot identity, model revision, adapter hash, runner hash, prompt hash, runtime dependency manifest, and launch receipt.

---

## 5. Additive Versioning Strategy

To guarantee that all existing V1–V6 sealed files remain 100% byte-identical, no existing file will be modified in place. Future remediation must follow strict additive file versioning:

```
training/fulgor_ray_v3/a234_contracts_v7.py
training/fulgor_ray_v3/a234_telemetry_v1.py
training/fulgor_ray_v3/stage_contract_prompts_v5.py
training/fulgor_ray_v3/structured_output_recovery_v2.py
training/fulgor_ray_v3/semantic_patch_intent_v3.py
training/fulgor_ray_v3/candidate_host_binding_v2.py
run_fulgor_v3_0_a234_inference_v7.py
```

### Versioned Schemas
- `fulgor.semantic_patch_intent.v3`
- `fulgor.a234_gpu_runner.v7`
- `fulgor.a234_launch_receipt.v7`

---

## 6. Required Synthetic Test Matrix Design

Before authorizing any future implementation, the following deterministic, CPU-only test matrix must be authored:

### Group 1: Structured Output Recovery V2
- `test_plain_object_without_fences`
- `test_lowercase_json_fence_with_newlines`
- `test_uppercase_json_fence`
- `test_generic_code_fence_without_tag`
- `test_string_containing_braces_and_escaped_quotes`
- `test_replacement_text_containing_code_braces`
- `test_rejection_of_multiple_top_level_objects` (Fail closed)
- `test_rejection_of_truncated_unclosed_json` (Fail closed)
- `test_rejection_of_trailing_comma_syntax_errors` (Fail closed)
- `test_rejection_of_leading_trailing_prose` (Fail closed)

### Group 2: Semantic Intent V3
- `test_valid_replace_exact_bounds`
- `test_insert_convention_end_equals_start`
- `test_insert_convention_end_equals_start_minus_one`
- `test_insert_before_first_line`
- `test_insert_middle_line`
- `test_insert_eof_position`
- `test_insert_empty_file_handling`
- `test_replacement_text_without_trailing_lf_normalized`
- `test_delete_with_null_replacement_normalized`
- `test_delete_with_empty_string`
- `test_rejection_of_missing_replacement_text` (Fail closed)
- `test_rejection_of_coordinate_guessing` (Fail closed)
- `test_rejection_of_out_of_bounds_coordinates`
- `test_rejection_of_duplicate_edit_spans`
- `test_rejection_of_extra_v1_keys`

### Group 3: Context-Expanded Anchor Derivation
- `test_unique_preimage_window_zero`
- `test_repeated_span_unique_with_window_one`
- `test_repeated_span_unique_with_window_two`
- `test_repeated_span_unique_with_window_three`
- `test_unresolvable_duplicate_function_fail_closed`
- `test_bof_boundary_expansion_clamp`
- `test_eof_boundary_expansion_clamp`
- `test_whitespace_only_context_handling`

### Group 4: Slot Fault Isolation
- `test_slot_a_invalid_slots_b_c_valid`
- `test_slot_b_invalid_slots_a_c_valid`
- `test_slot_c_invalid_slots_a_b_valid`
- `test_all_slots_invalid`
- `test_stable_candidate_ids`
- `test_stable_diversity_directives`
- `test_bounded_generation_count`
- `test_invalid_slot_never_selectable`
- `test_valid_slot_reaches_gate`
- `test_verifier_only_for_gate_accepted`
- `test_selector_missing_slot_handling`
- `test_all_three_positions_in_telemetry`

### Group 5: Telemetry & Observability
- `test_machine_readable_subcode_assignment`
- `test_stable_slot_index_preservation`
- `test_stage_reachability_milestone_flags`
- `test_zero_semantic_snippet_leakage_in_logs`
- `test_zero_raw_str_exc_persistence`
- `test_unresolved_exception_class_preserved_without_silent_mapping`

---

## 7. Proposed Implementation Scope & Phasing

| Phase ID | Phase Name | Scope Summary | Authorized Now? |
| :--- | :--- | :--- | :---: |
| **PHASE_R1** | Safe Observability | Additive typed exceptions, stage reachability flags, sanitized telemetry | `false` |
| **PHASE_R2** | Synthetic Contract Hardening | Authoring synthetic test matrix fixtures and running deterministic unit validation | `false` |
| **PHASE_R3** | Additive V7 Implementation | Creating additive files (`contracts_v7`, `telemetry_v1`, `prompts_v5`, `recovery_v2`, `intent_v3`, `host_binding_v2`, `runner_v7`) | `false` |
| **PHASE_R4** | Fresh Held-Out Preparation | Independent task sampling, checkout verification, dataset hashing, preflight | `false` |
| **PHASE_R5** | Fresh Held-Out Execution | Gated one-shot execution on fresh held-out dataset with cryptographic receipt | `false` |

**Notice**: This design review does NOT authorize the commencement of any implementation phase.

---

## 8. Required Final Declarations & Safety Flags

- **`REMEDIATION_DESIGN_REVIEW_STATUS`**: `PASS_PRE_A3_REMEDIATION_DESIGN_REVIEW`
- **`REM01_CLASSIFICATION`**: `SAFE_NOW`
- **`REM02_CLASSIFICATION`**: `NEEDS_SYNTHETIC_PROOF`
- **`REM03_CLASSIFICATION`**: `NEEDS_SYNTHETIC_PROOF`
- **`REM04_CLASSIFICATION`**: `NEEDS_SYNTHETIC_PROOF`
- **`REM05_CLASSIFICATION`**: `NEEDS_SYNTHETIC_PROOF`
- **`REM06_CLASSIFICATION`**: `FRESH_HELDOUT_ONLY`
- **`IMPLEMENTATION_SCOPE_DEFINED`**: `true`
- **`REMEDIATION_IMPLEMENTATION_AUTHORIZED`**: `false`
- **`FRESH_HELDOUT_EXECUTION_AUTHORIZED`**: `false`
- **`CANONICAL_DEV30_REUSE_AUTHORIZED`**: `false`
- **`V6_RERUN_AUTHORIZED`**: `false`

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
FRESH_HELDOUT_EXECUTION_AUTHORIZED=false
COMMIT_CREATED=false
PUSH_PERFORMED=false
```
