import {
  createPublicKey,
} from 'node:crypto';

import type {
  KeyObject,
} from 'node:crypto';

/*
 * Production corpus-registry verification authority.
 *
 * Deliberately unprovisioned.
 * Only PUBLIC key material may ever be placed here.
 * Private signing keys MUST remain outside the distributable source tree.
 */
export const PRODUCTION_FULGOR_CORPUS_REGISTRY_TRUST_ANCHOR_PROVISIONED =
  false as const;

const PRODUCTION_FULGOR_CORPUS_REGISTRY_PUBLIC_KEY_PEM:
  string | null =
    null;

export function resolveProductionFulgorCorpusRegistryPublicKey():
  KeyObject | null {
  if (
    !PRODUCTION_FULGOR_CORPUS_REGISTRY_TRUST_ANCHOR_PROVISIONED ||
    !PRODUCTION_FULGOR_CORPUS_REGISTRY_PUBLIC_KEY_PEM
  ) {
    return null;
  }

  try {
    const publicKey =
      createPublicKey(
        PRODUCTION_FULGOR_CORPUS_REGISTRY_PUBLIC_KEY_PEM,
      );

    if (
      publicKey.type !==
        'public' ||
      publicKey.asymmetricKeyType !==
        'ed25519'
    ) {
      return null;
    }

    return publicKey;
  }
  catch {
    return null;
  }
}
