# Phase A.12B.2C-5A.4.1 — Provider REST Parity & Budget Reconciliation Report

**Audit Date**: September 2, 2026  
**Specification Version**: `a12b2c5-v1.1`  
**Phase Identifier**: `A.12B.2C-5A.4.1`  
**Status**: `PROVIDER_REST_PARITY_PASS_5B_ELIGIBLE_PENDING_HUMAN_AUTHORIZATION`  
**Network Execution Mode**: **100% OFFLINE / ZERO NETWORK CALLS**  
**Production Routing Status**: **DORMANT (`enforcementAllowed === false`)**  

---

## 1. Executive Summary

Phase A.12B.2C-5A.4.1 resolves all remaining provider REST schema parity, token arithmetic integrity, budget reconciliation, and capability secret validation discrepancies identified during post-push inspection of Phase 5A.4.

This phase was executed entirely **offline** with mock synthetic fixtures and deterministic test doubles. **Zero live network calls** were made to DeepSeek, Google Gemini, or any other external provider. All 37 test suites across 683 tests pass cleanly.

---

## 2. Parity & Reconciliation Matrix

| Blocker # | Area | Issue Identified | Resolution & Verification |
| :--- | :--- | :--- | :--- |
| **Blocker 1** | Gemini REST Parsing | SDK-level parsing assumed (`output_text`, `usageMetadata`) instead of raw REST schema. | Implemented raw REST extraction in `boundedCanaryRunner.ts` inspecting `steps` array with `model_output` type, extracting `total_input_tokens`, `total_output_tokens`, `total_thought_tokens`, `total_cached_tokens`. |
| **Blocker 2** | Gemini Flex Provenance | Missing strict verification of `service_tier: "flex"` in provider responses. | Implemented fail-closed validation: if `service_tier` is absent, null, non-string, or any value other than `"flex"`, terminates immediately with `PROVENANCE_MISMATCH`. Preserves separate `requestedServiceTier` and `providerReportedServiceTier` in evidence without silent substitution. |
| **Blocker 3 & 4** | Gemini Pricing Rates | Reconciled standard vs flex pricing. | Standard: \$0.30/1M input, \$2.50/1M output. Flex: \$0.15/1M input, \$1.25/1M output. Enforced in `boundedCanaryRunner.ts` and `evaluationCostCalculator.ts`. |
| **Blocker 5** | DeepSeek Cache Telemetry | Telemetry lacked strict arithmetic verification between hit/miss and total prompt tokens. | Implemented arithmetic integrity check: `prompt_tokens === prompt_cache_hit_tokens + prompt_cache_miss_tokens`. Discrepancies abort fail-closed with `CACHE_ARITHMETIC_INCONSISTENCY`. |
| **Blocker 6** | DeepSeek Reasoning Tokens | Missing extraction from `completion_tokens_details.reasoning_tokens`. | Extracted and accounted for reasoning tokens; verified against reasoning budget. |
| **Blocker 7** | Gemini Cache Verification | Cache status was marked verified without mathematical reconciliation. | `cacheStatus` is marked `VERIFIED` only when `total_input_tokens === total_cached_tokens + non_cached_input_tokens`. |
| **Blocker 8** | Runbook Status | Runbook status needed update for REST parity certification. | Updated `CANARY_EXECUTION_RUNBOOK.md` to `PROVIDER_REST_PARITY_PASS_5B_ELIGIBLE_PENDING_HUMAN_AUTHORIZATION`. |
| **Blocker 9 & 10** | Capability Secret & Utility | Secret format required exactly 64-hex chars (256-bit entropy) with offline token generator. | Enforced 64 lowercase hex characters (`/^[0-9a-f]{64}$/`). Created `worker/ai/canary/tokenGenerator.ts` and `npm run generate-canary-token` CLI script. |
| **Blocker 11** | Mock Response Shapes | Test fixtures needed raw REST schema alignment. | Updated mock fixtures in `tests/ai/phaseA12B2C5A3LiveTransportCertification.test.ts` to official REST shapes for both providers. |
| **Blocker 12** | Parity Report | Certification evidence document required. | Committed this document: `A12B2C5A4_1_PROVIDER_REST_PARITY_REPORT.md`. |

---

## 3. Provider Raw REST Schema Specifications

