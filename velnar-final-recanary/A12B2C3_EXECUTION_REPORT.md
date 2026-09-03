# VELNAR AI — Phase A.12B.2C-3 Execution Report: Offline Canonical Replay & Fallback Regression

**Phase**: A.12B.2C-3  
**Status**: `READY_FOR_INDEPENDENT_AUDIT`  
**Execution Timestamp**: 2026-09-02T07:10:00.000Z  
**Certified Routing Policy Version**: `a12b2c-v1`  
**Evaluation Scoring Policy Version**: `v1.2.1`  
**Dataset Version**: `velnar-shadow-v1`  
**Runtime Policy Status**: `DORMANT` (`enforcementAllowed === false`)

---

## 1. Executive Summary & Provenance Separation

- **Historical LIVE Source**: `execution/a12b2b_full_v121_results.json` (Phase A.12B.2B controlled live shadow run, 132 live provider invocations).
- **Current Execution (Phase A.12B.2C-3)**: **100% OFFLINE SYNTHETIC REPLAY & REPAIR HARNESS**.
- **Real Provider Network Calls**: **0** (ZERO Gemini, ZERO DeepSeek, ZERO Kimi, ZERO Fulgor, ZERO global network calls).
- **Unexpected Real Network Attempts**: **0** (Verified via active global fetch sentinel throwing `A12B2C3_REAL_NETWORK_FORBIDDEN` if invoked).

---

## 2. Quantitative Verification Matrix

| Metric / Dimension | Target / Expected | Observed Result | Status |
| :--- | :--- | :--- | :--- |
| **Total Canonical Records** | 132 | 132 | **PASS** |
| **DeepSeek Replay Invocations** | 66 | 66 | **PASS** |
| **Gemini Replay Invocations** | 66 | 66 | **PASS** |
| **Provider Provenance Pass Count** | 132 / 132 | 132 / 132 | **PASS** |
| **Provider Provenance Mismatch Count** | 0 | 0 | **PASS** |
| **Real / Global Network Calls** | 0 | 0 | **PASS** |
| **Unexpected Real Network Attempts** | 0 | 0 | **PASS** |
| **Blocked Case Provider Fetches** | 0 | 0 | **PASS** |
| **Request Contract Parity Failures** | 0 | 0 | **PASS** |
| **DeepSeek Thinking Tokens Match** | 66 / 66 (exact) | 66 / 66 (exact) | **PASS** |
| **DeepSeek Cache Semantics Match** | 66 / 66 derived `VERIFIED` | 66 / 66 derived `VERIFIED` | **PASS** |
| **Gemini Service Tier Match** | 66 / 66 (`flex`) | 66 / 66 (`flex`) | **PASS** |
| **Routing Policy Mismatches** | 0 | 0 | **PASS** |
| **Fallback Sequencing Contract** | PASS | PASS | **PASS** |
| **Privacy Matrix Verification** | PASS | PASS | **PASS** |
| **Pricing Window Verification** | PASS | PASS | **PASS** |
| **TypeScript Typecheck (`tsc --noEmit`)** | 0 errors | 0 errors | **PASS** |
| **Vitest Test Suite (`npm test`)** | 602 / 602 passed | 602 / 602 passed (33 files) | **PASS** |
| **Production Build (`npm run build`)** | Clean bundle | Clean bundle (`dist/`) | **PASS** |

---

## 3. Detailed Technical Verification

### 3.1 DeepSeek Synthetic Usage Shape & Thinking Tokens
- Replay synthetic adapter emits the sealed shape: `usage.completion_tokens_details.reasoning_tokens`.
- All 66 DeepSeek replayed invocations have `thinkingTokens` exactly equal to canonical `thinkingTokens` (0 mismatches).
- `DeepSeekCertifiedProvider` remained completely unmodified.

### 3.2 Honest Historical DeepSeek `cacheStatus` Derivation
- Historical A.12B.2B DeepSeek records omitted explicit `cacheStatus` field but preserved `usageSource = PROVIDER_REPORTED` and mathematically valid `promptTokens = cacheHitTokens + cacheMissTokens`.
- Replay harness derived `expectedCacheStatus = VERIFIED` with explicit audit provenance tag: `cacheStatusComparisonSource = DERIVED_FROM_CANONICAL_PROVIDER_REPORTED_CACHE_SPLIT`.
- Canonical records with explicit `cacheStatus` (Gemini) were verified directly without mutation.

