import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  PRODUCTION_FULGOR_CORPUS_REGISTRY_TRUST_ANCHOR_PROVISIONED,
  resolveProductionFulgorCorpusRegistryPublicKey,
} from '../../../../scripts/fulgor/corpus/authorization/productionCorpusRegistryTrust';

describe(
  'FULGOR production corpus registry trust',
  () => {
    it(
      'is deliberately unprovisioned',
      () => {
        expect(
          PRODUCTION_FULGOR_CORPUS_REGISTRY_TRUST_ANCHOR_PROVISIONED,
        ).toBe(false);
      },
    );

    it(
      'fails closed without exposing a registry verification key',
      () => {
        expect(
          resolveProductionFulgorCorpusRegistryPublicKey(),
        ).toBeNull();
      },
    );
  },
);
