# VELNAR — A.12B.2C-5U.3.1
# INTERNAL WORKER RUNTIME CAPABILITY BINDING FOUNDATION

**Phase**: VELNAR — A.12B.2C-5U.3.1  
**Artifact Type**: `INTERNAL_WORKER_CAPABILITY_BINDING_FOUNDATION_OFFLINE`  
**Base Commit**: `fe2d4abe6d19e3429a4768fee0852ba76256a75a`  
**Base Tree**: `23e649d31df99a5a076520a285b30a6113940992`  
**Execution Mode**: STRICTLY OFFLINE IMPLEMENTATION & VERIFICATION  
**Authoritative Final Status**: `A12B2C5U31_WORKER_CAPABILITY_BINDING_FOUNDATION_PASS_PENDING_INDEPENDENT_SECURITY_REVIEW`  

---

## 1. EXECUTIVE SUMMARY & OBJECTIVE

Phase A.12B.2C-5U.3.1 implements the dedicated, internal Cloudflare Worker capability boundary module:
`worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary.ts`

This module encapsulates the sealed, replay-protected raw production transport:
`executeProductionReplayProtectedDeepSeekCertificationTransport(db, pkg, sourceReceipt, getRuntimeCredential)`

by establishing an impermeable boundary where:
1. **D1 Capability**: Sourced strictly from ambient `env.DB`.
2. **DeepSeek Credential Capability**: Sourced strictly from ambient `env.DEEPSEEK_API_KEY` via an internal, un-exported closure evaluated strictly post-reservation.
3. **Caller Capabilities Strictly Prohibited**: The public API accepts **exactly 3 parameters**:
   `executeProductionWorkerCanaryCertification(env, untrustedPkg, untrustedSourceReceipt)`.
   Callers cannot supply `db`, `backend`, `reserveIfAbsent`, `getRuntimeCredential`, `apiKey`, `replayKey`, `options`, or overrides.
4. **Authoritative Gate Order**: Argument count is validated first. The authoritative global live gate is evaluated first decision before any capability or payload property is accessed.
5. **Deferred Credential Resolution & Zero Normalization**: `env.DEEPSEEK_API_KEY` is NOT read during preflight or closure construction; it is read strictly after D1 confirms `RESERVED`. Leading/trailing/only whitespace is rejected, and exact string bytes are preserved without normalization.
6. **Zero Route Exposure**: The module is completely unrouted; `worker/index.ts`, `worker/env.ts`, and `worker/routes/aiRouter.ts` remain 100% unmodified.

---

## 2. EXACT PUBLIC API & ARGUMENT COUNT PASSIVITY

The module exports exactly one function:
```typescript
export async function executeProductionWorkerCanaryCertification(
  env: WorkerEnv,
  untrustedPkg: unknown,
  untrustedSourceReceipt: unknown
): Promise<GuardedTransportExecutionResult>
```

### Argument Count Enforcement:
`arguments.length` MUST equal 3.
- If called with 0, 1, 2, 4, or more arguments, execution immediately fails closed before reading any property of `env`, `untrustedPkg`, or `untrustedSourceReceipt`.
- Error returned: `WORKER_CAPABILITY_BOUNDARY_ARGUMENT_COUNT_INVALID`.
- Status: `PREFLIGHT_VALIDATION_FAILED`, failure category: `AUTHORIZATION_BINDING_FAILURE`.
- All execution counters strictly zero.

---

## 3. AUTHORITATIVE LIVE GATE & GETTER PASSIVITY

Immediately following argument count validation:
```typescript
if (
  !CANARY_LIVE_EXECUTION_ENABLED ||
  (CANARY_LIVE_EXECUTION_STATE as string) !== 'LIVE_EXECUTION_ALLOWED'
) {
  return {
    success: false,
    status: 'LIVE_EXECUTION_BLOCKED',
    failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
    errors: ['WORKER_CAPABILITY_BOUNDARY_LIVE_EXECUTION_BLOCKED'],
    providerNetworkCalls: 0,
    credentialReads: 0,
    transportAttempts: 0,
    completedTasks: 0,
    candidate: null,
    invocationResponses: [],
    invocationRecords: [],
    observedTotalCostMicroUsd: 0,
    authorizedBudgetMicroUsd: 0,
    aggregateSemanticScore: 0,
    allTasksPassed: false,
    allSchemasValid: false,
    finalCertificationEligible: false,
  };
}
```

### Critical Passivity Invariant:
When `CANARY_LIVE_EXECUTION_ENABLED === false` (the authoritative canonical state):
- **ZERO reads of `env.ENVIRONMENT`**
- **ZERO reads of `env.DB`**
- **ZERO reads of `env.DEEPSEEK_API_KEY`**
- **ZERO reads of `untrustedPkg`**
- **ZERO reads of `untrustedSourceReceipt`**
Counting or throwing getters placed on any of these parameters are evaluated **zero times**.

---

## 4. ENVIRONMENT & D1 CAPABILITY CAPTURE

