# VELNAR — A.12B.2C-5U
# PRODUCTION REPLAY RESERVATION INTEGRATION READINESS AUDIT

**Phase**: VELNAR — A.12B.2C-5U  
**Artifact Type**: `PRODUCTION_REPLAY_RESERVATION_INTEGRATION_READINESS_AUDIT`  
**Base Commit**: `6cc5d71bf99622f0dabae7380eb4baf0f3c68af9`  
**Base Tree**: `834ceeabfd86307167cb5980279aef7b84998b88`  
**Execution Mode**: STRICTLY OFFLINE AUDIT & ARCHITECTURAL DESIGN ONLY  

---

## 1. EXECUTIVE SUMMARY & AUDIT MANDATE

Phase 5T, 5T.1, 5T.2, and 5T.3 successfully established the durable authorization replay foundation:
1. **Trusted Authorization Verification Boundary** (`deepSeekProductionAuthorizationTrust.ts`, `deepSeekCertificationAttestation.ts`).
2. **Canonical Replay Reservation Request Builder** (`buildAuthorizationReplayReservationRequestFromCanonicalAuthorization`).
3. **Atomic Cloudflare D1 Backend Adapter** (`d1AuthorizationReplayBackend.ts`) with `INSERT ... ON CONFLICT(replay_key) DO NOTHING RETURNING replay_key` semantics.
4. **D1 Production Schema Migration** (`migrations/0008_authorization_replay_ledger.sql`).
5. **Deterministic Lockfile & Portability Verification** (clean `npm ci`, 0 typecheck errors, 1953/1953 green tests).

However, **production integration into guarded transport remains deliberately disabled**. 

This audit determines the exact, safe integration architecture required to wire durable D1 replay reservation into the live execution path BEFORE any production code is modified.

### Mandatory Ground Rules
- **ZERO production code modified** in this phase.
- **ZERO test code modified** in this phase.
- **ZERO migrations or Wrangler configuration modified**.
- **ZERO real D1 calls, cloud resources created, or migrations applied**.
- **ZERO DeepSeek, Gemini, or external network calls**.
- **ZERO private keys read or generated**.

---

## 2. MANDATORY RUNTIME ORDER & FAILURE SEMANTICS

The eventual trusted runtime dispatch sequence MUST strictly execute in the following 10-step order:

```
Step 1:  Authoritative Live Execution Gate Check
         (CANARY_LIVE_EXECUTION_ENABLED === true && CANARY_LIVE_EXECUTION_STATE === 'LIVE_EXECUTION_ALLOWED')
         └── If false -> FAIL CLOSED (LIVE_EXECUTION_BLOCKED)

Step 2:  Trusted Runtime Source Attestation Verification
         (verifyProductionRuntimeSourceProvenanceReceipt)
         └── If invalid/unprovisioned -> FAIL CLOSED (SOURCE_ATTESTATION_NOT_READY)

Step 3:  Production Human Authorization Signature Verification
         (verifyProductionHumanAuthorizationPackage(pkg, sourceAttestation))
         └── If invalid/unprovisioned -> FAIL CLOSED (AUTHORIZATION_NOT_VERIFIED)

Step 4:  Canonical Replay Reservation Request Construction & Validation
         (buildAuthorizationReplayReservationRequestFromCanonicalAuthorization(pkg))
         └── If malformed/mismatched -> FAIL CLOSED (CANONICAL_REPLAY_REQUEST_INVALID)

Step 5:  Fresh Runtime Authorization Expiry Check (Pre-D1)
         (new Date().getTime() < Date.parse(pkg.payload.expiresAt))
         └── If expired -> FAIL CLOSED (AUTHORIZATION_EXPIRED)

Step 6:  Awaited Durable D1 Reserve-If-Absent Call
         (await backend.reserveIfAbsent(request))
         └── Single statement: INSERT ... ON CONFLICT DO NOTHING RETURNING replay_key

Step 7:  Require Reservation Status === 'RESERVED'
         ├── If 'ALREADY_RESERVED'   -> FAIL CLOSED (terminal, single-use consumed)
         ├── If 'BACKEND_UNAVAILABLE' -> FAIL CLOSED (no retry, no DELETE)
         ├── If 'BACKEND_NOT_BOUND'   -> FAIL CLOSED (no binding in runtime)
         └── If 'INVALID_REQUEST'     -> FAIL CLOSED

Step 8:  Fresh Runtime Authorization Expiry Check AGAIN (Post-D1, Pre-Credential)
         (Date.now() < Date.parse(pkg.payload.expiresAt))
         └── If expired -> FAIL CLOSED (AUTHORIZATION_EXPIRED, reservation remains consumed in D1)

Step 9:  Runtime Credential Resolution
         (await getRuntimeCredential())
         └── Only reached AFTER successful D1 RESERVED and fresh expiry confirmation

Step 10: Provider / Network Transport Dispatch
         (7 canonical tasks dispatched sequentially with per-task fresh UTC clocks)
```

