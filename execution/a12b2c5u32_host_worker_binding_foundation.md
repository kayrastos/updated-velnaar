# VELNAR — A.12B.2C-5U.3.2
# HOST WORKER ENV BINDING & DORMANT OPERATIONAL ROUTE FOUNDATION

**Phase**: VELNAR — A.12B.2C-5U.3.2  
**Artifact Type**: `HOST_WORKER_ENV_BINDING_DORMANT_OPERATIONAL_ROUTE_FOUNDATION`  
**Base Commit**: `7a3dd2540d80cbedc151e4b4247ff5a850d24c92`  
**Base Tree**: `6682bfd144e4ed197a9350941faa4195bf1d4232`  
**Execution Mode**: STRICTLY OFFLINE IMPLEMENTATION & VERIFICATION  
**Authoritative Final Status**: `A12B2C5U32_HOST_WORKER_BINDING_FOUNDATION_PASS_PENDING_INDEPENDENT_SECURITY_REVIEW`  

---

## 1. EXECUTIVE SUMMARY & OBJECTIVE

Phase A.12B.2C-5U.3.2 establishes the host-level binding of the Cloudflare Worker runtime environment:
```
Cloudflare Host
  → worker/index.ts default.fetch(request, env, ctx)
    → dedicated operational route handler (handleProductionCanaryOperationalRoute)
      → exact same env reference
        → executeProductionWorkerCanaryCertification(env, pkg, receipt)
          → env.DB captured internally
          → credential resolver closure constructed internally
          → replay-protected transport execution
```

This satisfies the remaining capability requirement classified by Codex as `HOST_WORKER_ROUTE_BINDING_REQUIRED` by proving that the host-provided `WorkerEnv` is passed by direct reference from the Worker entrypoint through the operational route handler to the capability boundary without intermediate synthesis, spreading, cloning, or caller mutation.

Critically, the operational certification route is **strictly dormant and disabled** in the canonical codebase, protected by dual readiness barriers.

---

## 2. DUAL ROUTE BARRIERS & DORMANT BEHAVIOR

The operational route is governed by immutable constants in the zero-dependency leaf module:
`worker/ai/canary/deepSeekProductionOperationalRoutePolicy.ts`

```typescript
export const PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH =
  '/api/ops/canary/deepseek-certification' as const;

export const PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED =
  false as const;

export const PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY =
  false as const;
```

### Rationale for Two Barriers:
1. **`PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED`**: Platform toggle signaling operational route activation intent.
2. **`PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY`**: Security readiness barrier guaranteeing that dedicated ingress controls (mTLS, Cloudflare Access, service tokens) have been audited and deployed.

Unless **BOTH** barriers are true, the handler terminates immediately:
- Returns `404 NOT_FOUND` with `{ "error": "NOT_FOUND" }`.
- Exactly **ZERO** request body bytes are read (`request.text()` is never called).
- Exactly **ZERO** `env.DB` property accesses occur.
- Exactly **ZERO** `env.DEEPSEEK_API_KEY` property accesses occur.
- Exactly **ZERO** invocations of the capability boundary or transport occur.
- No information is leaked regarding canary, DeepSeek, route existence, live gates, or capabilities.

---

## 3. WORKER/INDEX.TS INTEGRATION & ORDERING RATIONALE

The operational route handler is wired into `worker/index.ts` at an exact architectural junction:
```typescript
// 3. Resolve Authenticated Identity (Fail-Closed)
const user = AuthContextService.resolveSessionUser(authHeader, environment);

if (!user) {
  return addCorsAndSecurityHeaders(unauthorizedResp, validatedOrigin);
}

// Dedicated Production Canary Operational Route (Dormant Foundation)
if (url.pathname === PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH) {
  const operationalResponse = await handleProductionCanaryOperationalRoute(
    request,
    user,
    env
  );
  return addCorsAndSecurityHeaders(operationalResponse, validatedOrigin);
}

// If in production and DB binding is missing, fail-closed with 503
if (environment === 'production' && !env.DB) {
  ...
}
```

