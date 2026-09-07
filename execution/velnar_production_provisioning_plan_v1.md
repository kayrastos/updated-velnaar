# VELNAR — Prelive to Controlled Live Mission V1
## Segment B: Deterministic Production Provisioning Plan

- **Mission**: VELNAR — Prelive to Controlled Live Mission V1
- **Segment**: B — Production Provisioning Plan
- **Status**: **PREPARED_FOR_REVIEW — NOT EXECUTED IN SEGMENT A**
- **Prerequisite**: Explicit Human Approval at **HARD GATE 1**
- **Repository**: `kayrastos/updated-velnaar`
- **Target Base Commit**: `05a136b76342f3514ec6c69a3064763adbd54bf4`

---

### 1. Architectural Invariants & Scope Boundaries

> [!WARNING]
> **NO PRODUCTION MUTATION PERMITTED IN SEGMENT A.**
> This document specifies the exact, bounded, deterministic sequence of operations that will be executed in Segment B **only after** explicit human approval (`SEGMENT_B_EXECUTION_APPROVAL_REQUIRED`).
> 
> **CUSTOMER CODE = DATA, NOT AUTHORITY.**
> External models have ZERO authority to provision credentials, mutate production, or alter routing gates.

---

### 2. Step-by-Step Production Provisioning Sequence (Segment B)

#### Step 1: Canonical Operational Hostname & DNS
- **Resource**: Cloudflare DNS Record
- **Action**: Create or verify `ops.velnar.studio` CNAME pointing to `velnar-platform-worker.workers.dev` (or apex domain proxy).
- **Zone**: `velnar.studio`
- **Proxy Status**: `proxied` (orange cloud active). Traffic must flow through Cloudflare edge to enforce Zero Trust Access.
- **Rollback**: Delete CNAME record `ops.velnar.studio`.

#### Step 2: Cloudflare Access Team Domain
- **Resource**: Cloudflare Zero Trust Organization Settings
- **Action**: Confirm authoritative team domain: `https://velnar.cloudflareaccess.com`.
- **Validation**: Enforce `https:` protocol, alphanumeric subdomain, `.cloudflareaccess.com` suffix.
- **Rollback**: Unset `CLOUDFLARE_ACCESS_TEAM_DOMAIN` in Worker configuration.

#### Step 3: Cloudflare Access Self-Hosted Application
- **Resource**: Cloudflare Zero Trust Application
- **Action**: Create self-hosted application protecting the operational surface:
  - **Name**: `VELNAR Dedicated Operational Canary Surface`
  - **Domain**: `ops.velnar.studio/api/ops/canary/deepseek-certification`
  - **Path Constraint**: Strict path match only; no wildcard prefix (`/api/ops/*` prohibited).
  - **Session Duration**: `15m` (proposed least-privilege window).
  - **Auto Redirect**: `false` (until IdP canonically resolved).
- **AUD Capture**: Cloudflare generates an opaque application AUD ($\le 64$ characters). Capture this value directly for Worker configuration.
- **Rollback**: Delete application in Cloudflare Zero Trust dashboard or API.

#### Step 4: Cloudflare Access Policy (Zero Wildcards)
- **Resource**: Cloudflare Access Policy
- **Action**: Create allow policy attached strictly to the operational application:
  - **Decision**: `allow`
  - **Include**: Explicit list of vetted human operator emails.
  - **Require**: Hardware MFA (FIDO2 / WebAuthn token enrollment).
- **Prohibitions**:
  - `*@company.com` wildcard domain rules are **CATEGORICALLY FORBIDDEN**.
  - Service tokens are **CATEGORICALLY FORBIDDEN** from gaining human operational authority.
  - Tenant user roles (`OWNER`, `ADMIN`) have **ZERO** operational standing.
- **Rollback**: Delete policy via Cloudflare Zero Trust API.

#### Step 5: Worker Runtime Environment Variables
- **Resource**: Cloudflare Worker Configuration
- **Action**: Set non-secret runtime variables in production Worker environment:
  - `CLOUDFLARE_ACCESS_TEAM_DOMAIN = "https://velnar.cloudflareaccess.com"`
  - `CLOUDFLARE_ACCESS_AUD = "<CAPTURED_AUD_64_CHAR>"`
- **Classification**: Non-Secret Runtime Configuration (separate from KMS or provider API keys).
- **Rollback**: Remove / unset environment variables via Wrangler.

#### Step 6: Audited Operator Access Login & Subject Capture
- **Action**: Operator performs browser login through Cloudflare Access to generate genuine test session.
- **Capture**: Record verified token claims:
  - `accessSubject`: Opaque user subject identifier from `sub` claim. (Must not be assumed globally permanent; if subject changes, re-enrollment required).
  - `expectedEmail`: Authenticated email from `email` claim ($\le 320$ characters).
- **Rollback**: Revoke active session in Cloudflare Zero Trust.