### Strict Failure Behavior Rules:
- **ALREADY_RESERVED**: Immediate terminal denial. Replay attack or re-execution prevented.
- **BACKEND_UNAVAILABLE**: Immediate fail-closed. Zero retries, zero automatic second attempts, zero compensating `DELETE` queries.
- **No Credential Read Before Replay Reservation**: `getRuntimeCredential()` must NEVER be evaluated before D1 confirms `RESERVED`.
- **No Provider Dispatch Before Replay Reservation**: Real HTTP fetch must NEVER be invoked before D1 confirms `RESERVED`.

---

## 3. CURRENT GUARDED TRANSPORT CONTRACT AUDIT

### 3.1 `GuardedTransportExecutionOptions` Fields
Located in `worker/ai/canary/deepSeekGuardedLiveTransport.ts` (lines 541-550):
```typescript
export interface GuardedTransportExecutionOptions {
  readonly authorization: WindowAuthorizationEvidence;
  readonly pricingWindow: 'OFF_PEAK' | 'PEAK';
  readonly getRuntimeCredential?: () => Promise<DeepSeekRuntimeCredential> | DeepSeekRuntimeCredential;
}
```

### 3.2 Human Approval Type in Guarded Transport
- Current guarded transport uses: `WindowAuthorizationEvidence` (from `worker/ai/canary/deepSeekSuccessorCertificationStateMachine.ts`).
- It is **NOT** `CanaryHumanApprovalEnvelope` (legacy HMAC token from Phase 5B/5D, defined in `canarySpecification.ts`).
- It is **NOT** `SignedHumanAuthorizationPackage` (the cryptographic Ed25519 signature package from Phase 5M/5R, defined in `deepSeekCertificationAttestation.ts`).

### 3.3 Source Provenance Input Path
- In `deepSeekGuardedLiveTransport.ts` (lines 693-695):
  ```typescript
  const authorization = options.authorization;
  const expectedCommit = authorization?.sourceCommitSha ?? '';
  const expectedTree = authorization?.sourceTreeSha ?? '';
  ```
- Source provenance is **purely caller-supplied via `options.authorization`**. Guarded transport reads `sourceCommitSha` and `sourceTreeSha` directly from the unverified caller object.
- In lines 1048-1049, these caller-supplied hashes are copied directly into the `LiveEvidenceCandidate` intermediate artifact.

### 3.4 Preflight Function & Trust Assumptions
- Preflight is performed by `validateLiveTransportPreflight(authorization, options)` from `deepSeekLiveCertificationTransportContract.ts` (lines 821-902).
- **Flawed Trust Assumption**: Because `options.expectedCommit` is initialized from `authorization.sourceCommitSha`, the preflight comparison `auth.sourceCommitSha === options.expectedCommit` evaluates to `x === x` (a trivial tautology).
- It verifies target program, pricing window, candidate ID, run nonce existence, token digest existence, and budget bounds.
- It **does NOT verify cryptographic signatures**, does NOT check authority public keys, does NOT verify expiry timestamps, and does NOT interact with any replay ledger.

### 3.5 Credential Capability Shape & Order
- Defined as `DeepSeekRuntimeCredential` (line 120):
  ```typescript
  export interface DeepSeekRuntimeCredential {
    readonly apiKey: string;
  }
  ```
- **Order of Resolution**:
  - Gate Barrier 1: Global Live Gate (line 604)
  - Gate Barrier 2: Source Attestation Barrier (line 634, compile-time `false`)
  - Gate Barrier 3: Human Auth Attestation Barrier (line 661, compile-time `false`)
  - Gate Barrier 4: Preflight Validation (line 697)
  - **Gate Barrier 5: Runtime Credential Resolution (line 729)**: `credential = await options.getRuntimeCredential();`
  - **Gate Barrier 6: Sequential Provider Dispatch (line 767, fetch at line 863)**.
