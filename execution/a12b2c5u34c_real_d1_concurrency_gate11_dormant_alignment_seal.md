# Seal Result

A.12B.2C-5U.3.4C is approved and sealed for the limited scope stated below. Final status: `A12B2C5U34C_REAL_D1_CONCURRENCY_GATE11_DORMANT_ALIGNMENT_APPROVED_AND_SEALED`.

## 1. Reviewed Canonical Snapshot

- Commit: `446aa7d3d29eeae14ca0afefee2853b31634f0d8`
- Tree: `cd5151b89f632bddf8fd818f29e6d214f529ab83`
- Parent: `0871a9839d630a4d16e6fbc3b6c75a2d98ba5aea`
- Independent review verdict: `A12B2C5U34C_REAL_D1_CONCURRENCY_GATE11_DORMANT_ALIGNMENT_INDEPENDENT_REVIEW_APPROVED_FOR_SEAL_PREPARATION`
- Review findings: 0 material findings, 2 non-material observations.

## 2. Sealed Predecessor

- 5U.3.4B seal: commit `c2a04246a508b4afd00bd1d2a550f4d9d99cc586`, tree `6c9ffd3b9a524d1b46b4e71d3d9d6590fc58310a`, status `A12B2C5U34B_GATE9_DORMANT_REDEPLOYMENT_APPROVED_AND_SEALED`.

## 3. R4 Execution Lineage

- Canonical base: `c2a04246a508b4afd00bd1d2a550f4d9d99cc586`
- Commit A (Harness snapshot): `987bcfeb4b6bbf2691781377d6b41fe33ab2b8d1`
- Commit B (Concurrency evidence): `b03f85b694e87c20336fce8282c8aaa2a00ccaf6`
- Commit C (Gate 11 deploy snapshot): `541a9f967cd0919464e1fde6f46e9dd34792ae4a`
- Commit D (Dormant runtime alignment evidence): `0871a9839d630a4d16e6fbc3b6c75a2d98ba5aea`
- Commit E (Evidence repair): `446aa7d3d29eeae14ca0afefee2853b31634f0d8`

## 4. Human Authorization

- Human authorization verified: `true`
- Scope: `AUTHORIZE_A12B2C5U34C_REAL_D1_CONCURRENCY_AND_GATE11_DORMANT_ALIGNMENT`
- The exact human authorization literal is verified and preserved in the reviewed execution evidence.

## 5. Harness Boundary

- Hard maximum distinct keys: 660
- Caller can choose replay key: `false`
- Harness uses canonical backend: `true` (`D1AuthorizationReplayBackend`)

## 6. Real Concurrency Certification

- Batch ID: `r4cert_da0d929f4a15a225`
- Key version: `r4-v1`, Ledger version: `a12b2c5r-v1`
- Rounds total: 40 (20 contested + 20 control)
- Total attempts: 1280
- Contested attempts: 640 -> 20 RESERVED (exact 1 per round), 620 ALREADY_RESERVED (exact 31 per round)
- Control attempts: 640 -> 640 RESERVED (exact 32 per round), 0 ALREADY_RESERVED
- Total reserved: 660, Total already reserved: 620
- Backend unavailable: 0, Invalid request: 0, Errors: 0, Retries: 0
- Concurrency certification passed: `true`

## 7. Current D1 Certification State

- Current D1 batch rows: 660
- Current D1 distinct replay keys: 660
- Current D1 distinct run nonces: 660
- Contested rows: 20, Control rows: 640
- Ledger version mismatch count: 0
- Key version mismatch count: 0
- Certification rows preserved: `true`
- D1 deletion/update/cleanup: `none`

## 8. Temporary Worker Lifecycle

- Temporary worker name: `velnar-r4-d1-conc-e26c7b0a0bc5`
- Deployed version: `6b4be0cf-c5ef-4639-b430-7aebdf14c457`
- Deploy commands: 1, Delete commands: 1
- Deletion evidence: verified (`true`)
- Ephemeral secret (`R4_CERT_TOKEN`) destroyed with worker deletion
- Separate secret put/delete commands: 0

## 9. Multi-Colo Observation

- Observed edge colos: AMS, DUS, FRA, WAW, DUB, MAN
- Multi-geo observed: `true`
- Multi-geo claim scope: `OBSERVATIONAL_EDGE_COLO_DIVERSITY_ONLY`
- Formal multi-region D1 replication certified: `false`

## 10. Gate 11 Activation

- Gate 11 (`D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED`) activated false -> true following successful concurrency certification.
- Gate 9: `true`, Gate 10: `true`, Gate 11: `true`.
- All other 9 canonical gates: `false` / `blocked`.
- Canonical true gate count: 3, Closed or blocked gate count: 9.
- Registry length: 0, frozen: `true`.

## 11. Production Worker Runtime Alignment

- Worker name: `velnar-platform-worker`
- Active version: `5aa1936f-bb0d-4a32-9697-955431770b92`
- D1 binding name: `DB` -> `velnar-production-db`
- Database ID SHA-256 match: `true`, Final-six: `4de303` (no raw ID in seal)
- Health status: 200, `HEALTHY`, production, database configured, D1 `ATTACHED`, external AI `DISABLED`
- Operational route: GET 404, POST 404, OPTIONS 404 (dormant verified)
- Provider AI secrets present: `false`, Provider AI calls: 0

