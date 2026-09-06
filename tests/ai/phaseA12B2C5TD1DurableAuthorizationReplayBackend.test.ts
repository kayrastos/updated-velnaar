/**
 * @file tests/ai/phaseA12B2C5TD1DurableAuthorizationReplayBackend.test.ts
 * @description Comprehensive unit, invariant, and security test suite for Phase A.12B.2C-5T:
 * Cloudflare D1 Durable Single-Use Authorization Replay Backend Foundation.
 *
 * STRICT INVARIANTS:
 * - Pure offline execution. ZERO network, ZERO provider, ZERO real D1 calls.
 * - Structurally atomic insertion using PRIMARY KEY conflict resolution.
 * - Single statement execution without preceding inspection queries.
 * - Untrusted backend classification fails closed to BACKEND_UNAVAILABLE.
 * - Append-only initial retention policy.
 * - Real D1 concurrency certified remains strictly false.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  D1AuthorizationReplayBackend,
  D1_AUTHORIZATION_REPLAY_RESERVATION_SQL,
  D1_REPLAY_BACKEND_ADAPTER_VERSION,
  D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED,
  D1_REPLAY_BACKEND_PRODUCTION_BOUND,
  D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED,
  D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED,
} from '../../worker/ai/canary/d1AuthorizationReplayBackend';

import {
  DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND,
  ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED,
  type AuthorizationReplayReservationRequest,
  type AuthorizationReplayReservationResult,
  type DurableAuthorizationReplayBackend,
} from '../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';

import type { D1Database } from '@cloudflare/workers-types';

// ============================================================================
// NETWORK SENTINEL: ZERO NETWORK / ZERO PROVIDER CALLS GUARANTEE
// ============================================================================

let originalFetch: typeof globalThis.fetch;
let globalFetchCalls = 0;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalFetchCalls = 0;
  globalThis.fetch = (async (..._args: any[]) => {
    globalFetchCalls++;
    throw new Error('NETWORK_CALL_FORBIDDEN: Network calls are strictly prohibited in offline tests');
  }) as any;
});

afterEach(() => {
  expect(globalFetchCalls).toBe(0);
  globalThis.fetch = originalFetch;
  globalFetchCalls = 0;
});

// ============================================================================
// TEST FIXTURES & MOCK D1 FACTORIES
// ============================================================================

function createValidTestReservationRequest(
  overrides?: Partial<AuthorizationReplayReservationRequest>
): AuthorizationReplayReservationRequest {
  return {
    ledgerVersion: 'a12b2c5r-v1',
    replayKey: 'a'.repeat(64),
    authorizationPayloadDigestSha256: 'b'.repeat(64),
    authorityId: 'auth_velnar_secops_test',
    keyVersion: '2026-v1',
    runNonce: 'a12b2c5t_nonce_0123456789abcdef',
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    ...overrides,
  };
}

interface MockD1Options {
  prepareThrows?: Error;
  bindThrows?: Error;
  allThrows?: Error;
  result?: unknown;
}

function createMockD1Database(options: MockD1Options = {}): {
  db: D1Database;
  prepareCalls: { query: string }[];
  bindCalls: { params: unknown[] }[];
  allCalls: { count: number };
} {
  const prepareCalls: { query: string }[] = [];
  const bindCalls: { params: unknown[] }[] = [];
  const allCalls = { count: 0 };

  const db = {
    prepare(query: string) {
      prepareCalls.push({ query });
      if (options.prepareThrows) {
        throw options.prepareThrows;
      }
      return {
        bind(...params: unknown[]) {
          bindCalls.push({ params });
          if (options.bindThrows) {
            throw options.bindThrows;
          }
          return {
            async all() {
              allCalls.count++;
              if (options.allThrows) {
                throw options.allThrows;
              }
              return 'result' in options
                ? options.result
                : {
                    success: true,
                    results: [{ replay_key: params[0] }],
                    meta: { changes: 1 },
                  };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, prepareCalls, bindCalls, allCalls };
}

describe('Phase A.12B.2C-5T: Cloudflare D1 Durable Authorization Replay Backend Foundation', () => {
  // ==========================================================================
  // 1. ADAPTER CONSTANTS & READINESS GATES
  // ==========================================================================
  describe('1. Adapter Constants & Readiness Gates', () => {
    it('1. adapter version is exact a12b2c5t-v1', () => {
      expect(D1_REPLAY_BACKEND_ADAPTER_VERSION).toBe('a12b2c5t-v1');
    });

    it('2. adapter implemented is true', () => {
      expect(D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED).toBe(true);
    });

    it('3. production bound remains strictly false', () => {
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
    });

    it('4. real concurrency certified remains strictly false', () => {
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(false);
    });

    it('5. real database provisioned remains strictly false', () => {
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(false);
    });
  });

  // ==========================================================================
  // 2. SQL ARCHITECTURE & STATEMENT INVARIANTS
  // ==========================================================================
  describe('2. SQL Architecture & Statement Invariants', () => {
    it('6. SQL contains exactly one INSERT statement', () => {
      const matches = D1_AUTHORIZATION_REPLAY_RESERVATION_SQL.match(/\bINSERT\b/gi);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(1);
    });

    it('7. SQL contains NO inspection query', () => {
      expect(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL).not.toMatch(/\bSELECT\b/i);
    });

    it('8. SQL contains NO deletion query', () => {
      expect(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL).not.toMatch(/\bDELETE\b/i);
    });

    it('9. SQL contains NO update query', () => {
      expect(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL).not.toMatch(/\bUPDATE\b/i);
    });

    it('10. SQL specifies ON CONFLICT(replay_key) DO NOTHING', () => {
      expect(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL).toContain('ON CONFLICT(replay_key) DO NOTHING');
    });

    it('11. SQL specifies RETURNING replay_key', () => {
      expect(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL).toContain('RETURNING replay_key');
    });

    it('12. SQL uses bound parameter placeholders ?1 through ?8', () => {
      for (let i = 1; i <= 8; i++) {
        expect(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL).toContain(`?${i}`);
      }
    });

    it('13. reserved_at uses strftime with now UTC without string interpolation', () => {
      expect(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL).toContain("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    });
  });

  // ==========================================================================
  // 3. CONSTRUCTOR & HANDLE VALIDATION
  // ==========================================================================
  describe('3. Constructor & Database Handle Validation', () => {
    it('14. constructor throws if db is null', () => {
      expect(() => new D1AuthorizationReplayBackend(null as any)).toThrow(
        'D1_BACKEND_INITIALIZATION_FAILED'
      );
    });

    it('15. constructor throws if db is undefined', () => {
      expect(() => new D1AuthorizationReplayBackend(undefined as any)).toThrow(
        'D1_BACKEND_INITIALIZATION_FAILED'
      );
    });

    it('16. constructor throws if db is a primitive', () => {
      expect(() => new D1AuthorizationReplayBackend('not_a_db' as any)).toThrow(
        'D1_BACKEND_INITIALIZATION_FAILED'
      );
    });

    it('17. constructor throws if db.prepare is not a function', () => {
      expect(() => new D1AuthorizationReplayBackend({} as any)).toThrow(
        'D1_BACKEND_INITIALIZATION_FAILED'
      );
    });
  });

  // ==========================================================================
  // 4. API SURFACE & SINGLE-ARGUMENT HARDENING
  // ==========================================================================
  describe('4. API Surface & Single-Argument Hardening', () => {
    it('18. reserveIfAbsent parameter length is exactly 1', () => {
      const { db } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      expect(backend.reserveIfAbsent.length).toBe(1);
    });

    it('19. reserveIfAbsent fails closed with INVALID_REQUEST if called with 0 arguments', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await (backend.reserveIfAbsent as any)();
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(res.errors[0]).toContain('FORBIDDEN_CALLER_PARAMETER');
      expect(prepareCalls.length).toBe(0);
    });

    it('20. reserveIfAbsent fails closed with INVALID_REQUEST if called with extra arguments', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const req = createValidTestReservationRequest();
      const res = await (backend.reserveIfAbsent as any)(req, { extra: true });
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(res.errors[0]).toContain('FORBIDDEN_CALLER_PARAMETER');
      expect(prepareCalls.length).toBe(0);
    });
  });

  // ==========================================================================
  // 5. REQUEST INPUT VALIDATION & INJECTION REJECTION
  // ==========================================================================
  describe('5. Request Input Validation & Injection Rejection (db.prepare call count === 0)', () => {
    it('21. rejects null request', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(null as any);
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('22. rejects undefined request', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(undefined as any);
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('23. rejects array request', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent([] as any);
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('24. rejects primitive request', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent('req' as any);
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    const requiredFields: (keyof AuthorizationReplayReservationRequest)[] = [
      'replayKey',
      'ledgerVersion',
      'authorizationPayloadDigestSha256',
      'authorityId',
      'keyVersion',
      'runNonce',
      'expiresAt',
    ];

    for (const field of requiredFields) {
      it(`rejects request missing field '${field}'`, async () => {
        const { db, prepareCalls } = createMockD1Database();
        const backend = new D1AuthorizationReplayBackend(db);
        const req = createValidTestReservationRequest();
        delete (req as any)[field];
        const res = await backend.reserveIfAbsent(req);
        expect(res.success).toBe(false);
        expect(res.status).toBe('INVALID_REQUEST');
        expect(prepareCalls.length).toBe(0);
      });
    }

    const forbiddenOverrides = [
      'nowUtc',
      'verified',
      'verificationResult',
      'alreadyVerified',
      'credentials',
      'signatureBase64',
      'authority',
      'publicKey',
      'apiKey',
    ] as const;

    for (const override of forbiddenOverrides) {
      it(`rejects forbidden override parameter '${override}' before db.prepare`, async () => {
        const { db, prepareCalls } = createMockD1Database();
        const backend = new D1AuthorizationReplayBackend(db);
        const req = createValidTestReservationRequest({ [override]: 'injected_val' } as any);
        const res = await backend.reserveIfAbsent(req);
        expect(res.success).toBe(false);
        expect(res.status).toBe('INVALID_REQUEST');
        expect(prepareCalls.length).toBe(0);
      });
    }
  });

  // ==========================================================================
  // 6. REPLAY KEY & SCHEMA VALIDATION
  // ==========================================================================
  describe('6. Replay Key & Canonical Schema Validation', () => {
    it('35. replayKey too short (< 64 hex chars) rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest({ replayKey: 'a'.repeat(63) }));
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('36. replayKey too long (> 64 hex chars) rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest({ replayKey: 'a'.repeat(65) }));
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('37. replayKey uppercase hex characters rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ replayKey: 'A'.repeat(64) })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('38. replayKey non-hex characters rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ replayKey: 'z'.repeat(64) })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('39. ledgerVersion not matching a12b2c5r-v1 rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ ledgerVersion: 'v2-unsupported' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('40. authorizationPayloadDigestSha256 too short rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ authorizationPayloadDigestSha256: 'b'.repeat(63) })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('41. authorizationPayloadDigestSha256 uppercase hex rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ authorizationPayloadDigestSha256: 'B'.repeat(64) })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('42. authorizationPayloadDigestSha256 non-hex rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ authorizationPayloadDigestSha256: 'x'.repeat(64) })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });
  });

  // ==========================================================================
  // 7. NONCE CANONICALITY & AUTHORITY VALIDATION
  // ==========================================================================
  describe('7. Nonce Canonicality & Authority Validation', () => {
    it('43. authorityId empty rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest({ authorityId: '' }));
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('44. authorityId with invalid characters rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ authorityId: 'auth@invalid!' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('45. keyVersion empty rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest({ keyVersion: '' }));
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('46. runNonce with leading whitespace rejected (exact trim equality)', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ runNonce: ' a12b2c5t_nonce_0123456789abcdef' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('47. runNonce with trailing whitespace rejected (exact trim equality)', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ runNonce: 'a12b2c5t_nonce_0123456789abcdef ' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('48. runNonce with tab characters rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ runNonce: '\ta12b2c5t_nonce_0123456789abcdef\t' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('49. runNonce too short (< 16 chars) rejected', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest({ runNonce: 'short_nonce' }));
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });
  });

  // ==========================================================================
  // 8. RUNTIME EXPIRY VALIDATION (ZERO CALLER CLOCK INFLUENCE)
  // ==========================================================================
  describe('8. Runtime Expiry Validation (ZERO caller clock influence)', () => {
    it('50. expiresAt with invalid date format rejected before db.prepare', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest({ expiresAt: 'invalid_date' }));
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('51. expiresAt without UTC designator Z rejected before db.prepare', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ expiresAt: '2026-09-06T12:00:00.000' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('52. expiresAt in the past (expired) rejected before db.prepare', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const pastExpiresAt = new Date(Date.now() - 60_000).toISOString();
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest({ expiresAt: pastExpiresAt }));
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('53. expiresAt calendar invalid (e.g. Feb 30) rejected before db.prepare', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ expiresAt: '2026-02-30T10:00:00.000Z' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('54. valid future expiresAt allows db.prepare to execute', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const futureExpiresAt = new Date(Date.now() + 60_000).toISOString();
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest({ expiresAt: futureExpiresAt }));
      expect(prepareCalls.length).toBe(1);
      expect(res.status).toBe('RESERVED');
    });
  });

  // ==========================================================================
  // 9. BOUND PARAMETERS & INTERNALLY DERIVED EPOCH ORDER
  // ==========================================================================
  describe('9. Bound Parameters & Internally Derived Epoch Order', () => {
    it('55. db.prepare is called with exact D1_AUTHORIZATION_REPLAY_RESERVATION_SQL', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(prepareCalls[0].query).toBe(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL);
    });

    it('56. statement.bind receives exactly 8 bound parameters', async () => {
      const { db, bindCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(bindCalls[0].params.length).toBe(8);
    });

    it('57. parameters match exact specified order (?1 through ?8)', async () => {
      const { db, bindCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const req = createValidTestReservationRequest();
      await backend.reserveIfAbsent(req);

      const params = bindCalls[0].params;
      expect(params[0]).toBe(req.replayKey);
      expect(params[1]).toBe(req.ledgerVersion);
      expect(params[2]).toBe(req.authorizationPayloadDigestSha256);
      expect(params[3]).toBe(req.authorityId);
      expect(params[4]).toBe(req.keyVersion);
      expect(params[5]).toBe(req.runNonce);
      expect(params[6]).toBe(req.expiresAt);
      expect(params[7]).toBe(Date.parse(req.expiresAt));
    });

    it('58. expiresAtEpochMs strictly equals Date.parse(request.expiresAt)', async () => {
      const { db, bindCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const req = createValidTestReservationRequest();
      await backend.reserveIfAbsent(req);
      expect(bindCalls[0].params[7]).toBe(Date.parse(req.expiresAt));
    });

    it('59. no caller-supplied epoch timestamp is accepted or bound', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const req = createValidTestReservationRequest({ expiresAtEpochMs: 9999999999 } as any);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });
  });

  // ==========================================================================
  // 10. SUCCESSFUL RESERVATION (RESERVED)
  // ==========================================================================
  describe('10. Successful Reservation Classification (RESERVED)', () => {
    it('60. returns RESERVED when success is true, 1 row returned', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { changes: 1 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(true);
      expect(res.status).toBe('RESERVED');
    });

    it('61. returns empty errors array on RESERVED', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { changes: 1 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.errors).toEqual([]);
    });

    it('62. returns replayKey and expiresAt matching request on RESERVED', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { changes: 1 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.replayKey).toBe(req.replayKey);
      expect(res.expiresAt).toBe(req.expiresAt);
    });

    it('63. db.prepare called exactly once for successful reservation', async () => {
      const req = createValidTestReservationRequest();
      const { db, prepareCalls, allCalls } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { changes: 1 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      await backend.reserveIfAbsent(req);
      expect(prepareCalls.length).toBe(1);
      expect(allCalls.count).toBe(1);
    });
  });

  // ==========================================================================
  // 11. ALREADY RESERVED CLASSIFICATION (ALREADY_RESERVED)
  // ==========================================================================
  describe('11. Already Reserved Classification (ALREADY_RESERVED)', () => {
    it('64. returns ALREADY_RESERVED when success is true, 0 rows returned', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [],
          meta: { changes: 0 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('ALREADY_RESERVED');
    });

    it('65. returns structured error message on ALREADY_RESERVED', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [],
          meta: { changes: 0 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.errors[0]).toContain('AUTHORIZATION_REPLAY_ALREADY_RESERVED');
    });

    it('66. returns replayKey and expiresAt on ALREADY_RESERVED', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [],
          meta: { changes: 0 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.replayKey).toBe(req.replayKey);
      expect(res.expiresAt).toBe(req.expiresAt);
    });

    it('67. executes exactly one prepared SQL statement on ALREADY_RESERVED', async () => {
      const req = createValidTestReservationRequest();
      const { db, prepareCalls, allCalls } = createMockD1Database({
        result: {
          success: true,
          results: [],
          meta: { changes: 0 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      await backend.reserveIfAbsent(req);
      expect(prepareCalls.length).toBe(1);
      expect(allCalls.count).toBe(1);
    });
  });

  // ==========================================================================
  // 12. BACKEND UNAVAILABLE ON AMBIGUOUS / ABNORMAL OUTCOMES
  // ==========================================================================
  describe('12. Fail-Closed to BACKEND_UNAVAILABLE on Ambiguous Outcomes', () => {
    const ambiguousCases: { name: string; result: unknown }[] = [
      { name: 'result is null', result: null },
      { name: 'result is undefined', result: undefined },
      { name: 'result is number', result: 42 },
      { name: 'result.success is false', result: { success: false, results: [], meta: {} } },
      { name: 'result.success is undefined', result: { results: [], meta: {} } },
      { name: 'result.success is null', result: { success: null, results: [], meta: {} } },
      { name: 'result.results is missing', result: { success: true, meta: {} } },
      { name: 'result.results is null', result: { success: true, results: null, meta: {} } },
      { name: 'result.results is object not array', result: { success: true, results: {}, meta: {} } },
      {
        name: 'result.results has 2 rows',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64) }, { replay_key: 'a'.repeat(64) }], meta: {} },
      },
      {
        name: 'result.results has 3 rows',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64) }, { replay_key: 'b'.repeat(64) }, { replay_key: 'c'.repeat(64) }], meta: {} },
      },
      { name: 'returned row is null', result: { success: true, results: [null], meta: {} } },
      { name: 'returned row is non-object', result: { success: true, results: ['row_string'], meta: {} } },
      { name: 'returned row is array', result: { success: true, results: [['row_array']], meta: {} } },
      {
        name: 'returned row has mismatched replay_key',
        result: { success: true, results: [{ replay_key: 'f'.repeat(64) }], meta: {} },
      },
      {
        name: 'returned row missing replay_key property',
        result: { success: true, results: [{ other_col: 'val' }], meta: {} },
      },
      {
        name: 'returned row with extra property injected',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64), injected: true }], meta: {} },
      },
      { name: 'result.meta is missing', result: { success: true, results: [{ replay_key: 'a'.repeat(64) }] } },
      { name: 'result.meta is null', result: { success: true, results: [{ replay_key: 'a'.repeat(64) }], meta: null } },
      { name: 'result.meta is array', result: { success: true, results: [{ replay_key: 'a'.repeat(64) }], meta: [] } },
      {
        name: 'meta.changed_db is non-boolean string',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64) }], meta: { changed_db: 'true' } },
      },
      {
        name: 'meta.rows_written is negative',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64) }], meta: { rows_written: -1 } },
      },
      {
        name: 'meta.rows_written is float',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64) }], meta: { rows_written: 1.5 } },
      },
      {
        name: 'meta.rows_written is string',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64) }], meta: { rows_written: '1' } },
      },
      {
        name: 'contradiction: 1 row returned but meta.changed_db is false',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64) }], meta: { changed_db: false } },
      },
      {
        name: 'contradiction: 1 row returned but meta.rows_written is 0',
        result: { success: true, results: [{ replay_key: 'a'.repeat(64) }], meta: { rows_written: 0 } },
      },
      {
        name: 'contradiction: 0 rows returned but meta.changed_db is true',
        result: { success: true, results: [], meta: { changed_db: true } },
      },
      {
        name: 'contradiction: 0 rows returned but meta.rows_written > 0 (1)',
        result: { success: true, results: [], meta: { rows_written: 1 } },
      },
    ];

    for (const testCase of ambiguousCases) {
      it(`returns BACKEND_UNAVAILABLE when ${testCase.name}`, async () => {
        const req = createValidTestReservationRequest();
        const { db } = createMockD1Database({ result: testCase.result });
        const backend = new D1AuthorizationReplayBackend(db);
        const res = await backend.reserveIfAbsent(req);
        expect(res.success).toBe(false);
        expect(res.status).toBe('BACKEND_UNAVAILABLE');
      });
    }
  });

  // ==========================================================================
  // 13. EXCEPTION HANDLING & AMBIGUOUS COMMIT FAILS CLOSED
  // ==========================================================================
  describe('13. Exception Handling & Ambiguous Commit Fails Closed', () => {
    it('92. prepare throws Error -> returns BACKEND_UNAVAILABLE', async () => {
      const { db } = createMockD1Database({ prepareThrows: new Error('D1_PREPARE_ERR') });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.errors[0]).toContain('D1_PREPARE_ERR');
    });

    it('93. bind throws Error -> returns BACKEND_UNAVAILABLE', async () => {
      const { db } = createMockD1Database({ bindThrows: new Error('D1_BIND_ERR') });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.errors[0]).toContain('D1_BIND_ERR');
    });

    it('94. all throws Error -> returns BACKEND_UNAVAILABLE', async () => {
      const { db } = createMockD1Database({ allThrows: new Error('D1_EXECUTION_ERR') });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.errors[0]).toContain('D1_EXECUTION_ERR');
    });

    it('95. UNIQUE constraint exception text MUST NOT be classified ALREADY_RESERVED', async () => {
      const { db } = createMockD1Database({ allThrows: new Error('UNIQUE constraint failed: authorization_replay_ledger.replay_key') });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.status).not.toBe('ALREADY_RESERVED');
    });

    it('96. duplicate replay key exception text MUST NOT be classified ALREADY_RESERVED', async () => {
      const { db } = createMockD1Database({ allThrows: new Error('duplicate replay key detected in sqlite engine') });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.status).not.toBe('ALREADY_RESERVED');
    });

    it('97. generic constraint error MUST NOT be classified ALREADY_RESERVED', async () => {
      const { db } = createMockD1Database({ allThrows: new Error('constraint error occurred during execution') });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.status).not.toBe('ALREADY_RESERVED');
    });

    it('98. storage quota exceeded returns BACKEND_UNAVAILABLE', async () => {
      const { db } = createMockD1Database({ allThrows: new Error('D1_STORAGE_QUOTA_EXCEEDED') });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
    });

    it('99. timeout / ambiguous commit fails closed to BACKEND_UNAVAILABLE', async () => {
      const { db } = createMockD1Database({ allThrows: new Error('D1_TIMEOUT_AMBIGUOUS_COMMIT') });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
    });
  });

  // ==========================================================================
  // 14. SQL INJECTION HARDENING TESTS
  // ==========================================================================
  describe('14. SQL Injection Hardening Tests', () => {
    it('100. SQL injection in replayKey rejected before D1', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ replayKey: "' OR '1'='1" })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('101. SQL comment injection in authorityId rejected before D1', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ authorityId: 'admin; --' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('102. SQL query injection in runNonce rejected before D1', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ runNonce: 'nonce; DROP TABLE authorization_replay_ledger;' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('103. SQL union injection in keyVersion rejected before D1', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ keyVersion: 'v1 UNION ALL' })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('104. SQL injection in expiresAt rejected before D1', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(
        createValidTestReservationRequest({ expiresAt: "2026-09-06T12:00:00Z'; DROP TABLE users;--" })
      );
      expect(res.success).toBe(false);
      expect(res.status).toBe('INVALID_REQUEST');
      expect(prepareCalls.length).toBe(0);
    });

    it('105. SQL string remains constant and immutable regardless of request', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const backend = new D1AuthorizationReplayBackend(db);
      await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(prepareCalls[0].query).toBe(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL);
    });
  });

  // ==========================================================================
  // 15. CONCURRENCY REHEARSAL & BOUNDARY CERTIFICATION
  // ==========================================================================
  describe('15. Concurrency Rehearsal & Boundary Certification', () => {
    it('106. sequential double-reservation rehearsal: 1st RESERVED, 2nd ALREADY_RESERVED', async () => {
      const ledger = new Set<string>();
      const statefulDb = {
        prepare(_query: string) {
          return {
            bind(...params: unknown[]) {
              const replayKey = params[0] as string;
              return {
                async all() {
                  if (ledger.has(replayKey)) {
                    return { success: true, results: [], meta: { changes: 0 } };
                  }
                  ledger.add(replayKey);
                  return { success: true, results: [{ replay_key: replayKey }], meta: { changes: 1 } };
                },
              };
            },
          };
        },
      } as unknown as D1Database;

      const backend = new D1AuthorizationReplayBackend(statefulDb);
      const req = createValidTestReservationRequest();

      const res1 = await backend.reserveIfAbsent(req);
      expect(res1.success).toBe(true);
      expect(res1.status).toBe('RESERVED');

      const res2 = await backend.reserveIfAbsent(req);
      expect(res2.success).toBe(false);
      expect(res2.status).toBe('ALREADY_RESERVED');
    });

    it('107. concurrent burst rehearsal: exactly 1 RESERVED, remainder ALREADY_RESERVED', async () => {
      const ledger = new Set<string>();
      const statefulDb = {
        prepare(_query: string) {
          return {
            bind(...params: unknown[]) {
              const replayKey = params[0] as string;
              return {
                async all() {
                  if (ledger.has(replayKey)) {
                    return { success: true, results: [], meta: { changes: 0 } };
                  }
                  ledger.add(replayKey);
                  return { success: true, results: [{ replay_key: replayKey }], meta: { changes: 1 } };
                },
              };
            },
          };
        },
      } as unknown as D1Database;

      const backend = new D1AuthorizationReplayBackend(statefulDb);
      const req = createValidTestReservationRequest();

      const results = await Promise.all([
        backend.reserveIfAbsent(req),
        backend.reserveIfAbsent(req),
        backend.reserveIfAbsent(req),
        backend.reserveIfAbsent(req),
      ]);

      const reservedCount = results.filter((r) => r.status === 'RESERVED').length;
      const alreadyReservedCount = results.filter((r) => r.status === 'ALREADY_RESERVED').length;

      expect(reservedCount).toBe(1);
      expect(alreadyReservedCount).toBe(3);
    });

    it('108. offline atomic rehearsal does NOT certify real Cloudflare D1 race conditions', () => {
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(false);
    });
  });

  // ==========================================================================
  // 16. STATIC ARCHITECTURE & SEALED FILE INVARIANTS
  // ==========================================================================
  describe('16. Static Architecture & Sealed File Invariants', () => {
    it('109. d1AuthorizationReplayBackend.ts contains INSERT, ON CONFLICT, DO NOTHING, RETURNING', () => {
      const adapterPath = path.resolve(process.cwd(), 'worker/ai/canary/d1AuthorizationReplayBackend.ts');
      expect(fs.existsSync(adapterPath)).toBe(true);
      const content = fs.readFileSync(adapterPath, 'utf8');

      expect(content).toContain('INSERT');
      expect(content).toContain('ON CONFLICT');
      expect(content).toContain('DO NOTHING');
      expect(content).toContain('RETURNING');
    });

    it('110. d1AuthorizationReplayBackend.ts contains NO inspection query, deletion, update, fetch, process.env', () => {
      const adapterPath = path.resolve(process.cwd(), 'worker/ai/canary/d1AuthorizationReplayBackend.ts');
      const content = fs.readFileSync(adapterPath, 'utf8');

      expect(content).not.toContain('SELECT');
      expect(content).not.toContain('DELETE');
      expect(content).not.toContain('UPDATE');
      expect(content).not.toContain('fetch(');
      expect(content).not.toContain('process.env');
    });

    it('111. wrangler.jsonc database_id remains placeholder/unprovisioned', () => {
      const wranglerPath = path.resolve(process.cwd(), 'wrangler.jsonc');
      expect(fs.existsSync(wranglerPath)).toBe(true);
      const content = fs.readFileSync(wranglerPath, 'utf8');
      expect(content).toContain('"database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"');
    });

    it('112. 5R durable backend bound gate remains strictly false', () => {
      expect(DURABLE_AUTHORIZATION_REPLAY_BACKEND_BOUND).toBe(false);
    });

    it('113. 5R atomic reserve if absent implemented gate remains strictly false', () => {
      expect(ATOMIC_RESERVE_IF_ABSENT_IMPLEMENTED).toBe(false);
    });
  });

  // ==========================================================================
  // 17. PHASE A.12B.2C-5T ARTIFACT INTEGRITY
  // ==========================================================================
  describe('17. Phase A.12B.2C-5T Artifact Integrity Check', () => {
    it('114. verifies execution/a12b2c5t_d1_durable_replay_backend_foundation.json integrity', () => {
      const artifactPath = path.resolve(
        process.cwd(),
        'execution/a12b2c5t_d1_durable_replay_backend_foundation.json'
      );
      expect(fs.existsSync(artifactPath)).toBe(true);
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

      expect(artifact.phase).toBe('A.12B.2C-5T');
      expect(artifact.artifactType).toBe(
        'CLOUDFLARE_D1_DURABLE_AUTHORIZATION_REPLAY_BACKEND_OFFLINE_FOUNDATION'
      );
      expect(artifact.baseCommit).toBe('2a205596fbb4dc680532c3a2e535031b2358eb79');
      expect(artifact.baseTree).toBe('1961f33f4ef09662abfe8f3c2921f31a32900c2c');
      expect(artifact.adapterVersion).toBe('a12b2c5t-v1');
      expect(artifact.migration).toBe('0008_authorization_replay_ledger.sql');
      expect(artifact.d1ReplayBackendAdapterImplemented).toBe(true);
      expect(artifact.singleStatementReserveIfAbsentImplemented).toBe(true);
      expect(artifact.precedingSelectUsed).toBe(false);
      expect(artifact.primaryKeyReplayConflictUsed).toBe(true);
      expect(artifact.onConflictDoNothingUsed).toBe(true);
      expect(artifact.returningReplayKeyUsed).toBe(true);
      expect(artifact.parameterBindingUsed).toBe(true);
      expect(artifact.genericDatabaseErrorsClassifiedAsDuplicate).toBe(false);
      expect(artifact.ambiguousDatabaseOutcomeFailsClosed).toBe(true);
      expect(artifact.synchronousCleanupImplemented).toBe(false);
      expect(artifact.appendOnlyInitialRetentionPolicy).toBe(true);
      expect(artifact.offlineAtomicClassificationRehearsed).toBe(true);
      expect(artifact.realD1ConcurrentRaceCertified).toBe(false);
      expect(artifact.realD1DatabaseProvisioned).toBe(false);
      expect(artifact.d1ProductionBindingProvisioned).toBe(false);
      expect(artifact.durableBackendBound).toBe(false);
      expect(artifact.atomicReserveIfAbsentOperationallyEnabled).toBe(false);
      expect(artifact.productionReplayReservationReady).toBe(false);
      expect(artifact.guardedTransportIntegrated).toBe(false);
      expect(artifact.sourceAttestationReady).toBe(false);
      expect(artifact.humanAuthorizationAttestationReady).toBe(false);
      expect(artifact.liveExecutionEnabled).toBe(false);
      expect(artifact.providerNetworkCalls).toBe(0);
      expect(artifact.externalNetworkCalls).toBe(0);
      expect(artifact.productionRoutingEnforcementAllowed).toBe(false);
      expect(artifact.successorActivated).toBe(false);
      expect(artifact.finalStatus).toBe(
        'A12B2C5T_D1_REPLAY_BACKEND_OFFLINE_FOUNDATION_PASS_PENDING_INDEPENDENT_SECURITY_REVIEW'
      );
    });
  });

  // ==========================================================================
  // 18. PHASE A.12B.2C-5T.1: RETURNING-CARDINALITY & METADATA HARDENING
  // ==========================================================================
  describe('18. Phase A.12B.2C-5T.1: RETURNING-Cardinality & Metadata Hardening', () => {
    it('A. 1 exact RETURNING replay_key row + meta.changes = 7 + changed_db = true + rows_written >= 1 still classifies RESERVED', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { changes: 7, changed_db: true, rows_written: 1 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(true);
      expect(res.status).toBe('RESERVED');
      expect(res.replayKey).toBe(req.replayKey);
    });

    it('B. 0 RETURNING rows + meta.changes = 7 + changed_db = false + rows_written = 0 classifies ALREADY_RESERVED', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [],
          meta: { changes: 7, changed_db: false, rows_written: 0 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('ALREADY_RESERVED');
      expect(res.replayKey).toBe(req.replayKey);
    });

    it('C. 1 row + changed_db false -> BACKEND_UNAVAILABLE', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { changed_db: false },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
    });

    it('D. 1 row + rows_written 0 -> BACKEND_UNAVAILABLE', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { rows_written: 0 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
    });

    it('E. 0 rows + changed_db true -> BACKEND_UNAVAILABLE', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [],
          meta: { changed_db: true },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
    });

    it('F. 0 rows + rows_written > 0 -> BACKEND_UNAVAILABLE', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [],
          meta: { rows_written: 2 },
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
    });

    it('G. returned row with extra field -> BACKEND_UNAVAILABLE', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey, injected: true }],
          meta: {},
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.errors[0]).toContain('D1_ROW_MALFORMED');
    });

    it('H. wrong replay_key -> BACKEND_UNAVAILABLE', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: '0'.repeat(64) }],
          meta: {},
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.errors[0]).toContain('D1_REPLAY_KEY_MISMATCH');
    });

    it('I. missing meta -> BACKEND_UNAVAILABLE', async () => {
      const req = createValidTestReservationRequest();
      const { db } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(req);
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.errors[0]).toContain('D1_META_INVALID');
    });

    it('J. weird/large meta.changes by itself cannot turn: RESERVED into ALREADY_RESERVED or vice-versa', async () => {
      const req = createValidTestReservationRequest();
      // 1 row + changes = 0 -> still RESERVED (not ALREADY_RESERVED)
      const { db: db1 } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { changes: 0 },
        },
      });
      const backend1 = new D1AuthorizationReplayBackend(db1);
      const res1 = await backend1.reserveIfAbsent(req);
      expect(res1.status).toBe('RESERVED');

      // 0 rows + changes = 1 -> still ALREADY_RESERVED (not RESERVED)
      const { db: db2 } = createMockD1Database({
        result: {
          success: true,
          results: [],
          meta: { changes: 1 },
        },
      });
      const backend2 = new D1AuthorizationReplayBackend(db2);
      const res2 = await backend2.reserveIfAbsent(req);
      expect(res2.status).toBe('ALREADY_RESERVED');

      // 1 row + changes = 999999 -> still RESERVED
      const { db: db3 } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: { changes: 999999 },
        },
      });
      const backend3 = new D1AuthorizationReplayBackend(db3);
      const res3 = await backend3.reserveIfAbsent(req);
      expect(res3.status).toBe('RESERVED');
    });

    it('K. generic UNIQUE exception remains BACKEND_UNAVAILABLE', async () => {
      const { db } = createMockD1Database({
        allThrows: new Error('UNIQUE constraint failed: authorization_replay_ledger.replay_key'),
      });
      const backend = new D1AuthorizationReplayBackend(db);
      const res = await backend.reserveIfAbsent(createValidTestReservationRequest());
      expect(res.success).toBe(false);
      expect(res.status).toBe('BACKEND_UNAVAILABLE');
      expect(res.status).not.toBe('ALREADY_RESERVED');
    });

    it('L. only one prepared SQL statement remains executed', async () => {
      const req = createValidTestReservationRequest();
      const { db, prepareCalls, allCalls } = createMockD1Database({
        result: {
          success: true,
          results: [{ replay_key: req.replayKey }],
          meta: {},
        },
      });
      const backend = new D1AuthorizationReplayBackend(db);
      await backend.reserveIfAbsent(req);
      expect(prepareCalls.length).toBe(1);
      expect(allCalls.count).toBe(1);
    });

    it('M. SQL still contains no SELECT', () => {
      expect(D1_AUTHORIZATION_REPLAY_RESERVATION_SQL).not.toMatch(/\bSELECT\b/i);
    });

    it('N. zero network/provider/real-D1 calls', () => {
      expect(globalFetchCalls).toBe(0);
    });

    it('O. verifies Phase A.12B.2C-5T.1 repair artifact integrity', () => {
      const artifactPath = path.resolve(
        process.cwd(),
        'execution/a12b2c5t1_d1_classifier_typescript_repair.json'
      );
      expect(fs.existsSync(artifactPath)).toBe(true);
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

      expect(artifact.phase).toBe('A.12B.2C-5T.1');
      expect(artifact.artifactType).toBe(
        'D1_RETURNING_CARDINALITY_CLASSIFIER_AND_TYPESCRIPT_FIXTURE_REPAIR'
      );
      expect(artifact.baseCommit).toBe('b6591afd01f298114ea68b877fa76778ffd07404');
      expect(artifact.baseTree).toBe('8af29d1fef2dc1c0528c93f1c0b17a87d39d5aa5');

      expect(artifact.codexSecurityReviewPassSuperseded).toBe(true);
      expect(artifact.returningCardinalityPrimaryClassifier).toBe(true);
      expect(artifact.metaChangesUsedAsExactClassifier).toBe(false);
      expect(artifact.changedDbUsedOnlyAsConsistencyEvidence).toBe(true);
      expect(artifact.rowsWrittenUsedOnlyAsConsistencyEvidence).toBe(true);
      expect(artifact.reservedRequiresExactReturnedReplayKey).toBe(true);
      expect(artifact.alreadyReservedRequiresSuccessfulZeroReturningRows).toBe(true);
      expect(artifact.genericDatabaseErrorsClassifiedAsDuplicate).toBe(false);
      expect(artifact.ambiguousDatabaseOutcomeFailsClosed).toBe(true);
      expect(artifact.signedAuthorizationPackageProductionSchemaModified).toBe(false);
      expect(artifact.stalePublicKeyFingerprintTestFixturePropertiesRemoved).toBe(true);
      expect(artifact.typescriptExcessPropertyRepairApplied).toBe(true);
      expect(artifact.migration0008Modified).toBe(false);

      expect(artifact.d1ProductionBindingProvisioned).toBe(false);
      expect(artifact.durableBackendBound).toBe(false);
      expect(artifact.productionReplayReservationReady).toBe(false);

      expect(artifact.realD1ConcurrentRaceCertified).toBe(false);
      expect(artifact.realD1DatabaseProvisioned).toBe(false);

      expect(artifact.guardedTransportIntegrated).toBe(false);
      expect(artifact.sourceAttestationReady).toBe(false);
      expect(artifact.humanAuthorizationAttestationReady).toBe(false);
      expect(artifact.liveExecutionEnabled).toBe(false);

      expect(artifact.providerNetworkCalls).toBe(0);
      expect(artifact.externalNetworkCalls).toBe(0);

      expect(artifact.productionRoutingEnforcementAllowed).toBe(false);
      expect(artifact.successorActivated).toBe(false);

      expect(artifact.finalStatus).toBe(
        'A12B2C5T1_D1_CLASSIFIER_TYPESCRIPT_REPAIR_PASS_PENDING_INDEPENDENT_VERIFICATION'
      );
    });
  });
});
