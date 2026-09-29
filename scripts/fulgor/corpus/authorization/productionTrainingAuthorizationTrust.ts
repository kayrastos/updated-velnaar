import {
  createTrainingAuthorizationTrustPolicy,
} from './trainingAuthorizationTrustPolicy';

/*
 * Production trust is intentionally fail-closed until an explicit
 * provisioning ceremony installs approved PUBLIC key material.
 *
 * Private signing material MUST NOT be placed in this source tree.
 */
export const PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_ANCHOR_PROVISIONED =
  false as const;

export const PRODUCTION_FULGOR_TRAINING_AUTHORIZATION_TRUST_POLICY =
  createTrainingAuthorizationTrustPolicy(
    [],
  );
