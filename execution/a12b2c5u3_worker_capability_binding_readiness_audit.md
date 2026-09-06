# VELNAR — A.12B.2C-5U.3
# WORKER CAPABILITY BINDING READINESS AUDIT

**Phase**: VELNAR — A.12B.2C-5U.3  
**Artifact Type**: `WORKER_CAPABILITY_BINDING_READINESS_AUDIT`  
**Base Commit**: `737c9f8e5c335cbe8985c745915ffcdd8e7cc5ae`  
**Base Tree**: `f33d2963dba1d62a64a601553ef06ef31eee234a`  
**Execution Mode**: STRICTLY OFFLINE AUDIT & ARCHITECTURAL DESIGN ONLY  
**Authoritative Final Status**: `A12B2C5U3_WORKER_CAPABILITY_BINDING_AUDIT_PASS_DESIGN_READY`  

---

## 1. EXECUTIVE SUMMARY & AUDIT MANDATE

Phase 5U.2, 5U.2.1, 5U.2.2, and 5U.2.3 established the sealed, same-invocation replay-protected guarded transport foundation:
1. **Immutable Snapshot Acquisition**: Safe property materialization prior to first `await`, complete immunity against caller TOCTOU object-mutation attacks across async coordinator and credential boundaries.
2. **Same-Invocation Coordinator Execution**: Cryptographic source verification, human authorization verification, and D1 single-statement atomic replay reservation strictly executed within the same invocation without portable tokens.
3. **Permanent Legacy Non-Production Barrier**: Fail-closed gate preventing un-authenticated legacy transport from running in production.
4. **Behavioral Test Observability Verification**: Full 7-task offline dispatch verification proving candidate policy derives strictly from verified authorizations and rejects attacker mutations.

However, the raw production transport entry point:
```typescript
export async function executeProductionReplayProtectedDeepSeekCertificationTransport(
  db: D1Database,
  pkg: SignedHumanAuthorizationPackage,
  sourceReceipt: RuntimeSourceProvenanceReceipt,
  getRuntimeCredential: () => Promise<DeepSeekRuntimeCredential> | DeepSeekRuntimeCredential
): Promise<GuardedTransportExecutionResult>
```
currently accepts `db: D1Database` and `getRuntimeCredential` directly as parameters. In a raw HTTP environment, accepting capabilities as caller-provided parameters would allow malicious callers or insecure routes to inject mock databases, bypass replay tracking, or supply arbitrary API keys.

### Objective of Phase A.12B.2C-5U.3
Design the exact, safest Cloudflare Worker runtime capability binding to supply:
- **Cloudflare Runtime D1 Database Binding**: `env.DB`
- **Cloudflare Runtime Secret Binding**: `env.DEEPSEEK_API_KEY`

such that these capabilities are sourced **exclusively** from the authenticated Cloudflare Worker runtime environment (`WorkerEnv`), completely isolated from HTTP request bodies, query strings, headers, tenant AI envelopes, caller options, or external caller callbacks.

### Strict Non-Modification Mandates
- **ZERO production code modified** in this audit phase.
- **ZERO test code modified** in this audit phase.
- **ZERO migrations or Wrangler configuration modified**.
- **ZERO real D1 calls, cloud resources provisioned, or migrations applied**.
- **ZERO DeepSeek, Gemini, or external network provider calls**.
- **ZERO private keys read or generated**.

---

## 2. INSPECTED FILES & CAPABILITY FLOW

The following core codebase artifacts were systematically audited to determine runtime trust boundaries and capability flow:

