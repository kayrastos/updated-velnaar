import {
  createHash,
} from 'node:crypto';

import type {
  D1Database,
} from '@cloudflare/workers-types';

import {
  D1AuthorizationReplayBackend,
} from '../../../worker/ai/canary/d1AuthorizationReplayBackend';

import {
  DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
} from '../../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';

import type {
  AuthorizationReplayReservationRequest,
} from '../../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';

import type {
  GceQloraCapabilityReplayConsumeResult,
  GceQloraCapabilityReplayIdentity,
  GceQloraCapabilityReplayStore,
} from './gceQloraExecutorHandoff';

export const FULGOR_GCE_QLORA_CAPABILITY_REPLAY_DOMAIN =
  'FULGOR_GCE_QLORA_CAPABILITY_REPLAY_V1' as const;

export const FULGOR_GCE_QLORA_CAPABILITY_REPLAY_AUTHORITY_ID =
  'fulgor_gce_qlora_capability' as const;

export const FULGOR_GCE_QLORA_CAPABILITY_REPLAY_KEY_VERSION =
  'gce-qlora-capability-v1' as const;

const SHA256 =
  /^[a-f0-9]{64}$/;

const UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function sha256Text(
  value:
    string,
): string {
  return createHash(
    'sha256',
  )
    .update(
      value,
      'utf8',
    )
    .digest('hex');
}

function assertReplayIdentity(
  identity:
    Readonly<GceQloraCapabilityReplayIdentity>,
): void {
  if (
    !SHA256.test(
      identity.capabilityId,
    ) ||
    !SHA256.test(
      identity.payloadSha256,
    ) ||
    !UTC.test(
      identity.expiresAtUtc,
    )
  ) {
    throw new Error(
      'INVALID_GCE_QLORA_CAPABILITY_REPLAY_IDENTITY',
    );
  }

  const expiresAtMs =
    Date.parse(
      identity.expiresAtUtc,
    );

  if (
    !Number.isFinite(
      expiresAtMs,
    )
  ) {
    throw new Error(
      'INVALID_GCE_QLORA_CAPABILITY_REPLAY_EXPIRY',
    );
  }
}

export function computeFulgorGceQloraCapabilityReplayKey(
  identity:
    Readonly<GceQloraCapabilityReplayIdentity>,
): string {
  assertReplayIdentity(
    identity,
  );

  const canonical =
    JSON.stringify({
      domain:
        FULGOR_GCE_QLORA_CAPABILITY_REPLAY_DOMAIN,

      capabilityId:
        identity.capabilityId,

      capabilityPayloadSha256:
        identity.payloadSha256,
    });

  return sha256Text(
    canonical,
  );
}

export function buildFulgorGceQloraCapabilityReplayReservationRequest(
  identity:
    Readonly<GceQloraCapabilityReplayIdentity>,
): AuthorizationReplayReservationRequest {
  assertReplayIdentity(
    identity,
  );

  return Object.freeze({
    ledgerVersion:
      DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,

    replayKey:
      computeFulgorGceQloraCapabilityReplayKey(
        identity,
      ),

    /*
     * Existing ledger column name is authorization-specific,
     * but semantically this slot is the canonical signed payload
     * digest for this domain-separated replay reservation.
     */
    authorizationPayloadDigestSha256:
      identity.payloadSha256,

    authorityId:
      FULGOR_GCE_QLORA_CAPABILITY_REPLAY_AUTHORITY_ID,

    keyVersion:
      FULGOR_GCE_QLORA_CAPABILITY_REPLAY_KEY_VERSION,

    /*
     * capabilityId is a random 256-bit lowercase hex identifier.
     * It satisfies the canonical ledger nonce contract and never
     * carries signing secrets or authorization credentials.
     */
    runNonce:
      identity.capabilityId,

    expiresAt:
      identity.expiresAtUtc,
  });
}

export class D1GceQloraCapabilityReplayStore
implements GceQloraCapabilityReplayStore {
  private readonly backend:
    D1AuthorizationReplayBackend;

  constructor(
    db:
      D1Database,
  ) {
    this.backend =
      new D1AuthorizationReplayBackend(
        db,
      );
  }

  async consumeOnce(
    identity:
      Readonly<GceQloraCapabilityReplayIdentity>,
  ): Promise<GceQloraCapabilityReplayConsumeResult> {
    let request:
      AuthorizationReplayReservationRequest;

    try {
      request =
        buildFulgorGceQloraCapabilityReplayReservationRequest(
          identity,
        );
    }
    catch {
      return 'BACKEND_UNAVAILABLE';
    }

    try {
      const result =
        await this.backend
          .reserveIfAbsent(
            request,
          );

      if (
        result.success ===
          true &&
        result.status ===
          'RESERVED'
      ) {
        return 'CONSUMED';
      }

      if (
        result.success ===
          false &&
        result.status ===
          'ALREADY_RESERVED'
      ) {
        return 'ALREADY_CONSUMED';
      }

      return 'BACKEND_UNAVAILABLE';
    }
    catch {
      return 'BACKEND_UNAVAILABLE';
    }
  }
}