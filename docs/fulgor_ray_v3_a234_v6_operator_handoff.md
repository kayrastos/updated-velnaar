# Fulgor Ray V3 — A234 V6 Operator Handoff

## Executive Summary
This document provides operator handoff and verification instructions for the **Fulgor Ray V3 A234 V6 Additive Architecture**.
The V6 architecture addresses the root causes of the V5 DEV30 run failures by decoupling model-facing semantic patch intent from trusted host-side cryptographic provenance and closed-world repository boundary enforcement.

---

## Authoritative Architectural Changes

### 1. Model-Facing Candidate Schema: `fulgor.semantic_patch_intent.v2`
- **Location**: `training/fulgor_ray_v3/semantic_patch_intent_v2.py`
- **Design Principle**: The model specifies *what* changes are intended (`kind`, `file`, `start_line`, `end_line`, `replacement_text`, `rationale`, `expected_fail_to_pass_effect`, `regression_risks`).
- **Cryptographic Independence**: The model is **never** asked or permitted to generate cryptographic data (`expected_preimage_sha256`, anchors, or repository hashes). Any extra or unknown keys trigger strict fail-closed rejection.

### 2. Trusted Host-Binding Layer: `candidate_host_binding_v1.py`
- **Location**: `training/fulgor_ray_v3/candidate_host_binding_v1.py`
- **Design Principle**: The host validates repository membership and bounds, derives canonical preimage bytes from the true repository files, computes `expected_preimage_sha256 = sha256(canonical_preimage_bytes)` directly in host code, derives deterministic serializer-compatible anchors, and constructs existing serializer-compatible `SemanticPatchV1` instances.
- **Strict Preservation**: The existing strict serializer (`patch_serializer.py`) and static gate (`static_gate.py`) remain completely unchanged and strictly enforced.

### 3. Closed-World Repository Target Validation
- **Location**: `training/fulgor_ray_v3/stage_contract_prompts_v4.py` & `run_fulgor_v3_0_a234_dev30_inference_v6.py`
- **Enforcement**: Diagnosis prompt v4 explicitly mandates that `target_files` must be chosen strictly from the provided `repository_files` inventory. Host validation executes before any repository reading; unknown or invented paths fail immediately with `DiagnosisTargetMembershipError`.

### 4. Output Robustness & Generation Framing
- **Prompt Framing**: Explicit root object closure rules in `stage_contract_prompts_v4.py` ensure the model emits the closing `}` after the final JSON array/property before EOS.
- **Context Budget**: Candidate generation token reserve is expanded to 2048 tokens.
- **No Parser Auto-Repair**: Strict parser semantics are preserved without silent mutations or guessing.

### 5. Full End-to-End Synthetic Pipeline Validation
- **Location**: `validate_a234_v6_end_to_end_synthetic_smoke.py`
- **Namespace**: `training/synthetic_smoke/fulgor_ray_v3/a234_v6_e2e/`
- **Isolation**: Uses an isolated synthetic fixture repository (`math_util.py`). DEV30 data and gold answers are never accessed.
- **Full Funnel Execution**: Validates diagnosis -> closed-world membership -> localization -> plan -> K=3 candidates -> host binding -> host SHA calculation -> strict serialization -> static gate -> blinded verifier -> primary selection.

---

## Artifact Index & File Paths

| Component | Path | Permissions |
| :--- | :--- | :--- |
| Model Schema & Parser | `training/fulgor_ray_v3/semantic_patch_intent_v2.py` | `0644` |
| Host Binding Layer | `training/fulgor_ray_v3/candidate_host_binding_v1.py` | `0644` |
| Stage Prompts V4 | `training/fulgor_ray_v3/stage_contract_prompts_v4.py` | `0644` |
| V6 Inference Runner | `run_fulgor_v3_0_a234_dev30_inference_v6.py` | `0644` |
| E2E Synthetic Smoke | `validate_a234_v6_end_to_end_synthetic_smoke.py` | `0644` |
| Prompt Tests | `training/fulgor_ray_v3/tests/test_stage_contract_prompts_v4.py` | `0644` |
| Schema Tests | `training/fulgor_ray_v3/tests/test_semantic_patch_intent_v2.py` | `0644` |
| Host Binding Tests | `training/fulgor_ray_v3/tests/test_candidate_host_binding_v1.py` | `0644` |
| Runner Tests | `training/fulgor_ray_v3/tests/test_a234_runner_v6.py` | `0644` |
| Host Binding Report (JSON) | `training/reports/fulgor_ray_v3_0_a234_v6_host_binding.json` | `0644` |
| Host Binding Report (MD) | `training/reports/fulgor_ray_v3_0_a234_v6_host_binding.md` | `0644` |
| Final Seal Report | `training/reports/fulgor_ray_v3_0_a234_candidate_v6_final_seal.txt` | `0644` |

