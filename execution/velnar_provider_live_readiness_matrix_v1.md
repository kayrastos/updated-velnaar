# VELNAR — Prelive to Controlled Live Mission V1
## Provider Live Readiness Matrix (Reconciled)

- **Mission**: VELNAR — Prelive to Controlled Live Mission V1
- **Artifact**: Provider Live Readiness Matrix (Reconciled)
- **Timestamp**: `2026-09-07T15:15:00.000Z`
- **Canonical Main Commit Binding**: `5f19cbc2f3a8be9ba68f5404c437392a70db4245`
- **Global Live Execution Gate**: `CANARY_LIVE_EXECUTION_ENABLED = false` (`BLOCKED_PENDING_CERTIFICATION`)
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
      | Tier: offpeak ($0.22/$0.66)  |                  | Tier: flex (Google AI Studio)|
      | Host: api.deepseek.com       |                  | Host: generativelanguage.    |
      | Calls in Seg B: 0            |                  |       googleapis.com         |
      | Status: READY FOR CANARY     |                  | Calls in Seg B: 0            |
      |         (BLOCKED AT GATE 2)  |                  | Status: DORMANT STANDBY      |
      +------------------------------+                  +------------------------------+
```

---

### 2. Comprehensive Provider Comparison Matrix

| Technical Dimension | DeepSeek (Primary Lane) | Gemini (Background Lane) | OpenAI (Comparison Lane) |
|---|---|---|---|
| **Role** | Primary Interactive Canary | Background Economy Standby | Optional Benchmark Only |
| **Execution Lane** | `INTERACTIVE` | `BACKGROUND_ECONOMY` | `BENCHMARK_COMPARISON_ONLY` |
| **Requested Model** | `deepseek-v4-flash` | `gemini-3.5-flash-lite` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Expected Returned Model** | `deepseek-v4-flash` | `gemini-3.5-flash-lite` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Documented Target Version** | `DeepSeek-V4-Flash-0731` | `gemini-3.5-flash-lite` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Outbound Host** | `api.deepseek.com` | `generativelanguage.googleapis.com` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Outbound Endpoint** | `https://api.deepseek.com/v1/chat/completions` | `https://generativelanguage.googleapis.com/v1beta/interactions` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Service Tier** | `offpeak` | `flex` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Input Pricing (Hit/Miss per 1M)** | $\$0.007$ / $\$0.22$ | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Output Pricing (per 1M)** | $\$0.66$ | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Reasoning Effort / Thinking** | `low` (max 2,048 tokens) | `low` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Output Token Bound** | 2,048 tokens | 2,048 tokens | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Lifecycle Timeout** | $15,000$ ms | $15,000$ ms | $15,000$ ms |
| **Credential Binding** | `env.DEEPSEEK_API_KEY` | `env.GEMINI_API_KEY` | `UNRESOLVED_REQUIRES_PRELIVE_CONFIRMATION` |
| **Credential Resolution Scope** | Post-D1 reservation only | Ambient Worker env | Unbound |
| **Credential Logging / Export** | Strictly $0$ (Never logged/exported) | Strictly $0$ (Never logged/exported) | Strictly $0$ |
| **Calls Permitted in Segment B** | **0** | **0** | **0** |
| **Max Invocations in Canary** | 7 calls (sequential) | 7 calls (if active) | 0 calls (network disallowed) |
| **Code Implementation** | **SEALED & TESTED** | **SEALED & TESTED** | **NOT INTEGRATED** |
| **Current Live Readiness** | **BLOCKED AT HARD GATE 2** | **DORMANT / BLOCKED AT GATE 2** | **UNCERTIFIED / DISALLOWED** |

---

### 3. Boundary & Invocations Mandates

1. **Zero Provider Calls in Segment B**: Both Google AI Studio / Gemini and DeepSeek are categorically prohibited from invocation during Segment B.
2. **First Live Provider Call**: The first point where Gemini or DeepSeek can be called is strictly in Segment C, following explicit human approval at Hard Gate 2 (`SEGMENT_C_FIRST_LIVE_PROVIDER_CALL_APPROVAL_REQUIRED`).
3. **Host Allowlist**: Outbound requests are strictly limited to `api.deepseek.com` and `generativelanguage.googleapis.com`.
4. **Credential Isolation**: Credentials are read from ambient Worker environment post-reservation; never printed, logged, or exported.