| File Path | Component Role | Capability Observation |
| :--- | :--- | :--- |
| `worker/index.ts` | Primary Cloudflare Worker entry point | Exports `default.fetch(request, env, ctx)`. Receives `WorkerEnv` from Cloudflare host. Evaluates global DB presence in production. |
| `worker/env.ts` | Environment interface definition | Defines `WorkerEnv` containing `DB?: D1Database`, `ENVIRONMENT: string`, `DEEPSEEK_API_KEY?: string`. |
| `worker/routes/aiRouter.ts` | Tenant AI API router (`/api/ai/*`) | Handles tenant-scoped requests. Receives entire `WorkerEnv`. Strictly enforces `TenantGuard` and `BusinessTenantGuard`. |
| `worker/ai/canary/deepSeekGuardedLiveTransport.ts` | Sealed production guarded transport | Defines `executeProductionReplayProtectedDeepSeekCertificationTransport`. Enforces argument count 4, materialization, same-invocation replay. |
| `worker/ai/canary/deepSeekProductionReplayCoordinator.ts` | Production replay coordinator | Coordinates source provenance, human authorization, and atomic D1 replay reservation. Accepts `db: D1Database`. |
| `worker/ai/canary/d1AuthorizationReplayBackend.ts` | Atomic D1 storage adapter | Executes single-statement `INSERT ... ON CONFLICT DO NOTHING RETURNING replay_key`. Accepts `db: D1Database`. |
| `worker/ai/canary/deepSeekProductionAuthorizationTrust.ts` | Authorization trust registry | Manages public key verification for human authorization. `PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED === false`. |
| `worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance.ts` | Source provenance registry | Verifies runtime Git commit/tree receipts against build authorities. `RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED === false`. |
| `worker/ai/canary/canarySpecification.ts` | Authoritative kill-switch & policy | Declares `CANARY_LIVE_EXECUTION_ENABLED = false` and `productionRoutingEnforcementAllowed = false`. |
| `wrangler.jsonc` | Worker deployment configuration | Declares D1 database binding `DB` (`database_id` placeholder) and vars (`ENVIRONMENT: "production"`). Secrets injected via runtime. |
| `tests/ai/phaseA12B2C5U2ProductionGuardedTransportIntegration.test.ts` | 5U.2 test suite | 224 pure offline tests validating same-invocation replay, TOCTOU immunity, and getter passivity. |

---

## 3. CONFIRMATION OF CURRENT WORKER TRUST ROOT

### A. Runtime Injection of `WorkerEnv`
In Cloudflare Workers, the runtime environment is passed by the host system as the second argument to the exported `fetch` handler in `worker/index.ts`:
```typescript
export default {
  async fetch(request: Request, env: WorkerEnv, ctx?: any): Promise<Response> {
    ...
  }
}
```
This object is instantiated by the V8 isolate runtime before request dispatch. Its properties (`env.DB`, `env.DEEPSEEK_API_KEY`, `env.ENVIRONMENT`) represent ambient infrastructure capabilities configured in `wrangler.jsonc` or Cloudflare encrypted secrets.

### B. Request-Controlled Value Separation
Audit confirms that standard HTTP request components (JSON body, query parameters, URL path, headers) are parsed locally within individual route handlers. 
- There is **NO automatic prototype pollution** or merge between `request` and `env`.
- `env.DB` and `env.DEEPSEEK_API_KEY` cannot be replaced by incoming HTTP headers or JSON bodies unless application code explicitly performs an unsafe assignment (e.g. `Object.assign(env, body)`). No such assignment exists in the codebase.
- **Security Mandate**: Future capability binding must never expose a parameter that accepts an external `db` or external `credentialResolver` in any reachable route.

### C. Current `env.DB` Handling in `worker/index.ts`
`worker/index.ts` already treats `env.DB` strictly as a runtime-only capability:
```typescript
// worker/index.ts lines 170-177
if (environment === 'production' && !env.DB) {
  SafeLogger.error('[WORKER_CONFIG_ERROR] Cloudflare D1 Database binding (env.DB) is missing in production');
  const dbNotConfiguredResp = Response.json({
    error: 'DATABASE_NOT_CONFIGURED',
    message: 'Database service is not configured or unavailable in production.',
  }, { status: 503 });
  return addCorsAndSecurityHeaders(dbNotConfiguredResp, validatedOrigin);
}
```
Sub-routers (`leadsRouter`, `appointmentsRouter`, `growthActionsRouter`, `vaultRouter`, `auditRouter`) receive `env.DB` directly as a function argument from `worker/index.ts`.

### D. Whole-`env` Exposure in `/api/ai`
In `worker/index.ts` (line 201):
```typescript
} else if (url.pathname.startsWith('/api/ai')) {
  response = await handleAiRoute(request, user, url, env);
}
```
`handleAiRoute` receives the entire `WorkerEnv` object. It forwards `env` to `AIRouter.execute(body, env)` and `ActionDraftEngine.draftActionFromLeak(draftInput, env)`.
**Identified Risk**: `WorkerEnv` contains all provider keys (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `KIMI_API_KEY`) and the KMS master secret (`VELNAR_MASTER_KMS_SECRET`). If certification canary execution were added to `/api/ai`, tenant requests could accidentally access or trigger operational canary logic, creating privilege escalation and cross-tenant boundary confusion.