### 3.3 Provenance & Request Contract Comparisons
- Provenance checks compared across all 132 records:
  - `providerId`
  - `candidateId`
  - `requestedModelIdentifier`
  - `returnedModelIdentifier`
  - `providerModelVersion` (where present)
  - `serviceTier` (Gemini: `flex`)
  - `promptTokens`, `cacheHitTokens`, `cacheMissTokens`, `completionTokens`, `thinkingTokens`, `totalTokens`
  - `usageSource` (`PROVIDER_REPORTED`)
  - `cacheStatus` semantics
- Request Contract verified:
  - DeepSeek payload: `temperature: 0.0`, `max_tokens: 4096`, `response_format: { type: "json_object" }`, `thinking: { type: "enabled", budget_tokens: 2048 }`.
  - Gemini payload: `responseModalities: ["TEXT"]`, `serviceTier: "flex"`, `thinkingConfig: { thinkingLevel: "low" }`, `responseMimeType: "application/json"`.

### 3.4 Strict Global Fetch Sentinel
- Installed global fetch sentinel during replay testing that increments `unexpectedRealNetworkAttemptCount` and immediately throws `A12B2C3_REAL_NETWORK_FORBIDDEN` if any un-injected fetch is attempted.
- Result: `unexpectedRealNetworkAttemptCount === 0`.

### 3.5 Replay Metadata & Mock Provenance Labeling
- Replayed records are explicitly wrapped with audit metadata:
  - `replayTransport: "SYNTHETIC_CUSTOM_FETCH"`
  - `liveProviderCall: false`
  - `isOfflineReplay: true`
- Avoids misrepresenting offline replay as live inference.

### 3.6 Semantic Replay vs Raw-Output Reconstruction Boundaries
- The canonical artifact preserved `parsedOutput` but not full raw text strings.
- Replay reports:
  - `rawReplayStatus: "NOT_RECONSTRUCTABLE_FROM_CANONICAL_ARTIFACT"`
  - `normalizedSemanticReplayStatus: "NORMALIZED_REPLAY_ONLY"`
  - `normalizedScoreMatchCount: 127` (5 invalid-schema historical failures classified as not replayable from preserved evidence).
  - `exactSemanticReplayCount: 0` (honestly reported without inflating claims).

### 3.7 Security & Privacy Zero-Call Proof
- `PERSONAL`, `SENSITIVE`, and `SECRET` cases fail closed before synthetic fetch with 0 network calls.
- 3 canonical blocked cases produce 0 external provider fetches.
- `PUBLIC_BUSINESS` and `PSEUDONYMOUS_OPERATIONAL` cases proceed within security boundaries.

### 3.8 Pure Offline Fallback Sequencing Contract
- Proved 6 distinct deterministic fallback scenarios:
  1. DeepSeek HTTP 503 -> Same-provider retry -> Success => Gemini fallback NOT eligible.
  2. DeepSeek persistent HTTP 503 -> Retry exhaustion => Gemini fallback becomes eligible.
  3. DeepSeek `MODEL_SUBSTITUTION_DETECTED` => NO fallback (security breach).
  4. DeepSeek `TELEMETRY_INTEGRITY_FAILURE` => NO fallback (telemetry breach).
  5. Low semantic quality score => NO fallback (prohibited by contract).
  6. Gemini fallback failure => NO recursive fallback to Kimi, Fulgor, or DeepSeek (terminates).

### 3.9 Pricing Window Schedule Matrix
- Weekday off-peak: `OFF_PEAK_CERTIFIED`.
- Weekday peak windows (01:00-04:00 UTC, 06:00-10:00 UTC): `PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION`.
- Saturday & Sunday peak-clock-equivalent: `OFF_PEAK_CERTIFIED`.
- Peak status does NOT mutate routing recommendation or bypass policy.

---

## 4. Final Phase Status

```
A.12B.2C-3 = READY_FOR_INDEPENDENT_AUDIT
```

- **Canary Execution**: NOT started (prohibited in Phase A.12B.2C-3).
- **Live Routing Activation**: NOT active (`enforcementAllowed === false`).
- **Audit Verification Ready**: Complete canonical reproducibility and deterministic fallback regression certified.
