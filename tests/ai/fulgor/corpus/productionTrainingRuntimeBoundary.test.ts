import type {
  D1Database,
} from '@cloudflare/workers-types';

import {
  describe,
  expect,
  it,
} from 'vitest';

import type {
  WorkerEnv,
} from '../../../../worker/env';

import {
  FULGOR_PRODUCTION_TRAINING_AUTHORIZATION_RUNTIME_ENABLED,
  invokeFulgorProductionTrainingAuthorizationBoundary,
  invokeFulgorTrainingAuthorizationBoundaryForTesting,
} from '../../../../worker/fulgor/fulgorTrainingRuntimeBoundary';

import type {
  TrainingExecutionAuthorization,
} from '../../../../scripts/fulgor/corpus/authorization/trainingExecutionAuthorization';

import type {
  SignedCorpusRegistry,
} from '../../../../scripts/fulgor/corpus/registry/signedCorpusRegistry';

import type {
  CorpusSplitBundle,
} from '../../../../scripts/fulgor/corpus/registry/sealedSplitManifest';

const authorization =
  {} as TrainingExecutionAuthorization;

const registry =
  {} as SignedCorpusRegistry;

const splitBundle =
  {} as CorpusSplitBundle;

describe(
  'FULGOR dormant production training runtime boundary',
  () => {
    it(
      'keeps the production runtime gate closed',
      () => {
        expect(
          FULGOR_PRODUCTION_TRAINING_AUTHORIZATION_RUNTIME_ENABLED,
        ).toBe(false);
      },
    );

    it(
      'reads zero ambient Worker capabilities while the production gate is closed',
      async () => {
        let reads =
          0;

        const env =
          new Proxy(
            {} as WorkerEnv,
            {
              get() {
                reads +=
                  1;

                throw new Error(
                  'ENV_MUST_NOT_BE_READ',
                );
              },
            },
          );

        const result =
          await invokeFulgorProductionTrainingAuthorizationBoundary(
            env,
            authorization,
            registry,
            splitBundle,
          );

        expect(result)
          .toEqual({
            reachedAuthorizationBoundary:
              false,

            databaseCapabilityCaptured:
              false,

            trainingStarted:
              false,

            promotionPerformed:
              false,

            deploymentPerformed:
              false,

            authorizationResult:
              null,

            errors: [
              'FULGOR_PRODUCTION_RUNTIME_DISABLED',
            ],
          });

        expect(
          reads,
        ).toBe(0);
      },
    );

    it(
      'reads no DB capability when environment validation fails',
      async () => {
        let environmentReads =
          0;

        let dbReads =
          0;

        const env =
          {} as WorkerEnv;

        Object.defineProperty(
          env,
          'ENVIRONMENT',
          {
            get() {
              environmentReads +=
                1;

              return 'preview';
            },
          },
        );

        Object.defineProperty(
          env,
          'DB',
          {
            get() {
              dbReads +=
                1;

              throw new Error(
                'DB_MUST_NOT_BE_READ',
              );
            },
          },
        );

        const result =
          await invokeFulgorTrainingAuthorizationBoundaryForTesting(
            env,
            authorization,
            registry,
            splitBundle,
            true,
          );

        expect(
          result.errors,
        ).toEqual([
          'WORKER_ENVIRONMENT_NOT_PRODUCTION',
        ]);

        expect(
          environmentReads,
        ).toBe(1);

        expect(
          dbReads,
        ).toBe(0);

        expect(
          result.trainingStarted,
        ).toBe(false);
      },
    );

    it(
      'fails closed when the production DB capability is missing',
      async () => {
        const env = {
          ENVIRONMENT:
            'production',
        } as WorkerEnv;

        const result =
          await invokeFulgorTrainingAuthorizationBoundaryForTesting(
            env,
            authorization,
            registry,
            splitBundle,
            true,
          );

        expect(result)
          .toMatchObject({
            reachedAuthorizationBoundary:
              false,

            databaseCapabilityCaptured:
              false,

            trainingStarted:
              false,

            errors: [
              'WORKER_D1_DATABASE_UNAVAILABLE',
            ],
          });
      },
    );

    it(
      'fails closed when the DB getter throws without leaking the exception',
      async () => {
        const env =
          {
            ENVIRONMENT:
              'production',
          } as WorkerEnv;

        Object.defineProperty(
          env,
          'DB',
          {
            get() {
              throw new Error(
                'SECRET_DB_FAILURE_DETAIL',
              );
            },
          },
        );

        const result =
          await invokeFulgorTrainingAuthorizationBoundaryForTesting(
            env,
            authorization,
            registry,
            splitBundle,
            true,
          );

        expect(
          result.errors,
        ).toEqual([
          'WORKER_D1_DATABASE_UNAVAILABLE',
        ]);

        expect(
          JSON.stringify(result),
        ).not.toContain(
          'SECRET_DB_FAILURE_DETAIL',
        );
      },
    );

    it(
      'captures a valid DB capability but performs no D1 write while production trust anchors are closed',
      async () => {
        let prepareCalls =
          0;

        const db = {
          prepare() {
            prepareCalls +=
              1;

            throw new Error(
              'D1_MUST_NOT_BE_REACHED_WITH_CLOSED_TRUST',
            );
          },
        } as unknown as D1Database;

        const env = {
          ENVIRONMENT:
            'production',

          DB:
            db,
        } as WorkerEnv;

        const result =
          await invokeFulgorTrainingAuthorizationBoundaryForTesting(
            env,
            authorization,
            registry,
            splitBundle,
            true,
          );

        expect(
          result.reachedAuthorizationBoundary,
        ).toBe(true);

        expect(
          result.databaseCapabilityCaptured,
        ).toBe(true);

        expect(
          result.authorizationResult,
        ).toEqual({
          authorized:
            false,

          nonceConsumed:
            false,

          failureCodes: [
            'SIGNER_TRUST_ANCHOR_NOT_PROVISIONED',
          ],
        });

        expect(
          prepareCalls,
        ).toBe(0);

        expect(
          result.trainingStarted,
        ).toBe(false);

        expect(
          result.promotionPerformed,
        ).toBe(false);

        expect(
          result.deploymentPerformed,
        ).toBe(false);
      },
    );
  },
);
