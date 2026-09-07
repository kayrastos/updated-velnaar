# Fulgor Ray V3 A234 V6 — Final Receipt Operator Handoff

## 1. Operating Protocol & Launch Authority
This document details the authorized operating procedure for executing the **Fulgor Ray V3 A234 V6 DEV30 Evaluation Run** on the designated RTX PRO 6000 GPU host (`fulgor-v3-g4-96`).

> [!CAUTION]
> **DIRECT RAW RUNNER EXECUTION IS STRICTLY FORBIDDEN.**
> Operators must NEVER invoke `python3 run_fulgor_v3_0_a234_dev30_inference_v6.py` or `python3 run_fulgor_v3_0_a234_dev30_inference_v6.py --run` directly.
> Direct runner execution completely bypasses the cryptographic launch receipt gate, audit trail recording, and fail-closed preflight safety validations.

### Authorized Launch Command
The **ONLY** authorized launch invocation is:
```bash
python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --run
```

---

## 2. Launch Invariants & Nature of Execution

1. **Human-Gated Only**:
   - The `--run` command must be invoked manually by an authorized human operator.
   - Automated scripts, background loops, or unmonitored triggers must never execute this command.

2. **Irreversible One-Shot Evaluation**:
   - V6 DEV30 evaluation is strictly one-shot.
   - Upon delegation, the runner immediately writes an irreversible attempt marker (`.CANONICAL_V3_A234_DEV30_INFERENCE_V6_ATTEMPTED`).
   - If the run fails, is interrupted, or preempted after marker creation, the attempt is permanently consumed.

---

## 3. Mandatory Pre-Execution Checklist

Before executing `python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --run`, the operator must verify each of the following four conditions:

### Check 1: Cryptographic Final Seal Verification
Verify all members of the final receipt seal manifest:
```bash
sha256sum -c training/reports/fulgor_ray_v3_0_a234_launch_receipt_v6_final_seal.txt
```
**Requirement**: Every line must report `OK`. Zero mismatches or missing files allowed.

### Check 2: GCP Flex Start & VM Reaper Handling
- Ensure that the execution host is running and will not be preempted during the expected 30-case evaluation duration (~45–60 minutes).
- Run inside a detached `tmux` or `screen` session to prevent local SSH disconnects from terminating the evaluation process:
  ```bash
  tmux new -s fulgor_v6_run
  ```
- Verify that standard logging output is redirected to disk for post-run audit:
  ```bash
  python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --run 2>&1 | tee training/eval/fulgor_ray_v3_dev30_v6_run.log
  ```

### Check 3: Absolute Absence of V6 Attempt Marker, Output, and Results
Confirm that the V6 evaluation namespace is completely pristine:
```bash
ls -la training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/.CANONICAL_V3_A234_DEV30_INFERENCE_V6_ATTEMPTED 2>/dev/null || echo "MARKER_ABSENT: OK"
ls -la training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/a234_hardened_v2_9_v6 2>/dev/null || echo "OUTPUT_ABSENT: OK"
ls -la training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/a234_hardened_v2_9_v6/results.jsonl 2>/dev/null || echo "RESULTS_ABSENT: OK"
```
**Requirement**: All three must be absent. If any file exists, the wrapper will fail closed and abort immediately.

### Check 4: No Competing Processes
Confirm no previous Python, receipt, runner, or GPU tasks are active:
```bash
ps aux | grep python3 | grep -E "run_fulgor|a234|dev30"
nvidia-smi
```
**Requirement**: GPU compute processes must be 0, and GPU memory usage must be near 0 MiB before launching.

---

## 4. Execution Workflow

When all pre-execution checks are confirmed:

1. **Activate Environment**:
   ```bash
   cd /home/kayra01_09_06/kayra-ai
   source .venv/bin/activate  # or conda environment where torch/transformers are installed
   ```

2. **Preflight Inspection (Recommended Final Dry-Run)**:
   ```bash
   python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --inspect
   ```
   Confirm that output JSON displays `"status": "READY"` and all checks evaluate to `true`.

3. **Authorized Human-Gated Launch**:
   ```bash
   python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --run
   ```

4. **Durable Receipt Publication**:
   The command will:
   - Durably write a cryptographic launch receipt under `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/launch_receipts_v6/`.
   - Re-verify all candidate hashes, historical evidence, and absence of prior markers.
   - Delegate execution to `run_fulgor_v3_0_a234_dev30_inference_v6.py --run`.
   - Complete 30 DEV30 evaluation instances.

---

## 5. Post-Run Verification
Following completion of the run:
1. Confirm return code `0`.
2. Inspect `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/a234_hardened_v2_9_v6/results.jsonl` (ensure exactly 30 records).
3. Do NOT modify any generated output or marker.
