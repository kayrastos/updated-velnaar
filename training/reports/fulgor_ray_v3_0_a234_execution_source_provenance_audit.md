# Fulgor Ray V3 A234 — Execution Source Provenance Recovery Audit

## 1. Executive Summary

This report documents the read-only forensic provenance audit of every first-party source dependency required by the sealed **Fulgor Ray V3 A234 V6 DEV30 Execution**.

- **Status**: `PASS_A234_EXECUTION_SOURCE_PROVENANCE_AUDIT`
- **Canonical HEAD**: `40eb6e02f18d5d241cd9cb23f9380418f7899638` on branch `fulgor/a234-v6-handoff-20260906`
- **Sealed Results SHA256**: `29e5935280052513a7bdb2c6203c76591f47c5e8ec9116adff5a6e6849670747`
- **Post-Run Final Seal SHA256**: `c2f2273b3ce438d73ef3c4f0ec4ae93fa2b2bfb19b145ff6974c0c0914d243a9`
- **Source Reproducibility Classification**: **`SOURCE_PROVENANCE_INCOMPLETE`**
- **Root-Cause Audit Eligibility**: **`ROOT_CAUSE_AUDIT_ELIGIBLE = false`**

---

## 2. Complete First-Party Dependency Graph & Inventory

The V6 runner (`run_fulgor_v3_0_a234_dev30_inference_v6.py`) and launch receipt module require 12 first-party modules. A complete inventory reveals that **only 4 modules are present in canonical Git at HEAD, while 8 critical runtime modules are absent**:

| Module Name | Path | Classification | Role / Functionality | Expected SHA256 Binding |
| :--- | :--- | :--- | :--- | :--- |
| `candidate_host_binding_v1` | `training/fulgor_ray_v3/candidate_host_binding_v1.py` | `A. PRESENT_AND_TRACKED` | Host-binding, line-span validation, anchor derivation | `b5a7fc33...` (Bound in V6 Candidate & Receipt Seals) |
| `semantic_patch_intent_v2` | `training/fulgor_ray_v3/semantic_patch_intent_v2.py` | `A. PRESENT_AND_TRACKED` | Patch intent schema, coordinate normalization | `31a6f04f...` (Bound in V6 Candidate & Receipt Seals) |
| `stage_contract_prompts_v4` | `training/fulgor_ray_v3/stage_contract_prompts_v4.py` | `A. PRESENT_AND_TRACKED` | System prompts for diagnosis, plan, candidate, verifier | `a66bf491...` (Bound in V6 Candidate & Receipt Seals) |
| `a234_launch_receipt_v6` | `training/fulgor_ray_v3/a234_launch_receipt_v6.py` | `A. PRESENT_AND_TRACKED` | Preflight inspection, launch receipt gate, audit trail | `23ebd02f...` (Bound in V6 Launch Receipt Seal) |
| `context_budget_v2` | `training/fulgor_ray_v3/context_budget_v2.py` | `E. EXPECTED_BUT_NOT_FOUND` | Context budgeting, chat tokenization, token fitting | `da9ae0af...` (Bound in runner preflight & real inspect) |
| `a1_inference` | `training/fulgor_ray_v3/a1_inference.py` | `E. EXPECTED_BUT_NOT_FOUND` | `LocalRepositoryProvider`, file reading | Unpinned in seals (inherited from V1) |
| `a234_inference` | `training/fulgor_ray_v3/a234_inference.py` | `E. EXPECTED_BUT_NOT_FOUND` | `A234ContractError`, candidate selection, blinding | Unpinned in seals (inherited from V2) |
| `constants` | `training/fulgor_ray_v3/constants.py` | `E. EXPECTED_BUT_NOT_FOUND` | `CANDIDATE_BUDGET=3`, `MAX_FEEDBACK_REFINEMENTS=1` | Unpinned in seals |
| `patch_serializer` | `training/fulgor_ray_v3/patch_serializer.py` | `E. EXPECTED_BUT_NOT_FOUND` | Strict serializer, `SerializationError`, unified diffs | Unpinned in seals (inherited from V1) |
| `schemas` | `training/fulgor_ray_v3/schemas.py` | `E. EXPECTED_BUT_NOT_FOUND` | `ContractError`, `DiagnosisV1`, `RepairPlanV1`, etc. | Unpinned in seals |
| `static_gate` | `training/fulgor_ray_v3/static_gate.py` | `E. EXPECTED_BUT_NOT_FOUND` | `evaluate()`, static patch gate rules | Unpinned in seals (inherited from V2) |
| `structured_output_recovery` | `training/fulgor_ray_v3/structured_output_recovery.py` | `E. EXPECTED_BUT_NOT_FOUND` | `StructuredOutputRecoveryError`, JSON normalizer | Unpinned in seals (inherited from V3) |

