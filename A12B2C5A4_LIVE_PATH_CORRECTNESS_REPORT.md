# VELNAR AI — Phase A.12B.2C-5A.4 Live Path Correctness & Evidence Repair Report

**Audit Phase**: `A.12B.2C-5A.4` (Live Path Correctness & Evidence Repair)  
**Specification Version**: `a12b2c5-v1.1`  
**Document Version**: `1.0.0`  
**Execution Timestamp**: `2026-09-02T16:05:00.000Z`  
**Phase Status**: **`A.12B.2C-5A.4 = LIVE_PATH_CORRECTED_5B_ELIGIBLE_PENDING_HUMAN_AUTHORIZATION`**  
**Human Authorization Status**: **`NOT_YET_GRANTED`** (Human approval is a separate, future explicit action)  
**Production Routing Status**: **`DORMANT`** (`enforcementAllowed === false`)  

---

## Important Status Correction & Governance Clarification

The status previously reported in Phase A.12B.2C-5A.3:
$$\text{Status} = \text{LIVE\_TRANSPORT\_GATE\_CERTIFIED\_5B\_AUTHORIZED}$$
**MUST NOT be interpreted as human authorization.**

Phase 5A.3 and 5A.4 establish **technical eligibility only**. Human authorization for Phase A.12B.2C-5B has **NOT** occurred. Human authorization requires a separate, explicit offline operator action providing a secret-backed HMAC-SHA256 token with a valid out-of-band secret ($\ge 32$ characters).

---

## 1. Executive Summary

Phase A.12B.2C-5A.4 was conducted 100% OFFLINE with ZERO real provider or network calls.

The post-push review of commit `42bbf7a63bb4fcab4d2669ca4e602373f216c541` identified that the live runner previously computed:
```typescript
maxAllowedTotalCalls = maxTotalInvocations + maxSameProviderRetries + maxCrossProviderFallbacks;
```
which erroneously permitted up to 17 calls instead of the strict 14/7 hard caps.

In Phase **A.12B.2C-5A.4**, this defect has been completely resolved:
1. **Strict 14 / 7 Hard Caps Restored**:
   - Total outbound transport requests across entire execution: $\le 14$.
   - Total outbound transport requests per provider: $\le 7$.
   - Retry attempts (HTTP 503) and fallback attempts **consume** these hard caps; they do **not** expand them.
2. **Deterministic Fail-Closed Accounting**:
   - If a retry or fallback causes a provider to exhaust its 7-call quota before completing all scheduled tasks, execution deterministically terminates fail-closed via the `INVOCATION_LIMIT_BREACH` kill switch rather than silently making an 8th call.
3. **Evidence & Certification Tests Updated**:
   - Updated the 503 retry certification test to verify this invariant: a retry on Task 1 consumes DeepSeek's quota, allowing 6 tasks to complete before Task 7 triggers `INVOCATION_LIMIT_BREACH` with 6 passed invocations and fail-closed termination.
4. **Complete Offline Regression**:
   - All **37 test files** and **683 tests** passed cleanly.
   - 0 TypeScript compiler errors (`tsc --noEmit`).
   - Production build compiled successfully (`vite build && esbuild`).

---

## 2. Blocker Remediation: True 14 / 7 Hard Caps

### The Defect
The previous implementation in `boundedCanaryRunner.ts` allowed the total call ceiling to expand when retries or fallbacks were configured:
```typescript
// DEFECTIVE IMPLEMENTATION:
const maxAllowedTotalCalls = CANARY_INVOCATION_LIMITS.maxTotalInvocations +
  CANARY_INVOCATION_LIMITS.maxSameProviderRetries +
  CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks; // 14 + 1 + 1 = 16 (or 17)
```

### The Corrected Implementation
The runner now strictly enforces the specification constants directly as non-expandable ceilings:
```typescript
// CORRECTED STRICT IMPLEMENTATION:
const maxAllowedTotalCalls = CANARY_INVOCATION_LIMITS.maxTotalInvocations; // Exactly 14
const maxAllowedProviderCalls = CANARY_INVOCATION_LIMITS.maxInvocationsPerProvider; // Exactly 7

if (totalTransportAttempts + 1 > maxAllowedTotalCalls) {
  const killSwitch: CanaryKillSwitchEvent = {
    timestamp: now().toISOString(),
    reason: 'INVOCATION_LIMIT_BREACH',
    message: `Total invocation quota ${maxAllowedTotalCalls} exceeded (attempted call #${totalTransportAttempts + 1}).`,
    terminatedFailClosed: true,
  };
  return { success: false, status: 429, killSwitch };
}

if (providerTransportAttempts[params.candidate.providerId] + 1 > maxAllowedProviderCalls) {
  const killSwitch: CanaryKillSwitchEvent = {
    timestamp: now().toISOString(),
    reason: 'INVOCATION_LIMIT_BREACH',
    message: `Provider invocation quota ${maxAllowedProviderCalls} exceeded for ${params.candidate.providerId}.`,
    terminatedFailClosed: true,
  };
  return { success: false, status: 429, killSwitch };
}
```

---

## 3. Verification & Test Evidence

### Test Summary
- **Test Suites**: 37 passed / 37 total (100%)
- **Total Tests**: 683 passed / 683 total (100%)
- **Snapshots**: 0 failed
- **Typecheck (`tsc --noEmit`)**: 0 errors
- **Production Build**: Clean (`dist/` generated with zero warnings)

### Key Test Coverage
- `phaseA12B2C5A3LiveTransportCertification.test.ts` (18 tests):
  - Strict 14/7 hard cap accounting.
  - Secret-backed approval token validation.
  - Constant-time HMAC-SHA256 signature verification.
  - Calendar date and freshness validation.
  - 17-trigger kill switch catalog.
  - Complete zero-secret leakage in output artifacts.

---

## 4. Phase Invariants & Security Directives Checklist

- [x] **100% OFFLINE execution**: Zero real network requests to DeepSeek or Gemini.
- [x] **Zero real provider credentials**: Only mock/synthetic keys used in tests.
- [x] **Production routing DORMANT**: `enforcementAllowed === false` preserved across all routers and policies.
- [x] **No execution of Phase 5B**: Live execution remains unexecuted.
- [x] **Human authorization distinction recorded**: 5A.4 establishes technical readiness; human approval remains ungranted.
- [x] **Evidence preserved**: Prior audit and evidence records maintained intact.