### 3.1 Google Gemini 3.5 Flash-Lite Raw REST Schema
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/interactions`
- **Method**: `POST`
- **Service Tier**: Must include `"service_tier": "flex"`
- **Response Structure**:
```json
{
  "model": "gemini-3.5-flash-lite",
  "service_tier": "flex",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "<output_payload>"
        }
      ]
    }
  ],
  "usage": {
    "total_input_tokens": 500,
    "total_output_tokens": 150,
    "total_thought_tokens": 50,
    "total_cached_tokens": 100,
    "total_tokens": 650,
    "non_cached_input_tokens": 400
  }
}
```
- **Arithmetic Integrity Invariant**:
  $$\text{total\_input\_tokens} = \text{total\_cached\_tokens} + \text{non\_cached\_input\_tokens}$$

### 3.2 DeepSeek V4 Flash Raw REST Schema
- **Endpoint**: `https://api.deepseek.com/v1/chat/completions`
- **Method**: `POST`
- **Response Structure**:
```json
{
  "model": "deepseek-v4-flash",
  "choices": [
    {
      "message": {
        "content": "<output_payload>"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 500,
    "completion_tokens": 150,
    "prompt_cache_hit_tokens": 400,
    "prompt_cache_miss_tokens": 100,
    "completion_tokens_details": {
      "reasoning_tokens": 50
    }
  }
}
```
- **Arithmetic Integrity Invariant**:
  $$\text{prompt\_tokens} = \text{prompt\_cache\_hit\_tokens} + \text{prompt\_cache\_miss\_tokens}$$

---

## 4. Cost Reconciliations

### 4.1 DeepSeek V4 Flash
- **Off-Peak (Default Canary Window)**:
  - Cache Hit: \$0.007 / 1M tokens ($0.007\,\mu\text{USD/token}$)
  - Cache Miss: \$0.22 / 1M tokens ($0.22\,\mu\text{USD/token}$)
  - Output: \$0.66 / 1M tokens ($0.66\,\mu\text{USD/token}$)
- **Peak**:
  - Cache Hit: \$0.014 / 1M tokens ($0.014\,\mu\text{USD/token}$)
  - Cache Miss: \$0.44 / 1M tokens ($0.44\,\mu\text{USD/token}$)
  - Output: \$1.32 / 1M tokens ($1.32\,\mu\text{USD/token}$)

### 4.2 Gemini 3.5 Flash-Lite
- **Flex Tier (`service_tier: "flex"`)**:
  - Input: \$0.15 / 1M tokens ($0.15\,\mu\text{USD/token}$)
  - Output: \$1.25 / 1M tokens ($1.25\,\mu\text{USD/token}$)
  - Thinking Tokens: Included in total output token count
- **Standard Tier (Non-Canary / Full Priority)**:
  - Input: \$0.30 / 1M tokens ($0.30\,\mu\text{USD/token}$)
  - Output: \$2.50 / 1M tokens ($2.50\,\mu\text{USD/token}$)

---

## 5. Offline Capability Token Generator

An offline cryptographic generator is provided in `worker/ai/canary/tokenGenerator.ts` and registered in `package.json` under `generate-canary-token`.

### Operator Execution Contract:
1. The operator first creates the capability secret in the protected environment:
   ```bash
   export VELNAR_CANARY_CAPABILITY_SECRET="$(openssl rand -hex 32)"
   ```
2. The operator runs the generator with strict CLI arguments:
   ```bash
   npm run generate-canary-token -- \
     --approved-by="security-lead@velnar.internal" \
     --max-budget-micro-usd=50000 \
     --target-phase="A.12B.2C-5B"
   ```

### Invariants:
1. `tokenGenerator.ts` strictly requires `VELNAR_CANARY_CAPABILITY_SECRET` from the environment and enforces exactly 64 lowercase hexadecimal characters (`^[0-9a-f]{64}$`). It does not silently generate secrets or accept uppercase characters.
2. The CLI parser strictly validates `--approved-by`, `--max-budget-micro-usd`, and `--target-phase`, rejecting unknown or unauthorized arguments fail-closed.
3. The capability secret is strictly redacted from public output and is never returned in `TokenGeneratorResult` or serialized in the approval envelope.

---

## 6. Test Suite Verification Summary

```
Test Files  37 passed (37)
Tests       683 passed (683)
Duration    ~12s
```

All security invariants, capability protections, transport limiters, and offline gates verified 100% green.
