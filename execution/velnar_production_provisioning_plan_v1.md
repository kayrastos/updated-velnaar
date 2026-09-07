# VELNAR — Prelive to Controlled Live Mission V1
## Segment B: Deterministic Production Provisioning Plan (Reconciled)

- **Mission**: VELNAR — Prelive to Controlled Live Mission V1
- **Segment**: B — Production Provisioning Plan (Reconciled)
- **Status**: **PREPARED_FOR_REVIEW — NOT EXECUTED**
- **Prerequisite**: Explicit Human Approval with Token `SEGMENT_B_PRODUCTION_PROVISIONING_APPROVED`
- **Segment B Execution Allowed**: **`false`**
- **Repository**: `kayrastos/updated-velnaar`
- **Target Commit Binding**: `5f19cbc2f3a8be9ba68f5404c437392a70db4245`

---

### 1. Architectural Invariants & Scope Boundaries

> [!WARNING]
> **SEGMENT B IS PROVISIONING + VERIFICATION ONLY.**
> Through the entire Segment B:
> - `PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED` MUST REMAIN **`false`**.
> - `PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY` MUST REMAIN **`false`**.
> - `CANARY_LIVE_EXECUTION_ENABLED` MUST REMAIN **`false`**.
> - `productionRoutingEnforcementAllowed` MUST REMAIN **`false`**.
> 
> **RESOURCE EXISTENCE $\ne$ ROUTE ACTIVATION OR INGRESS READINESS.**
> Segment B provisions and verifies dormant infrastructure only. It does **NOT** open a public or operational success path. Any proposed route or ingress gate transition moves strictly to **HARD GATE 2** and requires explicit human authorization alongside the bounded live canary boundary.

---

### 2. Step-by-Step Production Provisioning Sequence (Segment B)

#### Step 1: Operational Hostname & DNS Resolution
- **Resource**: Cloudflare DNS Record
- **Target Domain**: `ops.velnar.studio` (`PROPOSED_NOT_CANONICAL`).
  - *Epistemic Status*: `ops.velnar.studio` is strictly `PROPOSED_NOT_CANONICAL`. It MUST NOT be treated as a canonical production hostname until explicitly confirmed during Segment B.
- **DNS Target**: `UNRESOLVED_REQUIRES_PROVISIONING_TIME_CONFIRMATION`. No DNS target value is asserted as canonical until real Segment B account/zone inspection resolves it.
- **Zone**: `velnar.studio`
- **Proxy Status**: `proxied` (traffic flows through Cloudflare edge to enforce Zero Trust Access).
- **Rollback**: Delete CNAME record `ops.velnar.studio` or revert DNS target.

#### Step 2: Cloudflare Access Team Domain
- **Resource**: Cloudflare Zero Trust Organization Settings
- **Proposed Team Domain**: `https://velnar.cloudflareaccess.com` (`PROPOSED_NOT_CANONICAL`).
  - *Epistemic Status*: `https://velnar.cloudflareaccess.com` is proposed only; it MUST NOT be treated as authoritative until read from the real Cloudflare account during Segment B.
- **Validation Constraints**: Enforce `https:` protocol, alphanumeric subdomain, `.cloudflareaccess.com` suffix.
- **Rollback**: Unset `CLOUDFLARE_ACCESS_TEAM_DOMAIN` in Worker configuration.

#### Step 3: Cloudflare Access Self-Hosted Application
- **Resource**: Cloudflare Zero Trust Application
- **Action**: Create self-hosted application protecting the operational surface:
  - **Name**: `VELNAR Dedicated Operational Canary Surface`
  - **Domain**: `ops.velnar.studio/api/ops/canary/deepseek-certification` (`PROPOSED_NOT_CANONICAL`)
  - **Path Constraint**: Strict path match only; no wildcard prefix (`/api/ops/*` prohibited).
  - **Session Duration**: `15m` (`PROPOSED_NOT_CANONICAL` / `FUTURE_HUMAN_DECISION_REQUIRED`).
  - **Auto Redirect**: `false` (`PROPOSED_NOT_CANONICAL` / `FUTURE_HUMAN_DECISION_REQUIRED`).
- **AUD Capture**:
  - *Actual AUD Value*: `UNRESOLVED_NOT_CREATED` (`OBSERVED_ONLY_AFTER_PROVISIONING`). Must not be fabricated or predicted.
  - *Vendor Constraint*: 64 characters (`VENDOR_DOCUMENTED_REQUIRES_EXECUTION_TIME_REVALIDATION`).
  - *Internal Validator Bound*: 64 bytes max (`CANONICAL_REPOSITORY_FACT`).
- **Rollback**: Delete application in Cloudflare Zero Trust.