---

## 3. Git Database & Local Storage Forensic Search

1. **Canonical Git Tree & Object Database Inspection**:
   - `git ls-files` confirms only 4 of the 12 modules exist under `training/fulgor_ray_v3/`.
   - `git rev-list --objects --all` verified across all branches and historical tags in `kayra-ai-codex-phase1` confirms that none of the 8 missing module paths ever existed in this local Git object database.
   - Commit `8e1aa54` ("chore(fulgor): import verified A234 V6 handoff checkpoint") extracted `fulgor-v6-handoff-20260906.tar.gz`, which contained ONLY the V6 additive components. The pre-existing runtime modules were never bundled into the handoff archive.

2. **Local Storage Search Results**:
   - Deep search across `D:\YapayZeka\`, `C:\Users\kayra\Downloads\`, and Antigravity brain/scratch storage located **ZERO local copies** of the 8 missing runtime files.
   - All archives in Downloads (`fulgor-v6-dev30-postrun-final-20260907.tar.gz`, `fulgor-v6-handoff-20260906.tar.gz`, `fulgor-ray-v1.1-gemma12b-final-dev-pass.tar.gz`, etc.) were inspected; none contain the missing runtime source files.

3. **Known Context Budget Gap**:
   - `context_budget_v2.py` is explicitly pinned to SHA256 `da9ae0af2ed057287660abf820d31b4bed869b89d97a38db53ba9d9680f3374c`.
   - **`CONTEXT_BUDGET_V2_RECOVERED_EXACT = false`** (no local copy found).

---

## 4. Source Reproducibility Classification

**Classification**: **`SOURCE_PROVENANCE_INCOMPLETE`**
- The execution source code cannot be reproduced locally from canonical Git or existing local storage.
- The 8 missing first-party modules existed on the remote GPU host (`fulgor-v3-g4-96`, `/home/kayra01_09_06/kayra-ai/training/fulgor_ray_v3/`) during the real execution of V6, but were never imported into the local workspace.

---

## 5. Root-Cause Audit Eligibility

**`ROOT_CAUSE_AUDIT_ELIGIBLE = false`**

### Failure Class Mapping & Blocker Analysis:
The 7 observed DEV30 failure classes map to the following implementation modules:
1. `DiagnosisTargetMembershipError`: Implemented in `run_fulgor_v3_0_a234_dev30_inference_v6.py` [TRACKED]
2. `SemanticIntentError`: Implemented in `training/fulgor_ray_v3/semantic_patch_intent_v2.py` [TRACKED]
3. `CandidateHostBindingError`: Implemented in `training/fulgor_ray_v3/candidate_host_binding_v1.py` [TRACKED]
4. `CandidateLineSpanError`: Implemented in `training/fulgor_ray_v3/candidate_host_binding_v1.py` [TRACKED]
5. `CandidateAnchorDerivationError`: Implemented in `training/fulgor_ray_v3/candidate_host_binding_v1.py` [TRACKED]
6. `StructuredOutputRecoveryError` (10 instances): Implemented in `training/fulgor_ray_v3/structured_output_recovery.py` **[MISSING]**
7. `A234ContractError` (20 instances): Implemented in `training/fulgor_ray_v3/a234_inference.py` / `schemas.py` **[MISSING]**

Because `StructuredOutputRecoveryError` and `A234ContractError` account for 30 of the observed failures and rely entirely on missing modules, the root-cause audit cannot proceed without guessing or substituting unverified code, which is strictly prohibited.

**Blockers**:
- `MISSING_SOURCE_A234_INFERENCE`
- `MISSING_SOURCE_STRUCTURED_OUTPUT_RECOVERY`
- `MISSING_SOURCE_CONTEXT_BUDGET_V2`
- `MISSING_SOURCE_PATCH_SERIALIZER`
- `MISSING_SOURCE_STATIC_GATE`
- `MISSING_SOURCE_SCHEMAS`
- `MISSING_SOURCE_A1_INFERENCE`
- `MISSING_SOURCE_CONSTANTS`