- **Critical Finding**: Credential resolution currently begins at **Line 729**, immediately after preflight validation, with **ZERO replay ledger reservation occurring before it**.

### 3.6 Current vs Target Call-Flow Comparison

```
CURRENT CALL-FLOW (Phase 5K/5T):
Caller
  │ options { authorization, pricingWindow, getRuntimeCredential }
  ▼
[executeGuardedDeepSeekCertificationTransport]
  │
  ├── 1. Global Live Gate (BLOCKED: CANARY_LIVE_EXECUTION_ENABLED === false)
  ├── 2. Source Attestation Gate (BLOCKED: GUARDED_SOURCE_ATTESTATION_READY === false)
  ├── 3. Human Auth Attestation Gate (BLOCKED: GUARDED_HUMAN_AUTH_ATTESTATION_READY === false)
  ├── 4. validateLiveTransportPreflight (checks WindowAuthorizationEvidence tautologically)
  ├── 5. getRuntimeCredential() ──► CREDENTIAL RESOLVED HERE (NO REPLAY CHECK!)
  └── 6. Sequential fetch() loop ──► DISPATCH TO DEEPSEEK

TARGET CALL-FLOW (Phase 5U.1 Integration):
Caller / Runtime Router (with env.DB)
  │ options { pkg: SignedHumanAuthorizationPackage, sourceAttestation: TrustedSourceAttestation, env.DB }
  ▼
[ProductionReplayCoordinator]
  │
  ├── 1. Global Live Gate (CANARY_LIVE_EXECUTION_ENABLED)
  ├── 2. Verify Source Attestation (verifyProductionRuntimeSourceProvenanceReceipt)
  ├── 3. Verify Human Auth Package (verifyProductionHumanAuthorizationPackage)
  ├── 4. Build Canonical Replay Request (buildAuthorizationReplayReservationRequestFromCanonicalAuthorization)
  ├── 5. Runtime Expiry Check 1 (expiresAtMs > Date.now())
  ├── 6. Durable D1 Reservation (await backend.reserveIfAbsent(request))
  │      └── Requires status === 'RESERVED' (if ALREADY_RESERVED -> TERMINAL FAIL)
  ├── 7. Runtime Expiry Check 2 (expiresAtMs > Date.now())
  ├── 8. Credential Resolution (await getRuntimeCredential()) ──► SAFE: SINGLE-USE RESERVED
  └── 9. Guarded Transport Dispatch (7 canonical tasks) ──────► SAFE: REPLAY-PROTECTED
```

---

## 4. AUTHORIZATION CONTRACT GAP ANALYSIS

### 4.1 Cryptographic Equivalence Evaluation
Current guarded transport authorization (`WindowAuthorizationEvidence`) is **NOT cryptographically equivalent** to `SignedHumanAuthorizationPackage`. They are separate data structures representing distinct evolutionary phases:

| Contract Dimension | `WindowAuthorizationEvidence` (Current Transport) | `SignedHumanAuthorizationPackage` (Phase 5M/5R/5T) |
| :--- | :--- | :--- |
| **Cryptographic Signature** | None (`authorizationTokenDigest` is an opaque string) | Ed25519 `signatureBase64` over canonical JSON |
| **Authority Identity** | `approvedBy: string` (unverified text) | `authorityId: string`, verified in immutable registry |
| **Key Versioning** | None | `keyVersion: string` bound to public key |
| **Cryptographic Algorithm** | None | `algorithm: 'Ed25519'` |
| **Expiration Timestamp** | None | `expiresAt: string` (strict ISO-8601 UTC) |
| **Issuance Timestamp** | `approvalTimestamp: string` | `issuedAt: string` (strict ISO-8601 UTC) |
| **Single-Use Enforcement** | Optional `authorizationReusable?: boolean` | Mandatory `singleUse: true` |
| **Source Attestation Binding**| None | `sourceAttestationDigest: string` (SHA-256) |
| **Model & Provider Binding** | None | `provider: 'deepseek'`, `model: 'deepseek-v4-flash'` |
| **Task Matrix Binding** | None | `canonicalTaskCount: 7` |
| **Contract Version Binding** | None | `transportContractVersion`, `guardedTransportModuleVersion` |