### E. Zero Capability Injection from HTTP Input
Audit of all existing route handlers confirms:
- **ZERO routes accept `D1Database` from HTTP input.**
- **ZERO routes accept a credential resolver or raw API key from HTTP input.**
- **ZERO routes accept a replay backend, replay key, or replay result from HTTP input.**
All database operations and provider credentials throughout the application are strictly sourced from ambient environment bindings.

---

## 4. TENANT AI ROUTE AUDIT (`/api/ai/*` SEPARATION MANDATE)

Audit Question: *Should existing `/api/ai/run` or any `/api/ai/*` route be used for production certification canary execution?*

**VERDICT: CATEGORICALLY NO.**

### Rationale:
1. **Tenant Context vs Operational Infrastructure Context**:
   - Routes under `/api/ai/*` require an authenticated end-user (`AuthenticatedUser`), explicit tenant organization ID (`organizationId`), and RBAC authorization via `TenantGuard.authorize(user, orgId, 'actions.read')`.
   - Canary certification is a privileged, infrastructure-level verification procedure executed by platform operators or CI/CD systems to prove that the DeepSeek model conforms to the sealed 7-task specification under cryptographic governance. It does NOT belong to any tenant organization.
2. **Payload Conflict & Incompatible Data Contracts**:
   - `/api/ai/run` expects an `AIRequestEnvelope` containing business prompts, data classification (`PUBLIC_BUSINESS` / `PSEUDONYMOUS_OPERATIONAL`), and optional leak IDs.
   - Guarded certification transport expects a `SignedHumanAuthorizationPackage` (Ed25519 signed by platform security root) and a `RuntimeSourceProvenanceReceipt` (Ed25519 signed by build authority).
3. **Denial of Service & Replay Ledger Pollution**:
   - Allowing arbitrary tenant users to trigger canary certification could exhaust single-use authorization nonces, consume operational certification budgets, or lock out authorized certification runs via replay ledger conflicts.
4. **Mandate**:
   - **Do NOT modify `worker/routes/aiRouter.ts`**.
   - **Do NOT add canary certification endpoints under `/api/ai/*`**.

---

## 5. TARGET PRODUCTION CAPABILITY ORDER

When invoked in the future production runtime, execution MUST follow this strict 14-step deterministic order:

```
Step 1:  Host Runtime Initialization
         └── Cloudflare Workers host provides real, immutable 'env: WorkerEnv'.

Step 2:  Authoritative Global Live Gate Check
         └── CANARY_LIVE_EXECUTION_ENABLED === true && CANARY_LIVE_EXECUTION_STATE === 'LIVE_EXECUTION_ALLOWED'
         └── If false -> FAIL CLOSED (status: 'LIVE_EXECUTION_BLOCKED')

Step 3:  Runtime Environment Validation
         └── env.ENVIRONMENT === 'production'
         └── If non-production -> FAIL CLOSED (status: 'PREFLIGHT_VALIDATION_FAILED', error: 'WORKER_ENVIRONMENT_INVALID')

Step 4:  Runtime D1 Database Capability Verification
         └── typeof env.DB === 'object' && env.DB !== null
         └── If missing -> FAIL CLOSED (status: 'PREFLIGHT_VALIDATION_FAILED', error: 'WORKER_D1_DATABASE_UNAVAILABLE')

Step 5:  Runtime DeepSeek Credential Capability Verification
         └── typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.trim().length > 0
         └── If missing/blank -> FAIL CLOSED (status: 'PREFLIGHT_VALIDATION_FAILED', error: 'WORKER_DEEPSEEK_API_KEY_UNAVAILABLE')

Step 6:  Untrusted Operational Payload Ingestion
         ├── Receive untrusted SignedHumanAuthorizationPackage (caller JSON)
         └── Receive untrusted RuntimeSourceProvenanceReceipt (caller JSON)

Step 7:  Materialization of Immutable Snapshots
         └── Deep-freeze and strip prototype/accessors/symbols from caller inputs before first await.

Step 8:  Internal Credential Closure Construction
         └── Construct private, non-serializable, non-exported closure reading env.DEEPSEEK_API_KEY.

Step 9:  Invoke Production Guarded Transport
         └── executeProductionReplayProtectedDeepSeekCertificationTransport(env.DB, pkg, receipt, internalClosure)

Step 10: Verified Runtime Source Provenance Verification
         └── verifyProductionRuntimeSourceProvenanceReceipt against sealed authority registry.

Step 11: Production Human Authorization Signature Verification
         └── verifyHumanAuthorizationPackage against sealed human authority registry.

Step 12: Atomic Single-Statement D1 Replay Reservation
         └── backend.reserveIfAbsent(request) via INSERT ... ON CONFLICT DO NOTHING RETURNING replay_key.
         └── Require status === 'RESERVED'.

Step 13: Fresh Expiry & Pricing Window Rechecks
         └── Pre-credential and post-credential runtime clock checks.

Step 14: Evaluate Credential Closure Exactly Once & Dispatch
         └── Resolve DeepSeekRuntimeCredential internally and execute 7 canonical tasks sequentially.
```

