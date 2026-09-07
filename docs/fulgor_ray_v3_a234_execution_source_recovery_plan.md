# Fulgor Ray V3 A234 — Execution Source Recovery Plan

## 1. Operating Boundaries & Purpose

This document outlines the proposed recovery protocol for restoring the 8 missing first-party runtime dependencies required by `run_fulgor_v3_0_a234_dev30_inference_v6.py`.

> [!IMPORTANT]
> **NO RECOVERY OPERATION IS PERFORMED DURING THIS AUDIT.**
> - Local storage contains 0 copies of the missing runtime modules.
> - The authoritative source bytes currently reside exclusively on the persistent boot disk of the stopped GCP GPU host (`fulgor-v3-g4-96`, `/home/kayra01_09_06/kayra-ai/training/fulgor_ray_v3/`).
> - The GPU VM must NOT be started and GCP must NOT be accessed during this task.

---

## 2. Inventory of Required Runtime Source Modules

The following 8 modules must be recovered to achieve full source reproducibility:

1. `training/fulgor_ray_v3/context_budget_v2.py` (Must match pinned SHA256: `da9ae0af2ed057287660abf820d31b4bed869b89d97a38db53ba9d9680f3374c`)
2. `training/fulgor_ray_v3/structured_output_recovery.py`
3. `training/fulgor_ray_v3/a234_inference.py`
4. `training/fulgor_ray_v3/schemas.py`
5. `training/fulgor_ray_v3/patch_serializer.py`
6. `training/fulgor_ray_v3/static_gate.py`
7. `training/fulgor_ray_v3/a1_inference.py`
8. `training/fulgor_ray_v3/constants.py`

---

## 3. Recommended Recovery Protocol (Future Human-Approved Operation)

When authorized by the human operator, the following strictly controlled procedure should be executed:

### Phase A: Non-Inferencing Remote Export
1. Under human authorization, start instance `fulgor-v3-g4-96` (with `velnar-blackwell-reaper` paused).
2. Execute a single, read-only tar export of the exact runtime source files from `/home/kayra01_09_06/kayra-ai/training/fulgor_ray_v3/`:
   ```bash
   tar -czf /home/kayra01_09_06/fulgor-ray-v3-runtime-provenance-20260907.tar.gz \
     -C /home/kayra01_09_06/kayra-ai \
     training/fulgor_ray_v3/context_budget_v2.py \
     training/fulgor_ray_v3/structured_output_recovery.py \
     training/fulgor_ray_v3/a234_inference.py \
     training/fulgor_ray_v3/schemas.py \
     training/fulgor_ray_v3/patch_serializer.py \
     training/fulgor_ray_v3/static_gate.py \
     training/fulgor_ray_v3/a1_inference.py \
     training/fulgor_ray_v3/constants.py
   ```
3. Transfer `fulgor-ray-v3-runtime-provenance-20260907.tar.gz` to local storage.
4. Immediately stop the VM and resume `velnar-blackwell-reaper`.

### Phase B: Local Cryptographic Verification
1. Verify SHA256 of `training/fulgor_ray_v3/context_budget_v2.py` matches `da9ae0af2ed057287660abf820d31b4bed869b89d97a38db53ba9d9680f3374c` exactly.
2. Record the SHA256 of every recovered module.
3. Verify that running `python3 -m unittest -v training/fulgor_ray_v3/tests/test_a234_runner_v6.py` succeeds locally without import errors.

### Phase C: Dedicated Provenance Checkpoint Commit
1. Additively place the 8 recovered modules into `training/fulgor_ray_v3/`.
2. Commit them under a dedicated commit message (e.g. `chore(provenance): restore sealed A234 V6 runtime dependencies`).
3. Seal the complete execution source manifest.
4. Only after this checkpoint commit is established may the `LOCAL_ONLY_PRE_A3_FAILURE_ROOT_CAUSE_AUDIT` be authorized to proceed.
