# PHASE A.12B.2C-2B EXECUTION REPORT: CERTIFIED PROVIDER PARITY ADAPTERS

**Phase Identifier:** `A.12B.2C-2B`  
**Status:** **READY_FOR_INDEPENDENT_AUDIT**  
**Execution Timestamp:** 2026-09-01T13:31:00Z  
**Real Provider API Calls Executed:** `0` (Zero DeepSeek, Zero Gemini, Zero Kimi, Zero Fulgor)  
**Production Runtime Interruption / Behavioral Alteration:** `NONE` (Legacy router and adapters untouched)  
**Adapter Activation Status:** `DORMANT` (Isolated from `aiRouter.ts` until Phase 2C-3 activation)

---

## 1. Executive Summary

Phase `A.12B.2C-2B` constructs the dormant, hardened certified provider adapters for the primary candidate (`deepseek-v4-flash-offpeak-low`) and the fallback candidate (`gemini-3.5-flash-lite-flex-low`). These adapters achieve strict 1:1 behavioral, structural, and contractual parity with the benchmark client (`worker/ai/providers/liveEvaluationClient.ts`), enforcing zero-tolerance fail-closed safeguards against model substitution, non-Flex downgrade, token telemetry tampering, privacy leakage, Chain-of-Thought exposure, output token bounds divergence, and uncertified task scope execution.

---

## 2. Core Certified Provider Implementations

### 2.1 Exact Token Bound Parity (Canonical Constant)
- Both certified provider adapters import and strictly enforce `A12B2B_MAX_OUTPUT_TOKENS_BOUND` (`2048`) from `worker/ai/evaluation/evaluationLiveTypes.ts`.
- `envelope.maxTokens` cannot raise or lower this bound; certified benchmark compliance requires exact 2048 token allocation.

### 2.2 Task Certification Scope Gate (7 Canonical Tasks)
- Defined immutable set `CERTIFIED_A12B2C_TASK_TYPES`:
  1. `LEAD_INTENT_CLASSIFICATION`
  2. `LEAK_EXPLANATION`
  3. `GROWTH_ACTION_DRAFT`
  4. `BUSINESS_TWIN_SUMMARY`
  5. `FUNNEL_DIAGNOSTIC_EXPLANATION`
  6. `SEO_CONTENT_SUGGESTION`
  7. `ANOMALY_TRIAGE`
- Invocations with any TaskType outside this canonical set fail-closed with `TASK_NOT_CERTIFIED` prior to network invocation (Zero-Fetch guarantee).

### 2.3 DeepSeek Certified Adapter (`DeepSeekCertifiedProvider`)
- **Source File:** `worker/ai/providers/deepSeekCertifiedProvider.ts`
- **Certified Profile ID:** `deepseek-v4-flash-offpeak-low`
- **Certified Model:** `deepseek-v4-flash`
- **Canonical Endpoint:** `https://api.deepseek.com/v1/chat/completions` (Strict URL validator blocks lookalikes, query credentials, and alternate ports).
- **Certified Execution Parameters:**
  - `response_format`: `{ type: "json_object" }`
  - `thinking`: `{ type: "enabled" }`
  - `reasoning_effort`: `"low"`
  - `max_tokens`: `2048` (`A12B2B_MAX_OUTPUT_TOKENS_BOUND`)
- **Model Identity Enforcement:** Exact string match required (`json.model === "deepseek-v4-flash"`). Substituted models trigger immediate, non-transient `MODEL_SUBSTITUTION_DETECTED` fail-closed exception.
- **Cache Telemetry & Provenance:** Provider-reported `prompt_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `completion_tokens`, `reasoning_tokens`, and `total_tokens` required. Enforces invariant `prompt_tokens === prompt_cache_hit_tokens + prompt_cache_miss_tokens` (`TELEMETRY_INTEGRITY_FAILURE`). Always reports `cacheStatus: 'VERIFIED'`.
- **Pricing Certification Status Helper:** Exposes pure static helper `getPricingCertificationStatus(date)` returning `OFF_PEAK_CERTIFIED` or `PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION` based on deterministic UTC window calculation.
- **CoT Sanitization:** `reasoning_content` is strictly isolated and never exposed in returned `content`.
- **Privacy Preflight Gate:** Invocations with `PERSONAL`, `SENSITIVE`, or `SECRET` classifications fail-closed with `PRIVACY_VIOLATION` before any network connection is initiated (Zero-Fetch guarantee).

### 2.4 Gemini Certified Adapter (`GeminiCertifiedProvider`)
- **Source File:** `worker/ai/providers/geminiCertifiedProvider.ts`
- **Certified Profile ID:** `gemini-3.5-flash-lite-flex-low`
- **Certified Model:** `gemini-3.5-flash-lite`
- **Canonical Endpoint:** `https://generativelanguage.googleapis.com/v1beta/interactions` (Interactions API)
- **Certified Execution Parameters:**
  - `service_tier`: `"flex"`
  - `generation_config.thinking_level`: `"low"`
  - `generation_config.max_output_tokens`: `2048` (`A12B2B_MAX_OUTPUT_TOKENS_BOUND`)
  - `response_format`: `{ type: "text", mime_type: "application/json" }`
