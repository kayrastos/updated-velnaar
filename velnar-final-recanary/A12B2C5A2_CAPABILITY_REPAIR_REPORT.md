# VELNAR AI — Phase A.12B.2C-5A.2 Capability Repair Report

**Audit Phase**: `A.12B.2C-5A.2` (Human Capability & Live-Runbook Repair)  
**Specification Version**: `a12b2c5-v1.1`  
**Document Version**: `1.0.0`  
**Execution Timestamp**: `2026-09-02T15:20:00.000Z`  
**Final Phase Status**: **`A.12B.2C-5A.2 = CAPABILITY_REPAIR_PASS_5B_ELIGIBLE`**  

---

## Executive Summary

During the post-push review of Phase A.12B.2C-5A.1, a material vulnerability was identified in the human approval authorization subsystem: the token validator permitted an unauthenticated public fallback string (`:VELNAR_CANARY_HUMAN_CAPABILITY_V1`) when an operator secret was not supplied. This created a potential bypass of the cryptographic capability gate.

In Phase **A.12B.2C-5A.2**, this deficiency was completely excised and replaced with a strict, cryptographically sealed HMAC-SHA256 authorization mechanism with fail-closed semantics across all execution and audit paths.

All 36 test suites comprising 665 tests passed with zero failures. Zero live provider calls were made, zero live credentials were used, and production routing remains strictly `DORMANT` (`enforcementAllowed === false`).

---

## 1. Blocker Analysis & Root Cause Remediation

### The Vulnerability
Previously, `canarySpecification.ts` contained a conditional fallback:
```typescript
// INSECURE PREVIOUS IMPLEMENTATION (REMOVED):
const secret = options?.capabilitySecret ?? ':VELNAR_CANARY_HUMAN_CAPABILITY_V1';
```
This allowed anyone with knowledge of the public codebase to construct a valid human approval token without possessing an actual cryptographic secret.

### The Remediation
1. **Total Elimination of Hardcoded Secrets**: All references to `:VELNAR_CANARY_HUMAN_CAPABILITY_V1` and default fallback strings were eradicated across all source files, runner harnesses, audit scripts, and runbooks.
2. **Mandatory Capability Secret Requirement**: Both token generation (`generateCanaryApprovalToken`) and validation (`validateHumanApprovalToken`) now require a non-empty `capabilitySecret` of at least 16 characters (128-bit minimum entropy). If missing or shorter than 16 characters, execution fails closed immediately.
3. **Full 64-Hex HMAC-SHA256 Signatures**: Approval signatures are computed as full 64-character lowercase hexadecimal digests (256-bit entropy) generated using `crypto.createHmac('sha256', secret)`.
4. **Constant-Time Verification**: Verification utilizes `crypto.timingSafeEqual` over raw byte buffers to prevent timing side-channel attacks.

---

## 2. Cryptographic Multi-Parameter Binding

The HMAC payload strictly concatenates 8 distinct execution dimensions:
$$\text{Payload} = \text{approvedBy} \parallel \text{targetPhase} \parallel \text{environmentTarget} \parallel \text{dateYyyyMmDd} \parallel \text{maxBudgetUsd} \parallel \text{approvalTimestamp} \parallel \text{specificationVersion} \parallel \text{sourceCommitSha} \parallel \text{runNonce}$$

| Parameter | Validation Rule | Tamper Consequence |
| :--- | :--- | :--- |
| `approvedBy` | Non-empty identity string (e.g. `security-lead@velnar.internal`) | Signature mismatch -> Abort (0 calls) |
| `targetPhase` | Must strictly equal `'A.12B.2C-5B'` | Phase check failure -> Abort (0 calls) |
| `environmentTarget` | Must strictly equal `'CONTROLLED_CANARY'` | Environment check failure -> Abort (0 calls) |
| `dateYyyyMmDd` | Valid Gregorian calendar date matching timestamp | Date validation failure -> Abort (0 calls) |
| `maxBudgetUsd` | Bounded float ($0 < \text{budget} \le 0.05$) formatted as `toFixed(2)` | Budget check / Signature mismatch -> Abort (0 calls) |
| `approvalTimestamp` | Valid ISO-8601 string within 3600s freshness window | Expiration failure -> Abort (0 calls) |
| `specificationVersion` | Must strictly equal `'a12b2c5-v1.1'` | Version check failure -> Abort (0 calls) |
| `sourceCommitSha` | Exact 40-hex git commit SHA of codebase | SHA mismatch -> Abort (0 calls) |
| `runNonce` | Unique $\ge 16$-char string per execution run | Nonce mismatch -> Abort (0 calls) |

---

## 3. Strict Calendar & Freshness Validation

