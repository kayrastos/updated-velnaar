# VELNAR D1 Remote Concurrency Certification Evidence V1

**Artifact Type**: `OBSERVED_REMOTE_EXECUTION_EVIDENCE_REPOSITORY_BOUND`  
**Mission Phase**: `SEGMENT_B_PRODUCTION_PROVISIONING`  
**Verification Target**: Cloudflare D1 Production Replay Backend  
**Verdict**: `D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED_PASS`  
**Test Run ID**: `cert_run_1a07f17a810_bb7dfc12`  

---

## 1. Target Database Information

- **Database Name**: `velnar-production-db`
- **Database UUID**: `d65abcb3-d8d6-46fb-9403-a97ab54de303`
- **Region**: `EEUR`
- **Binding Name**: `DB`
- **Execution Mode**: Direct Remote Cloudflare D1 API Query
- **Started At**: `2026-09-08T03:37:31.922Z`
- **Completed At**: `2026-09-08T03:37:45.177Z`

---

## 2. Concurrency Test Execution Summary

| Test Case | Description | Expected Outcome | Actual Outcome | Status |
|---|---|---|---|---|
| **1. Initial Atomic Reservation** | First-time reservation of replay key | 1 row returned (`RESERVED`) | 1 row returned | **PASS** |
| **2. Replay Duplicate Rejection** | Re-attempting same replay key | 0 rows returned (`ON CONFLICT DO NOTHING`) | 0 rows returned | **PASS** |
| **3. Concurrent Race Atomicity** | 5 simultaneous parallel reservations of same key | Exactly 1 reserved, 4 rejected | 1 reserved, 4 rejected | **PASS** |
| **4. Bounded Synthetic Cleanup** | Deletion of synthetic test rows | 2 rows deleted | 2 rows deleted | **PASS** |

- **Concurrency Level**: 5 simultaneous promises
- **Winner Count**: Exactly 1
- **Rejection Count**: Exactly 4
- **Synthetic Rows Cleaned Up**: 2
- **All Tests Passed**: `true`

---

## 3. Dual-State D1 Architecture

- **Remote Cloudflare D1 Infrastructure**: Provisioned (`d65abcb3-d8d6-46fb-9403-a97ab54de303`), migrated, and concurrency-certified.
- **Canonical Runtime Readiness Flags**:
  - `D1_REPLAY_BACKEND_PRODUCTION_BOUND`: `false` (runtime remains fail-closed until Hard Gate 2 approval and deployment).
  - `D1_REPLAY_BACKEND_PERSISTENCE_READY`: `false`
