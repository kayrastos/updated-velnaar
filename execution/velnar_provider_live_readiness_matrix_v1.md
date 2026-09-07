# VELNAR — Prelive to Controlled Live Mission V1
## Provider Live Readiness Matrix (Reconciled)

- **Mission**: VELNAR — Prelive to Controlled Live Mission V1
- **Artifact**: Provider Live Readiness Matrix (Reconciled)
- **Timestamp**: `2026-09-07T15:45:00.000Z`
- **Canonical Main Commit Binding**: `5f19cbc2f3a8be9ba68f5404c437392a70db4245`
- **Global Live Execution Gate**: `CANARY_LIVE_EXECUTION_ENABLED = false` (`BLOCKED_PENDING_CERTIFICATION`)
- **Execution-Time Provider Confirmation Required**: `true`
- **Epistemic Classification Policy**: Strategy values are `REPO_PINNED_STRATEGY_VALUE` (retained for reproducibility). Candidate $\ne$ current provider certification. Zero live calls occur before Hard Gate 2.
- **Live Provider Calls in Segment A**: **0**
- **Live Provider Calls in Segment B**: **0**
- **First Live Provider Call Boundary**: **Segment C after Hard Gate 2**

---

### 1. Provider Live Readiness Overview

```
                    +----------------------------------------------------+
                    |        CANARY_LIVE_EXECUTION_ENABLED = false       |
                    |        (Deterministic Safety Kernel Barrier)       |
                    +-------------------------+--------------------------+
                                              |
                     +------------------------+------------------------+
                     |                                                 |
                     v                                                 v
      +------------------------------+                  +------------------------------+
      |        DEEPSEEK LANE         |                  |         GEMINI LANE          |
      |   (Primary Interactive)      |                  |    (Background Economy)      |
      |                              |                  |                              |
      | Model: deepseek-v4-flash     |                  | Model: gemini-3.5-flash-lite |
      | Strategy Tier: offpeak       |                  | Strategy Tier: flex          |
      | Host: api.deepseek.com       |                  | Host: generativelanguage.    |
      | Calls in Seg B: 0            |                  |       googleapis.com         |
      | Status: DORMANT STRATEGY     |                  | Calls in Seg B: 0            |
      |         (BLOCKED AT GATE 2)  |                  | Status: DORMANT STANDBY      |
      +------------------------------+                  +------------------------------+
```

---

### 2. Comprehensive Provider Comparison Matrix