**Critical Invariant**: At NO point may a caller supply `db`, `backend`, `reserveIfAbsent`, `credentialResolver`, `apiKey`, `replayKey`, `verified: true`, or `authorizationReady: true`.

---

## 6. D1 CAPABILITY BINDING ARCHITECTURAL EVALUATION

Four candidate architectures were evaluated for binding `env.DB` and `env.DEEPSEEK_API_KEY`:

### Option A: Direct In-Line Invocation in `worker/index.ts`
`worker/index.ts` directly imports `executeProductionReplayProtectedDeepSeekCertificationTransport`, reads `env.DB` and `env.DEEPSEEK_API_KEY`, and calls the transport inline.
- **Drawbacks**: Bloats `worker/index.ts` with canary-specific validation and error mapping. Exposes raw transport construction directly inside the primary routing file. Difficult to unit-test without running full worker integration tests. Violates single-responsibility principle.

### Option B: Dedicated Capability Boundary Module (`deepSeekProductionWorkerCapabilityBoundary.ts`) [RECOMMENDED]
A dedicated internal module under `worker/ai/canary/` defines:
```typescript
export async function executeProductionWorkerCanaryCertification(
  env: WorkerEnv,
  untrustedPkg: unknown,
  untrustedSourceReceipt: unknown
): Promise<GuardedTransportExecutionResult>
```
Inside this module:
1. Validates `env` presence, `env.ENVIRONMENT === 'production'`, `env.DB`, and `env.DEEPSEEK_API_KEY`.
2. Creates the private, un-exported credential resolver closure.
3. Invokes `executeProductionReplayProtectedDeepSeekCertificationTransport(env.DB, untrustedPkg as any, untrustedSourceReceipt as any, internalClosure)`.
4. Returns the standardized `GuardedTransportExecutionResult`.
- **Advantages**: 
  - **Zero Caller-Supplied Capabilities**: API signature strictly requires `env: WorkerEnv` and accepts data payloads only.
  - **Full Offline Testability**: Can be tested comprehensively using simulated `WorkerEnv` objects in pure offline Vitest suites without touching `worker/index.ts`.
  - **Strict Encapsulation**: Keeps raw transport parameter construction private.
  - **Zero Regressions**: `worker/index.ts` remains 100% untouched until 5U.3.2.

### Option C: Smaller Internal Capability Object in `worker/index.ts`
Constructs a `ProductionCapabilityBundle` in `worker/index.ts` and passes it to transport.
- **Drawbacks**: Shares all drawbacks of Option A. Still exposes capability wiring logic in the top-level worker file.

### Option D: Class-Based Dependency Injection Container
Introduces a dynamic DI container (e.g. `ServiceContainer.get('D1Database')`).
- **Drawbacks**: Excessive complexity, indirection, potential dynamic lookup overhead, and higher risk of configuration spoofing in V8 isolates.

### Architectural Recommendation
**OPTION B (Dedicated Capability Boundary Module)** is unanimously recommended. It maximizes separation of concerns, guarantees complete capability encapsulation, and allows exhaustive offline test verification in Phase 5U.3.1 without modifying a single line of `worker/index.ts`.

---

## 7. CREDENTIAL CAPABILITY BINDING & SECRET HYGIENE

The future externally reachable capability boundary must construct the credential closure internally:

```typescript
const createWorkerDeepSeekCredentialResolver = (
  env: WorkerEnv
): (() => DeepSeekRuntimeCredential) => {
  return () => {
    const rawKey = env?.DEEPSEEK_API_KEY;
    if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      throw new Error(
        'WORKER_DEEPSEEK_API_KEY_UNAVAILABLE: DEEPSEEK_API_KEY is missing or empty in Worker environment.'
      );
    }
    return Object.freeze({
      apiKey: rawKey.trim(),
    });
  };
};
```