### 4.2 Strict Anti-Tamper Mandate
- **No Type Casting**: Code MUST NOT cast `WindowAuthorizationEvidence` to `SignedHumanAuthorizationPackage` or vice-versa (`as unknown as ...`).
- **No Legacy Conflation**: `CanaryHumanApprovalEnvelope` from Phase 5B/5D must NEVER be treated as cryptographically verified production authorization.
- **Migration Architecture**: Guarded transport must be upgraded or wrapped to accept `SignedHumanAuthorizationPackage` and verify it through the sealed Phase 5S orchestration boundary.

---

## 5. SOURCE ATTESTATION GAP ANALYSIS

### 5.1 How `TrustedSourceAttestation` is Handled Today
- **Definition**: In `deepSeekCertificationAttestation.ts`, `TrustedSourceAttestation` contains repository identity, source commit SHA, source tree SHA, contract versions, task set digests, fixture digests, and `attestationDigest`.
- **Runtime Verification**: In Phase 5Q (`deepSeekTrustedRuntimeSourceProvenance.ts`), source provenance is verified via `RuntimeSourceProvenanceReceipt` signed with Ed25519.
- **Current Barrier State**:
  - `RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED === false`
  - `TRUSTED_RUNTIME_SOURCE_PROVENANCE_READY === false`
  - `PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES` is empty (`[]`).
  - `GUARDED_SOURCE_ATTESTATION_READY === false`.
- **Current Transport Behavior**: Guarded transport does NOT verify source attestation; it reads `sourceCommitSha` and `sourceTreeSha` directly from the caller's authorization object.

### 5.2 Classification of Caller-Controlled Source Metadata
- **Classification**: **CRITICAL ATTACK SURFACE (TAUTOLOGICAL TRUST)**.
- Currently, a caller can supply any arbitrary commit/tree SHA in `authorization`, and guarded transport will accept it because `expectedCommit` is derived from the same input.
- **Resolution**: In the integrated architecture, `sourceCommitSha` and `sourceTreeSha` MUST originate from a cryptographically verified `TrustedSourceAttestation` and match `pkg.payload.sourceCommitSha` and `pkg.payload.sourceTreeSha`.

---

## 6. D1 CAPABILITY BINDING & ARCHITECTURAL EVALUATION

### 6.1 Architectural Options Analysis

#### Option A: Direct Instantiation Inside Guarded Transport
- Guarded transport receives `db: D1Database` via options and calls `new D1AuthorizationReplayBackend(db)`.
- *Drawback*: Mixes low-level Cloudflare runtime bindings into the pure transport module, and requires guarded transport to orchestrate verification, reservation, and dispatch.

#### Option B: Instantiate in `worker/index.ts` and Pass Abstract Backend to Transport
- Pass `backend: DurableAuthorizationReplayBackend` into guarded transport options.
- *FATAL SECURITY DEFECT*: If guarded transport accepts an abstract interface, a malicious or test caller could supply:
  ```typescript
  const fakeBackend = {
    reserveIfAbsent: async () => ({ success: true, status: 'RESERVED' })
  };
  ```
  This would completely bypass single-use durable replay protection!

#### Option C (RECOMMENDED): Dedicated Production Replay Coordinator Module
- Create `worker/ai/canary/deepSeekProductionReplayCoordinator.ts`.
- The coordinator receives the verified runtime environment capability (`env.DB: D1Database`).
- Internally instantiates `new D1AuthorizationReplayBackend(env.DB)`.
- Never accepts a caller-supplied backend, mock, store, or reservation result.
- Sequentially executes: verification -> reservation -> post-reservation expiry check -> guarded transport dispatch.

### 6.2 Architectural Recommendation
**Option C is the only architecture that satisfies all zero-trust invariants**. It isolates the D1 database binding, prevents fake backend injection, and preserves guarded transport as a strict execution engine.

---

## 7. FAKE BACKEND & CAPABILITY INJECTION THREAT ANALYSIS

### 7.1 Threat Vector
Can an attacker or rogue caller bypass replay enforcement by passing a mocked backend or forged reservation result?
```typescript
// FORBIDDEN INJECTION ATTACK:
await execute({
  backend: fakeMockBackend,
  reservationResult: { status: 'RESERVED' },
  alreadyReserved: false,
  skipReplayCheck: true
});
```

