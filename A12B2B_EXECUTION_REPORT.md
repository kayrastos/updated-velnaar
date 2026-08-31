# VELNAR SPRINT 4 AI INTELLIGENCE FINALIZATION — PHASE A.12B.2B EXECUTION REPORT
## CONTROLLED LIVE EVALUATION SPECIFICATION & INVARIANTS CERTIFICATION

**PHASE:** A.12B.2B — Controlled Live Evaluation Specification & Invariants  
**DATE:** 2026-08-31  
**CERTIFICATION STATUS:** READY_FOR_LIVE_EXECUTION  
**PAID PROVIDER CALLS:** 0  
**SOURCE MODIFICATIONS:** NONE  
**TEST MODIFICATIONS:** NONE  

---

## 1. Executive Summary & Verification Gates

- **TYPECHECK EXIT CODE:** 0
- **TEST EXIT CODE:** 0
- **TEST FILES FAILED:** 0
- **TESTS FAILED:** 0
- **TOTAL TEST FILES:** 30 passed (30)
- **TOTAL TESTS:** 487 passed (487)
- **BUILD EXIT CODE:** 0
- **PAID PROVIDER CALLS:** 0

---

## 2. Phase A.12B.2B Test Suite Breakdown

**Test File:** `tests/ai/phaseA12B2BControlledLiveEvaluation.test.ts`  
**Test Count:** 40 passed (40)

### Verified Invariant Coverage:
1. **Canonical 3-Smoke-Case Verification & Selection**:
   - `eval_v1_lead_01` (Normal operational lead intent)
   - `eval_v1_lead_03_injection` (Adversarial prompt injection)
   - `eval_v1_lead_06_insufficient` (Insufficient evidence fail-closed)
2. **Smoke Fixture Integrity & Preflight Gate**:
   - Halts immediately with `A12B2B_SMOKE_FIXTURE_INTEGRITY_FAILURE` and 0 network calls if required fixtures are missing from prepared dataset.
3. **Exact DeepSeek Model Identity Enforcement**:
   - Enforces exact identity equality: `returnedModelIdentifier === "deepseek-v4-flash"`.
   - Records immutable telemetry provenance in `providerModelVersion`.
4. **Exact Gemini Model Identity Enforcement**:
   - Enforces exact identity equality: `returnedModelIdentifier === "gemini-3.5-flash-lite"`.
   - Enforces `flex` routing tier and records `providerModelVersion`.
5. **Lookalike Model Rejection**:
   - Rejects `deepseek-chat`, `deepseek-reasoner`, `deepseek-v4-flash-pro`, `evil-deepseek-v4-flash-proxy` with `A12B2B_MODEL_SUBSTITUTION_DETECTED`.
   - Rejects `gemini-3.5-flash-lite-preview`, `gemini-3.5-flash-lite-other`, `evil-gemini-3.5-flash-lite-proxy` with `A12B2B_MODEL_SUBSTITUTION_DETECTED`.
6. **UTF-8 Byte-based Conservative Input Budget Bounds**:
   - Derives input upper bound from exact UTF-8 byte length (`Buffer.byteLength(canonicalPrompt, 'utf8')`).
   - Assumes zero DeepSeek cache hits for fail-closed preflight spend reservation.
7. **Oversized Input → Zero Network Calls Preflight Rejection**:
   - Rejects inputs exceeding `A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND` (4,000 tokens) with `A12B2B_INPUT_BOUND_EXCEEDED` and 0 network calls.
8. **Actual-Case Full Protocol Budget Preflight**:
   - Derives worst-case protocol spend from real dataset cases across candidates and replicates.
9. **Replicate Protocol & Orchestration State Machine**:
   - Enforces 3 replicates per model-case combination in full evaluation mode.
   - Ensures strict separation between smoke results and full evaluation run results.

---

## 3. Execution Artifacts Summary

- `execution/a12b2b_typecheck.log`: `TYPECHECK_EXIT_CODE=0`
- `execution/a12b2b_test.log`: 30 passed test files, 487 passed tests, `TEST_EXIT_CODE=0`
- `execution/a12b2b_build.log`: Vite build succeeded, `BUILD_EXIT_CODE=0`

---

**PHASE A.12B.2B = READY_FOR_LIVE_EXECUTION**
