# Fulgor Ray V3.0 A234 V6 Launch Receipt Audit & Evidence Binding Report

## Executive Summary
This engineering report documents the final post-recovery verification and evidence binding for the **A234 V6 Launch Receipt Layer** in the Fulgor Ray V3 evaluation pipeline.
During the receipt testing phase, an unmocked live probe in unit tests caused a hang condition that was forensically isolated and resolved by introducing fast dependency injection solely within the test harness (`training/fulgor_ray_v3/tests/test_a234_launch_receipt_v6.py`) and strictly ordering pre-delegation checks in `training/fulgor_ray_v3/a234_launch_receipt_v6.py`.
This report authoritatively binds the **POST-RECOVERY** receipt implementation bytes and incorporates the byte-verified evidence captured from a human-operated real-VM preflight inspection on the RTX PRO 6000 host.

---

## 1. Local Verified Artifacts

### 1.1 Current Post-Recovery Receipt Layer Hashes
The receipt hang-recovery edits modified the receipt module and its test suite. These post-recovery bytes are authoritative:

| Component | Repository Path | Post-Recovery SHA256 | Status |
| :--- | :--- | :--- | :--- |
| **Receipt Module** | `training/fulgor_ray_v3/a234_launch_receipt_v6.py` | `23ebd02fbe9991f8a20f10c46d284e206aecdbdc5a9ab818823e30e2ddc31675` | `CURRENT` |
| **Receipt CLI** | `run_fulgor_v3_0_a234_launch_receipt_v6.py` | `45b9452a00a767c53306400379e3ad55aef96c247125e00591cef56ee8a5dca7` | `CURRENT` |
| **Receipt Tests** | `training/fulgor_ray_v3/tests/test_a234_launch_receipt_v6.py` | `0feb4e4f65b71ae23fe0cdf6ec5c7c167110f3e742efb36809b6b022ed0f838b` | `CURRENT` |

### 1.2 Immutable V6 Candidate Hashes
All candidate artifacts remain byte-for-byte identical to their sealed candidate manifest:

| Component | Repository Path | Pinned Expected SHA256 | Local Verified |
| :--- | :--- | :--- | :--- |
| **V6 Runner** | `run_fulgor_v3_0_a234_dev30_inference_v6.py` | `5dacaef8f7d9f1c0658cfe4abe5c024fb9d38db84a4c8392fd2a984421d9395b` | MATCH |
| **Prompts V4** | `training/fulgor_ray_v3/stage_contract_prompts_v4.py` | `a66bf49189e7c2857fe495ec36119bea119ac1caf2f965883336eb86916adf9b` | MATCH |
| **Semantic Intent V2** | `training/fulgor_ray_v3/semantic_patch_intent_v2.py` | `31a6f04f87a37e240ac1bb85692f61b8c26e44221ff39035697e5c70d01a1709` | MATCH |
| **Host Binder V1** | `training/fulgor_ray_v3/candidate_host_binding_v1.py` | `b5a7fc331798892bbd14bdad443e9203e3a1596b5f6cc69209f300359eb2386c` | MATCH |
| **Synthetic Smoke Tool** | `validate_a234_v6_end_to_end_synthetic_smoke.py` | `8f8a6075e2ab7b265c7d2365f290dcc3bdf5b8bffd4527b48047c8f8d6eb151d` | MATCH |
| **Synthetic E2E Summary** | `training/synthetic_smoke/fulgor_ray_v3/a234_v6_e2e/summary.json` | `ed09f5313d0ddf7754ad913579773282ec01622f75e5fb9f1fe4270a8e0c1f01` | MATCH |
| **Host Binding Report (JSON)** | `training/reports/fulgor_ray_v3_0_a234_v6_host_binding.json` | `3fc9bdf8b21799c82d7f0e153929f2f6063451756c433ba1052630d76615d419` | MATCH |
| **Host Binding Report (MD)** | `training/reports/fulgor_ray_v3_0_a234_v6_host_binding.md` | `8ad044ea9432a6f15cf7339b78f27cc220d840f022c1690759aaea2bc0dbde5d` | MATCH |
| **Operator Handoff (Candidate)** | `docs/fulgor_ray_v3_a234_v6_operator_handoff.md` | `2d388c7c90b37a99f4c58d44c3d738e5e0b3bb04842e16aef35ed12a1c59307b` | MATCH |
| **Candidate Final Seal** | `training/reports/fulgor_ray_v3_0_a234_candidate_v6_final_seal.txt` | `bb68569cdbafacd737d4efe48e2fadc8de1c740fbde74b2498551661ac136fb3` | MATCH |

