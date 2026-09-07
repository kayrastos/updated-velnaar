# Fulgor Ray V3 A234 — A4 Execution Contract & State Machine

## 1. Operating Authority & Foundational Principles

This contract establishes the formal specification, fail-closed boundaries, and state machine transitions for the **A234 A4 Feedback Refinement Phase** of the Fulgor Ray V3 evaluation pipeline.

> [!CRITICAL]
> **A4 IS STRICTLY A CONSUMER OF SEALED V6 RESULTS.**
> - A4 MUST NOT regenerate V6 DEV30 inference.
> - A4 MUST NOT invoke `run_fulgor_v3_0_a234_dev30_inference_v6.py`.
> - A4 MUST NOT invoke `run_fulgor_v3_0_a234_launch_receipt_v6.py --run`.
> - A4 MUST fail closed before any semantic processing if the input dataset SHA256 does not match `29e5935280052513a7bdb2c6203c76591f47c5e8ec9116adff5a6e6849670747`.
> - `v6_rerun_authorized = false`.
> - `training_started = false`.

---

## 2. A4 Eligibility Gate & Preconditions

A real A4 invocation is permitted **ONLY** if the sealed upstream record contains an eligible A3 verifier judgment.

### Mandatory Record Eligibility Criteria:
A4 may consume a record only when all of the following conditions are simultaneously met:
1. Upstream candidate intent passed host-binding, syntax normalization, and static gating (`gate.accepted == True`).
2. A3 blinded verifier actually executed against the validated patch.
3. A valid verifier judgment exists and validates against the expected `blind_id(instance_id, candidate_id)` binding with schema `fulgor.verifier_score.v1`.
4. Feedback is explicitly requested / eligible under the A4 refinement protocol.
5. `feedback_iteration_budget == 1`.

### Ineligibility Rules:
If any of the above preconditions are absent for a record:
- A4 MUST record the instance as **`INELIGIBLE`** and dispatch **ZERO** model calls.
- A4 MUST NEVER treat:
  - host-binding failure (`CandidateHostBindingError`, `CandidateLineSpanError`, `CandidateAnchorDerivationError`)
  - parser failure / syntax normalization failure (`StructuredOutputRecoveryError`)
  - contract failure (`A234ContractError`, `SemanticIntentError`, `DiagnosisTargetMembershipError`)
  - missing primary candidate (`NoPrimary`)
  - missing verifier judgment (`score = None`)
  as authorization to regenerate A2 candidates.
- **A4 MAY NOT "REPAIR" AN A2 FAILURE UNDER THE A4 LABEL.**
- Invoking A4 directly against gate-rejected candidates would violate the strict `A2 -> A3 -> A4` phase separation by masquerading A2 re-synthesis as an A4 feedback pass.

---

## 3. A4 Lifecycle State Machine

The future A4 runner must strictly adhere to the following deterministic state transitions:

```
[A4_NOT_STARTED]
       │
       ▼  (read-only preflight gate: check seals, bundle, environment, inputs)
[A4_PREFLIGHT_READY]
       │
       ▼  (human operator explicitly authorizes --run; durable marker written)
[A4_ATTEMPT_RECORDED]
       │
       ▼  (inspect sealed V6 records for eligible A3 verifier judgments)
[A4_ELIGIBILITY_INSPECTION]
       │
       ├───────────────────────────────┐
       ▼ (if 0 eligible records exist)   ▼ (if eligible A3 records exist)
[A4_TERMINAL_INELIGIBLE]        [A4_VERIFIER_REVIEW]
       │                               │
       │                               ├───────────────────────────────┐
       │                               ▼ (if verifier accepts primary)  ▼ (if feedback requested)
       │                        [A4_PRIMARY_DISPOSITION]        [A4_FEEDBACK_1_RUNNING] (budget=1)
       │                               │                               │
       │                               │                               ▼
       │                               │                        [A4_REFINED_EVALUATION]
       │                               │                               │
       └───────────────────────────────┴───────────────┬───────────────┘
                                                       ▼
                                               [A4_COMPLETED]
```

### State Definitions and Invariants:

1. **`A4_NOT_STARTED`**:
   - Initial state. No A4 marker, receipt, or output directory exists.
   - Pre-conditions: Git tree is clean at approved commit; V6 post-run final seal is verified 6/6; external bundle and results SHA match authoritative values.

2. **`A4_PREFLIGHT_READY`**:
   - Result of executing `python3 run_fulgor_v3_0_a234_a4_v1.py --inspect` (or `--preflight`).
   - Read-only inspection passes 100% of cryptographic and environment gates.
   - NO disk writes, NO marker created, NO GPU allocated, NO model weights loaded.
   - Repeatable indefinitely without state mutation.

3. **`A4_ATTEMPT_RECORDED`**:
   - Human operator explicitly dispatches `python3 run_fulgor_v3_0_a234_a4_v1.py --run`.
   - The runner IMMEDIATELY writes the durable attempt marker (`.CANONICAL_V3_A234_DEV30_A4_ATTEMPTED`) and launch receipt BEFORE loading model weights or calling any model endpoint.
   - The one-shot execution allowance for A4 is irreversibly consumed.