| Technical Dimension | DeepSeek (Primary Lane) | Gemini (Background Lane) | OpenAI (Comparison Lane) |
|---|---|---|---|
| **Role** | Primary Interactive Canary | Background Economy Standby | Optional Benchmark Only |
| **Execution Lane** | `INTERACTIVE` | `BACKGROUND_ECONOMY` | `BENCHMARK_COMPARISON_ONLY` |
| **Strategy Candidate Model** | `deepseek-v4-flash` (`REPO_PINNED_STRATEGY_VALUE`) | `gemini-3.5-flash-lite` (`REPO_PINNED_STRATEGY_VALUE`) | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Expected Returned Model** | `deepseek-v4-flash` (`REPO_PINNED_STRATEGY_VALUE`) | `gemini-3.5-flash-lite` (`REPO_PINNED_STRATEGY_VALUE`) | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Documented Target Version** | `DeepSeek-V4-Flash-0731` (`REPO_PINNED_STRATEGY_VALUE`) | `gemini-3.5-flash-lite` (`REPO_PINNED_STRATEGY_VALUE`) | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Outbound Host** | `api.deepseek.com` | `generativelanguage.googleapis.com` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Outbound Endpoint** | `https://api.deepseek.com/v1/chat/completions` (`REPO_PINNED_STRATEGY_VALUE`) | `https://generativelanguage.googleapis.com/v1beta/interactions` (`REPO_PINNED_STRATEGY_VALUE`) | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Strategy Service Tier** | `offpeak` (`REPO_PINNED_STRATEGY_VALUE`) | `flex` (`REPO_PINNED_STRATEGY_VALUE`) | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Strategy Input Pricing (Hit/Miss per 1M)** | $\$0.007$ / $\$0.22$ (`REPO_PINNED_STRATEGY_VALUE`) | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Strategy Output Pricing (per 1M)** | $\$0.66$ (`REPO_PINNED_STRATEGY_VALUE`) | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Reasoning Effort / Thinking** | `low` (max 2,048 tokens) | `low` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Output Token Bound** | 2,048 tokens | 2,048 tokens | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Lifecycle Timeout** | $15,000$ ms | $15,000$ ms | $15,000$ ms |
| **Credential Binding** | `env.DEEPSEEK_API_KEY` | `env.GEMINI_API_KEY` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Credential Resolution Scope** | Post-D1 reservation only | Ambient Worker env | Unbound |
| **Credential Logging / Export** | Strictly $0$ (Never logged/exported) | Strictly $0$ (Never logged/exported) | Strictly $0$ |
| **Calls Permitted in Segment B** | **0** | **0** | **0** |
| **Execution-Time Confirmations Required** | Model, endpoint, tier, pricing, credentials: `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` | Model, API path, pricing, credentials: `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` | All: `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Current Live Readiness** | **BLOCKED AT HARD GATE 2** | **DORMANT / BLOCKED AT GATE 2** | **UNCERTIFIED / DISALLOWED** |

---

### 3. Boundary & Invocations Mandates

1. **Zero Provider Calls in Segment B**: Both Google AI Studio / Gemini and DeepSeek are categorically prohibited from invocation during Segment B.
2. **First Live Provider Call**: The first point where Gemini or DeepSeek can be called is strictly in Segment C, following explicit human approval at Hard Gate 2 (`SEGMENT_C_FIRST_LIVE_PROVIDER_CALL_APPROVAL_REQUIRED`).
3. **Host Allowlist**: Outbound requests are strictly limited to `api.deepseek.com` and `generativelanguage.googleapis.com`.
4. **Credential Isolation**: Credentials are read from ambient Worker environment post-reservation; never printed, logged, or exported.

---

### 4. Sovereign Boundary Architecture & Mandatory BLACK Taxonomy

The Sovereign Boundary strictly protects VELNAR proprietary assets and secrets from exposure to external AI models (including **DeepSeek**, **Gemini / Google AI Studio**, **OpenAI**, and **future frontier/external models**).

#### Mandatory BLACK Data Taxonomy (NEVER_SENT_TO_EXTERNAL_MODEL):
All 10 canonical categories are strictly classified as BLACK data with zero exceptions through sanitization:
1. **full Security Memory**
2. **proprietary verification algorithms**
3. **detection heuristics**
4. **private benchmark answers**
5. **customer credentials**
6. **production secrets**
7. **master keys**
8. **critical IAM policy internals**
9. **critical Safety Kernel internals**
10. **critical routing/policy internals**
*(along with Customer PII and raw identity data, and VELNAR master KMS keys)*

#### Boundary Rules:
- **BLACK**: `NEVER_SENT_TO_EXTERNAL_MODEL` (No exceptions through sanitization).
- **GREY**: `MAY_LEAVE_ONLY_AFTER_MINIMIZATION_AND_SANITIZATION_AS_BOUNDED_TASK_CAPSULE` (Customer context is NOT unrestricted; must be strictly minimized, sanitized, bounded to the specific task capsule, and must NEVER contain BLACK material. Context may include only minimum necessary sanitized context such as small code excerpts, AST/data-flow fragments, stack traces, anonymized vulnerability context, necessary tests, and minimized sanitized metadata. Synthetic fixtures preferred where sufficient, but GREY is not limited exclusively to synthetic fixtures).
- **WHITE**: `PUBLIC_OR_EXTERNALLY_SAFE_INFORMATION` (Approved public synthetic evaluation fixtures from `VELNAR_SHADOW_EVAL_V1`).

#### Sovereign Boundary Implementation Truth:
- `sovereignBoundarySpecificationReady = true`
- `sovereignBoundaryRuntimeEnforcementCertified = false`
- `sovereignBoundaryRuntimeEnforcementStatus = "SPECIFIED_NOT_RUNTIME_CERTIFIED"`
- **HARD GATE 2 BLOCKER**: Sovereign Boundary runtime enforcement certification is an explicit mandatory blocker before any live provider invocations in Segment C.