Once the live gate passes:
1. **Environment Object Check**: Requires `env` to be a non-null object. Fails closed with `WORKER_ENV_MISSING` otherwise.
2. **Environment Policy**: Reads `env.ENVIRONMENT` within try/catch. Requires exact string `'production'`. Non-production environments (development, test, preview, arbitrary) fail closed with `WORKER_ENVIRONMENT_INVALID`. Thrown accessors fail closed with `WORKER_ENVIRONMENT_UNAVAILABLE`.
3. **D1 Capability Capture**: Reads `env.DB` exactly once within try/catch. Requires non-null object. Fails closed with `WORKER_D1_DATABASE_UNAVAILABLE`.
   - The boundary does NOT call `prepare()` or inspect SQL methods; backend storage adapter validation belongs to the raw transport.
   - The exact captured reference is passed to the raw transport.

---

## 5. DEFERRED CREDENTIAL RESOLVER & ZERO NORMALIZATION

The internal credential resolver is defined locally within the invocation scope:
```typescript
const runtimeEnv = env;

const getRuntimeCredential = (): DeepSeekRuntimeCredential => {
  let rawKey: unknown;

  try {
    rawKey = runtimeEnv.DEEPSEEK_API_KEY;
  } catch {
    throw new Error('WORKER_DEEPSEEK_API_KEY_UNAVAILABLE');
  }

  if (typeof rawKey !== 'string' || rawKey.length === 0) {
    throw new Error('WORKER_DEEPSEEK_API_KEY_UNAVAILABLE');
  }

  if (rawKey.trim() !== rawKey) {
    throw new Error('WORKER_DEEPSEEK_API_KEY_NON_CANONICAL');
  }

  return Object.freeze({
    apiKey: rawKey,
  });
};
```

### Invariants:
- **Zero Preflight Reads**: Constructing the resolver closure causes **EXACTLY ZERO reads** of `runtimeEnv.DEEPSEEK_API_KEY`.
- **Post-Reservation Timing**: The secret is accessed strictly when the raw transport invokes `getRuntimeCredential` after D1 confirms `RESERVED`.
- **Zero Normalization**: `rawKey.trim()` is NEVER returned. If `rawKey.trim() !== rawKey`, the resolver throws `WORKER_DEEPSEEK_API_KEY_NON_CANONICAL`. Valid keys preserve exact original bytes.
- **Frozen Plain Object**: Returns `Object.freeze({ apiKey: rawKey })`. Zero getters, zero custom prototypes.
- **Secret Hygiene**: Missing or throwing secret access throws generic `WORKER_DEEPSEEK_API_KEY_UNAVAILABLE`. Secret content is never exposed in error text, logs, evidence, or responses.

---

## 6. POST-RESERVATION CREDENTIAL FAILURE & LEDGER PRESERVATION

If `DEEPSEEK_API_KEY` is missing, empty, or non-canonical when evaluated by the raw transport post-reservation:
- The resolver throws cleanly.
- The raw transport catches the error and terminates with `AUTHORIZATION_BINDING_FAILURE`.
- **Ledger Invariant**: Because durable D1 replay reservation completed prior to credential resolution, the single-use authorization **remains consumed in D1**.
- The boundary does NOT retry, does NOT query alternate keys, does NOT execute compensating deletions, and does NOT provide fallback credentials.

---

## 7. SCOPE STABILITY & UNROUTED ISOLATION

This phase maintains strict non-interference:
- **`worker/index.ts`**: UNCHANGED. Zero route wiring.
- **`worker/env.ts`**: UNCHANGED.
- **`worker/routes/aiRouter.ts`**: UNCHANGED. Tenant AI routes remain completely separated from operational canary certification.
- **`wrangler.jsonc`**: UNCHANGED.
- **No Public Route**: The boundary cannot be invoked via external HTTP requests.

### WorkerEnv Runtime Origin Limitation:
The TypeScript type `WorkerEnv` does NOT prove host origin by itself. At this stage, `env` is an internal test/invocation parameter. Proof of host-supplied origin will be established in Phase 5U.3.2 when `worker/index.ts` binds its host-provided `env` object directly to the boundary.

---

## 8. REMAINING REQUIREMENTS FOR LIVE PRODUCTION READINESS

The completion of Phase 5U.3.1 leaves all fail-closed gates strictly false:
1. **Phase 5U.3.2**: Host Worker routing and administrative orchestration integration.
2. **Real D1 Provisioning**: Allocation of real Cloudflare D1 database and updating `database_id` in `wrangler.jsonc`.
3. **Real D1 Concurrency Certification**: Live distributed race testing verifying SQLite PRIMARY KEY conflict semantics.
4. **Human Authority Trust-Anchor Provisioning**: Enrolling public Ed25519 keys into `PRODUCTION_HUMAN_AUTHORIZATION_AUTHORITIES`.
5. **Runtime Source Provenance Trust-Anchor Provisioning**: Enrolling build authority public keys into `PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES`.
6. **Live Execution Gate Approval**: Flipping `CANARY_LIVE_EXECUTION_ENABLED` only after all prior gates pass independent verification.

---

## 9. CONCLUSION

Phase A.12B.2C-5U.3.1 successfully establishes the internal Worker runtime capability boundary foundation with complete anti-injection defense, verified gate ordering, deferred credential resolution, strict non-normalization, and zero route exposure.

**Final Status**: `A12B2C5U31_WORKER_CAPABILITY_BINDING_FOUNDATION_PASS_PENDING_INDEPENDENT_SECURITY_REVIEW`
