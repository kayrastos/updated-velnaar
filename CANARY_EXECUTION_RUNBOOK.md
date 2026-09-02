# VELNAR AI — Phase A.12B.2C-5B Live Canary Execution Runbook

**Document Version**: `1.0.0`  
**Specification Version**: `a12b2c5-v1.0`  
**Target Execution Phase**: Phase A.12B.2C-5B (Future Explicit Human-Approved Phase)  
**Current Phase Status**: **Phase A.12B.2C-5A (Preparation & Readiness Verification Only)**  

> ⚠️ **CRITICAL OPERATIONAL DIRECTIVE**  
> **DO NOT EXECUTE THIS RUNBOOK IN PHASE A.12B.2C-5A.**  
> Live canary execution is strictly prohibited until explicit human authorization is granted for Phase A.12B.2C-5B.  
> Production routing remains `DORMANT` (`enforcementAllowed === false`).

---

## 1. Prerequisites & Human Approval Envelope

Live canary execution requires a cryptographically unique Human Approval Token. Execution will terminate fail-closed immediately if this envelope is absent or malformed.

### 1.1 Approval Envelope Requirements
1. **Target Phase**: Must be strictly `'A.12B.2C-5B'`.
2. **Environment**: Must be strictly `'CONTROLLED_CANARY'`.
3. **Budget Cap**: Maximum allowable budget is **$0.05 USD** (`50,000 microUSD`).
4. **Approval Token Format**: `VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_<YYYYMMDD>_<HEX_SIGNATURE>`.

### 1.2 Required Environment Variables (Phase A.12B.2C-5B Only)
```bash
export VELNAR_CANARY_PHASE="A.12B.2C-5B"
export VELNAR_CANARY_APPROVED_BY="security-lead@velnar.internal"
export VELNAR_CANARY_APPROVAL_TOKEN="VELNAR_CANARY_APPROVED_PHASE_A12B2C5B_20260902_4f8a9b2c3d1e0f9a8b7c6d5e4f3a2b1c"
export VELNAR_CANARY_MAX_BUDGET_USD="0.05"
export DEEPSEEK_API_KEY="<temporary_scoped_deepseek_canary_key>"
export GEMINI_API_KEY="<temporary_scoped_gemini_canary_key>"
```

---

## 2. Pre-Flight Verification Checklist

Before executing the Phase A.12B.2C-5B canary, the operator must verify:

- [ ] **1. Offline Regression Suite Green**: `npm test` passes 100% (614+ tests passing).
- [ ] **2. Pricing Window Status**: Verify current UTC time falls in off-peak window for DeepSeek (or weekend).
- [ ] **3. Task Scope Restriction**: Exactly 7 certified tasks (`CERTIFIED_A12B2C_TASK_TYPES`).
- [ ] **4. Zero Sensitive Data**: Synthetic prompts only (`PUBLIC_BUSINESS` / `PSEUDONYMOUS_OPERATIONAL`).
- [ ] **5. Endpoint Allowlist**: Verify outbound traffic resolves strictly to `https://api.deepseek.com` and `https://generativelanguage.googleapis.com`.
- [ ] **6. Production Isolation**: Verify `enforcementAllowed === false` across all routing tables.

---

## 3. Canonical Canary Execution Command (Future Phase A.12B.2C-5B)

> ⛔ **DO NOT RUN THIS COMMAND DURING PHASE A.12B.2C-5A**

When Phase A.12B.2C-5B is explicitly authorized, execute the bounded canary via:

```bash
npx tsx worker/ai/canary/boundedCanaryRunner.ts \
  --phase=A.12B.2C-5B \
  --execute-live-canary \
  --approval-token="${VELNAR_CANARY_APPROVAL_TOKEN}" \
  --approved-by="${VELNAR_CANARY_APPROVED_BY}" \
  --max-budget-usd="${VELNAR_CANARY_MAX_BUDGET_USD}" \
  --output="execution/a12b2c5b_canary_execution_results.json"
```

---

## 4. Execution Invariants & Active Kill Switches

The canary harness automatically terminates fail-closed under any of the following conditions:

| Kill Switch Event | Abort Condition | Consequence |
| :--- | :--- | :--- |
| `PROVENANCE_MISMATCH` | Returned model/provider differs from requested candidate. | Immediate abort; 0 further calls. |
| `MODEL_SUBSTITUTION_DETECTED` | Provider attempts stealth model downgrade or swap. | Immediate abort; 0 further calls. |
| `PRIVACY_CLASSIFICATION_VIOLATION` | Prompt contains `PERSONAL`, `SENSITIVE`, or `SECRET` data. | Immediate abort; 0 provider calls. |
| `TASK_SCOPE_VIOLATION` | Task requested is outside the 7 certified tasks. | Immediate abort; 0 provider calls. |
| `COST_CEILING_BREACH` | Cumulative run cost exceeds **$0.05 USD** (50,000 microUSD). | Immediate abort; 0 further calls. |
| `INVOCATION_LIMIT_BREACH` | Total calls attempt to exceed **14 requests**. | Immediate abort; 0 further calls. |
| `NETWORK_DESTINATION_MISMATCH` | Outbound request target not in certified endpoint allowlist. | Immediate abort; 0 provider calls. |
| `RECURSIVE_FALLBACK_ATTEMPTED` | Failure of Gemini attempting fallback to secondary uncertified providers. | Immediate abort; 0 further calls. |

---

## 5. Post-Canary Verification & Evidence Collection

After execution completes:
1. Verify `execution/a12b2c5b_canary_execution_results.json` exists and records `overallStatus === 'CANARY_EXECUTION_PASSED'`.
2. Verify token telemetry reported `usageSource === 'PROVIDER_REPORTED'` across all records.
3. Verify observed cost did not exceed budget.
4. Verify aggregate semantic score $\ge 0.85$.
5. Rotate and revoke temporary canary API keys.
6. Commit evidence package for post-canary review and certification audit.

---

## 6. Rollback / Emergency Procedures

- Because `enforcementAllowed` remains `false` throughout the canary, **no production rollback or traffic shifting is required**.
- To halt an ongoing canary immediately, send `SIGINT` (`Ctrl+C`) or unset `VELNAR_CANARY_APPROVAL_TOKEN`.