### 7.2 Defensive Invariants for Phase 5U.1
1. **Zero Caller Backend Parameters**: Neither the coordinator nor guarded transport will accept any of the following options:
   `backend`, `storage`, `adapter`, `replayStore`, `dbOverride`, `reservationResult`, `alreadyReserved`, `replayVerified`, `replayAllowed`.
2. **Strict Object Key Whitelisting**: Any unexpected property in execution options must cause immediate fail-closed termination (`INVALID_REQUEST`).
3. **Internal D1 Instantiation**: The backend MUST be instantiated internally from `env.DB`:
   ```typescript
   if (!env.DB || typeof env.DB.prepare !== 'function') {
     return { success: false, status: 'BACKEND_NOT_BOUND' };
   }
   const backend = new D1AuthorizationReplayBackend(env.DB);
   ```

---

## 8. ASYNC BOUNDARY & FUNCTION EVOLUTION

### 8.1 Current Functions Status
- `reserveProductionAuthorizationReplay(request)` in `deepSeekDurableAuthorizationReplayLedger.ts`:
  - Synchronous legacy stub that returns `BACKEND_NOT_BOUND`.
  - **MUST REMAIN UNTOUCHED AND FAIL-CLOSED**. Do not alter its signature or behavior (sealed Phase 5R baseline).
- `D1AuthorizationReplayBackend.prototype.reserveIfAbsent(request)`:
  - Asynchronous method returning `Promise<AuthorizationReplayReservationResult>`.

### 8.2 New Async Coordinator Function
Phase 5U.1 will introduce:
```typescript
export async function coordinateProductionAuthorizationAndD1ReplayReservation(params: {
  readonly pkg: SignedHumanAuthorizationPackage;
  readonly sourceAttestation: TrustedSourceAttestation;
  readonly db: D1Database;
}): Promise<ProductionReplayCoordinationResult>
```

### 8.3 Return Status Union
The coordinator will return a discriminated union with statuses:
- `'RESERVED'` (Success, proceed to credential resolution)
- `'ALREADY_RESERVED'` (Fail closed: replay detected)
- `'BACKEND_UNAVAILABLE'` (Fail closed: D1 error/timeout)
- `'BACKEND_NOT_BOUND'` (Fail closed: D1 database missing)
- `'AUTHORIZATION_NOT_VERIFIED'` (Fail closed: invalid signature/authority)
- `'AUTHORIZATION_EXPIRED'` (Fail closed: expired before or after reservation)
- `'INVALID_REQUEST'` (Fail closed: schema/validation error)

### 8.4 Awaiting Invariant
The promise returned by `backend.reserveIfAbsent(request)` MUST be strictly awaited:
```typescript
const reservationResult = await backend.reserveIfAbsent(request);
```
No floating promises, background tasks, or unawaited execution permitted.

---

## 9. MULTI-LAYER RUNTIME EXPIRY DEFENSE

The integrated system implements **three independent layers of runtime expiry verification**:

1. **Layer 1: Pre-Reservation Boundary**  
   In `buildProductionReplayReservationAfterAuthorizationVerification` (line 985):
   `Date.parse(pkg.payload.expiresAt) > new Date().getTime()`
2. **Layer 2: D1 Adapter Pre-Insert Boundary**  
   In `D1AuthorizationReplayBackend.prototype.reserveIfAbsent` (line 168):
   `Date.parse(request.expiresAt) > Date.now()`
3. **Layer 3: Post-Reservation Pre-Credential Boundary (NEW in 5U.1)**  
   Immediately AFTER D1 returns `RESERVED` and BEFORE `getRuntimeCredential()` is invoked:
   ```typescript
   const runtimeNowAfterD1 = Date.now();
   if (Date.parse(pkg.payload.expiresAt) <= runtimeNowAfterD1) {
     return {
       success: false,
       status: 'AUTHORIZATION_EXPIRED',
       errors: ['AUTHORIZATION_EXPIRED_POST_RESERVATION: Authorization expired during D1 reservation round-trip. Zero credential reads.'],
     };
   }
   ```

### Behavior on Post-Reservation Expiry:
- Fail closed with `AUTHORIZATION_EXPIRED`.
- Credential reads = 0; Provider calls = 0.
- **The consumed replay reservation remains in D1**: DO NOT execute a compensating `DELETE`. The authorization is spent and must remain spent.

