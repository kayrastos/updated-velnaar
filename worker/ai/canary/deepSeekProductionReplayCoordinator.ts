/**
 * @file worker/ai/canary/deepSeekProductionReplayCoordinator.ts
 * @description VELNAR — A.12B.2C-5U.1 Production Human Authorization & D1 Replay Coordinator Foundation.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS & INVARIANTS:
 * - PURE OFFLINE COORDINATOR FOUNDATION ONLY.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO provider calls or network dispatch.
 * - ZERO provider credentials (no API keys, no bearer tokens, no secret readers).
 * - ZERO real D1 calls or external cloud resource creation.
 * - Strict 3-parameter typed API: (db, pkg, sourceReceipt).
 * - ZERO options object, ZERO variadic parameters.
 * - ZERO caller-supplied backend, storage adapter, clock, replayKey, or verification override.
 * - Internal cryptographic verification order:
 *     1. verifyProductionRuntimeSourceProvenanceReceipt(sourceReceipt)
 *     2. Internally derive TrustedSourceAttestation via buildTrustedSourceAttestation (using sealed repository identity)
 *     3. validateTrustedSourceAttestation(derivedAttestation)
 *     4. buildProductionReplayReservationAfterAuthorizationVerification(pkg, derivedAttestation)
 *     5. D1 production readiness barrier check
 *     6. Awaited single-statement D1 reserve-if-absent execution
 *     7. Post-reservation runtime authorization expiry recheck
 * - READY_FOR_CREDENTIAL_RESOLUTION is not a portable trust token and must never
 *   be accepted as caller-supplied authorization evidence.
 * - Diagnostic output only; does not provide a reusable capability to guarded transport.
 * - Single-attempt policy: zero retries, zero rollbacks, zero compensating removal operations.
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
  type SignedHumanAuthorizationPackage,
  type TrustedSourceAttestation,
  buildTrustedSourceAttestation,
  validateTrustedSourceAttestation,
} from './deepSeekCertificationAttestation';
import {
  type RuntimeSourceProvenanceReceipt,
  verifyProductionRuntimeSourceProvenanceReceipt,
} from './deepSeekTrustedRuntimeSourceProvenance';
import {
  buildProductionReplayReservationAfterAuthorizationVerification,
} from './deepSeekDurableAuthorizationReplayLedger';
import {
  D1AuthorizationReplayBackend,
  D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED,
  D1_REPLAY_BACKEND_PRODUCTION_BOUND,
  D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED,
  D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED,
} from './d1AuthorizationReplayBackend';

// ============================================================================
// 1. MODULE CONSTANTS & FORBIDDEN PARAMETERS
// ============================================================================

export const PRODUCTION_REPLAY_COORDINATOR_VERSION = 'a12b2c5u1-v1' as const;

export const FORBIDDEN_COORDINATOR_CALLER_KEYS = Object.freeze([
  'backend',
  'storage',
  'adapter',
  'replayStore',
  'dbOverride',
  'reservationResult',
  'verified',
  'authorized',
  'alreadyVerified',
  'alreadyReserved',
  'replayAllowed',
  'replayVerified',
  'replayKey',
  'nowUtc',
  'currentTimeUtc',
  'clock',
  'sourceAttestation',
  'apiKey',
  'credential',
  'credentials',
  'skipReplayCheck',
  'forceReserve',
  'bypass',
] as const);

// ============================================================================
// 2. RESULT STATUS UNION & DISCRIMINATED RESULT CONTRACT
// ============================================================================

export type ProductionReplayCoordinationStatus =
  | 'SOURCE_PROVENANCE_NOT_VERIFIED'
  | 'SOURCE_ATTESTATION_DERIVATION_FAILED'
  | 'AUTHORIZATION_NOT_VERIFIED'
  | 'AUTHORIZATION_EXPIRED'
  | 'CANONICAL_REPLAY_REQUEST_INVALID'
  | 'D1_BACKEND_NOT_READY'
  | 'REPLAY_ALREADY_RESERVED'
  | 'REPLAY_BACKEND_UNAVAILABLE'
  | 'REPLAY_BACKEND_NOT_READY'
  | 'REPLAY_INVALID_REQUEST'
  | 'AUTHORIZATION_EXPIRED_AFTER_RESERVATION'
  | 'READY_FOR_CREDENTIAL_RESOLUTION';

export type ProductionReplayCoordinationResult =
  | {
      readonly readyForCredentialResolution: false;
      readonly status: Exclude<ProductionReplayCoordinationStatus, 'READY_FOR_CREDENTIAL_RESOLUTION'>;
      readonly errors: readonly string[];
      readonly failureReason: string;
      readonly replayKey?: string;
      readonly expiresAt?: string;
    }
  | {
      readonly readyForCredentialResolution: true;
      readonly status: 'READY_FOR_CREDENTIAL_RESOLUTION';
      readonly errors?: never;
      readonly failureReason?: never;
      readonly replayKey: string;
      readonly expiresAt: string;
    };

// ============================================================================
// 3. PRIMARY PRODUCTION REPLAY COORDINATOR API
// ============================================================================

/**
 * Authoritative production coordinator orchestrating:
 * Runtime Source Receipt Verification
 * -> Internal Trusted Source Attestation Derivation
 * -> Production Human Authorization Verification
 * -> Canonical Replay Reservation Request Construction
 * -> D1 Production Readiness Barrier Check
 * -> Awaited D1 Atomic Reserve-If-Absent Execution
 * -> Post-Reservation Runtime Expiry Recheck
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Exactly 3 typed parameters: db, pkg, sourceReceipt.
 * 2. Does NOT accept caller-supplied source attestation or backend adapters.
 * 3. READY_FOR_CREDENTIAL_RESOLUTION is not a portable trust token and must never
 *    be accepted as caller-supplied authorization evidence.
 * 4. Fails closed immediately at any stage without retries or compensating queries.
 */
