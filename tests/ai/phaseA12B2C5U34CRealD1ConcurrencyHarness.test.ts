/**
 * @file tests/ai/phaseA12B2C5U34CRealD1ConcurrencyHarness.test.ts
 * @description Unit, boundary, and safety verification for R4 D1 Concurrency Certification Harness.
 * Phase: A.12B.2C-5U.3.4C
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import worker, {
  deriveCertificationReservationRequest,
  R4_BATCH_ID,
  R4_BATCH_HEX,
  R4_EXPIRES_AT,
  R4_AUTHORITY_ID,
  R4_KEY_VERSION,
} from '../../scripts/r4D1ConcurrencyCertificationWorker';
import { validateAuthorizationReplayReservationRequest } from '../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';
import type { D1Database } from '@cloudflare/workers-types';

// Mock D1 Database
function createMockD1Database(mockResult?: unknown) {
  const prepareCalls: { query: string }[] = [];
  const bindCalls: { params: unknown[] }[] = [];

  const db = {
    prepare(query: string) {
      prepareCalls.push({ query });
      return {
        bind(...params: unknown[]) {
          bindCalls.push({ params });
          return {
            async all() {
              if (mockResult !== undefined) {
                return mockResult;
              }
              return {
                success: true,
                results: [{ replay_key: params[0] }],
                meta: { changed_db: true, rows_written: 1 },
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, prepareCalls, bindCalls };
}

describe('Phase A.12B.2C-5U.3.4C: R4 D1 Concurrency Certification Harness', () => {
  const TEST_TOKEN = 'test_token_r4_secret_0123456789abcdef';

  describe('1. Canonical Reservation Request Derivation & Key Uniqueness', () => {
    it('contested round: all 32 contenders derive the EXACT SAME canonical request', () => {
      for (let round = 1; round <= 20; round++) {
        const roundRequests = [];
        for (let contender = 1; contender <= 32; contender++) {
          const req = deriveCertificationReservationRequest('contested', round, contender);
          roundRequests.push(req);
        }

        const firstReqSerialized = JSON.stringify(roundRequests[0]);
        for (let i = 1; i < 32; i++) {
          expect(JSON.stringify(roundRequests[i])).toBe(firstReqSerialized);
        }

        // Validate canonical request schema against durable ledger contract
        const validation = validateAuthorizationReplayReservationRequest(roundRequests[0]);
        expect(validation.valid).toBe(true);
        expect(validation.errors).toEqual([]);
      }
    });

    it('control matrix: exactly 640 unique canonical requests across 20 rounds x 32 contenders', () => {
      const controlKeys = new Set<string>();
      const controlNonces = new Set<string>();

      for (let round = 1; round <= 20; round++) {
        for (let contender = 1; contender <= 32; contender++) {
          const req = deriveCertificationReservationRequest('control', round, contender);
          controlKeys.add(req.replayKey);
          controlNonces.add(req.runNonce);

          const validation = validateAuthorizationReplayReservationRequest(req);
          expect(validation.valid).toBe(true);
        }
      }

      expect(controlKeys.size).toBe(640);
      expect(controlNonces.size).toBe(640);
    });

    it('combined hard maximum: exactly 660 unique replay keys across all valid inputs', () => {
      const allKeys = new Set<string>();

      // 20 contested rounds
      for (let round = 1; round <= 20; round++) {
        for (let contender = 1; contender <= 32; contender++) {
          const req = deriveCertificationReservationRequest('contested', round, contender);
          allKeys.add(req.replayKey);
        }
      }
      expect(allKeys.size).toBe(20);

      // 640 control requests
      for (let round = 1; round <= 20; round++) {
        for (let contender = 1; contender <= 32; contender++) {
          const req = deriveCertificationReservationRequest('control', round, contender);
          allKeys.add(req.replayKey);
        }
      }
      expect(allKeys.size).toBe(660);
    });

    it('rejects round outside 1..20', () => {
      expect(() => deriveCertificationReservationRequest('contested', 0, 1)).toThrow(/ROUND_OUT_OF_BOUNDS/);
      expect(() => deriveCertificationReservationRequest('contested', 21, 1)).toThrow(/ROUND_OUT_OF_BOUNDS/);
      expect(() => deriveCertificationReservationRequest('contested', 1.5 as any, 1)).toThrow(/ROUND_OUT_OF_BOUNDS/);
    });

    it('rejects contender outside 1..32', () => {
      expect(() => deriveCertificationReservationRequest('control', 1, 0)).toThrow(/CONTENDER_OUT_OF_BOUNDS/);
      expect(() => deriveCertificationReservationRequest('control', 1, 33)).toThrow(/CONTENDER_OUT_OF_BOUNDS/);
      expect(() => deriveCertificationReservationRequest('control', 1, 2.5 as any)).toThrow(/CONTENDER_OUT_OF_BOUNDS/);
    });

    it('rejects invalid mode', () => {
      expect(() => deriveCertificationReservationRequest('unknown' as any, 1, 1)).toThrow(/MODE_INVALID/);
    });
  });

  describe('2. Temporary Worker Boundary & Attack-Surface Verification', () => {
    it('denies unauthenticated request with 401', async () => {
      const { db } = createMockD1Database();
      const req = new Request('http://localhost/r4/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'contested', round: 1, contender: 1 }),
      });

      const res = await worker.fetch(req, { DB: db, R4_CERT_TOKEN: TEST_TOKEN });
      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('denies request with wrong bearer token with 401', async () => {
      const { db } = createMockD1Database();
      const req = new Request('http://localhost/r4/reserve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong_token',
        },
        body: JSON.stringify({ mode: 'contested', round: 1, contender: 1 }),
      });

      const res = await worker.fetch(req, { DB: db, R4_CERT_TOKEN: TEST_TOKEN });
      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('denies non-POST methods with 405 Method Not Allowed', async () => {
      const { db } = createMockD1Database();
      for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
        const req = new Request('http://localhost/r4/reserve', {
          method,
          headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        });

        const res = await worker.fetch(req, { DB: db, R4_CERT_TOKEN: TEST_TOKEN });
        expect(res.status).toBe(405);
      }
    });

    it('denies paths other than /r4/reserve with 404 Not Found', async () => {
      const { db } = createMockD1Database();
      for (const pathname of ['/', '/api/health', '/r4', '/reserve', '/r4/reserve/sub']) {
        const req = new Request(`http://localhost${pathname}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`,
          },
          body: JSON.stringify({ mode: 'contested', round: 1, contender: 1 }),
        });

        const res = await worker.fetch(req, { DB: db, R4_CERT_TOKEN: TEST_TOKEN });
        expect(res.status).toBe(404);
      }
    });

    it('denies request body containing unexpected keys (e.g. replayKey injection)', async () => {
      const { db } = createMockD1Database();
      const forbiddenInjections = [
        { mode: 'contested', round: 1, contender: 1, replayKey: 'custom_key' },
        { mode: 'contested', round: 1, contender: 1, authorityId: 'custom_auth' },
        { mode: 'contested', round: 1, contender: 1, sql: 'SELECT 1;' },
        { mode: 'contested', round: 1, contender: 1, database: 'db' },
        { mode: 'contested', round: 1, contender: 1, expiresAt: '2099-01-01T00:00:00.000Z' },
      ];

      for (const forbiddenBody of forbiddenInjections) {
        const req = new Request('http://localhost/r4/reserve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`,
          },
          body: JSON.stringify(forbiddenBody),
        });

        const res = await worker.fetch(req, { DB: db, R4_CERT_TOKEN: TEST_TOKEN });
        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error).toBe('INVALID_REQUEST');
      }
    });

    it('successfully processes valid request and invokes canonical D1 backend', async () => {
      const { db, prepareCalls } = createMockD1Database();
      const req = new Request('http://localhost/r4/reserve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({ mode: 'contested', round: 1, contender: 1 }),
      });

      const res = await worker.fetch(req, { DB: db, R4_CERT_TOKEN: TEST_TOKEN });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.mode).toBe('contested');
      expect(body.round).toBe(1);
      expect(body.contender).toBe(1);
      expect(body.status).toBe('RESERVED');
      expect(prepareCalls.length).toBe(1);
      expect(prepareCalls[0].query).toContain('INSERT INTO authorization_replay_ledger');
    });
  });

  describe('3. Source Inspection & Safety Invariants', () => {
    it('confirms certification worker source contains NO external AI provider imports', () => {
      const workerPath = path.resolve(__dirname, '../../scripts/r4D1ConcurrencyCertificationWorker.ts');
      const source = fs.readFileSync(workerPath, 'utf8');

      expect(source).not.toContain('@google/genai');
      expect(source).not.toContain('deepseek');
      expect(source).not.toContain('gemini');
      expect(source).not.toContain('kimi');
      expect(source).not.toContain('openai');
      expect(source).not.toContain('anthropic');
      expect(source).not.toContain('DEEPSEEK_API_KEY');
      expect(source).not.toContain('GEMINI_API_KEY');
      expect(source).not.toContain('KIMI_API_KEY');
    });

    it('confirms certification worker imports and invokes canonical D1AuthorizationReplayBackend', () => {
      const workerPath = path.resolve(__dirname, '../../scripts/r4D1ConcurrencyCertificationWorker.ts');
      const source = fs.readFileSync(workerPath, 'utf8');

      expect(source).toContain("import { D1AuthorizationReplayBackend } from '../worker/ai/canary/d1AuthorizationReplayBackend'");
      expect(source).toContain('new D1AuthorizationReplayBackend(env.DB)');
      expect(source).toContain('backend.reserveIfAbsent(reservationRequest)');
    });
  });
});