---

## 10. AMBIGUOUS D1 OUTCOME & ERROR HANDLING

- If D1 throws an exception, network timeout, or returns ambiguous row counts (`results.length > 1`):
  - Adapter classifies outcome as `BACKEND_UNAVAILABLE`.
  - Coordinator fails closed immediately.
  - Zero retries.
  - Zero credential reads.
  - Zero provider network calls.
  - **No compensating DELETE query**: The state in D1 is unknown; attempting deletion could open a race condition.

---

## 11. TERMINAL ALREADY_RESERVED SEMANTICS

When D1 returns `ALREADY_RESERVED`:
- It indicates the primary key (`replay_key`) already exists in the ledger.
- This is an **absolute terminal failure**.
- Prohibited workarounds:
  - NO fallback to alternative authorization.
  - NO regeneration of nonce or replay key.
  - NO retry loop.
  - NO fallback to mock or legacy transport.
  - NO provider fallback.

---

## 12. CURRENT READINESS GATES AUDIT

Audit of the 13 canonical system readiness gates:

| Gate Identifier | Location | Canonical Value | Meaning |
| :--- | :--- | :--- | :--- |
| `DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY` | `deepSeekDurableAuthorizationReplayLedger.ts:47` | `false` | Ledger not declared ready for live routing |
| `DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND` | `deepSeekDurableAuthorizationReplayLedger.ts:48` | `false` | Production runtime has no bound durable backend |
| `ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED` | `deepSeekDurableAuthorizationReplayLedger.ts:49` | `false` | Legacy atomic reserve stub remains unbound |
| `D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED` | `d1AuthorizationReplayBackend.ts:29` | `true` | D1 adapter class and SQL implemented |
| `D1_REPLAY_BACKEND_PRODUCTION_BOUND` | `d1AuthorizationReplayBackend.ts:30` | `false` | D1 adapter not bound into production runtime |
| `D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED`| `d1AuthorizationReplayBackend.ts:31` | `false` | Concurrency not certified against live Cloudflare D1 |
| `D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED` | `d1AuthorizationReplayBackend.ts:32` | `false` | Real Cloudflare D1 database not provisioned |
| `PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED` | `deepSeekProductionAuthorizationTrust.ts:41` | `false` | Human authorization public keys not provisioned |
| `RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED` | `deepSeekTrustedRuntimeSourceProvenance.ts:36` | `false` | Source provenance public keys not provisioned |
| `GUARDED_SOURCE_ATTESTATION_READY` | `deepSeekGuardedLiveTransport.ts:97` | `false` | Guarded transport source attestation barrier |
| `GUARDED_HUMAN_AUTH_ATTESTATION_READY` | `deepSeekGuardedLiveTransport.ts:103` | `false` | Guarded transport human auth barrier |
| `CANARY_LIVE_EXECUTION_ENABLED` | `canarySpecification.ts:67` | `false` | Master global live execution barrier |
| `productionRoutingEnforcementAllowed` | Throughout codebase | `false` | Production traffic routing strictly disabled |

---

## 13. PROVISIONING DEPENDENCY CLASSIFICATION

Tasks are segregated into four operational dependency classes:

### Class 1: `CODE_IMPLEMENTABLE_OFFLINE` (Phase 5U.1 Scope)
- Implementation of `deepSeekProductionReplayCoordinator.ts`.
- Integration of D1 replay reservation with post-reservation expiry recheck.
- Integration tests using in-memory mock `D1Database` simulating conflict, timeout, and success.
- Negative security tests (tampering, fake backend, unawaited promise, expired tokens).

### Class 2: `REQUIRES_REAL_D1_PROVISIONING` (Future Cloud Ops)
- Creation of Cloudflare D1 database via Wrangler CLI.
- Updating `wrangler.jsonc` with real `database_id`.
- Applying migration `0008_authorization_replay_ledger.sql` to remote D1.
- Concurrency race certification on live Cloudflare network.

### Class 3: `REQUIRES_TRUST_ANCHOR_PROVISIONING` (Future Security Ops)
- Generating offline Ed25519 root authority keypairs.
- Enrolling public keys into `PRODUCTION_HUMAN_AUTHORITY_REGISTRY`.
- Enrolling source provenance public keys into `PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES`.

