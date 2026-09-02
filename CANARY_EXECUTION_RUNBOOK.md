# VELNAR AI — Phase A.12B.2C-5B Live Canary Execution Runbook

**Document Version**: `1.2.0`  
**Specification Version**: `a12b2c5-v1.1`  
**Target Execution Phase**: Phase A.12B.2C-5B (Future Explicit Human-Approved Phase)  
**Current Phase Status**: **Phase A.12B.2C-5A.3 (Real Live-Canary Transport & Execution-Gate Certified — 5B Eligible)**  

> ⚠️ **CRITICAL OPERATIONAL DIRECTIVE**  
> **DO NOT EXECUTE THIS RUNBOOK IN PHASE A.12B.2C-5A, A.12B.2C-5A.1, A.12B.2C-5A.2, OR A.12B.2C-5A.3.**  
> Live canary execution is strictly prohibited until explicit human authorization is granted for Phase A.12B.2C-5B.  
> Production routing remains `DORMANT` (`enforcementAllowed === false`).  
> Hardcoded, public, or deterministic capability token bypasses are strictly prohibited and eliminated.

---

## 1. Prerequisites & Secret-Backed Human Approval Envelope

Live canary execution requires a cryptographically strong, secret-backed Human Approval Token verified via HMAC-SHA256 with constant-time equality (`crypto.timingSafeEqual`).

### 1.1 Approval Envelope Requirements
1. **Target Phase**: Must be strictly `'A.12B.2C-5B'`.
2. **Environment Target**: Must be strictly `'CONTROLLED_CANARY'`.
3. **Specification Version**: Must match `a12b2c5-v1.1`.
4. **Source Commit SHA**: Must bind to exact 40-character git commit SHA being executed.
5. **Run Nonce**: Cryptographically random unique string per run (prevents replay).
6. **Budget Cap**: Maximum allowable budget is **$0.05 USD** (`50,000 microUSD`), bound cryptographically as integer microUSD.
7. **Strict Calendar Validation**: The `<YYYYMMDD>` token date must represent a genuine, valid calendar date (e.g., `20260231` is rejected fail-closed).
8. **Expiration Window**: Token timestamp is valid for a maximum of 3600 seconds (1 hour) from generation.
9. **HMAC Signature Format**: Exactly 64-hex characters (256-bit entropy):  
   `VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_<YYYYMMDD>_<64_HEX_HMAC_SHA256_SIGNATURE>`
10. **Clean Working Tree**: The repository must be clean (`git status --porcelain` empty) matching the approved commit.

### 1.2 Capability Secret & Token Generation Procedure (Offline / Air-Gapped)

The security operator generates the token using an offline command with an out-of-band `VELNAR_CANARY_CAPABILITY_SECRET` ($\ge 32$ characters, 256-bit entropy).

```bash
# Operator exports approval environment (do NOT pass capability secret on CLI argv)
export VELNAR_CANARY_CAPABILITY_SECRET="<out-of-band-cryptographic-secret-min-32-chars-256-bits>"
export GIT_COMMIT_SHA="$(git rev-parse HEAD)"
export VELNAR_CANARY_RUN_NONCE="$(openssl rand -hex 16)"
export APPROVAL_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export APPROVAL_DATE="$(date -u +"%Y%m%d")"
export MAX_BUDGET_MICRO_USD="50000"

# Canonical HMAC Payload:
# ${approvedBy}:${targetPhase}:${environmentTarget}:${dateYyyyMmDd}:${maxBudgetMicroUsd}:${approvalTimestamp}:${specificationVersion}:${sourceCommitSha}:${runNonce}
```

