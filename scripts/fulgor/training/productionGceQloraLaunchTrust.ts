import {
  createPublicKey,
} from 'node:crypto';

import type {
  KeyObject,
} from 'node:crypto';

/*
 * Production verification authority for signed GCE QLoRA
 * launch capabilities.
 *
 * Deliberately unprovisioned.
 *
 * Only PUBLIC key material may ever be placed here.
 * Private signing keys MUST remain outside the repository
 * and outside distributable training containers.
 */
export const PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_TRUST_ANCHOR_PROVISIONED =
  false as const;

const PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_KEY_ID:
  string | null =
    null;

const PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_PUBLIC_KEY_PEM:
  string | null =
    null;

export interface ProductionGceQloraLaunchTrust {
  keyId:
    string;

  publicKey:
    KeyObject;
}

export function resolveProductionGceQloraLaunchTrust():
  ProductionGceQloraLaunchTrust | null {
  if (
    !PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_TRUST_ANCHOR_PROVISIONED ||
    !PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_KEY_ID ||
    !PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_PUBLIC_KEY_PEM
  ) {
    return null;
  }

  try {
    const publicKey =
      createPublicKey(
        PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_PUBLIC_KEY_PEM,
      );

    if (
      publicKey.type !==
        'public' ||
      publicKey.asymmetricKeyType !==
        'ed25519'
    ) {
      return null;
    }

    return Object.freeze({
      keyId:
        PRODUCTION_FULGOR_GCE_QLORA_LAUNCH_KEY_ID,

      publicKey,
    });
  }
  catch {
    return null;
  }
}