### Secret Hygiene Rules:
1. **Missing Secret Handling**: Fails closed. The raw transport catches the exception and classifies it under `AUTHORIZATION_BINDING_FAILURE` with zero network calls.
2. **Blank / Whitespace Secret**: Trimmed immediately; if `rawKey.trim().length === 0`, rejected.
3. **No Getters or Proxies**: The returned credential is a frozen plain object: `Object.freeze({ apiKey })`. No dynamic property getters.
4. **Zero Secret Serialization**: `apiKey` is never returned in `GuardedTransportExecutionResult`, never logged to `SafeLogger`, never serialized to JSON, and never included in invocation evidence or audit records.
5. **Raw Transport Callback API**: Remains exported as an internal primitive under `worker/ai/canary/` for offline testing, while the Worker capability boundary exposes an API that completely omits the callback parameter.

---

## 8. WHO MAY SUPPLY AUTHORIZATION PACKAGE

It is critical to distinguish between **untrusted caller data** and **trusted runtime capabilities**:

| Element | Classification | Trust Status | Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| `env.DB` | Runtime Capability | Ambient Trusted | Injected by Cloudflare host. Verified non-null by boundary. |
| `env.DEEPSEEK_API_KEY` | Runtime Secret | Ambient Trusted | Injected by Cloudflare secrets. Sealed in private closure. |
| `env.ENVIRONMENT` | Runtime Var | Ambient Trusted | Injected by Wrangler vars. Verified `=== 'production'`. |
| `SignedHumanAuthorizationPackage` | Caller Data | Untrusted Payload | Cryptographically verified with Ed25519 against sealed public keys. |
| `RuntimeSourceProvenanceReceipt` | Caller Data | Untrusted Payload | Cryptographically verified with Ed25519 against sealed build authority. |

The `SignedHumanAuthorizationPackage` may originate from an operational HTTP request body, but it is treated as hostile bytes until:
1. Its structure is validated against allowlisted keys.
2. Its prototype and accessors are stripped by safe snapshot materialization.
3. Its signature is mathematically verified by `verifyHumanAuthorizationPackage`.

---

## 9. SOURCE PROVENANCE RECEIPT ORIGIN & CI/CD INFRASTRUCTURE

The `RuntimeSourceProvenanceReceipt` certifies that the running Cloudflare Worker code corresponds to an authoritative Git commit SHA and tree SHA.

### Origin in Production:
- **Generation**: Created during the CI/CD deployment workflow (e.g. GitHub Actions). The build pipeline computes the commit SHA (`GITHUB_SHA`), tree SHA, and bundle hash (`buildArtifactSha256`), then signs the receipt using the private key of `source_authority_prod_01`.
- **Delivery**: The signed receipt can either be:
  1. Embedded directly into the deployed bundle as a static build artifact (`buildProvenance.json`).
  2. Submitted alongside the human authorization package in an operational certification request.

### Offline Readiness vs Future Infrastructure:
- **Offline Ready Now**: Schema validation, Ed25519 verifier foundation, and fail-closed gate checks (`RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED === false`) are 100% implemented and tested.
- **Future Infrastructure Required**: Provisioning the build authority Ed25519 public key into `PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES` after explicit human authorization.

---

## 10. ROUTE EXPOSURE DECISION

Audit Question: *Should Phase 5U.3.1 create an externally reachable HTTP route?*

**RECOMMENDATION: OPTION B (Internal Worker Capability Boundary with NO Public Route).**

### Comparison:
- **Option A (Create Public Route Now)**: Exposing an HTTP route (e.g. `POST /api/operational/canary/certify`) while `CANARY_LIVE_EXECUTION_ENABLED`, `PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED`, and `D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED` are all `false` creates dead route surface, unnecessary attack vectors, and requires premature routing decisions.
- **Option B (Internal Capability Boundary Only)**: Implements `deepSeekProductionWorkerCapabilityBoundary.ts` as a hardened, un-routed library function. Allows 100% offline verification of environment extraction, secret sealing, and fail-closed defenses. Zero attack surface.
- **Option C (Scheduled/Cron Runtime)**: Cloudflare Cron triggers cannot receive ad-hoc operational human authorization packages without complex KV/D1 polling.
- **Option D (Unreachable until Provisioning)**: Leaving code unwired prevents incremental audit and testing.