#### Step 7: Operational Superadmin Registry Enrollment
- **Resource**: `worker/auth/cloudflareAccessOperationalAuth.ts`
- **Action**: Populate `PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY` with the verified entry:
  ```typescript
  export const PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY: readonly OperationalSuperAdminEntry[] =
    Object.freeze([
      {
        accessSubject: "<CAPTURED_ACCESS_SUBJECT>",
        expectedEmail: "<CAPTURED_OPERATOR_EMAIL>",
        status: "active",
        registryVersion: "a12b2c5-provisioned-v1",
      },
    ]);
  ```
- **Requirements**: Dual-signed commit required; `Object.isFrozen` maintained.
- **Rollback**: Set `status: 'suspended'` or clear registry array.

---

### 3. Cryptographic Trust-Anchor Package Specification

In Segment B, 4 foundational trust-anchor gates will be transitioned from false to true upon cryptographic ceremony:

| Trust Anchor Gate | Target File | Intended State |
|---|---|---|
| `PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED` | `worker/ai/canary/deepSeekProductionAuthorizationTrust.ts` | `true` |
| `RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED` | `worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance.ts` | `true` |
| `GUARDED_HUMAN_AUTH_ATTESTATION_READY` | `worker/ai/canary/deepSeekGuardedLiveTransport.ts` | `true` |
| `GUARDED_SOURCE_ATTESTATION_READY` | `worker/ai/canary/deepSeekGuardedLiveTransport.ts` | `true` |

#### Trust-Anchor Invariants:
1. **Identity Binding**: Verified against an immutable Ed25519 public key authority registry. Includes authority ID, key version, algorithm (`Ed25519`), and SHA-256 public key fingerprint.
2. **Commit & Tree Binding**: Attestation requires source commit SHA (`05a136b...`) and tree SHA (`d9fa32b...`) matching the deployed Worker build.
3. **Temporal Validity & Expiry**: Evaluated against ISO 8601 UTC timestamp. Maximum authorization window $\le 15$ minutes (900 seconds). Materially future timestamps rejected.
4. **Static Rotation**: No dynamic remote key fetching or KMS polling. Key rotation requires static code update with dual human sign-off.
5. **Fail-Closed Revocation**: Authorities can be revoked immediately by marking `status: 'suspended'` or removing public keys from the registry.
6. **Durable Anti-Replay**: Each signed package requires a unique `run_nonce` registered atomically in D1 `authorization_replay_ledger` before execution.
7. **Evidence & Sanitization**: Attestation receipts contain public hashes only; private signing keys are never embedded or logged.
8. **Fail-Closed Semantics**: Any signature failure, expired window, unknown authority, or replay collision terminates fail-closed with HTTP 401 or 403.

---

### 4. Cloudflare D1 Production Binding & Concurrency Certification

#### Actions:
1. **Provision Real D1 Database**: Execute `npx wrangler d1 create velnar-production-db` (if unprovisioned) and capture real 36-character UUID.
2. **Update Binding in `wrangler.jsonc`**:
   ```jsonc
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "velnar-production-db",
       "database_id": "<REAL_CLOUDFLARE_D1_UUID_36_CHAR>",
       "migrations_dir": "migrations"
     }
   ]
   ```
3. **Execute Migrations**: Apply migrations 0001 through 0008:
   - `0001_initial_schema.sql`
   - `0002_indexes_and_performance.sql`
   - `0003_ai_intelligence_layer.sql`
   - `0004_growth_action_policy_hardening.sql`
   - `0005_appointment_concurrency_hardening.sql`
   - `0006_appointment_identity_resource_hardening.sql`
   - `0007_ai_run_protocol_hardening.sql`
   - `0008_authorization_replay_ledger.sql`
4. **Verify Table Schema**: Confirm table `authorization_replay_ledger` exists with strict SHA-256 hex primary key constraint (`length(replay_key) = 64`).
5. **Concurrency & Replay Certification**: Execute atomic reservation test inserting a dummy replay key, confirming duplicate insert throws primary key conflict, then cleaning test row.
6. **Flip Concurrency Certification Gate**: Set `D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED = true`.

---

### 5. Pre-Mutation Evidence Snapshot Procedure

Immediately prior to executing any write in Segment B, the following baseline snapshot must be captured and sealed:
```bash
git rev-parse HEAD > execution/snapshots/pre_mutation_head.txt
git write-tree > execution/snapshots/pre_mutation_tree.txt
npm run lint > execution/snapshots/pre_mutation_lint.log
npx vitest run tests/security/phaseA12B2C5U33PreLiveMasterReadiness.test.ts > execution/snapshots/pre_mutation_tests.log
```

---

### 6. Expected Cost Impact & Irreversible Action Notice

- **Cloudflare Access**: Free tier for first 50 seats ($\$0.00$).
- **Cloudflare D1**: Included in standard Cloudflare Workers paid subscription ($\$0.00$ incremental).
- **AI Provider Invocations in Segment B**: **$0.00 (Zero calls permitted in Segment B)**.
- **First Irreversible / Externally Visible Mutation**: Creation of the self-hosted Cloudflare Access application in Cloudflare Zero Trust.