## 12. Final Gate State

- Gate 9: `true`
- Gate 10: `true`
- Gate 11: `true`
- Gates 1, 2, 3, 4, 5, 6, 7, 8, 12: `false` / `blocked`
- Canonical true gate count: 3, Closed or blocked gate count: 9

## 13. Behavioral Fail-Closed State

- Behavioral upstream fail-closed verified: `true`
- `db.prepare` calls: 0
- Credential resolver calls reachable: 0
- Provider fetch calls reachable: 0
- Production replay execution enabled: `false`
- Semantic distinction: Gates 9, 10, and 11 establish the real D1 replay backend foundation. They DO NOT establish permission to reach that backend in production. Upstream execution/trust/route barriers remain closed.

## 14. Test / Build Verification

- Independent test execution performed: `true`
- Test files: 63, Tests: 2523, Passed: 2523, Failed: 0
- Typecheck: `PASS`
- Build: `PASS`

## 15. Mutation Accounting

- R4 overall mutation accounting:
  - Temporary worker deploy commands: 1, delete commands: 1, confirmed: true
  - Secret bindings created: 1, separate secret put/delete: 0
  - Synthetic reservation attempts: 1280
  - Inserted certification rows: 660, conflict non-writes: 620
  - D1 deletes/updates/restores/migrations: 0
  - Concurrency retries: 0
  - Gate 11 flips: 1, Gate 9 flips: 0, Gate 10 flips: 0, other gate flips: 0
  - Main worker deploy commands: 1, confirmed: 1, rollbacks: 0
  - Provider AI secrets/reads/calls: 0
  - Access/DNS/domain/route/identity/trust-anchor mutations: 0
- Seal operation accounting:
  - Seal provider calls: 0, D1 calls: 0, production mutations: 0, deployments: 0, gate flips: 0

## 16. Provenance Limits

- Wrangler: 4.130.0
- Worker dry-run: 3 files, manifest SHA-256 `0fb5983d74e992dd999029c29d584b1b62a9deb6b34b7fd766db80b2d8ccbf82`, aggregate SHA-256 `1f26afccb41b3a594ce7c035cf205ee2a1902621edba491685af9fc2d216c70b`
- Static assets: 4 files, manifest SHA-256 `cdb2d1f7f6819b21fbff1596ea4f75ac9a70f746344a551f77d30b96cb9322c2`, aggregate SHA-256 `67cc807730df47eb7d94fd7d6efa551c71aa82a49105908af39a548f234a227d`
- Deployed byte equality claimed: `false`
- Runtime source provenance trust anchor provisioned: `false`

## 17. Non-Material Observations

1. **PROVIDER_CONTRACT**: Provider-side Worker Route and Custom Domain enumeration was unavailable through the permitted Wrangler read-only CLI. This does not contradict active Worker version, D1 binding identity, health response, provider-AI absence, or 404 dormant route behavior. Before any route/domain activation phase, enumerate current route and Custom Domain state through an approved management-plane read interface.
2. **TEST_VERIFICATION**: Current Gate 11 behavioral regression proves fail-closed readiness and db.prepare calls = 0, but does not assert the exact upstream failure status. This is non-material for R4 certification because independent review confirmed the behavioral safety property required by this phase. Add an exact upstream failure-status assertion in a later test-only refinement.

## 18. Explicit Non-Claims

This seal does not certify or authorize:
- live canary readiness
- provider AI readiness
- provider AI execution
- production replay execution readiness
- production authority trust anchor
- human authorization trust readiness
- source attestation trust readiness
- runtime source provenance trust anchor
- Access readiness
- Custom Domain readiness
- Worker Route readiness
- production routing readiness
- deployed byte-for-byte source provenance
- formal multi-region D1 replication
- real customer authorization use
- No later phase is implicitly authorized.

## 19. Sealed Scope

This seal certifies only:
- the bounded certification harness was constrained to a maximum of 660 distinct synthetic replay keys
- the canonical D1 replay adapter was used
- 1280 bounded real reservation attempts were executed
- all 20 contested rounds produced exact 1 RESERVED + 31 ALREADY_RESERVED
- all 640 control attempts produced RESERVED
- zero retries/errors/backend-unavailable occurred
- exact production D1 retained 660 synthetic append-only certification rows
- all 660 rows have unique replay keys and run nonces
- key_version r4-v1 and ledger_version a12b2c5r-v1 were independently verified
- Gate 11 was activated only after successful certification
- production Worker was redeployed once with Gate11=true
- exact production D1 binding remained attached
- current runtime remained healthy
- operational route remained dormant 404/404/404
- provider AI remained disabled
- all upstream production execution gates remained closed
- independent review found zero material findings

## 20. Final Status

`A12B2C5U34C_REAL_D1_CONCURRENCY_GATE11_DORMANT_ALIGNMENT_APPROVED_AND_SEALED`
