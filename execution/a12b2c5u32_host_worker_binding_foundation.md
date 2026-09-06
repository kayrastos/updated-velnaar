# VELNAR — A.12B.2C-5U.3.2R
# TARGETED SECURITY REPAIR REPORT AFTER INDEPENDENT CODEX HIGH REVIEW
# HOST WORKER ENV BINDING & HARDENED DORMANT OPERATIONAL ROUTE FOUNDATION

**Phase**: VELNAR — A.12B.2C-5U.3.2R  
**Artifact Type**: `HOST_WORKER_ENV_BINDING_DORMANT_OPERATIONAL_ROUTE_FOUNDATION`  
**Base Commit**: `046b9eb75793b3279a4a85be006f5a43884cc937`  
**Base Tree**: `9098a82e03ccfd619f617987417c7d0b0e8415a7`  
**Execution Mode**: STRICTLY OFFLINE IMPLEMENTATION & VERIFICATION  
**Authoritative Final Status**: `A12B2C5U32_TARGETED_SECURITY_REPAIR_PASS_PENDING_INDEPENDENT_REREVIEW`  

---

## 1. EXECUTIVE SUMMARY & SECURITY RE-AUDIT CONTEXT

An independent Codex High architectural and security review of phase `A.12B.2C-5U.3.2` identified three seal-blocking vulnerabilities in the operational route handler:
1. **Unbounded Request Body Buffering & UTF-16 Code-Unit Counting**: Calling `await request.text()` buffered the entire unconstrained payload before checking size, and checked JavaScript string `.length` (UTF-16 code units) rather than actual UTF-8 request bytes.
2. **Public Response Information Leakage via Raw `result.errors`**: Forwarding downstream `result.errors` directly into the public HTTP response risked exposing internal SQLite/D1 diagnostics, provider error messages, tokens, SHAs, and nonces.
3. **Duplicate Top-Level JSON Member Collisions**: Standard `JSON.parse` silently overwrote duplicate keys with the final value, allowing attackers to bypass two-key envelope restrictions via duplicate member smuggling.

Phase `A.12B.2C-5U.3.2R` remediates **ONLY** these three seal-blocking findings in place while strictly preserving all existing `5U.3.2` and `5U.3.1` architectural invariants.

---

## 2. REPAIR SPECIFICATIONS

### 2.1 Repair 1 — True 65,536-Byte Incremental Stream Limiting
- **Incremental Stream Consumption**: Rather than buffering via `request.text()`, the handler acquires `request.body.getReader()` and incrementally tallies received bytes via chunk `byteLength`.
- **Immediate Rejection & Cancellation**: The moment cumulative bytes exceed 65,536, the reader is cancelled (`reader.cancel()`), execution terminates immediately, and HTTP `413 PAYLOAD_TOO_LARGE` is returned. The capability boundary is **never** invoked.
- **Strict Content-Length Header Pre-Validation**:
  - Validated strictly with canonical unsigned decimal syntax (`/^[0-9]+$/`).
  - Negative values (`-1`), fractional numbers (`12.5`), junk suffixes (`12abc`), and non-safe integers fail closed with `400 INVALID_REQUEST`.
  - Content-Length values exceeding 65,536 reject with `413` prior to any body stream acquisition.
  - Content-Length is treated strictly as an early rejection optimization; actual streamed bytes are always counted to prevent understated header bypasses.
- **Deterministic Fatal UTF-8 Decoding**: The bounded `Uint8Array` buffer is decoded with `new TextDecoder('utf-8', { fatal: true })`. Malformed byte sequences fail closed with `400 INVALID_REQUEST`.

### 2.2 Repair 2 — Public-Safe Error Sanitization Boundary
- **Zero Exposure of Downstream Errors**: Raw `result.errors` from the capability boundary or transport are **strictly prohibited** from crossing the HTTP boundary.
- **Deterministic Public Allowlist**: All errors are mapped exclusively from structural state (`result.status` and `result.failureCategory`) to a route-owned public allowlist:
  - `CANARY_LIVE_EXECUTION_BLOCKED`
  - `CANARY_AUTHORIZATION_REJECTED`
  - `CANARY_SOURCE_BINDING_REJECTED`
  - `CANARY_REPLAY_REJECTED`
  - `CANARY_PROVIDER_EXECUTION_FAILED`
  - `CANARY_VALIDATION_FAILED`
  - `CANARY_BUDGET_REJECTED`
  - `CANARY_INTERNAL_FAILURE`
- **Redaction of Diagnostics**: Diagnostic strings containing sentinels, SQL tables, stack traces, provider URLs, source SHAs, or replay keys are completely excluded.
- **Sanitized Failure Categories**: Only known canonical failure categories from `TRANSPORT_FAILURE_CATEGORIES` are reflected; unknown or arbitrary strings are omitted.

