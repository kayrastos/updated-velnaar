# Phase A.12B.2C-5S: Durable Replay Backend Capability Audit & Selection Gate

## Audit Base

- **Base Commit**: `94605374f13f74b50865d7689cca0f53c88f25a2`
- **Base Tree**: `a7b439298fe0addf77694b7bf1f086187c5a50c8`
- **Audit Execution Mode**: Strictly offline, tracked repository content only.
- **Provider & External Calls**: 0 Gemini calls, 0 DeepSeek calls, 0 external network calls.
- **Credential & Secret Isolation**: Zero `.env` files, local credential files, cloud credentials, private keys, or API tokens read or accessed.

---

## Search Scope

The audit surveyed all tracked repository files under commit `94605374f13f74b50865d7689cca0f53c88f25a2`, covering:

1. **Package Manifests & Locks**:
   - `package.json`
   - `package-lock.json`
2. **Runtime & Infrastructure Configurations**:
   - `wrangler.jsonc`
   - `.env.example`
   - Absence of `Dockerfile`, `docker-compose*`, `firebase.json`, `firestore.rules`, `prisma/`, `terraform/`, `.github/workflows/`
3. **Database Migrations & Schema**:
   - `migrations/0001_initial_schema.sql`
   - `migrations/0002_indexes_and_performance.sql`
   - `migrations/0003_ai_intelligence_layer.sql`
   - `migrations/0004_growth_action_policy_hardening.sql`
   - `migrations/0005_appointment_concurrency_hardening.sql`
   - `migrations/0006_appointment_identity_resource_hardening.sql`
   - `migrations/0007_ai_run_protocol_hardening.sql`
   - `src/db/schema.sql`
4. **Server & Worker Codebase**:
   - `worker/index.ts`
   - `worker/env.ts`
   - `worker/ai/canary/deepSeekDurableAuthorizationReplayLedger.ts`
   - `worker/repositories/*.ts`
5. **Test Suites & Execution Audits**:
   - `tests/ai/phaseA12B2C5RDurableAuthorizationReplayLedger.test.ts`
   - `tests/repositories/d1Scoping.test.ts`
   - `execution/a12b2c5r_durable_authorization_replay_ledger_foundation.json`
   - `execution/a12b2c5r1_authorization_expiry_replay_binding_repair.json`

---

## Candidate Findings

Each backend family was audited for dependency presence, runtime binding presence, storage implementation presence, atomic reserve-if-absent implementation, durability across restarts, and cross-replica safety.

### 1. PostgreSQL / SQL
- **Dependency Present**: `false` (No `pg`, `postgres`, `prisma`, `drizzle-orm`, `typeorm`, or `sequelize` in `package.json` / `package-lock.json`).
- **Runtime Binding Present**: `false` (No connection strings, `DATABASE_URL`, or client pools).
- **Storage Implementation Present**: `false` (No relational SQL schema or migrations for replay tracking).
- **Atomic Reserve-If-Absent Present**: `false`.
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current Production Usable**: `false`.
- **Rejection Reason**: No PostgreSQL dependencies, infrastructure definitions, connection configurations, or runtime bindings exist in the tracked repository.

### 2. Redis
- **Dependency Present**: `false` (No `redis`, `ioredis`, `@upstash/redis` in `package.json`).
- **Runtime Binding Present**: `false` (No Redis host, port, TLS, or token environment bindings).
- **Storage Implementation Present**: `false` (No key-value storage adapter or replay key formatting).
- **Atomic Reserve-If-Absent Present**: `false` (No `SET ... NX` commands).
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current Production Usable**: `false`.
- **Rejection Reason**: No Redis client dependencies, connection configurations, or atomic reservation logic exist in the repository.

### 3. Firestore / Firebase
- **Dependency Present**: `false` (No `firebase`, `firebase-admin`, `@google-cloud/firestore`).
- **Runtime Binding Present**: `false` (No Firebase app initialization or project configuration).
- **Storage Implementation Present**: `false` (No `firebase.json`, `firestore.rules`, or document schemas).
- **Atomic Reserve-If-Absent Present**: `false`.
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current Production Usable**: `false`.
- **Rejection Reason**: No Firestore SDK, configuration files, or transaction semantics exist in the repository.