4. **`A4_ELIGIBILITY_INSPECTION`**:
   - Ingests sealed V6 result records.
   - If `a4_eligible_record_count == 0` (as in sealed V6 DEV30, where 0/27 candidates passed host gate and 0 A3 verifier scores exist), transitions immediately to `A4_TERMINAL_INELIGIBLE`.
   - Makes ZERO model calls and exits with exit code 0, certifying ineligibility without side-effects.

5. **`A4_FEEDBACK_1_RUNNING` (Hard-Bounded to 1 Iteration)**:
   - Entered ONLY for eligible records where primary candidate was rejected by A3 verifier and feedback refinement is requested.
   - Generates exactly ONE refined candidate per instance.
   - **`feedback_iteration_budget` is strictly decremented to 0.**
   - No `while` loops, no retries, no dynamic re-evaluations.

6. **`A4_COMPLETED`**:
   - Terminal success state.
   - Refined candidate outcomes evaluated via host-binding, strict serialization, and static gating.
   - Final disposition durably written to `a4_results.jsonl`.
   - Post-A4 evidence report and cryptographic seal generated.

---

## 4. Terminal Failure Handling & Crash Recovery

1. **Pre-Execution Failure (during `A4_PREFLIGHT_READY`)**:
   - Fails closed with zero disk side-effects. Safe to re-inspect once environment is corrected.

2. **Verifier Failure (during `A4_VERIFIER_REVIEW`)**:
   - If an unhandled exception or model timeout occurs during verifier evaluation, the instance is recorded as `failure_code = VerifierExecutionError`.
   - The runner proceeds to the next instance or terminates.
   - The attempt remains consumed.

3. **Feedback Failure (during `A4_FEEDBACK_1_RUNNING`)**:
   - If the single allowed feedback refinement fails syntax normalization, contract validation, host-binding, or static gating:
     - The failure is recorded in `a4_results.jsonl` under `feedback_failure_code`.
     - **NO SECOND REFINEMENT IS ATTEMPTED.**
     - The instance disposition defaults permanently to `NoPrimary` / `REJECTED`.

4. **Process Crash After Marker Creation**:
   - If the process is terminated, preempted, or interrupted while in `A4_ATTEMPT_RECORDED` or later:
     - The attempt marker remains permanently in place.
     - **NO AUTOMATIC OR BLIND RERUN IS AUTHORIZED.**
     - Recovery is restricted strictly to an audited **forensic resumption** that inspects partial line counts and resumes cleanly without re-running completed instances, under strict human oversight.

---

## 5. Allowed and Forbidden Writes

### Allowed Writes:
- Dedicated A4 namespace ONLY:
  `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/a4_v1/`
- Attempt Marker:
  `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/a4_v1/.CANONICAL_V3_A234_DEV30_A4_ATTEMPTED`
- A4 Launch Receipt:
  `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/a4_v1/launch_receipts_a4/`
- A4 Result Dataset:
  `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/a4_v1/a234_hardened_v2_9_a4/results.jsonl`
- Canonical Reports in version control:
  `training/reports/fulgor_ray_v3_0_a234_a4_*.{json,md,txt}`

### Forbidden Writes:
- **STRICTLY FORBIDDEN**: Writing into `training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/` or any V1/V2/V3/V5 directory.
- **STRICTLY FORBIDDEN**: Overwriting or modifying existing V6 results (`results_sha256 = 29e59352...`).
- **STRICTLY FORBIDDEN**: Retroactively changing any V6 gate result or synthesizing missing verifier scores.
- **STRICTLY FORBIDDEN**: Committing raw `results.jsonl` or model text outputs to Git.
- **STRICTLY FORBIDDEN**: Mutating existing sealed manifest files.

---

## 6. Evaluation Contamination & Held-Out Rules

1. **No Canonical DEV30 Reuse**:
   - The DEV30 dataset has now exposed aggregate pipeline failure modes (10 JSON recovery failures, 6 semantic intent failures, 17 contract errors, 10 host-binding/span/anchor derivation errors).
   - **`CANONICAL_DEV30_REUSE_AUTHORIZED = false`**.
   - Individual DEV30 semantic contents, prompts, patches, and problem statements must NEVER be used to hand-tune or overfit repairs.

2. **Remediation Methodology**:
   - All pipeline remediation must be developed strictly via source-code contract analysis, deterministic unit tests, parser/schema tests, static gate tests, and dedicated non-DEV30 synthetic fixtures.

3. **Fresh Held-Out Requirement**:
   - After remediation of the pre-A3 failure classes, evaluation MUST NOT rerun on canonical DEV30.
   - A fresh, independently sealed held-out evaluation dataset with a new immutable input hash, distinct instance IDs, and an independent one-shot launch receipt/seal workflow is required for unbiased evaluation.
