# Fulgor Ray V3 A234 Pre-A3 Remediation Plan & Architectural Specification (Corrected Evidence Edition)

## 1. Executive Summary & Policy Boundary

This document defines the technical architecture, implementation roadmap, and validation protocol to remediate the pre-A3 pipeline progression failures identified in the **Fulgor Ray V3 A234 Pre-A3 Root Cause Forensic Audit** (`training/reports/fulgor_ray_v3_0_a234_pre_a3_root_cause_audit.md`).

### Critical Operating Constraints
- **Design Specification Only**: This document authorizes remediation design only. **`REMEDIATION_IMPLEMENTATION_AUTHORIZED = false`**. No source files are modified during this phase.
- **Permanent Freeze of Canonical DEV30**: Canonical DEV30 is permanently consumed and contaminated by aggregate observation. **`CANONICAL_DEV30_REUSE_AUTHORIZED = false`**.
- **Mandatory Fresh Held-Out Evaluation**: Validating any future remediated runner requires an independently sampled, fresh held-out evaluation dataset.

---

## 2. Architectural Remediation Tiers

```
+-------------------------------------------------------------------------+
| Tier 1: SAFE_WITHOUT_DEV30_SEMANTICS                                     |
| Observability, telemetry enrichment, slot fault isolation, multi-fence   |
| recovery. Verifiable via deterministic static tests. Zero safety risk.  |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Tier 2: REQUIRES_SYNTHETIC_TEST                                         |
| Context-expanded anchor derivation, natural insert coordinates, newline |
| LF normalization. Verifiable via synthetic unit and adversarial fixtures.|
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Tier 3: REQUIRES_FRESH_HELDOUT_EVAL                                     |
| Benchmark evaluation of end-to-end pipeline progression on an           |
| independently sampled, fresh held-out evaluation dataset.                |
+-------------------------------------------------------------------------+
```

---

## 3. Tier 1: Safe Remediations (Safe Without DEV30 Semantics)

### 3.1 Granular Exception Hierarchy & Telemetry Enrichment (`REM01`)
**Problem**:
`A234ContractError` collapses multiple distinct failure conditions into one opaque string, and candidate outcome exceptions drop failure messages (`str(exc)`). Furthermore, candidate-level `A234ContractError` outcomes exhibit an unresolved reachability contradiction in V6.

**Remediation Design**:
1. Subclass contract exceptions into domain-specific types with explicit subcodes:
   - `DiagnosisContractError` (subcodes: `SCHEMA_MISMATCH`, `TARGET_COUNT_EXCEEDED`, `INVALID_SYMBOLS`, `OUT_OF_SCOPE_SYMBOL`)
   - `PlanContractError` (subcodes: `SCHEMA_MISMATCH`, `DIAGNOSIS_HASH_MISMATCH`, `INVALID_STEPS`, `OUT_OF_SCOPE_STEP`, `PRESERVATION_CONSTRAINTS_MISSING`)
   - `CandidateContractError` (subcodes: `SCHEMA_MISMATCH`, `ID_MISMATCH`, `PARENT_HASH_MISMATCH`, `EMPTY_EDITS`, `OUT_OF_SCOPE_EDIT`, `DUPLICATE_SPANS`)
   - `VerifierContractError` (subcodes: `SCHEMA_MISMATCH`, `BLINDED_ID_MISMATCH`, `SUBSCORES_OUT_OF_BOUNDS`)
2. Update `CandidateOutcome` dataclass:
   ```python
   @dataclass(frozen=True)
   class CandidateOutcome:
       candidate: SemanticPatchV1 | None
       patch: SerializedPatchV1 | None
       gate: GateResult | None
       score: VerifierScoreV1 | None
       failure_code: str | None = None
       failure_message: str | None = None
       structural_diagnostics: dict[str, Any] | None = None
   ```
3. Update `run()` and `process_candidates_v6()` to record `failure_message=str(exc)` and structured diagnostics for all failure paths without leaking protected semantic text.

**Safety Impact**: Purely additive observability. Zero regression risk.

---

### 3.2 Robust Multi-Envelope Structured Output Recovery (`REM02`)
**Problem**:
`normalize_single_json_object()` rejects generic code fences (```` ``` ````), uppercase tags (```` ```JSON ````), leading preambles, trailing conversational text, and whitespace variations. While the prompt explicitly commands models not to emit markdown fences or conversational text, strict recovery causes 10 pre-candidate failures when models deviate from prompt instructions.

**Remediation Design**:
1. Implement multi-envelope candidate normalization pipeline:
   - **Step 1 (Fence Normalization)**: If output contains markdown code fences with any casing (`(?i)```(?:json)?\s*
(.*?)
````), extract the inner body.
   - **Step 2 (Outermost Object Extraction)**: If direct parsing fails, locate the first non-whitespace `{` and matching outermost syntactically balanced `}`. Ignore conversational prose before `{` and after `}`.
   - **Step 3 (Strict Syntax Validation)**: Execute `json.loads()` on the extracted body. If JSON syntax is invalid (e.g. unclosed braces, unescaped quotes), fail closed.
   - **Step 4 (Dict Schema Check)**: Verify `isinstance(val, dict)`.
2. Record recovery envelope type in provenance: `plain_json`, `markdown_json_fence`, `generic_markdown_fence`, or `balanced_brace_extraction`.

**Safety Impact**: Preserves 100% strict JSON syntax validity and downstream dataclass verification while eliminating superficial envelope rejection.

---

### 3.3 Runner Slot Fault Isolation (`REM03`)
**Problem**:
In `run_fulgor_v3_0_a234_dev30_inference_v6.py:480-484`, candidate parsing is executed in the record-level loop. A parsing error in Candidate Slot A aborts the entire DEV30 instance, preventing Slots B and C from generating.