### Ordering Rationale:
1. **AFTER Public Health & Dev Demo**: Health and CORS preflights are processed prior to authentication.
2. **AFTER AuthContextService & 401 Rejection**: Anonymous callers without valid session tokens fail closed immediately.
3. **BEFORE Generic Production `!env.DB` Check**:
   - The generic check in `worker/index.ts` checks `env.DB` for standard multi-tenant routes.
   - However, the operational certification route is governed by its own 5U.3.1 capability boundary, which enforces the global live gate **before** any `env.DB` property read.
   - Placing the operational branch before the generic check prevents `worker/index.ts` from pre-reading `env.DB` when the operational live gate or route barriers are closed.
4. **Direct Host Env Passing**: The third parameter passed to `handleProductionCanaryOperationalRoute` is the exact `env` parameter received by `default.fetch(request, env, ctx)`.

---

## 4. FUTURE-PATH SECURITY & REQUEST ENVELOPE

When simulating open route barriers in isolated test harnesses, the handler enforces strict platform-grade controls:

### 4.1 Superadmin Operational Privilege:
- Requires `user && user.isSuperAdmin === true`.
- Tenant roles—including `OWNER`, `ADMIN`, `MANAGER`, `STAFF`, and `VIEWER`—are strictly insufficient. Non-superadmins receive `403 FORBIDDEN` with zero boundary calls.

### 4.2 Strict Top-Level HTTP Envelope:
- Method must be `POST` (non-POST yields `405 METHOD_NOT_ALLOWED`).
- Content-Type must be `application/json` (invalid yields `400 INVALID_REQUEST`).
- Content-Length and body text must not exceed 65,536 bytes (exceeding yields `413 PAYLOAD_TOO_LARGE`).
- JSON payload must be a non-null, non-array object.
- Payload must contain **EXACTLY two top-level keys**:
  `authorizationPackage` and `sourceProvenanceReceipt`.
- Any extra keys (such as `env`, `db`, `apiKey`, `credential`, `getRuntimeCredential`, `resolver`, `options`) are rejected with `400 INVALID_REQUEST`.

### 4.3 Inner Payload Passivity:
- The route handler does not inspect, parse, or validate fields within `authorizationPackage` or `sourceProvenanceReceipt`. Those fields represent untrusted caller data and are passed directly to the capability boundary for cryptographic snapshotting and verification.

---

## 5. RESPONSE MINIMIZATION & HYGIENE

The operational handler does not return raw transport objects, candidates, or execution transcripts. It formats an operational summary containing only allowlisted fields:
- `success` (boolean)
- `status` (string)
- `failureCategory` (optional string)
- `errors` (readonly string[])
- `providerNetworkCalls` (number)
- `credentialReads` (number)
- `transportAttempts` (number)
- `completedTasks` (number)
- `observedTotalCostMicroUsd` (number)
- `authorizedBudgetMicroUsd` (number)
- `aggregateSemanticScore` (number)
- `allTasksPassed` (boolean)
- `allSchemasValid` (boolean)
- `finalCertificationEligible` (boolean)

**Explicitly Stripped & Redacted**:
- `candidate` (intermediate candidate structure)
- `invocationResponses` (raw DeepSeek responses)
- `invocationRecords` (task execution transcripts)
- Source SHAs, run nonces, replay keys, database connection details, and credentials.

---

## 6. COMPLETE STATUS OF AUTHORITATIVE CANARY GATES

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
| `PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED` | `false` | **NEW**: Operational route activation toggle |
| `PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY` | `false` | **NEW**: Ingress auth readiness toggle |

---

## 7. REMAINING PREREQUISITES FOR FUTURE ACTIVATION

Before live production certification can be enabled in a future release:
1. Operational ingress authentication (mTLS / Cloudflare Access / Service Tokens) must be provisioned and verified.
2. Real Cloudflare D1 database provisioning and concurrency certification.
3. Production human authorization trust anchor provisioning.
4. Runtime source provenance trust anchor provisioning.
5. Independent multi-party security review approval.