### 2.3 Repair 3 — Duplicate Top-Level JSON Member Rejection
- **Deterministic Top-Level Member Scanner**: A bounded, duplicate-aware tokenizer (`scanTopLevelJsonEnvelope`) parses the raw JSON string before `JSON.parse`.
- **Exact Member Enforcement**: The top-level envelope must contain **exactly** `authorizationPackage` and `sourceProvenanceReceipt`.
- **Rejection of Duplicate Keys**: If either key appears more than once at top level, it fails closed with `400 INVALID_REQUEST`.
- **Prototype Poisoning & Third Key Rejection**: Keys including `__proto__`, `constructor`, `prototype`, `env`, `db`, `apiKey`, and Unicode lookalikes are rejected.
- **Value Isolation**: The tokenizer parses values without recursing or materializing attacker objects, ensuring strings with escaped quotes or nested objects with matching keys do not trigger false positive rejections.

---

## 3. PRESERVED HOST WORKER CAPABILITY INVARIANTS

The call signature to the capability boundary remains completely untouched:
```typescript
const result = await executeProductionWorkerCanaryCertification(
  env,
  bodyRecord.authorizationPackage,
  bodyRecord.sourceProvenanceReceipt
);
```
- The `env` reference passed to the capability boundary is the exact, un-cloned, un-spread object reference received by `handleProductionCanaryOperationalRoute` from `worker/index.ts`.
- The operational route performs zero property accesses on `env.DB` or `env.DEEPSEEK_API_KEY`.
- Sourced capabilities remain encapsulated within the 5U.3.1 capability boundary after its authoritative global live gate.

---

## 4. DORMANT STATE & READINESS BARRIERS

The operational route remains strictly dormant and protected by multi-layered barriers in production:
- `PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED = false`
- `PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY = false`

### 4.1 Direct Operational Handler Behavior
When `handleProductionCanaryOperationalRoute(...)` is directly invoked or reached under canonical policy:
- `PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED === false`
- `PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY === false`

Because these canonical operational route barriers are `false`, the handler returns HTTP `404 NOT_FOUND` immediately, with:
- Zero request body reads
- Zero reader acquisitions
- Zero `env.DB` accesses
- Zero `env.DEEPSEEK_API_KEY` accesses
- Zero capability-boundary invocations

### 4.2 Current End-to-End Worker Production Behavior
In the complete Worker pipeline (`worker/index.ts`), session and user authentication are resolved before dispatching to the operational route branch:
- `worker/index.ts` extracts the `Authorization` header into `authHeader` and invokes `AuthContextService.resolveSessionUser(authHeader, environment)` before operational route dispatch.
- Because verified production session authentication and production superadmin authentication are not yet implemented or proven in the canonical runtime, ordinary end-to-end production requests do not reach the operational route handler. Instead, they fail closed at the host authentication boundary with HTTP `401 UNAUTHORIZED`.
- If a request were ever authenticated in the future, it would then encounter the dormant handler-level barrier and return HTTP `404 NOT_FOUND` as long as operational route gates remain closed.

### 4.3 Evidence Precision Note
This distinction between handler-level canonical behavior (`404 NOT_FOUND`) and current end-to-end Worker request behavior (`401 UNAUTHORIZED`) is an evidence-precision correction only. It accurately models the current multi-layer fail-closed defense without weakening dormant safety or altering the reviewed security implementation:
- No claim is made that every end-to-end production request receives `404` (unauthenticated requests receive `401` first).
- No claim is made that production superadmin authentication exists or is proven.
- No claim is made that operational ingress authentication exists or is provisioned.
- No claim is made that production success-path execution exists or has been certified.

---

## 5. COMPLETE STATUS OF AUTHORITATIVE CANARY GATES

All 11 authoritative canary readiness and operational gates remain strictly `false`:

| Gate Constant | Value | Description |
|---|---|---|
| `CANARY_LIVE_EXECUTION_ENABLED` | `false` | Authoritative global live dispatch gate |
| `GUARDED_SOURCE_ATTESTATION_READY` | `false` | Runtime source attestation prerequisite |
| `GUARDED_HUMAN_AUTH_ATTESTATION_READY` | `false` | Production human authorization prerequisite |
| `PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED` | `false` | Human root trust anchor |
| `RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED` | `false` | Source provenance trust anchor |
| `D1_REPLAY_BACKEND_PRODUCTION_BOUND` | `false` | Durable D1 replay binding |
| `D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED` | `false` | Real Cloudflare D1 database provisioning |
| `D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED` | `false` | Real D1 concurrency certification |
| `productionRoutingEnforcementAllowed` | `false` | Production router enforcement gate |
| `PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED` | `false` | Operational route activation toggle |
| `PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY` | `false` | Ingress auth readiness toggle |

---

## 6. EXPLICIT NON-CLAIMS & REMAINING ACTIVATION PREREQUISITES

This repair phase makes **NO** claims of production readiness:
- **Cloudflare Production Deployment**: NOT verified.
- **Operational Ingress Authentication**: STILL NOT provisioned (mTLS / Cloudflare Access / Service Tokens).
- **Production Superadmin Authentication**: STILL NOT proven.
- **Real Cloudflare D1 Database**: NOT provisioned.
- **Real D1 Concurrency**: NOT certified.
- **Live Execution**: NOT enabled.
- **Production Success-Path**: NOT certified.