### 4. DynamoDB
- **Dependency Present**: `false` (No `@aws-sdk/client-dynamodb` or `@aws-sdk/lib-dynamodb`).
- **Runtime Binding Present**: `false` (No AWS credentials, region config, or client instances).
- **Storage Implementation Present**: `false` (No table definitions or schema).
- **Atomic Reserve-If-Absent Present**: `false` (No `attribute_not_exists(replayKey)` conditional writes).
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current Production Usable**: `false`.
- **Rejection Reason**: No AWS SDK, IAM policies, table definitions, or conditional write expressions exist in the repository.

### 5. Cloudflare Durable Objects
- **Dependency Present**: `true` (Worker types via devDependency `@cloudflare/workers-types`).
- **Runtime Binding Present**: `false` (No `durable_objects` declaration in `wrangler.jsonc` or `worker/env.ts`).
- **Storage Implementation Present**: `false` (No Durable Object class or storage logic defined).
- **Atomic Reserve-If-Absent Present**: `false`.
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current Production Usable**: `false`.
- **Rejection Reason**: While `@cloudflare/workers-types` provides ambient type declarations, no Durable Object binding is defined in `wrangler.jsonc`, no Durable Object coordinator class exists, and no transactional actor logic is implemented.

### 6. Cloudflare D1
- **Dependency Present**: `true` (`@cloudflare/workers-types` in `package.json`).
- **Runtime Binding Present**: `false` (Binding `DB` is declared in `wrangler.jsonc` with placeholder `database_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"`, but is unbound in `worker/ai/canary/deepSeekDurableAuthorizationReplayLedger.ts`).
- **Storage Implementation Present**: `false` (7 migration files exist for business entities such as leads and appointments, but zero migrations, tables, or columns exist for replay ledger reservations).
- **Atomic Reserve-If-Absent Present**: `false` (No SQL queries with `PRIMARY KEY` or `UNIQUE` constraint conflict resolution exist for authorization replay; `reserveProductionAuthorizationReplay` fails closed with `BACKEND_NOT_BOUND`).
- **Durability Across Restart Evidence**: `false` (Placeholder database ID indicates no provisioned production D1 instance; no persistent replay schema applied).
- **Cross-Replica Safety Evidence**: `false` (No transactional queries or constraint semantics implemented for replay keys).
- **Current Production Usable**: `false`.
- **Rejection Reason**: Cloudflare D1 is referenced in `wrangler.jsonc` with an unprovisioned placeholder `database_id` and used for business entities. However, no replay ledger migration, table schema, unique constraint, repository binding, or atomic reserve-if-absent queries exist. In `worker/ai/canary/deepSeekDurableAuthorizationReplayLedger.ts`, `DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND` and `ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED` remain strictly `false`, and `reserveProductionAuthorizationReplay` fails closed with `BACKEND_NOT_BOUND`.

### 7. Cloudflare KV
- **Dependency Present**: `false` (No KV bindings).
- **Runtime Binding Present**: `false` (No `kv_namespaces` in `wrangler.jsonc` or `worker/env.ts`).
- **Storage Implementation Present**: `false`.
- **Atomic Reserve-If-Absent Present**: `false`.
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current Production Usable**: `false`.
- **Rejection Reason**: No `KVNamespace` bindings exist. Furthermore, plain Cloudflare KV is eventually consistent and lacks single-roundtrip atomic create-if-absent primitives, making it unsafe for single-use replay prevention.

### 8. MongoDB
- **Dependency Present**: `false` (No `mongodb` or `mongoose`).
- **Runtime Binding Present**: `false`.
- **Storage Implementation Present**: `false`.
- **Atomic Reserve-If-Absent Present**: `false`.
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current Production Usable**: `false`.
- **Rejection Reason**: No MongoDB dependencies, configurations, or unique index reservation logic exist in the repository.

### 9. Supabase
- **Dependency Present**: `false` (No `@supabase/supabase-js`).
- **Runtime Binding Present**: `false`.
- **Storage Implementation Present**: `false`.
- **Atomic Reserve-If-Absent Present**: `false`.
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current ProductionUsable**: `false`.
- **Rejection Reason**: No Supabase client SDK, project URL, or key bindings exist in the repository.