### Class 4: `REQUIRES_NEW_HUMAN_LIVE_AUTHORIZATION` (Future Live Run Ops)
- Generating and signing real `SignedHumanAuthorizationPackage` for a specific run window.
- Activating `CANARY_LIVE_EXECUTION_ENABLED = true` for bounded execution.

---

## 14. RECOMMENDED FILE SCOPE FOR PHASE 5U.1

To minimize risk and preserve sealed contracts:
1. **[NEW] `worker/ai/canary/deepSeekProductionReplayCoordinator.ts`**: Dedicated coordinator implementing Option C.
2. **[NEW] `tests/ai/phaseA12B2C5U1ProductionReplayIntegration.test.ts`**: Comprehensive offline test suite.
3. **[MODIFY] `worker/ai/canary/deepSeekGuardedLiveTransport.ts`**: Minimal adjustments to accept verified coordination context without lowering any live gates.
4. **[DO NOT MODIFY]**:
   - `migrations/0008_authorization_replay_ledger.sql` (SEALED)
   - `worker/ai/canary/d1AuthorizationReplayBackend.ts` (SEALED)
   - `worker/ai/canary/deepSeekDurableAuthorizationReplayLedger.ts` (SEALED)
   - `wrangler.jsonc` (SEALED)
   - `package.json` / `package-lock.json` (SEALED)

---

## 15. REQUIRED SECURITY TESTS FOR PHASE 5U.1

The Phase 5U.1 test suite MUST verify the following test cases offline:
1. **Unsigned Authorization**: Fails closed before D1, 0 D1 calls, 0 credentials, 0 network.
2. **Invalid Source Attestation**: Fails closed before D1, 0 D1 calls, 0 credentials, 0 network.
3. **Trust Anchor Unprovisioned**: Fails closed before D1, 0 D1 calls.
4. **Malformed Authorization Payload**: Schema mismatch fails closed before D1.
5. **D1 Binding Absent (`env.DB === undefined`)**: Fails closed with `BACKEND_NOT_BOUND`.
6. **Fake Caller Backend Injection**: Options containing `backend` or `storage` are rejected.
7. **No Caller Clock Influence**: Modifying caller timestamps has zero effect on internal runtime clock checks.
8. **No Caller ReplayKey**: `replayKey` is derived strictly from canonical authorization.
9. **No Caller Reservation Result**: Status `RESERVED` cannot be passed in options.
10. **D1 `BACKEND_UNAVAILABLE`**: Database error terminates dispatch; 0 credential reads, 0 network calls.
11. **D1 `ALREADY_RESERVED`**: Replay conflict terminates dispatch; 0 credential reads, 0 network calls.
12. **Ambiguous D1 Exception**: Thrown error maps to `BACKEND_UNAVAILABLE`; no retry, no DELETE query.
13. **Strict Await Verification**: Proves reservation promise is awaited before credential resolution.
14. **Post-Reservation Expiry**: If authorization expires after D1 insertion but before credential read, execution halts with `AUTHORIZATION_EXPIRED`, 0 credentials, 0 network, reservation remains in D1.
15. **No Automatic Retry**: Verifies single-attempt policy.
16. **Live Execution Gate Priority**: `CANARY_LIVE_EXECUTION_ENABLED === false` halts execution before any coordinator logic runs.

---

## 16. CODEX ESCALATION DECISION

**Decision**: `CODEX_REVIEW_RECOMMENDED_AFTER_IMPLEMENTATION`

### Concrete Rationale:
- Phase 5U is an offline architectural audit that changes zero production code and confirms the soundness of sealed contracts.
- Phase 5U.1 will implement the actual integration code connecting D1 replay reservation to guarded transport.
- Because this boundary governs single-use cryptographic authorization enforcement, an independent Codex review of the **exact implementation diff** produced in Phase 5U.1 is strongly recommended before any cloud resources or cryptographic trust anchors are provisioned.

---

## 17. BASELINE VERIFICATION STATUS

- **TypeScript Typecheck**: **PASS** (0 errors)
- **Full Test Suite**: **PASS** (56 test files, 1953/1953 tests passed)
- **Working Tree**: Clean
- **Final Audit Status**: `A12B2C5U_INTEGRATION_AUDIT_PASS_DESIGN_READY`
