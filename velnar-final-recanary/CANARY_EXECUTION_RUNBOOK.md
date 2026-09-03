# VELNAR AI — Phase A.12B.2C-5B Live Canary Execution Runbook

**Document Version**: `1.3.0`  
**Specification Version**: `a12b2c5-v1.1`  
**Target Execution Phase**: Phase A.12B.2C-5B (Future Explicit Human-Approved Phase)  
**Current Phase Status**: `PROVIDER_REST_PARITY_PASS_5B_ELIGIBLE_PENDING_HUMAN_AUTHORIZATION`  

> ⚠️ **CRITICAL OPERATIONAL DIRECTIVE**  
> **DO NOT EXECUTE THIS RUNBOOK IN PHASE A.12B.2C-5A, A.12B.2C-5A.1, A.12B.2C-5A.2, A.12B.2C-5A.3, OR A.12B.2C-5A.4.1.**  
> Live canary execution is strictly prohibited until explicit human authorization is granted for Phase A.12B.2C-5B.  
> Production routing remains `DORMANT` (`enforcementAllowed === false`).  
> Hardcoded, public, or deterministic capability token bypasses are strictly prohibited and eliminated.  
> THIS PHASE REMAINS 100% OFFLINE WITH ZERO REAL PROVIDER CALLS.

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

### 1.2 Operator Execution Sequence

The security operator generates the capability secret and token using the offline utility (`npm run generate-canary-token`):
- **Capability Secret**: Exactly 64 lowercase hexadecimal characters representing 32 cryptographically random bytes (`^[0-9a-f]{64}$`). Created first by the operator via `openssl rand -hex 32`.
- **Secret Transmission**: Passed strictly via the `VELNAR_CANARY_CAPABILITY_SECRET` environment variable (never via CLI `--arguments`). `tokenGenerator.ts` strictly requires this secret from the protected environment channel.
- **Canonical Approved-By Identity**: Must be established before generation and must match identically between token generation and live execution (no USER/default identity fallbacks allowed).

The documented, executable operator sequence consists of 7 distinct steps:

```bash
# Step 1: Establish canonical approved-by identity
export VELNAR_CANARY_APPROVED_BY="security-lead@velnar.internal"

# Step 2: Generate the 64-hex capability secret (32 cryptographically random bytes) in protected environment:
export VELNAR_CANARY_CAPABILITY_SECRET="$(openssl rand -hex 32)"

# Step 3: Verify clean working tree and resolve git HEAD SHA:
git status --porcelain
git rev-parse HEAD

# Step 4: Generate the cryptographically bound offline approval token:
npm run generate-canary-token -- \
  --approved-by="${VELNAR_CANARY_APPROVED_BY}" \
  --max-budget-micro-usd=50000 \
  --target-phase="A.12B.2C-5B"

# Step 5: Apply the REDACTED metadata export bundle emitted by the generator:
# (Copy and paste the export block printed by npm run generate-canary-token)
export VELNAR_CANARY_APPROVAL_TOKEN="<emitted_approval_token>"
export VELNAR_CANARY_APPROVED_BY="security-lead@velnar.internal"
export APPROVAL_TIMESTAMP="<emitted_approval_timestamp>"
export GIT_COMMIT_SHA="<emitted_git_commit_sha>"
export VELNAR_CANARY_RUN_NONCE="<emitted_run_nonce>"
export VELNAR_CANARY_MAX_BUDGET_MICRO_USD="50000"
export VELNAR_CANARY_PHASE="A.12B.2C-5B"

# Step 6: Supply temporary scoped canary API keys:
export DEEPSEEK_API_KEY="<temporary_scoped_deepseek_canary_key>"
export GEMINI_API_KEY="<temporary_scoped_gemini_canary_key>"

# Step 7: ONLY AFTER explicit human authorization, execute the existing bounded Phase 5B command.
```

### 1.3 Required Environment State Summary (Phase A.12B.2C-5B Only)

Upon completion of Steps 1–6, all environment variables required for bounded canary execution are fully populated:
- `VELNAR_CANARY_APPROVED_BY="security-lead@velnar.internal"`
- `VELNAR_CANARY_CAPABILITY_SECRET` (exactly 64 lowercase hexadecimal characters representing 32 cryptographically random bytes)
- `VELNAR_CANARY_APPROVAL_TOKEN` (HMAC-SHA256 signature bound to all execution parameters)
- `APPROVAL_TIMESTAMP` (UTC ISO string)
- `GIT_COMMIT_SHA` (40 lowercase hex characters matching git HEAD)
- `VELNAR_CANARY_RUN_NONCE` (unique 32-hex random nonce)
- `VELNAR_CANARY_MAX_BUDGET_MICRO_USD="50000"`
- `VELNAR_CANARY_PHASE="A.12B.2C-5B"`
- `DEEPSEEK_API_KEY` (scoped temporary key)
- `GEMINI_API_KEY` (scoped temporary key)

---

## 2. Pre-Flight Verification Checklist

Before executing the Phase A.12B.2C-5B canary, the operator must verify:

- [ ] **1. Offline Regression Suite Green**: Complete offline test suite passing 100%.
- [ ] **2. Capability Secret Supplied via Secure Channel**: `VELNAR_CANARY_CAPABILITY_SECRET` is present in process environment as exactly 64 lowercase hexadecimal characters representing 32 cryptographically random bytes (never passed as CLI argv).
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
| `HUMAN_APPROVAL_INVALID` | Security Gate | Missing/invalid token, wrong secret format (not exactly 64 lowercase hexadecimal characters representing 32 cryptographically random bytes), date/signature mismatch, expired timestamp, dirty git tree, or commit SHA mismatch. | Immediate abort; 0 provider calls. |
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