**Remediation Design**:
1. Wrap each slot's generation and intent parsing in an isolated per-slot try-except block.
2. If slot A fails parsing (e.g. `SemanticIntentError` or `StructuredOutputRecoveryError`), record `outcomes[0] = CandidateOutcome(failure_code=...)` and proceed to generate slot B and slot C.
3. Pass valid normalized candidate strings to `process_candidates_v6()`.
4. Maintain `len(outcomes) == CANDIDATE_BUDGET` (K=3).

**Safety Impact**: Prevents cascading pipeline aborts while strictly maintaining the fixed slot budget and diversity directives.

---

## 4. Tier 2: Synthetic-Tested Remediations (Requires Synthetic Fixtures)

### 4.1 Deterministic Context-Expanded Anchor Derivation (`REM04`)
**Problem**:
`_derive_anchor` fails closed when both the declared edit span and every individual line within it appear multiple times in the file (causing 4 candidate outcome failures).

**Remediation Design**:
1. When full preimage and single lines are non-unique:
   - Deterministically expand an anchor inspection window by `w = 1, 2, 3` lines of surrounding immutable repository context above and below the edit span:
     `expanded_context = "".join(original[max(0, start_idx - w):min(n_lines, stop_idx + w)])`
   - If `text.count(expanded_context) == 1`, use `expanded_context` as the unique anchor.
2. The declared edit span (`start_line`, `end_line`) and replacement text remain unchanged; only the anchor string used by `_validate_anchor()` is expanded.
3. If an anchor cannot be established within `w <= 3` lines, fail closed with `CandidateAnchorDerivationError`.

**Safety Impact**: Mathematically eliminates ambiguity while preserving exact byte-level patch application invariants.

---

### 4.2 Intuitive Coordinate & Insertion Convention Alignment (`REM05`)
**Problem**:
The convention `end_line == start_line - 1` for insertions is counter-intuitive for LLMs, and missing trailing newlines on `replacement_text` causes immediate rejection.

**Remediation Design**:
1. Update prompt contract (`stage_contract_prompts_v5.py`) and schema parser (`semantic_patch_intent_v3.py`):
   - For `insert`: Allow `start_line == line` and `end_line == line` (or `end_line == start_line - 1` for backward compatibility) with `kind == "insert"`.
   - Clear prompt specification: `"For insert: specify start_line as the line before which the new code will be inserted."`
2. Trailing Newline Normalization:
   - For `replace` and `insert`: If `replacement_text` is non-empty and lacks a trailing `
`, automatically append `
` host-side during normalization, recording `trailing_newline_appended: true` in provenance.
3. Delete Normalization:
   - For `delete`: If `replacement_text` is `null` or missing, normalize to `""`.

**Safety Impact**: Eliminates formatting friction without sacrificing deterministic patch generation.

---

## 5. Tier 3: Fresh Held-Out Evaluation Protocol (`REM06`)

### 5.1 Canonical DEV30 Permanent Sealing
- Canonical DEV30 (`training/eval/fulgor_ray_v3/dev30_v1/`) is permanently consumed.
- **Rerun Policy**: `V6_RERUN_AUTHORIZED = false`. No future runner may evaluate on the canonical DEV30 dataset.
- Any metric obtained by running remediated code on canonical DEV30 is scientifically invalid and contaminated.

### 5.2 Fresh Held-Out Set Specifications
1. **Independent Sampling**: Sample 30 new, disjoint task instances from the SWE-bench / SWE-smith evaluation corpus.
2. **Cryptographic Identity**: Generate an independent input dataset hash (`fresh_heldout_input_sha256`), fresh instance IDs, and independent repository checkouts.
3. **Sealed Pre-Evaluation Receipt**: Require human operator verification, non-inferencing preflight inspection, and a cryptographic launch receipt prior to evaluation.

---

## 6. Implementation Roadmap & Phase Invariants

```
+------------------------------------------------------------------------+
| Phase 1: Local Unit & Adversarial Test Development                      |
| Author deterministic synthetic unit tests covering all failure classes |
| and anchor expansion edge cases without modifying production code.     |
+------------------------------------------------------------------------+
                                    |
                                    v
+------------------------------------------------------------------------+
| Phase 2: Additive Component Implementation (V7 Architecture)           |
| Implement stage_contract_prompts_v5.py, semantic_patch_intent_v3.py,   |
| candidate_host_binding_v2.py, and run_fulgor_v3_0_a234_runner_v7.py.   |
| Preserve V1-V6 byte-for-byte in version control.                       |
+------------------------------------------------------------------------+
                                    |
                                    v
+------------------------------------------------------------------------+
| Phase 3: Synthetic Preflight & Host Probing                             |
| Verify all 27 preflight checks and 100% unit test pass rate.          |
+------------------------------------------------------------------------+
                                    |
                                    v
+------------------------------------------------------------------------+
| Phase 4: Fresh Held-Out Evaluation Launch                              |
| Execute one-shot evaluation on fresh held-out evaluation set under     |
| human operator receipt gating.                                         |
+------------------------------------------------------------------------+
```

---

## 7. Policy Statements & Authorization Status

- **`REMEDIATION_DESIGN_ELIGIBLE`**: `true`
- **`REMEDIATION_IMPLEMENTATION_AUTHORIZED`**: `false`
- **`CANONICAL_DEV30_REUSE_AUTHORIZED`**: `false`
- **`FRESH_HELDOUT_REQUIRED_AFTER_REMEDIATION`**: `true`
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
