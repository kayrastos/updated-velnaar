# Fulgor Ray V3 A234 V6 — Final Receipt Operator Handoff

## 1. Operating Protocol & Launch Authority
This document details the authorized operating procedure for executing the **Fulgor Ray V3 A234 V6 DEV30 Evaluation Run** on the designated RTX PRO 6000 GPU host (`fulgor-v3-g4-96`).

> [!CAUTION]
> **DIRECT RAW RUNNER EXECUTION IS STRICTLY FORBIDDEN.**
> Operators must NEVER invoke `run_fulgor_v3_0_a234_dev30_inference_v6.py` or `run_fulgor_v3_0_a234_dev30_inference_v6.py --run` directly.
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

## 3. Remote Gate Separation

Operational execution strictly separates the canonical local verification gate from the remote GPU VM runtime gate:

### Gate A: Canonical Local / GitHub Gate
- **Execution Location**: Local clean canonical Git checkout (`D:\YapayZeka\kayra-ai-codex-phase1` or cloned repository).
- **Invariants**:
  - The operator must use the clean canonical Git checkout corresponding to the explicitly approved launch checkpoint.
  - Before GPU launch, record:
    ```bash
    git branch --show-current
    git rev-parse HEAD
    git status --short
    ```
  - Working tree must be clean.
  - The recorded HEAD must match the human-approved canonical launch checkpoint for that execution.
  - The final cryptographic seal manifest verifies 17/17 members with zero mismatches.
  - Evidence and report packages are immutable.
  - **CANONICAL FINAL SEAL VERIFICATION IS PERFORMED ON THE CLEAN CANONICAL GIT CHECKOUT BEFORE GPU VM LAUNCH.**
  - *(Note: The final receipt package and local test reports reside in canonical Git; they do NOT need to be copied to the non-Git GPU VM).*

### Gate B: GPU VM Runtime Gate
- **Execution Location**: Remote GPU host (`fulgor-v3-g4-96`).
- **Invariants & Procedures**:
  1. **Pause Reaper**: Intentionally pause `velnar-blackwell-reaper` before starting the VM to prevent premature instance shutdown during evaluation.
     *(IMPORTANT: `velnar-kaggle-reconcile` must NOT be paused).*
  2. **Start Host**: Start instance `fulgor-v3-g4-96` and retrieve its active external IP.
  3. **Process Check**: Verify no competing A234, V6, or lingering Python processes exist.
  4. **Namespace Check**: Verify absolute absence of V6 attempt marker, output directory, and results files.
  5. **Preflight Inspection**: Execute ONLY `python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --inspect`.
  6. **Inspect Requirement**: Require status `READY` and all 27 runtime checks evaluating to `true`.
  7. **Human Decision**: Only after preflight inspection succeeds may the operator proceed to the one-shot `--run`.
  8. **Post-Evaluation Recovery**: After evaluation finishes and the VM is stopped:
     - Resume `velnar-blackwell-reaper`.
     - Verify Cloud Scheduler state is `ENABLED`.

---

## 4. Mandatory Pre-Execution Verification Procedures

### Procedure 1: Canonical Final Seal Verification (Local Git Workspace)
The final seal manifest (`training/reports/fulgor_ray_v3_0_a234_launch_receipt_v6_final_seal.txt`) uses a human-readable `path = sha256` structure with section headers and assertions rather than standard GNU sha256sum format.
Run the deterministic Python verification procedure on the clean canonical checkout:

```bash
python3 -c "
import hashlib, os

seal_path = 'training/reports/fulgor_ray_v3_0_a234_launch_receipt_v6_final_seal.txt'
assert os.path.isfile(seal_path), f'Missing seal: {seal_path}'

assertions = {}
members = {}
with open(seal_path, 'r', encoding='utf-8') as f:
    section = None
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1]
            continue
        if ' = ' in line:
            k, v = line.split(' = ', 1)
            k, v = k.strip(), v.strip()
            if section == 'ASSERTIONS':
                assertions[k] = v
            else:
                members[k] = v

# Verify non-file assertions
assert assertions.get('schema') == 'fulgor.a234_launch_receipt_final_seal.v6'
assert assertions.get('real_receipt_status') == 'READY'
assert assertions.get('real_receipt_check_count') == '27'
assert assertions.get('real_receipt_all_checks_true') == 'true'
assert assertions.get('captured_evidence_sha256') == '4893d46a5c0c326e3544b4918aa5f0f8c766fd8ad9d1590980d4256238a45da7'
assert assertions.get('A234_V6_DEV30_EXECUTED') == 'false'
assert assertions.get('A234_V6_ATTEMPT_MARKER_WRITTEN') == 'false'
assert assertions.get('A4_EXECUTED') == 'false'
assert assertions.get('TRAINING_STARTED') == 'false'

# Verify exactly 17 file members
assert len(members) == 17, f'Expected 17 members, got {len(members)}'
for path, expected_sha in members.items():
    assert os.path.isfile(path), f'Missing file: {path}'
    with open(path, 'rb') as f:
        actual_sha = hashlib.sha256(f.read()).hexdigest()
    assert actual_sha == expected_sha, f'Hash mismatch on {path}: {actual_sha} != {expected_sha}'
    print(f'{path}: OK')

print('FINAL SEAL VERIFICATION: 17/17 OK')
"
```
**Requirement**: Output must conclude with `FINAL SEAL VERIFICATION: 17/17 OK`.

---

### Procedure 2: Preflight Inspection & Environment Probe (GPU VM)
On the remote GPU host (`fulgor-v3-g4-96`):

1. **Verify Competing Tasks & Namespace Cleanliness**:
   ```bash
   ps aux | grep python3 | grep -E "run_fulgor|a234|dev30"
   nvidia-smi
   ls -la training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/.CANONICAL_V3_A234_DEV30_INFERENCE_V6_ATTEMPTED 2>/dev/null || echo "MARKER_ABSENT: OK"
   ls -la training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/a234_hardened_v2_9_v6 2>/dev/null || echo "OUTPUT_ABSENT: OK"
   ls -la training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/a234_hardened_v2_9_v6/results.jsonl 2>/dev/null || echo "RESULTS_ABSENT: OK"
   ```

2. **Execute Preflight Inspection (Zero Side-Effects)**:
   Record Python environment identity before inspecting:
   ```bash
   command -v python3
   python3 --version
   python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --inspect
   ```
   **Requirement**: JSON output must confirm `"status": "READY"`, all 27 checks `true`, and side-effect flags `false`.

---

## 5. Execution Workflow with Pipeline Exit Code Safety

### Runtime Python Environment Invariants:
- Do not change the Python environment between the final successful `--inspect` and the one-shot `--run`.
- Use the exact same `python3` executable and environment that produced `status=READY`.
- After READY status is obtained, do not activate/deactivate a venv, conda environment, or switch Python before `--run`.
- If an environment change occurs after READY, the operator must STOP and run a new `--inspect` in the intended final environment before considering launch.
- Do not load model weights merely to identify the environment.

When all preconditions are satisfied, launch the evaluation inside a detached `tmux` session on the GPU VM:

```bash
# 1. Start or attach to tmux session
tmux new -s fulgor_v6_eval

# 2. Enter repository root and record Python environment
cd /home/kayra01_09_06/kayra-ai

command -v python3
python3 --version

# Run final inspect first and require READY.
# After READY, without changing Python environment:

set -o pipefail
python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --run 2>&1 | tee training/eval/fulgor_ray_v3_dev30_v6_run.log
rc=${PIPESTATUS[0]}
echo "A234_V6_RECEIPT_EXIT_CODE=$rc"
test "$rc" -eq 0
```

> [!IMPORTANT]
> **Exit Code Safety**:
> Using `set -o pipefail` and inspecting `${PIPESTATUS[0]}` guarantees that the pipeline exit status reflects the Python launch receipt process, preventing `tee` from masking a non-zero exit code.
> The authoritative exit status is the return code of `run_fulgor_v3_0_a234_launch_receipt_v6.py`.

---

## 6. Post-Run Verification & Host Recovery

1. **Verify Completion**:
   - Confirm `A234_V6_RECEIPT_EXIT_CODE=0`.
   - Verify that `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/a234_hardened_v2_9_v6/results.jsonl` contains exactly 30 valid evaluation records.
   - Confirm that a durable launch receipt was created under `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/launch_receipts_v6/`.

2. **Re-enable Reaper & Stop VM**:
   - Stop instance `fulgor-v3-g4-96`.
   - Resume Cloud Scheduler job `velnar-blackwell-reaper`.
   - Verify Cloud Scheduler state is `ENABLED`.
