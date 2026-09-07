# Fulgor Ray V3 A234 V6 DEV30 Post-Run Forensic Report

## 1. Executive Summary & Verification Authority

This report documents the structural completion and evidence verification of the **Fulgor Ray V3 A234 V6 DEV30 One-Shot Evaluation Run**.

- **Status**: `PASS_A234_V6_DEV30_ONE_SHOT_COMPLETE`
- **Canonical Pre-Launch Checkpoint**: Commit `40e71168b83e5febe42b4b2906a2fd9065c3a6ae` on branch `fulgor/a234-v6-handoff-20260906`
- **Execution Mode**: Strict human-gated one-shot invocation via `python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --run`
- **Host**: RTX PRO 6000 GPU host (`fulgor-v3-g4-96`, `34.46.116.170`)
- **Scope**: FORENSIC / STRUCTURAL VERIFICATION ONLY

---

## 2. Invariants & Key Findings

1. **Preflight Sealed Prior to Launch**:
   - The pre-launch environment and candidate architecture were sealed under `training/reports/fulgor_ray_v3_0_a234_launch_receipt_v6_final_seal.txt` (SHA256: `0e02601c2564080f5866d33685e7872ddd49cebeab33de406aeee330ef94bd5c`).
   - The captured live preflight inspection (`training/reports/evidence/fulgor_v6_real_receipt_inspect_20260907.json`, SHA256: `4893d46a5c0c326e3544b4918aa5f0f8c766fd8ad9d1590980d4256238a45da7`) certified all 27/27 preflight checks passed with status `READY`.

2. **Human-Gated Wrapper As Sole Launch Path**:
   - Direct raw runner invocation was strictly bypassed. Launch was performed exclusively through the receipt wrapper (`run_fulgor_v3_0_a234_launch_receipt_v6.py --run`).
   - The durable launch receipt was written prior to delegation with schema `fulgor.a234_launch_receipt.v6` and record SHA256 `2ac8347ce8314e5e249ba90d660486b82ef6ac4aec5218e82858111dd0d4d23b`.

3. **Attempt Marker Irreversibly Created**:
   - The evaluation attempt marker (`.CANONICAL_V3_A234_DEV30_INFERENCE_V6_ATTEMPTED`, SHA256: `7b5a47f78f76329b1f83dea0c022cce8a385649743e3a30f63b9acb2663cf43f`) was written upon execution commencement, consuming the one-shot allowance.

4. **Complete 30/30 Output Dataset Produced**:
   - Exactly 30 raw result records were generated.
   - All 30 records parse as valid JSON objects.
   - All 30 raw line SHA256 hashes are strictly unique (0 duplicates).
   - The results dataset SHA256 is `29e5935280052513a7bdb2c6203c76591f47c5e8ec9116adff5a6e6849670747`.

5. **Wrapper Exit Code 0 Recovered**:
   - Preserved tmux pane history confirmed successful process completion with exit code 0 (`A234_V6_RECEIPT_EXIT_CODE=0`, SHA256: `7653113809dcc1dea3b5a2cd2c2b9cd6b8bae8a6abc29ff7a7f2d933c0370ef7`).

6. **Strict Semantic Non-Inspection Policy**:
   - Protected DEV30 semantic outputs (prompts, answers, vulnerability analyses, patch texts, reasoning steps) were **NOT** inspected, displayed, or scored during this forensic sealing task.
   - Raw `results.jsonl` and the tar archive remain strictly outside the Git repository.
   - Only cryptographic identities and structural completion evidence are canonicalized in version control.

7. **No Training, No A4 Execution**:
   - `TRAINING_STARTED = false`: No model parameters were updated or trained.
   - `A4_EXECUTED = false`: Downstream verifier execution / A4 evaluation has not commenced.
   - This report does **NOT** make any model-quality claim; it certifies structural execution integrity only.

8. **Rerun Invariant**:
   - `one_shot_consumed = true`
   - `rerun_authorized = false`
   - **V6 may never be rerun.**

---

## 3. Cryptographic Evidence Inventory

| Evidence Class | Path / Reference | SHA256 |
| :--- | :--- | :--- |
| **External Post-Run Bundle** | `C:\Users\kayra\Downloads\fulgor-v6-dev30-postrun-final-20260907.tar.gz` | `175f8fc576835c84db903c992cff5c868068cf97a93fca8eac08da1c2c7abd26` |
| **Attempt Marker** | `.CANONICAL_V3_A234_DEV30_INFERENCE_V6_ATTEMPTED` | `7b5a47f78f76329b1f83dea0c022cce8a385649743e3a30f63b9acb2663cf43f` |
| **Results Dataset** | `results.jsonl` (30 records) | `29e5935280052513a7bdb2c6203c76591f47c5e8ec9116adff5a6e6849670747` |
| **Durable Launch Receipt** | `launch-receipt-2ac8347ce8314e5e249ba90d660486b82ef6ac4aec5218e82858111dd0d4d23b.json` | `b890c9b04f647556403dd7f56dfdda809c116c9cdcd5fd33ce0c1b854206764a` |
| **Exit Evidence** | `fulgor-v6-dev30-exit-evidence-20260907.txt` | `7653113809dcc1dea3b5a2cd2c2b9cd6b8bae8a6abc29ff7a7f2d933c0370ef7` |
| **Post-Run Summary** | `fulgor-v6-dev30-postrun-summary-20260907.json` | `93b589b580bb91eadc480675cb57cd3247ceb5c639c1d2b0647a3ecfb9cccb31` |

---

## 4. Structural Metrics Summary

- **Total Result Lines**: 30
- **Valid JSON Count**: 30
- **Unique Record Count**: 30
- **Duplicate Line Count**: 0
- **Wrapper Exit Code**: 0
- **Protected Content Committed**: `false`
- **GPU Currently Required**: `false`