**Conclusion**: Implement the capability boundary module in **5U.3.1** without any route. Route integration (Option A or administrative dispatch) will be addressed in **5U.3.2**.

---

## 11. ENVIRONMENT BARRIER POLICY

The capability boundary must enforce:
```typescript
if (env?.ENVIRONMENT !== 'production') {
  return {
    success: false,
    status: 'PREFLIGHT_VALIDATION_FAILED',
    failureCategory: 'AUTHORIZATION_BINDING_FAILURE',
    errors: [
      `WORKER_ENVIRONMENT_INVALID: Capability boundary requires ENVIRONMENT === 'production' (got '${env?.ENVIRONMENT}')`
    ],
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
- **No Caller Selection**: The environment parameter must come strictly from `env.ENVIRONMENT`.
- **Rejection of Non-Production**: Calls under `development`, `test`, or `preview` fail closed immediately.

---

## 12. RAW TRANSPORT EXPORT AUDIT & ENCAPSULATION

Audit Question: *Should `executeProductionReplayProtectedDeepSeekCertificationTransport` remain exported?*

**VERDICT: YES, AS AN INTERNAL/TEST PRIMITIVE.**

### Rationale:
1. In Cloudflare Workers, only symbols exported from the bundle entry point (`worker/index.ts`) are accessible via HTTP. Functions exported from internal files (`worker/ai/canary/*`) are completely invisible to external callers unless explicitly imported and routed by `worker/index.ts`.
2. Keeping the raw transport exported internally is vital for unit testing, regression testing (such as the 224 tests in Phase 5U.2), and modular architecture.
3. The essential security invariant is that **no externally reachable route passes request-derived capabilities** to the raw transport.

---

## 13. WORKER INDEX REGRESSION RISK & STAGED IMPLEMENTATION

`worker/index.ts` is the central dispatch hub for all application features (leads, appointments, leaks, actions, vault, audit, AI). Modifying it in Phase 5U.3.1 would introduce unnecessary blast radius before the capability boundary itself is certified.

### Recommended Staging Sequence:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Phase A.12B.2C-5U.3.1                                                  │
│ Internal Worker Capability Boundary Foundation                         │
│ - Implement deepSeekProductionWorkerCapabilityBoundary.ts             │
│ - Pure offline unit test suite (phaseA12B2C5U3...test.ts)              │
│ - Zero changes to worker/index.ts, worker/env.ts, worker/routes/       │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Phase A.12B.2C-5U.3.2                                                  │
│ Operational Route & Administrative Orchestration Integration           │
│ - Implement dedicated operational route or administrative handler      │
│ - Strict mutual TLS / Cloudflare Access / Admin role enforcement       │
│ - Minimal surgical modification to worker/index.ts                     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Phase A.12B.2C-5U.3.3                                                  │
│ Real D1 & Trust Anchor Provisioning (Post-Approval)                    │
│ - Provision real Cloudflare D1 database_id                             │
│ - Enroll Ed25519 public trust anchors                                  │
│ - Concurrency certification and live gate enablement                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 14. CONFIRMATION OF DORMANT GATES (9/9 STRICTLY FALSE)

All nine authoritative fail-closed security gates remain strictly `false` at the canonical base commit `737c9f8e5c335cbe8985c745915ffcdd8e7cc5ae`:

| Gate Identifier | Declared File | Value | Description |
| :--- | :--- | :---: | :--- |
| `CANARY_LIVE_EXECUTION_ENABLED` | `canarySpecification.ts` | `false` | Authoritative live execution kill switch |
| `GUARDED_SOURCE_ATTESTATION_READY` | `deepSeekGuardedLiveTransport.ts` | `false` | Compile-time source attestation barrier |
| `GUARDED_HUMAN_AUTH_ATTESTATION_READY` | `deepSeekGuardedLiveTransport.ts` | `false` | Compile-time human authorization barrier |
| `PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED` | `deepSeekProductionAuthorizationTrust.ts` | `false` | Human authorization trust anchor provisioning |
| `RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED` | `deepSeekTrustedRuntimeSourceProvenance.ts` | `false` | Runtime source provenance trust anchor provisioning |
| `D1_REPLAY_BACKEND_PRODUCTION_BOUND` | `d1AuthorizationReplayBackend.ts` | `false` | D1 production binding status |
| `D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED` | `d1AuthorizationReplayBackend.ts` | `false` | Real Cloudflare D1 database provisioning |
| `D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED` | `d1AuthorizationReplayBackend.ts` | `false` | Live concurrent replay conflict certification |
| `productionRoutingEnforcementAllowed` | `canarySpecification.ts` | `false` | Production traffic routing mutation barrier |

**Mandate**: Zero audit recommendations in this or subsequent phases may flip any of these gates without explicit, formal human authorization.

---

## 15. REAL D1 READINESS VS CODE CAPABILITY BINDING

This audit explicitly decouples:
1. **Code Capability Binding**: Writing TypeScript code that extracts `env.DB` and passes it to `D1AuthorizationReplayBackend`. (Ready to implement offline in 5U.3.1).
2. **Real D1 Provisioning**: Running Cloudflare CLI commands to allocate a real D1 database on Cloudflare edge infrastructure, updating `database_id` in `wrangler.jsonc`, and applying migration `0008_authorization_replay_ledger.sql`. (Requires cloud provisioning).
3. **Real D1 Concurrency Certification**: Subjecting the live edge database to high-concurrency race testing to verify that SQLite/D1 PRIMARY KEY conflicts reliably produce `changes: 0` and zero duplicate executions under distributed worker load. (Requires live testing).

Binding `env.DB` in code does **NOT** prove real D1 concurrency or edge reliability.

---

## 16. TRUST ANCHOR PROVISIONING READINESS

This audit explicitly decouples:
1. **Capability Boundary Implementation**: Pure code structure binding environment variables to transport functions.
2. **Human Authorization Trust-Anchor Provisioning**: Enrolling public Ed25519 signing keys into `PRODUCTION_HUMAN_AUTHORIZATION_AUTHORITIES`.
3. **Runtime Source-Provenance Trust-Anchor Provisioning**: Enrolling CI/CD build public Ed25519 signing keys into `PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES`.

**Cryptographic Invariant**: ZERO private key material enters the repository, test fixtures, or AI model context. Only public keys will be provisioned after formal ceremony.

---

## 17. FAIL-CLOSED ERROR TAXONOMY & FAILURE SEMANTICS

The future capability boundary will enforce exact fail-closed semantics:

| Failure Scenario | Transport Status | Failure Category | Error Message Structure |
| :--- | :--- | :--- | :--- |
| Missing `env` object | `PREFLIGHT_VALIDATION_FAILED` | `AUTHORIZATION_BINDING_FAILURE` | `WORKER_ENV_MISSING: Worker execution environment is undefined.` |
| `env.ENVIRONMENT !== 'production'` | `PREFLIGHT_VALIDATION_FAILED` | `AUTHORIZATION_BINDING_FAILURE` | `WORKER_ENVIRONMENT_INVALID: Capability boundary requires ENVIRONMENT === 'production'` |
| Missing `env.DB` | `PREFLIGHT_VALIDATION_FAILED` | `AUTHORIZATION_BINDING_FAILURE` | `WORKER_D1_DATABASE_UNAVAILABLE: Cloudflare D1 binding (env.DB) is missing.` |
| Missing/blank `DEEPSEEK_API_KEY` | `PREFLIGHT_VALIDATION_FAILED` | `AUTHORIZATION_BINDING_FAILURE` | `WORKER_DEEPSEEK_API_KEY_UNAVAILABLE: DEEPSEEK_API_KEY is missing or empty.` |
| Live gate false | `LIVE_EXECUTION_BLOCKED` | `AUTHORIZATION_BINDING_FAILURE` | `CANARY_LIVE_EXECUTION_BLOCKED: Live canary execution is categorically disabled.` |
| Malformed authorization package | `PREFLIGHT_VALIDATION_FAILED` | `AUTHORIZATION_BINDING_FAILURE` | `PRODUCTION_INPUT_MATERIALIZATION_FAILED: Safe snapshot acquisition failed.` |
| Replay conflict (`ALREADY_RESERVED`) | `PREFLIGHT_VALIDATION_FAILED` | `AUTHORIZATION_BINDING_FAILURE` | `REPLAY_RESERVATION_DENIED: Single-use authorization already reserved.` |

**Security Guarantee**: All failure responses return:
- `providerNetworkCalls: 0`
- `credentialReads: 0`
- `authorizedBudgetMicroUsd: 0`
- `candidate: null`
- **Zero secret leakage** in error arrays or diagnostic strings.

---

## 18. OFFLINE VERIFICATION & TEST PLAN FOR 5U.3.1

The upcoming implementation in Phase 5U.3.1 will be verified via a dedicated test file:
`tests/ai/phaseA12B2C5U3ProductionWorkerCapabilityBoundary.test.ts`

### Required Test Suites:
1. **Suite 1: Environment & Capability Preflight**:
   - Reject undefined `env`.
   - Reject non-production environments (`development`, `test`, `preview`, arbitrary strings).
   - Reject missing or null `env.DB`.
   - Reject undefined, empty, or whitespace `env.DEEPSEEK_API_KEY`.
2. **Suite 2: Anti-Injection & Ambient Immutability**:
   - Verify that caller-supplied `db` inside `pkg` or options is ignored.
   - Verify that caller-supplied `getRuntimeCredential` is ignored.
   - Verify that caller-supplied `apiKey` in headers/body is ignored.
   - Prove `env.DB` reference passed to transport matches `env.DB` from Worker environment.
3. **Suite 3: Secret Hygiene**:
   - Verify that `env.DEEPSEEK_API_KEY` is never present in return value, error messages, or logs.
   - Verify that credential resolver throws clean error on blank key.
4. **Suite 4: Fail-Closed Gate Enforcement**:
   - Verify that canonical closed live gate (`CANARY_LIVE_EXECUTION_ENABLED === false`) immediately returns `LIVE_EXECUTION_BLOCKED`.
   - Verify 0 D1 prepare calls and 0 credential reads on closed live gate.
5. **Suite 5: Isolated Mock Dispatch Execution**:
   - Using isolated Vitest module mocks (simulating future open gate and mock D1), prove that `executeProductionWorkerCanaryCertification` orchestrates the full 7-task dispatch without real network calls.
   - Assert `providerNetworkCalls === 0` (real) and `realD1Calls === 0`.

---

## 19. MINIMAL FUTURE FILE SCOPE FOR 5U.3.1

To maintain strict risk control, Phase 5U.3.1 will touch **ONLY** the minimal necessary files:

| File Path | Action | Rationale |
| :--- | :---: | :--- |
| `worker/ai/canary/deepSeekProductionWorkerCapabilityBoundary.ts` | **ADD** | Dedicated Worker capability boundary module implementing `executeProductionWorkerCanaryCertification`. |
| `tests/ai/phaseA12B2C5U3ProductionWorkerCapabilityBoundary.test.ts` | **ADD** | Comprehensive offline unit tests verifying capability extraction, secret sealing, and fail-closed gates. |
| `execution/a12b2c5u3_worker_capability_binding_foundation.json` | **ADD** | Machine-readable execution evidence artifact for 5U.3.1. |
| `execution/a12b2c5u3_worker_capability_binding_foundation.md` | **ADD** | Human-readable walkthrough and audit record for 5U.3.1. |
| `worker/index.ts` | **UNCHANGED** | Preserved without modifications until 5U.3.2. |
| `worker/env.ts` | **UNCHANGED** | Already defines `DB?: D1Database` and `DEEPSEEK_API_KEY?: string`. |
| `worker/routes/aiRouter.ts` | **UNCHANGED** | Tenant AI routes remain strictly isolated from certification canary. |
| `wrangler.jsonc` | **UNCHANGED** | Infrastructure configuration remains untouched until post-approval provisioning. |

---

## 20. CODEX ESCALATION CLASSIFICATION

**Classification**: `CODEX_REQUIRED_AFTER_IMPLEMENTATION`

### Justification:
The implementation of `deepSeekProductionWorkerCapabilityBoundary.ts` in Phase 5U.3.1 represents the critical bridge between raw Cloudflare Worker ambient secrets (`DEEPSEEK_API_KEY`), storage bindings (`env.DB`), and the execution pipeline. Independent cryptographic and security review by Codex is strictly required to verify:
1. Zero possibility of caller capability injection.
2. Complete absence of secret leakage across async boundaries and error pathways.
3. Unbroken fail-closed behavior under all anomalous environment conditions.
4. Total isolation of tenant execution contexts from operational certification primitives.

---

## 21. AUDIT CONCLUSION & READINESS VERDICT

The Cloudflare Worker capability binding architecture has been fully analyzed and specified. The path forward is clean, modular, and completely protected against request injection and secret leakage.

**Final Audit Verdict**: `A12B2C5U3_WORKER_CAPABILITY_BINDING_AUDIT_PASS_DESIGN_READY`