### 1.3 Required Environment Variables (Phase A.12B.2C-5B Only)
```bash
export VELNAR_CANARY_PHASE="A.12B.2C-5B"
export VELNAR_CANARY_APPROVED_BY="security-lead@velnar.internal"
export VELNAR_CANARY_APPROVAL_TOKEN="VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_${APPROVAL_DATE}_<64_hex_signature>"
export VELNAR_CANARY_MAX_BUDGET_USD="0.05"
export VELNAR_CANARY_MAX_BUDGET_MICRO_USD="50000"
export VELNAR_CANARY_RUN_NONCE="${VELNAR_CANARY_RUN_NONCE}"
export VELNAR_CANARY_CAPABILITY_SECRET="${VELNAR_CANARY_CAPABILITY_SECRET}"
export DEEPSEEK_API_KEY="<temporary_scoped_deepseek_canary_key>"
export GEMINI_API_KEY="<temporary_scoped_gemini_canary_key>"
```

---

## 2. Pre-Flight Verification Checklist

Before executing the Phase A.12B.2C-5B canary, the operator must verify:

- [ ] **1. Offline Regression Suite Green**: Complete offline test suite passing 100%.
- [ ] **2. Capability Secret Supplied via Secure Channel**: `VELNAR_CANARY_CAPABILITY_SECRET` is present in process environment and $\ge 32$ chars (never passed as CLI argv).
- [ ] **3. Commit SHA Match & Pristine Tree**: Working tree is clean and matches approved `GIT_COMMIT_SHA`.
- [ ] **4. Pricing Window Status**: Verify current UTC time falls in off-peak window for DeepSeek (or weekend).
- [ ] **5. Task Scope Restriction**: Exactly 7 certified tasks (`CERTIFIED_A12B2C_TASK_TYPES`).
- [ ] **6. Zero Sensitive Data**: Synthetic prompts only (`PUBLIC_BUSINESS` / `PSEUDONYMOUS_OPERATIONAL`).
- [ ] **7. Endpoint Allowlist & Redirect Prevention**: Outbound traffic strictly limited to `https://api.deepseek.com` and `https://generativelanguage.googleapis.com` with `redirect: 'error'`.
- [ ] **8. Production Isolation**: Verify `enforcementAllowed === false` across all routing tables.

---

## 3. Canonical Canary Execution Command (Future Phase A.12B.2C-5B)

> ⛔ **DO NOT RUN THIS COMMAND DURING PHASE A.12B.2C-5A, A.12B.2C-5A.1, A.12B.2C-5A.2, OR A.12B.2C-5A.3**

When Phase A.12B.2C-5B is explicitly authorized, execute the bounded canary via:

```bash
npx tsx worker/ai/canary/boundedCanaryRunner.ts \
  --phase=A.12B.2C-5B \
  --execute-live-canary \
  --approval-token="${VELNAR_CANARY_APPROVAL_TOKEN}" \
  --approved-by="${VELNAR_CANARY_APPROVED_BY}" \
  --approval-timestamp="${APPROVAL_TIMESTAMP}" \
  --max-budget-micro-usd="50000" \
  --specification-version="a12b2c5-v1.1" \
  --source-commit="${GIT_COMMIT_SHA}" \
  --run-nonce="${VELNAR_CANARY_RUN_NONCE}" \
  --output="execution/a12b2c5b_canary_execution_results.json"
```

*(Note: Capability secret is loaded securely from the `VELNAR_CANARY_CAPABILITY_SECRET` environment variable and is never exposed in the process argument list).*

---

## 4. Invocation Envelope & Retry/Fallback Accounting

- **Ceiling Constraints**:
  - `maxTotalInvocations = 14`
  - `maxInvocationsPerProvider = 7`
  - `maxConcurrentInvocations = 1` (strictly sequential)
  - `maxSameProviderRetries = 1`
  - `maxCrossProviderFallbacks = 1`
- **Accounting Rule**: Every retry and fallback counts as a full provider request against the 7-per-provider and 14-total request ceilings. If a retry or fallback causes a provider to reach 7 requests before all base tasks complete, execution deterministically terminates fail-closed (`INVOCATION_LIMIT_BREACH`) rather than silently exceeding limits.

---

## 5. Execution Invariants & Complete Kill-Switch Catalog (17 Triggers)

The canary harness automatically terminates fail-closed under any of the 17 formal kill-switch conditions:

| Kill Switch Event | Category | Abort Trigger | Consequence |
| :--- | :--- | :--- | :--- |
| `HUMAN_APPROVAL_INVALID` | Security Gate | Missing/invalid token, wrong secret (< 32 chars), date/signature mismatch, expired timestamp, dirty git tree, or commit SHA mismatch. | Immediate abort; 0 provider calls. |
| `UNAUTHORIZED_ENVIRONMENT` | Security Gate | Live execution attempted in non-5B phase or invalid environment. | Immediate abort; 0 provider calls. |
| `PRIVACY_CLASSIFICATION_VIOLATION` | Privacy | Prompt contains `PERSONAL`, `SENSITIVE`, or `SECRET` classification. | Immediate abort; 0 provider calls. |
| `TASK_SCOPE_VIOLATION` | Scope | Requested task is outside the 7 certified tasks. | Immediate abort; 0 provider calls. |
| `NETWORK_DESTINATION_MISMATCH` | Network | Outbound target not in certified HTTPS allowlist, or redirect attempted. | Immediate abort; 0 provider calls. |
| `PROVENANCE_MISMATCH` | Model Provenance | Returned provider differs from requested provider candidate. | Immediate abort; 0 further calls. |
| `MODEL_SUBSTITUTION_DETECTED` | Model Provenance | Returned model identifier does not match certified model ID. | Immediate abort; 0 further calls. |
| `UNEXPECTED_MODEL_VERSION` | Model Provenance | Model runtime version differs from certified baseline version. | Immediate abort; 0 further calls. |
| `MALFORMED_USAGE_TELEMETRY` | Telemetry | Token usage fields missing or non-conforming. | Immediate abort; 0 further calls. |
| `CACHE_ARITHMETIC_INCONSISTENCY` | Cost / Billing | Cache hit + miss sum does not reconcile with prompt tokens. | Immediate abort; 0 further calls. |
| `REASONING_TOKEN_INCONSISTENCY` | Model Integrity | Reasoning budget exceeded or thinking tokens omitted when required. | Immediate abort; 0 further calls. |
| `REASONING_LEAKAGE_DETECTED` | Privacy / Security | Unsanitized reasoning traces detected in customer output payload. | Immediate abort; 0 further calls. |
| `UNEXPECTED_RETRY_OR_FALLBACK` | Flow Control | Retry or fallback attempted beyond allowed bounds ($> 1$). | Immediate abort; 0 further calls. |
| `RECURSIVE_FALLBACK_ATTEMPTED` | Flow Control | Gemini attempting secondary fallback to uncertified providers. | Immediate abort; 0 further calls. |
| `COST_CEILING_BREACH` | Budget / Cost | Cumulative run cost exceeds **$0.05 USD** (`50,000 microUSD`). | Immediate abort; 0 further calls. |
| `INVOCATION_LIMIT_BREACH` | Concurrency / Limits | Total provider requests attempt to exceed **14 requests** (14 calls) or **7 per provider**. | Immediate abort; 0 further calls. |
| `UNEXPECTED_EXCEPTION` | Operational | Runtime crash, network timeout, or SIGINT/SIGTERM abort signal. | Immediate abort; 0 further calls. |

---

## 6. Post-Canary Verification & Evidence Collection

After execution completes:
1. Verify `execution/a12b2c5b_canary_execution_results.json` exists and records `overallStatus === 'CANARY_EXECUTION_PASSED'`.
2. Verify token telemetry reported `usageSource === 'PROVIDER_REPORTED'` across all records.
3. Verify observed cost did not exceed budget ($< \$0.05$).
4. Verify aggregate semantic score $\ge 0.85$.
5. Confirm `capabilitySecret` is completely redacted from the output JSON artifact.
6. Rotate and revoke temporary canary API keys.
7. Commit evidence package for post-canary certification review.

---

## 7. Rollback / Emergency Procedures

- Because `enforcementAllowed` remains `false` throughout the canary, **no production rollback or traffic shifting is required**.
- To halt an ongoing canary immediately, send `SIGINT` (`Ctrl+C`) or `SIGTERM`. The runner captures signals via `AbortController` and exits fail-closed without lingering background tasks.

