import {
  createHash,
} from 'node:crypto';

import type {
  D1Database,
} from '@cloudflare/workers-types';

import {
  D1AuthorizationReplayBackend,
} from '../../../../worker/ai/canary/d1AuthorizationReplayBackend';

import {
  DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,
} from '../../../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';

import type {
  AuthorizationReplayReservationRequest,
} from '../../../../worker/ai/canary/deepSeekDurableAuthorizationReplayLedger';

import type {
  TrainingAuthorizationReplayConsumeResult,
  TrainingAuthorizationReplayStore,
  TrainingExecutionAuthorization,
} from './trainingExecutionAuthorization';

export const FULGOR_TRAINING_REPLAY_DOMAIN =
  'FULGOR_TRAINING_EXECUTION_REPLAY_V1' as const;

export const FULGOR_TRAINING_REPLAY_AUTHORITY_ID =
  'fulgor_training_execution' as const;

function sha256Text(
  value: string,
): string {
  return createHash('sha256')
    .update(
      value,
      'utf8',
    )
    .digest('hex');
}

export function computeFulgorTrainingAuthorizationReplayKey(
  authorization:
    Readonly<TrainingExecutionAuthorization>,
): string {
  const canonical =
    JSON.stringify({
      domain:
        FULGOR_TRAINING_REPLAY_DOMAIN,

      authorizationPayloadDigestSha256:
        authorization.payloadSha256,

      signerKeyId:
        authorization.signerKeyId,

      signerPublicKeySha256:
        authorization.signerPublicKeySha256,

      nonce:
        authorization.nonce,
    });

  return sha256Text(
    canonical,
  );
}

export function buildFulgorD1ReplayReservationRequest(
  authorization:
    Readonly<TrainingExecutionAuthorization>,
): AuthorizationReplayReservationRequest {
  const replayKey =
    computeFulgorTrainingAuthorizationReplayKey(
      authorization,
    );

  /*
   * D1 key_version is storage metadata.
   * It is deterministically bound to the actual signing public key
   * without trusting caller-controlled formatting.
   */
  const keyVersion =
    `fulgor-${authorization
      .signerPublicKeySha256
      .slice(0, 32)}`;

  return Object.freeze({
    ledgerVersion:
      DURABLE_AUTHORIZATION_REPLAY_LEDGER_VERSION,

    replayKey,

    authorizationPayloadDigestSha256:
      authorization.payloadSha256,

    authorityId:
      FULGOR_TRAINING_REPLAY_AUTHORITY_ID,

    keyVersion,

    runNonce:
      authorization.nonce,

    expiresAt:
      authorization.expiresAtUtc,
  });
}

export class D1TrainingAuthorizationReplayStore
implements TrainingAuthorizationReplayStore {
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
    authorization:
      Readonly<TrainingExecutionAuthorization>,
  ): Promise<TrainingAuthorizationReplayConsumeResult> {
    let request:
      AuthorizationReplayReservationRequest;

    try {
      request =
        buildFulgorD1ReplayReservationRequest(
          authorization,
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
        result.success === true &&
        result.status ===
          'RESERVED'
      ) {
        return 'CONSUMED';
      }

      if (
        result.success === false &&
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