- **Service Tier Enforcement:** Returned `service_tier` MUST equal `"flex"`. Standard or downgraded service tiers trigger immediate `SERVICE_TIER_MISMATCH` fail-closed exception.
- **Model Identity Enforcement:** Exact string match required (`json.model === "gemini-3.5-flash-lite"`). Substituted models trigger `MODEL_SUBSTITUTION_DETECTED`.
- **Cache Telemetry & Integrity:** When `total_cached_tokens` is provider-reported, validates `0 <= total_cached_tokens <= total_input_tokens` (fails closed with `TELEMETRY_INTEGRITY_FAILURE` if violated) and sets `cacheStatus: 'VERIFIED'`. When omitted, sets `cacheStatus: 'NOT_VERIFIED'`.
- **Thought Sanitization:** Hidden thought steps (`type === "thought"`) are isolated; only `model_output` / `output` parts populate returned `content`.
- **Privacy Preflight Gate:** Zero-Fetch enforcement for `PERSONAL`, `SENSITIVE`, and `SECRET` classifications.
- **Diagnostic Redaction:** API keys and credential strings are deterministically redacted from all exception messages and error diagnostic telemetry.

### 2.5 Shared Type Contract (`certifiedProviderTypes.ts`)
- **Source File:** `worker/ai/providers/certifiedProviderTypes.ts`
- Encodes structured `CertifiedProviderResponse` (including `cacheStatus: 'VERIFIED' | 'NOT_VERIFIED'`), `CertifiedUsageTelemetry`, `CERTIFIED_A12B2C_TASK_TYPES`, `isCertifiedA12B2CTaskType`, and `CertifiedProviderError` with explicit typed failure categories (`HTTP_429`, `HTTP_500`, `HTTP_502`, `HTTP_503`, `HTTP_504`, `NETWORK_TRANSPORT_FAILURE`, `MODEL_SUBSTITUTION_DETECTED`, `SERVICE_TIER_MISMATCH`, `TELEMETRY_INCOMPLETE`, `TELEMETRY_INTEGRITY_FAILURE`, `PRIVACY_VIOLATION`, `TASK_NOT_CERTIFIED`, `CREDENTIALS_MISSING`, `MAX_RETRIES_EXCEEDED`).

---

## 3. Retry Strategy & Non-Interference Guarantees

### 3.1 Bounded Exponential Retry Contract
- **Eligible Failover Triggers:** Transient errors only (`HTTP_429`, `HTTP_500`, `HTTP_502`, `HTTP_503`, `HTTP_504`, `NETWORK_TRANSPORT_FAILURE`).
- **Maximum Attempts:** Initial invocation + maximum 2 retries (3 total attempts).
- **Prohibited Retries:** Non-transient errors (`HTTP_400`, `HTTP_401`, `HTTP_403`, `HTTP_404`, `TASK_NOT_CERTIFIED`, `MODEL_SUBSTITUTION_DETECTED`, `SERVICE_TIER_MISMATCH`, `PRIVACY_VIOLATION`, `MALFORMED_AI_OUTPUT`) terminate immediately on attempt 1 without retry.
- **Cross-Provider Isolation:** No cross-provider fallback occurs inside individual adapters.

### 3.2 Production Non-Interference Guarantee
- `aiRouter.ts` contains ZERO imports of `DeepSeekCertifiedProvider` or `GeminiCertifiedProvider`.
- Legacy `deepSeekProvider.ts` and `geminiProvider.ts` remain unchanged and continue serving production requests.
- No production routing behavior or request ordering is altered.

---

## 4. Verification & Validation Metrics

- **Parity Test Suite (`tests/ai/phaseA12B2CCertifiedProviderParity.test.ts`):**
  - Total Tests: 25 / 25 passed (100%).
  - weekend DeepSeek pricing certification regression = PASS
  - Zero live network calls executed.
- **Full Vitest System Suite (`execution/a12b2c2b_vitest_summary.json`):**
  - Total Test Suites: 186 / 186 passed (100%).
  - Total Tests: 573 / 573 passed (100%).
  - Failed Test Files: 0.
  - Failed Tests: 0.
  - Pending / Todo Tests: 0.
- **Provider Calls:**
  - Real Provider API Calls: 0 (Zero DeepSeek, Zero Gemini, Zero Kimi, Zero Fulgor).
- **TypeScript Typecheck (`npm run typecheck`):**
  - Exit Code: 0 (0 errors).
- **Production Build (`npm run build`):**
  - Exit Code: 0 (0 errors).

---

**A.12B.2C-2B = READY_FOR_INDEPENDENT_AUDIT**