### 10. In-Memory Stores (Map / Set / devStore)
- **Dependency Present**: `false` (JavaScript built-ins).
- **Runtime Binding Present**: `false`.
- **Storage Implementation Present**: `false` (In-memory mocks exist in development business repositories, but are forbidden in `deepSeekDurableAuthorizationReplayLedger.ts`).
- **Atomic Reserve-If-Absent Present**: `false`.
- **Durability Across Restart Evidence**: `false`.
- **Cross-Replica Safety Evidence**: `false`.
- **Current Production Usable**: `false`.
- **Rejection Reason**: In-memory data structures are explicitly rejected per Phase 5S Section 3. They provide zero durability across restarts, zero cross-worker or cross-replica coordination, and are subject to race conditions and process recycling.

---

## Atomicity Analysis

A viable replay backend MUST support the semantic equivalent of:
$$\text{RESERVE-IF-ABSENT}(replayKey) \to \begin{cases} \text{RESERVED} & \text{first attempt} \\ \text{ALREADY\_RESERVED} & \text{subsequent attempts} \end{cases}$$
such that concurrent race conditions allow **EXACTLY ONE** reservation to succeed, without any check-then-set race windows.

### Evaluation of Candidates Against Atomicity Requirements:

1. **In-Memory Structures (Map / Set / Object)**:
   - Check-then-set (`if (!map.has(k)) map.set(k, v)`) creates race conditions in concurrent asynchronous JavaScript event loop interleavings.
   - Separate Cloudflare Worker isolates and threads do not share process memory; two concurrent requests hitting different isolates would both succeed, violating single-use security.
2. **Cloudflare KV**:
   - Cloudflare KV is an eventually consistent key-value store optimized for high-read throughput.
   - It does not support atomic create-if-absent (e.g. no conditional write or compare-and-swap). A read-then-write sequence allows two concurrent workers to observe an absent key simultaneously and both write reservations.
3. **Cloudflare D1 (Relational SQL)**:
   - SQLite provides ACID transactions and strict uniqueness enforcement via `PRIMARY KEY` or `UNIQUE` constraints.
   - An `INSERT INTO authorization_replay_ledger (replay_key, ...) VALUES (...)` query fails immediately with a unique constraint violation (SQLITE_CONSTRAINT) if `replay_key` already exists, or can use `ON CONFLICT (replay_key) DO NOTHING` where `changes === 0` identifies duplicate reservation.
   - Under D1's single-primary architecture, writes are serialized, preventing concurrent race conditions.
   - **Current Repository State**: No such table, constraint, or query is implemented.
4. **Cloudflare Durable Objects**:
   - Durable Objects provide single-threaded actor execution with strongly consistent transactional storage.
   - A Durable Object method handling reservation guarantees that only one request executes at a time per coordinate ID, allowing atomic `storage.put(key, val, { noOverwrite: true })`.
   - **Current Repository State**: No Durable Object binding or class is implemented.
5. **Redis**:
   - `SET replayKey val NX EX ttl` provides atomic test-and-set in a single atomic server command.
   - **Current Repository State**: No Redis dependency or connection is present.

---

## Durability Analysis

Per Phase 5S Section 2 & 3, the backend must retain reservations across worker restarts, process recycling, and edge replica dispatch for at least the full signed authorization validity period (`expiresAt`).

### Durability Findings:

- **In-Memory / Local Ephemeral Runtimes**: Provide zero restart durability. When a Cloudflare Worker isolate is torn down or scaled down, all in-memory state is discarded. This would allow an attacker to replay a previously used authorization against a freshly spawned isolate.
- **Tracked Repository D1 Configuration**: In `wrangler.jsonc`, the `database_id` is `"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"`, which is an unprovisioned template string. There is no active connection or migration applying a replay ledger table to an existing durable store.
- **Repository Evidence Verdict**: The repository currently contains **ZERO** operational durable storage bindings for authorization replay reservation.

---

## Existing Backend Selection

```
selectionStatus: NO_EXISTING_DURABLE_ATOMIC_BACKEND_FOUND
existingViableDurableAtomicBackendFound: false
selectedExistingBackend: null
```