1. **Gregorian Calendar Validation**: Custom date validator (`isValidCalendarDate`) strictly enforces leap years and real month lengths. Impossible dates (e.g. `20260231`, `20260229` in non-leap year, `20260431`, `20261301`) are rejected fail-closed.
2. **1-Hour Freshness Window**: Approval tokens are valid for a maximum of 3,600 seconds from their `approvalTimestamp`. Tokens older than 1 hour or with timestamps in the future are rejected.

---

## 4. Invocation Envelope & Retry/Fallback Accounting

All execution bounds remain strictly locked:
- **Total Invocations**: Maximum 14 total requests across all providers.
- **Per-Provider Limit**: Maximum 7 requests per provider candidate.
- **Concurrency**: Strictly sequential ($N=1$).
- **Same-Provider Retries**: Maximum 1 retry (for HTTP 503 transient errors).
- **Cross-Provider Fallbacks**: Maximum 1 fallback (DeepSeek $\to$ Gemini).
- **Accounting Invariant**: Every retry and fallback is recorded as a real provider request against both the 7-per-provider and 14-total request quotas. Exceeding either limit triggers immediate fail-closed termination (`INVOCATION_LIMIT_BREACH`).

---

## 5. Network Restrictions & Redirect Prevention

1. **Protocol & Host Restriction**: Outbound HTTPS requests are strictly constrained to:
   - `https://api.deepseek.com/v1/chat/completions` (or `/chat/completions`)
   - `https://generativelanguage.googleapis.com/v1beta/interactions`
2. **Redirect Elimination**: Fetch requests enforce `redirect: 'error'`. Any attempt by an external endpoint to issue a 301/302 redirect terminates the request immediately.
3. **Userinfo & Port Restrictions**: Userinfo credentials in URLs and non-443 ports are explicitly blocked.

---

## 6. Complete 17-Trigger Kill-Switch Catalog

The canary runtime incorporates 17 distinct fail-closed abort triggers:

1. `HUMAN_APPROVAL_INVALID`: Token missing, malformed, expired, or failed HMAC verification.
2. `UNAUTHORIZED_ENVIRONMENT`: Live invocation attempted outside Phase A.12B.2C-5B.
3. `PRIVACY_CLASSIFICATION_VIOLATION`: Prompt contains non-synthetic or sensitive data.
4. `TASK_SCOPE_VIOLATION`: Task requested is outside the 7 certified tasks.
5. `NETWORK_DESTINATION_MISMATCH`: Target endpoint outside allowlist or redirect attempted.
6. `PROVENANCE_MISMATCH`: Returned provider differs from requested candidate.
7. `MODEL_SUBSTITUTION_DETECTED`: Returned model does not match certified model ID.
8. `UNEXPECTED_MODEL_VERSION`: Runtime version differs from certified baseline.
9. `MALFORMED_USAGE_TELEMETRY`: Token telemetry fields missing or invalid.
10. `CACHE_ARITHMETIC_INCONSISTENCY`: Token cache hit/miss math fails reconciliation.
11. `REASONING_TOKEN_INCONSISTENCY`: Reasoning budget or thinking tokens malformed.
12. `REASONING_LEAKAGE_DETECTED`: Unsanitized reasoning traces detected in output.
13. `UNEXPECTED_RETRY_OR_FALLBACK`: Retries/fallbacks exceed single-attempt limits.
14. `RECURSIVE_FALLBACK_ATTEMPTED`: Gemini attempting secondary fallback to uncertified providers.
15. `COST_CEILING_BREACH`: Cumulative cost exceeds **$0.05 USD** (`50,000 microUSD`).
16. `INVOCATION_LIMIT_BREACH`: Requests attempt to exceed **14 calls** or **7 per provider**.
17. `UNEXPECTED_EXCEPTION`: Runtime crash, timeout, or SIGINT/SIGTERM signal received.

---

## 7. Evidence Redaction & Runbook Synchronization

1. **Evidence Redaction**: `BoundedCanaryRunner` explicitly strips the `capabilitySecret` field from the `humanApproval` record before serializing results to disk, preventing sensitive credentials from being committed to repository artifacts.
2. **Runbook Updated to v1.1.0**: `CANARY_EXECUTION_RUNBOOK.md` was updated with the complete operator procedure for generating secret-backed tokens, setting environment variables, executing the CLI entrypoint, and reviewing evidence.

---

## 8. Verification & Test Suite Summary

- **Total Test Files**: 36
- **Total Tests**: 665 passed, 0 failed, 0 skipped
- **Live Network Invocations**: 0
- **Production Routing Status**: `enforcementAllowed === false` (100% Dormant)
- **Zero Secrets Committed**: Verified clean.

---

## Phase Determination

With all capability loopholes eliminated, cryptographic HMAC-SHA256 authorization verified, runbook synchronized, and 665 offline regression tests passing:

$$\mathbf{A.12B.2C\text{-}5A.2 = CAPABILITY\_REPAIR\_PASS\_5B\_ELIGIBLE}$$