#### Step 4: Cloudflare Access Policy (Zero Wildcards)
- **Resource**: Cloudflare Access Policy
- **Policy Decision State**: `FUTURE_HUMAN_DECISION_REQUIRED`
- **Action**: Create allow policy attached strictly to the operational application:
  - **Decision**: `allow`
  - **Include**: Explicit list of vetted human operator emails (`PROPOSED_NOT_CANONICAL`).
  - **Require**: Hardware MFA (`PROPOSED_NOT_CANONICAL` / `FUTURE_HUMAN_DECISION_REQUIRED`).
- **Prohibitions**:
  - `*@company.com` wildcard domain rules are **CATEGORICALLY FORBIDDEN**.
  - Service tokens are **CATEGORICALLY FORBIDDEN** from gaining human operational authority.
  - Tenant user roles (`OWNER`, `ADMIN`) have **ZERO** operational standing.
- **Rollback**: Delete policy via Cloudflare Zero Trust API.

#### Step 5: Worker Runtime Environment Variables
- **Resource**: Cloudflare Worker Configuration
- **Action**: Set non-secret runtime variables in production Worker environment upon verified creation:
  - `CLOUDFLARE_ACCESS_TEAM_DOMAIN = "https://velnar.cloudflareaccess.com (PROPOSED_NOT_CANONICAL)"`
  - `CLOUDFLARE_ACCESS_AUD = "<CAPTURED_APPLICATION_AUD_POST_CREATION>"`
- **Classification**: Non-Secret Runtime Configuration.
- **Rollback**: Remove / unset environment variables via Wrangler.

#### Step 6: Audited Operator Access Login & Subject Capture
- **Action**: Operator completes browser login through Cloudflare Access to generate genuine test session.
- **Capture**: Record verified token claims:
  - `accessSubject`: Opaque user subject identifier from `sub` claim.
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

#### Step 8: Cryptographic Trust-Anchor Provisioning
- **Action**: Provision Ed25519 public key authorities in production registries:
  - `PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED = true`
  - `RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED = true`
  - `GUARDED_HUMAN_AUTH_ATTESTATION_READY = true`
  - `GUARDED_SOURCE_ATTESTATION_READY = true`
- **Invariants**: Public key verification only; zero private signing keys in source; commit/tree binding to canonical Git state; single-use run_nonce and payload digest registered in D1.
- **Rollback**: Set all 4 trust flags to false and clear authority registries.

#### Step 9: Cloudflare D1 Production Binding & Concurrency Certification
- **Action**: Bind real Cloudflare D1 database UUID in `wrangler.jsonc`.
- **Migrations**: Apply migrations 0001 through 0008 (`authorization_replay_ledger`).
- **Certification**: Run atomic reservation concurrency test against live D1.
- **Flag**: Set `D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED = true`.
- **Rollback**: Revert `database_id` to placeholder; drop test tables.

#### Step 10: Dormant Route Passivity Verification (NO ROUTE FLIP)
- **Mandate**: **DO NOT FLIP ROUTE OR INGRESS GATES IN SEGMENT B.**
- **Verification**:
  - `PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED` remains **`false`**.
  - `PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY` remains **`false`**.
  - `CANARY_LIVE_EXECUTION_ENABLED` remains **`false`**.
  - Verify that requests to `/api/ops/canary/deepseek-certification` return HTTP 404 `NOT_FOUND`.
- **Route Activation Boundary**: Any proposed route or ingress enablement moves strictly to **HARD GATE 2**.

---

### 3. AI Provider & Studio Boundary in Segment B

> [!CAUTION]
> **ZERO PROVIDER CALLS IN SEGMENT B.**
> - Google AI Studio / Gemini **MUST NOT** be invoked during Segment B.
> - DeepSeek **MUST NOT** be invoked during Segment B.
> - OpenAI **MUST NOT** be invoked during Segment B.
> - All provider network calls remain strictly **0**.
> - Provider API keys / secrets may only be provisioned in the Worker environment if explicitly included in the approved mutation package, and must **never** be printed or committed to source.
> - The first real AI provider invocation occurs exclusively in Segment C after **HARD GATE 2** human approval.

---

### 4. Infrastructure Cost Confirmation

Exact zero-dollar infrastructure cost claims have been removed:
- **Cloudflare Access & D1 Pricing**: Classified as `UNRESOLVED_REQUIRES_PROVISIONING_TIME_CONFIRMATION`. Free-tier allowances and subscription terms must be verified immediately prior to provisioning.
- **Provider Calls in Segment B**: Strictly **0**.
- **AI Provider Spend in Segment B**: **$0.00 (Zero calls by design)**.

---

### 5. Required Human Approval Token

To authorize proceeding to Segment B:

`SEGMENT_B_PRODUCTION_PROVISIONING_APPROVED`

Until that exact token is explicitly supplied:
`SEGMENT_B_EXECUTION_ALLOWED = false`
