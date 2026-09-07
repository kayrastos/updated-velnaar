# VELNAR — Prelive to Controlled Live Mission V1
## Provider Live Readiness Matrix

- **Mission**: VELNAR — Prelive to Controlled Live Mission V1
- **Artifact**: Provider Live Readiness Matrix
- **Timestamp**: `2026-09-07T14:35:00.000Z`
- **Global Live Execution Gate**: `CANARY_LIVE_EXECUTION_ENABLED = false` (`BLOCKED_PENDING_CERTIFICATION`)
- **Live Calls Permitted**: **0**

---

### 1. Provider Live Readiness Overview

This matrix formalizes the technical and operational posture of all prospective AI providers for the VELNAR platform under Canary Specification v1.2.

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
      | Status: READY FOR CANARY     |                  |       googleapis.com         |
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
| **Max Invocations in Canary** | 7 calls (sequential) | 7 calls (if active) | 0 calls (network disallowed) |
| **Code Implementation** | **SEALED & TESTED** | **SEALED & TESTED** | **NOT INTEGRATED** |
| **Current Live Readiness** | **BLOCKED AT HARD GATE 2** | **DORMANT / BLOCKED AT GATE 2** | **UNCERTIFIED / DISALLOWED** |

---

### 3. Provider Contract & Boundary Enforcement

1. **Host Allowlist Enforced**: Outbound requests are strictly limited to `api.deepseek.com` and `generativelanguage.googleapis.com`. Any attempt to dispatch to arbitrary IP addresses, alternate ports, or uncertified domains triggers `NETWORK_DESTINATION_MISMATCH` and aborts fail-closed.
2. **Sequential Concurrency**: Concurrency is strictly clamped to $1$. No parallel batches or asynchronous fire-and-forget calls are allowed during canary execution.
3. **No Autonomous Expansion**: The runner is bounded to the 7 certified tasks. Once the 7 tasks complete (or fail), execution halts immediately and triggers the closure/kill path.
4. **Credential Isolation Invariant**: Credentials are read directly from `env.DEEPSEEK_API_KEY` exactly once per invocation, strictly after D1 replay reservation succeeds. Private key bytes are never exported, never passed to logging utilities, and never recorded in artifacts.