No existing backend in the tracked repository qualifies as an operational, viable durable atomic replay ledger backend.

---

## Future Recommendation

### Recommended Future Backend Class: `CLOUDFLARE_D1`

### Comparative Architecture Matrix:

| Evaluation Criterion | Cloudflare D1 (Recommended) | Cloudflare Durable Objects | Redis (e.g. Upstash) | PostgreSQL |
| :--- | :--- | :--- | :--- | :--- |
| **Atomic Reserve-If-Absent** | High (`INSERT` + `PRIMARY KEY` / `UNIQUE` constraint) | High (Single-thread actor + `storage.put(..., { noOverwrite: true })`) | High (`SET NX EX`) | High (`INSERT ... ON CONFLICT DO NOTHING`) |
| **Durability Across Restart** | High (D1 replicated SQLite storage) | High (Distributed transactional storage) | Medium-High (AOF/RDB persistence depending on provider) | High (WAL-backed relational database) |
| **Operational Simplicity** | High (Declared directly in `wrangler.jsonc`, zero external credentials) | Medium (Requires class definition, migrations, and Workers Paid plan) | Medium (Requires external REST/TCP credentials, VPC/egress setup) | Low-Medium (Requires Hyperdrive pooling, connection management) |
| **Compatibility with VELNAR** | Native (`worker/env.ts` already defines `DB?: D1Database`) | Native Cloudflare, but requires architectural restructuring | External service dependency | External service dependency |
| **Cost** | Included in standard Cloudflare Workers allowance | Requires Workers Paid subscription | Additional third-party SaaS billing | Additional database hosting costs |
| **Cross-Replica Behavior** | Cloudflare coordinates writes through single-primary SQLite engine | Globally unique actor instance routes all requests for its ID | Centralized cluster handles writes | Centralized primary handles writes |
| **TTL / Expiry Support** | Requires cleanup query on `expires_at <= ?` | Alarms API can schedule deletion | Native TTL (`EX seconds`) | Requires `pg_cron` or scheduled deletion |
| **Failure Behavior** | Fails closed with SQL error; easily handled | Fails closed if object unreachable | Network timeout / network failure | Network timeout / connection pool exhaustion |
| **Testing Complexity** | High testability with in-memory SQLite / D1 mock harnesses | Complex mocking required for Miniflare Durable Objects | Requires Redis mock / testcontainer | Requires Postgres container / mock |
| **Vendor Lock-In** | Bound to Cloudflare Workers (SQLite SQL is standard) | Strictly bound to Cloudflare Workers | Open standard (Redis protocol) | Open standard (PostgreSQL protocol) |

### Rationale:
Cloudflare D1 is the most architecturally compatible candidate for future implementation because the VELNAR repository already targets Cloudflare Workers, declares a D1 binding (`DB`) in `wrangler.jsonc`, and uses SQL repositories across other domains. Implementing a replay ledger in D1 requires creating a schema migration (`CREATE TABLE authorization_replay_ledger (replay_key TEXT PRIMARY KEY, ...)`) and an atomic SQL `INSERT` statement, without introducing any external third-party packages, credentials, or network hops.

### Infrastructure Target Status:
- The execution platform is established by tracked repository evidence as **Cloudflare Workers** (`wrangler.jsonc`, `worker/index.ts`).
- However, the concrete production D1 database remains **unprovisioned** (placeholder `database_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"`).
- **IMPORTANT**: This recommendation is purely evaluative. No backend is implemented, no packages are added, no cloud resources are provisioned, and no production code is modified in Phase 5S.

---

## Safety State

All security gates, operational readiness flags, and execution boundaries remain strictly **false** and fail-closed:

- `DURABLE_AUTHORIZATION_REPLAY_LEDGER_READY === false`
- `DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND === false`
- `ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED === false`
- `RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED === false`
- `PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED === false`
- `GUARDED_SOURCE_ATTESTATION_READY === false`
- `GUARDED_HUMAN_AUTH_ATTESTATION_READY === false`
- `CANARY_LIVE_EXECUTION_ENABLED === false`
- `production routing: OFF`
- `providerNetworkCalls: 0`
