/**
 * @file scripts/r4D1ConcurrencyCertificationWorker.ts
 * @description Temporary provider-free D1 Concurrency Certification Worker.
 * Phase: A.12B.2C-5U.3.4C
 *
 * STRICT SAFETY INVARIANTS:
 * - Direct invocation of canonical D1AuthorizationReplayBackend.reserveIfAbsent(...)
 * - ZERO direct raw SQL INSERT statements
 * - ZERO AI bindings, models, or provider credentials
 * - ZERO routes, custom domains, or external network calls
 * - Hard maximum distinct replay keys = 660 (20 contested + 640 control)
 * - Strict authentication via ephemeral R4_CERT_TOKEN
 * - Fail-closed on any malformed or unexpected request
 */

import type { D1Database } from '@cloudflare/workers-types';
import crypto from 'node:crypto';
import { D1AuthorizationReplayBackend } from '../worker/ai/canary/d1AuthorizationReplayBackend';
import {
  DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
  type AuthorizationReplayReservationRequest,
} from '../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';

// ============================================================================
// 1. BOUNDED BATCH PARAMETERS
// ============================================================================

export const R4_BATCH_ID = 'r4cert_da0d929f4a15a225' as const;
export const R4_BATCH_HEX = 'da0d929f4a15a225' as const;
export const R4_EXPIRES_AT = '2026-09-11T18:57:51.148Z' as const;
export const R4_AUTHORITY_ID = R4_BATCH_ID;
export const R4_KEY_VERSION = 'r4-v1' as const;

export interface Env {
  DB: D1Database;
  R4_CERT_TOKEN?: string;
}

// ============================================================================
// 2. CANONICAL RESERVATION REQUEST DERIVATION
// ============================================================================

/**
 * Derives a canonical AuthorizationReplayReservationRequest from bounded coordinates.
 * Client has ZERO control over replayKey, authorityId, runNonce, or expiresAt.
 */
export function deriveCertificationReservationRequest(
  mode: 'contested' | 'control',
  round: number,
  contender: number
): AuthorizationReplayReservationRequest {
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 1 || round > 20) {
    throw new Error('ROUND_OUT_OF_BOUNDS: round must be an integer between 1 and 20');
  }
  if (typeof contender !== 'number' || !Number.isInteger(contender) || contender < 1 || contender > 32) {
    throw new Error('CONTENDER_OUT_OF_BOUNDS: contender must be an integer between 1 and 32');
  }

  const roundPad = String(round).padStart(2, '0');

  if (mode === 'contested') {
    // In contested mode, all 32 contenders in the same round derive the EXACT SAME canonical request.
    const runNonce = `r4c_${R4_BATCH_HEX}_r${roundPad}_shared`;
    const replayKey = crypto
      .createHash('sha256')
      .update(`r4:contested:${R4_BATCH_ID}:${roundPad}`)
      .digest('hex');
    const authorizationPayloadDigestSha256 = crypto
      .createHash('sha256')
      .update(`r4:payload:contested:${R4_BATCH_ID}:${roundPad}`)
      .digest('hex');

    return {
      ledgerVersion: DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
      replayKey,
      authorizationPayloadDigestSha256,
      authorityId: R4_AUTHORITY_ID,
      keyVersion: R4_KEY_VERSION,
      runNonce,
      expiresAt: R4_EXPIRES_AT,
    };
  } else if (mode === 'control') {
    // In control mode, each round + contender pair derives a distinct canonical request.
    const contenderPad = String(contender).padStart(2, '0');
    const runNonce = `r4u_${R4_BATCH_HEX}_r${roundPad}_c${contenderPad}`;
    const replayKey = crypto
      .createHash('sha256')
      .update(`r4:control:${R4_BATCH_ID}:${roundPad}:${contenderPad}`)
      .digest('hex');
    const authorizationPayloadDigestSha256 = crypto
      .createHash('sha256')
      .update(`r4:payload:control:${R4_BATCH_ID}:${roundPad}:${contenderPad}`)
      .digest('hex');

    return {
      ledgerVersion: DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
      replayKey,
      authorizationPayloadDigestSha256,
      authorityId: R4_AUTHORITY_ID,
      keyVersion: R4_KEY_VERSION,
      runNonce,
      expiresAt: R4_EXPIRES_AT,
    };
  } else {
    throw new Error("MODE_INVALID: mode must be 'contested' or 'control'");
  }
}

// ============================================================================
// 3. WORKER FETCH HANDLER
// ============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Path enforcement: /r4/reserve only
    if (url.pathname !== '/r4/reserve') {
      return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Method enforcement: POST only
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Bearer authentication enforcement
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bearerToken = authHeader.slice(7).trim();
    if (!env.R4_CERT_TOKEN || bearerToken !== env.R4_CERT_TOKEN) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Request body parsing & strict schema verification
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'INVALID_JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: 'INVALID_REQUEST' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const record = body as Record<string, unknown>;
    const keys = Object.keys(record);

    // Endpoint body must contain EXACTLY: mode, round, contender (no additional keys)
    if (
      keys.length !== 3 ||
      !keys.includes('mode') ||
      !keys.includes('round') ||
      !keys.includes('contender')
    ) {
      return new Response(JSON.stringify({ error: 'INVALID_REQUEST' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { mode, round, contender } = record;

    if (mode !== 'contested' && mode !== 'control') {
      return new Response(JSON.stringify({ error: 'INVALID_REQUEST' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof round !== 'number' || !Number.isInteger(round) || round < 1 || round > 20) {
      return new Response(JSON.stringify({ error: 'INVALID_REQUEST' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof contender !== 'number' || !Number.isInteger(contender) || contender < 1 || contender > 32) {
      return new Response(JSON.stringify({ error: 'INVALID_REQUEST' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Derive canonical reservation request (server-derived; client cannot choose key)
    let reservationRequest: AuthorizationReplayReservationRequest;
    try {
      reservationRequest = deriveCertificationReservationRequest(mode, round, contender);
    } catch {
      return new Response(JSON.stringify({ error: 'DERIVATION_FAILED' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 6. Execute reservation via canonical D1AuthorizationReplayBackend
    try {
      const backend = new D1AuthorizationReplayBackend(env.DB);
      const result = await backend.reserveIfAbsent(reservationRequest);

      const cf = (request as unknown as { cf?: { colo?: string } }).cf;
      const colo = cf?.colo || 'UNKNOWN';

      return new Response(
        JSON.stringify({
          mode,
          round,
          contender,
          status: result.status,
          colo,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch {
      return new Response(JSON.stringify({ error: 'BACKEND_EXECUTION_EXCEPTION' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