export async function coordinateProductionReplayReservation(
  db: D1Database,
  pkg: SignedHumanAuthorizationPackage,
  sourceReceipt: RuntimeSourceProvenanceReceipt
): Promise<ProductionReplayCoordinationResult> {
  // Step 0: Strict 3-parameter enforcement (reject extra or missing arguments)
  if (arguments.length !== 3) {
    return {
      readyForCredentialResolution: false,
      status: 'REPLAY_INVALID_REQUEST',
      errors: [
        `FORBIDDEN_CALLER_PARAMETER: coordinateProductionReplayReservation accepts exactly 3 parameters (got ${arguments.length})`,
      ],
      failureReason: `FORBIDDEN_CALLER_PARAMETER: expected exactly 3 parameters, got ${arguments.length}`,
    };
  }

  // Reject caller override injection fields on pkg
  if (pkg && typeof pkg === 'object') {
    const pkgRec = pkg as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN_COORDINATOR_CALLER_KEYS) {
      if (key in pkgRec) {
        return {
          readyForCredentialResolution: false,
          status: 'REPLAY_INVALID_REQUEST',
          errors: [`FORBIDDEN_CALLER_OVERRIDE: parameter '${key}' is strictly prohibited on authorization package`],
          failureReason: `FORBIDDEN_CALLER_OVERRIDE: parameter '${key}' is strictly prohibited`,
        };
      }
    }
  }

  // Reject caller override injection fields on sourceReceipt
  if (sourceReceipt && typeof sourceReceipt === 'object') {
    const receiptRec = sourceReceipt as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN_COORDINATOR_CALLER_KEYS) {
      if (key in receiptRec) {
        return {
          readyForCredentialResolution: false,
          status: 'REPLAY_INVALID_REQUEST',
          errors: [`FORBIDDEN_CALLER_OVERRIDE: parameter '${key}' is strictly prohibited on source receipt`],
          failureReason: `FORBIDDEN_CALLER_OVERRIDE: parameter '${key}' is strictly prohibited`,
        };
      }
    }
  }

  // Step 1: Verify Production Runtime Source Provenance Receipt internally
  const sourceVerification = verifyProductionRuntimeSourceProvenanceReceipt(sourceReceipt);
  if (!sourceVerification || sourceVerification.valid !== true) {
    return {
      readyForCredentialResolution: false,
      status: 'SOURCE_PROVENANCE_NOT_VERIFIED',
      errors: sourceVerification?.errors && sourceVerification.errors.length > 0
        ? sourceVerification.errors
        : ['SOURCE_PROVENANCE_NOT_VERIFIED: Runtime source provenance verification failed.'],
      failureReason: sourceVerification?.failureReason ?? 'SOURCE_PROVENANCE_NOT_VERIFIED',
    };
  }

  // Step 2: Internally derive TrustedSourceAttestation from verified source receipt
  // CRITICAL: repositoryIdentity is NOT passed from sourceReceipt.repositoryFullName.
  // It uses SEALED_REPOSITORY_IDENTITY inside buildTrustedSourceAttestation.
  let derivedSourceAttestation: TrustedSourceAttestation;
  try {
    derivedSourceAttestation = buildTrustedSourceAttestation({
      sourceCommitSha: sourceReceipt.sourceCommitSha,
      sourceTreeSha: sourceReceipt.sourceTreeSha,
      createdAt: sourceReceipt.issuedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      readyForCredentialResolution: false,
      status: 'SOURCE_ATTESTATION_DERIVATION_FAILED',
      errors: [`SOURCE_ATTESTATION_DERIVATION_FAILED: ${message}`],
      failureReason: `SOURCE_ATTESTATION_DERIVATION_FAILED: ${message}`,
    };
  }

  // Step 3: Immediately validate the internally derived source attestation
  const attestationValidation = validateTrustedSourceAttestation(derivedSourceAttestation);
  if (!attestationValidation || attestationValidation.valid !== true) {
    return {
      readyForCredentialResolution: false,
      status: 'SOURCE_ATTESTATION_DERIVATION_FAILED',
      errors: attestationValidation?.errors && attestationValidation.errors.length > 0
        ? attestationValidation.errors
        : ['SOURCE_ATTESTATION_DERIVATION_FAILED: Internally derived attestation failed validation.'],
      failureReason: attestationValidation?.failureReason ?? 'SOURCE_ATTESTATION_DERIVATION_FAILED',
    };
  }

  // Step 4: Production human authorization orchestration boundary
  // Verifies signature, checks runtime expiry, builds and validates canonical reservation request.
  const orchestration = buildProductionReplayReservationAfterAuthorizationVerification(
    pkg,
    derivedSourceAttestation
  );

  if (!orchestration || orchestration.ready !== true) {
    let mappedStatus: Exclude<ProductionReplayCoordinationStatus, 'READY_FOR_CREDENTIAL_RESOLUTION'>;
    if (orchestration?.status === 'AUTHORIZATION_EXPIRED') {
      mappedStatus = 'AUTHORIZATION_EXPIRED';
    } else if (orchestration?.status === 'CANONICAL_REPLAY_REQUEST_INVALID') {
      mappedStatus = 'CANONICAL_REPLAY_REQUEST_INVALID';
    } else {
      mappedStatus = 'AUTHORIZATION_NOT_VERIFIED';
    }

    const reason = orchestration?.failureReason ?? mappedStatus;
    return {
      readyForCredentialResolution: false,
      status: mappedStatus,
      errors: [reason],
      failureReason: reason,
    };
  }

  const replayRequest = orchestration.request;

  // Step 5: D1 Production Readiness Barrier
  // Only reached AFTER source verification, attestation validation, and human authorization pass.
  if (
    !D1_REPLAY_BACKEND_ADAPTER_IMPLEMENTED ||
    !D1_REPLAY_BACKEND_PRODUCTION_BOUND ||
    !D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED ||
    !D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED
  ) {
    return {
      readyForCredentialResolution: false,
      status: 'D1_BACKEND_NOT_READY',
      errors: [
        'D1_BACKEND_NOT_READY: Cloudflare D1 durable replay backend is not ready for production execution.',
      ],
      failureReason: 'D1_BACKEND_NOT_READY',
      replayKey: replayRequest.replayKey,
      expiresAt: replayRequest.expiresAt,
    };
  }

  // Step 6: Validate D1Database handle readiness
  if (!db || typeof db.prepare !== 'function') {
    return {
      readyForCredentialResolution: false,
      status: 'D1_BACKEND_NOT_READY',
      errors: ['D1_DATABASE_HANDLE_INVALID: db must be a valid D1Database capability.'],
      failureReason: 'D1_DATABASE_HANDLE_INVALID',
      replayKey: replayRequest.replayKey,
      expiresAt: replayRequest.expiresAt,
    };
  }

  // Step 7: Instantiate D1 adapter internally & execute single-statement atomic reservation
  const backend = new D1AuthorizationReplayBackend(db);
  const reservation = await backend.reserveIfAbsent(replayRequest);

  if (!reservation || reservation.success !== true || reservation.status !== 'RESERVED') {
    let mappedStatus: Exclude<ProductionReplayCoordinationStatus, 'READY_FOR_CREDENTIAL_RESOLUTION'>;
    if (reservation?.status === 'ALREADY_RESERVED') {
      mappedStatus = 'REPLAY_ALREADY_RESERVED';
    } else if (reservation?.status === 'BACKEND_NOT_BOUND') {
      mappedStatus = 'REPLAY_BACKEND_NOT_READY';
    } else if (reservation?.status === 'INVALID_REQUEST') {
      mappedStatus = 'REPLAY_INVALID_REQUEST';
    } else {
      mappedStatus = 'REPLAY_BACKEND_UNAVAILABLE';
    }

    return {
      readyForCredentialResolution: false,
      status: mappedStatus,
      errors: reservation?.errors && reservation.errors.length > 0 ? reservation.errors : [mappedStatus],
      failureReason: reservation?.errors?.[0] ?? mappedStatus,
      replayKey: replayRequest.replayKey,
      expiresAt: replayRequest.expiresAt,
    };
  }

  // Step 8: Post-Reservation Runtime Expiry Recheck
  // Fresh internal runtime clock observation immediately after D1 reservation round-trip.
  const expiresAtMs = Date.parse(pkg.payload.expiresAt);
  const postReservationNowMs = Date.now();

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= postReservationNowMs) {
    return {
      readyForCredentialResolution: false,
      status: 'AUTHORIZATION_EXPIRED_AFTER_RESERVATION',
      errors: [
        `AUTHORIZATION_EXPIRED_AFTER_RESERVATION: Authorization expired at ${pkg.payload.expiresAt} during D1 round-trip (evaluated ${postReservationNowMs} >= ${expiresAtMs}). Replay reservation remains consumed in ledger. Zero credentials read.`,
      ],
      failureReason: 'AUTHORIZATION_EXPIRED_AFTER_RESERVATION',
      replayKey: replayRequest.replayKey,
      expiresAt: replayRequest.expiresAt,
    };
  }

  // Step 9: Replay reservation verified and consumed; diagnostic readiness returned
  return {
    readyForCredentialResolution: true,
    status: 'READY_FOR_CREDENTIAL_RESOLUTION',
    replayKey: replayRequest.replayKey,
    expiresAt: replayRequest.expiresAt,
  };
}