### 1.3 Captured Real-VM Evidence File
- **Source Location**: `C:\Users\kayra\Downloads\fulgor-v6-real-receipt-inspect-20260907.json`
- **Repository Destination**: `training/reports/evidence/fulgor_v6_real_receipt_inspect_20260907.json`
- **Stable File Identity SHA256**: `4893d46a5c0c326e3544b4918aa5f0f8c766fd8ad9d1590980d4256238a45da7`
- **Integrity**: Verified byte-for-byte copy with zero modifications.
- **Captured `receipt_sha256` (Metadata Only)**: `8510d04402dec4d56ea5b69c6c45ddf55a2fd31e58383ebdc9065a0f1a26aeac` (non-stable execution metadata).

---

## 2. Real-VM Inspect Verified via Captured Evidence

A live execution of `python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --inspect` was performed by the human operator on the designated RTX PRO 6000 GPU host (`fulgor-v3-g4-96`), producing:

- **Schema**: `fulgor.a234_gpu_launch_preflight.v6`
- **Preflight Status**: `READY`
- **Total Checks Evaluated**: 27
- **Passing Checks**: 27 / 27 (`true`)
- **GPU & Environment Invariants**:
  - `cuda_available`: `true`
  - `bf16_supported`: `true`
  - `gpu_memory_sufficient`: `true` (>= 30 GiB)
  - `disk_free_sufficient`: `true` (>= 10 GiB)
  - `workspace_root_safe`: `true`
  - `output_parent_safe`: `true`
- **Model Snapshot & Tokenizer Invariants**:
  - `pinned_model_snapshot_complete`: `true` (`google/gemma-4-12B-it` revision `707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7`)
  - `tokenizer_accounting_passed`: `true` (canonical budget tokens match production tensor tokens without weight loading)
- **Candidate & Evidence Invariants**:
  - `runner_v6_hash`: `true`
  - `stage_contract_prompts_v4_hash`: `true`
  - `semantic_patch_intent_v2_hash`: `true`
  - `candidate_host_binding_v1_hash`: `true`
  - `context_budget_v2_hash`: `true`
  - `canonical_a1_input_hash`: `true`
  - `adapter_config_hash`: `true`
  - `adapter_weights_hash`: `true`
  - `candidate_v6_seal_verified`: `true` (all 21 candidate seal members verified)
  - `e2e_synthetic_smoke_summary_verified`: `true`
- **Historical Evidence Preservation**:
  - `v5_marker_preserved`: `true` (`4b0d575ef1db040fd0b149b2b286b43dad334dac259111e7f5ae12274ce748b9`)
  - `v5_results_preserved`: `true` (`40bbaf72edf7856aa015ec55cbf25f32ef0bbc3b8e3226939a5256cdaaea568d`)
  - `v3_marker_preserved`: `true` (`ba7ece51a8404c16db68dc9eaea8c29c074b219ce84ee9c25ba00e64b49ae849`)
  - `v3_results_preserved`: `true` (`4b3ec53f406375d54e8aa2f5c7eaa04d2ba1b9dd87eb21430db89f13688dba18`)
  - `v2_marker_preserved`: `true` (`98636f5d53597d74f7a8da520daf94545f1edea3d41714d94e3cf3525cdaa170`)
  - `v2_results_preserved`: `true` (`95c65877ed3137f8b840d7e0dc2dd3efad62b608f124ac6f1baa4237d0a96520`)
  *(Note: Remote-only historical markers and results reside on the remote GPU host; their preservation was verified by the captured real production receipt preflight gate).*
- **V6 One-Shot Non-Consumption**:
  - `v6_marker_absent`: `true`
  - `v6_output_absent`: `true`
  - `v6_results_absent`: `true`
- **Zero Side-Effects**:
  - `inference_executed`: `false`
  - `marker_written`: `false`
  - `training_started`: `false`

---

## 3. Not Executed Operations

In strict accordance with the project safety protocol, the following operations were **NOT** executed:
- V6 DEV30 inference execution (`--run`)
- Raw V6 runner direct execution
- A4 execution
- Model fine-tuning or training
- Rerun of synthetic model smoke
- Model weights loading during receipt audit or local sealing
- GPU utilization during this local sealing task

---

## 4. Safety Confirmations

```text
A234_V5_RERUN=false
A234_V6_DEV30_EXECUTED=false
A234_V6_ATTEMPT_MARKER_WRITTEN=false
A4_EXECUTED=false
TRAINING_STARTED=false
MODEL_WEIGHTS_LOADED=false
GPU_USED=false
SSH_USED=false
DEV30_USED_BY_SYNTHETIC_SMOKE=false
EXISTING_SERIALIZER_WEAKENED=false
EXISTING_SEALED_ARTIFACTS_MODIFIED=false
```