---

## Operator Verification Procedures

### 1. Execute Unit & Adversarial Test Suite
```bash
cd /home/kayra01_09_06/kayra-ai
pytest -v \
  training/fulgor_ray_v3/tests/test_stage_contract_prompts_v4.py \
  training/fulgor_ray_v3/tests/test_semantic_patch_intent_v2.py \
  training/fulgor_ray_v3/tests/test_candidate_host_binding_v1.py \
  training/fulgor_ray_v3/tests/test_a234_runner_v6.py \
  training/fulgor_ray_v3/tests/test_a1_serializer.py \
  training/fulgor_ray_v3/tests/test_a234_contracts.py
```
Expected: 50/50 tests PASS with 0 failures.

### 2. Verify V6 Runner Preflight
```bash
python3 run_fulgor_v3_0_a234_dev30_inference_v6.py --preflight
```
Expected output: `PASS_A234_V6_GPU_RUNNER_PREFLIGHT` (exit code 0).

### 3. Verify End-to-End Synthetic Smoke Summary
```bash
cat training/synthetic_smoke/fulgor_ray_v3/a234_v6_e2e/summary.json
```
Expected: `"status": "PASS_A234_V6_E2E_SYNTHETIC_SMOKE"`.

### 4. Integrity Check of Historical Sealed Evidence
```bash
sha256sum \
  training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v5/.CANONICAL_V3_A234_DEV30_INFERENCE_V5_ATTEMPTED \
  training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v5/a234_hardened_v2_9_v5/results.jsonl \
  training/reports/fulgor_ray_v3_0_a234_v5_postrun_forensic.json \
  training/reports/fulgor_ray_v3_0_a234_v5_postrun_forensic.md \
  training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v3/a234_hardened_v2_9_v3/results.jsonl \
  training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v2/a234_hardened_v2_9/results.jsonl
```
Expected hashes:
- V5 marker: `4b0d575ef1db040fd0b149b2b286b43dad334dac259111e7f5ae12274ce748b9`
- V5 results: `40bbaf72edf7856aa015ec55cbf25f32ef0bbc3b8e3226939a5256cdaaea568d`
- V5 forensic JSON: `331a4d5fde8923073af49a9b708230b71bd9634aa2d7d21e751bd1371a1abee7`
- V5 forensic MD: `2e55daab948ba824c5c0f94c6c2612d0c408ddd9d0e6ac18816d3aad34a1363e`
- V3 results: `4b3ec53f406375d54e8aa2f5c7eaa04d2ba1b9dd87eb21430db89f13688dba18`
- V2 results: `95c65877ed3137f8b840d7e0dc2dd3efad62b608f124ac6f1baa4237d0a96520`

---

## Operating Boundaries & Next Steps
- **DEV30 Gating**: DO NOT execute DEV30 inference under V6 runner directly. A dedicated audit and launch-receipt binding task must precede any execution.
- **Receipts**: No launch receipt was generated for V6 in this phase.
- **Safety Commitments**:
  - `A234_V5_RERUN=false`
  - `A234_V6_DEV30_EXECUTED=false`
  - `A234_V6_ATTEMPT_MARKER_WRITTEN=false`
  - `A4_EXECUTED=false`
  - `TRAINING_STARTED=false`
  - `DEV30_USED_BY_SYNTHETIC_SMOKE=false`
  - `MODEL_GENERATED_CRYPTOGRAPHIC_PROVENANCE=false`
  - `EXISTING_SERIALIZER_WEAKENED=false`
  - `EXISTING_SEALED_ARTIFACTS_MODIFIED=false`
