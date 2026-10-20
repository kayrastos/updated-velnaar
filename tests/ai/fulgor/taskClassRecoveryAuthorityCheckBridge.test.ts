import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  runRecoveryAuthorityCheckOnly,
  SEALED_RECOVERY_AUTHORIZER_V2_SHA256,
  SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256,
  TASK_CLASS_RECOVERY_INTENT_SCHEMA_V2,
  type RecoveryAuthorityCheckInput,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';


const BASELINE =
  '0123456789abcdef0123456789abcdef01234567';

const HASH =
  'a'.repeat(
    64,
  );

const INTENT_PATH =
  '/tmp/velnar-offline-recovery-check.json';


function input(
  phase:
    'PROBATION_BOOTSTRAP' |
    'BOUNDED_CERTIFICATION',

  calls:
    number,
): RecoveryAuthorityCheckInput {
  return Object.freeze({
    intentPath:
      INTENT_PATH,

    batchId:
      phase ===
        'PROBATION_BOOTSTRAP'
        ? 'offline-probation'
        : 'offline-certification',

    baseline:
      BASELINE,

    provider:
      'antigravity' as const,

    taskClass:
      'GENERAL' as const,

    phase,

    requestedModel:
      'gemini-3.8-flash-high' as const,

    requestedProviderCalls:
      calls,

    requestedConcurrency:
      1 as const,
  });
}


function intentText(
  current:
    RecoveryAuthorityCheckInput,
): string {
  return JSON.stringify({
    schemaVersion:
      TASK_CLASS_RECOVERY_INTENT_SCHEMA_V2,

    batchId:
      current.batchId,

    baseline:
      current.baseline,

    provider:
      current.provider,

    taskClass:
      current.taskClass,

    phase:
      current.phase,

    requestedModel:
      current.requestedModel,

    requestedProviderCalls:
      current.requestedProviderCalls,

    requestedConcurrency:
      current.requestedConcurrency,

    latestTransportFailureObservedAtMs:
      1_000,

    antigravityExecutableSha256:
      HASH,

    codexExecutableSha256:
      HASH,

    nodeExecutableSha256:
      HASH,

    tsxCliSha256:
      HASH,

    liveEnvSha256:
      HASH,

    liveUnitSha256:
      HASH,

    foundationHashes:
      {
        policy:
          HASH,
      },

    jobs:
      Array.from(
        {
          length:
            current.requestedProviderCalls,
        },
        (
          _,
          index,
        ) => ({
          jobId:
            `recovery-${index + 1}`,
        }),
      ),
  });
}


function validStdout(
  current:
    RecoveryAuthorityCheckInput,
): string {
  return [
    'RECOVERY_POLICY_ELIGIBILITY=PASS',
    'RECOVERY_PROVIDER=antigravity',
    'RECOVERY_TASK_CLASS=GENERAL',
    `RECOVERY_PHASE=${current.phase}`,
    `RECOVERY_CALLS=${current.requestedProviderCalls}`,
    'RECOVERY_CONCURRENCY=1',
    'RUNTIME_CONTEXT_RECHECK=PASS',
    'RECOVERY_AUTHORIZATION_CHECK=PASS',
    'RECOVERY_AUTHORIZATION_CREATED=NO',
    'PROVIDER_EXECUTION=NO',
    '',
  ].join(
    '\n',
  );
}


describe(
  'VELNAR recovery authority check-only bridge',
  () => {
    it(
      'accepts one-call probation without creating live authority',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
          );

        const executions:
          unknown[] =
            [];

        const result =
          await runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  intentText(
                    current,
                  ),

              executeAuthorizer:
                async request => {
                  executions.push(
                    request,
                  );

                  return {
                    exitCode:
                      0,

                    stdout:
                      validStdout(
                        current,
                      ),

                    stderr:
                      '',
                  };
                },
            },
          );

        expect(
          executions,
        ).toEqual([
          {
            expectedAuthorizerSha256:
              SEALED_RECOVERY_AUTHORIZER_V2_SHA256,

            expectedCommonSha256:
              SEALED_RECOVERY_AUTHORITY_COMMON_V2_SHA256,

            args: [
              '--check-only',
              INTENT_PATH,
            ],
          },
        ]);

        expect(
          result,
        ).toMatchObject({
          status:
            'CHECK_ONLY_PASS',

          phase:
            'PROBATION_BOOTSTRAP',

          requestedProviderCalls:
            1,

          authorizationCreated:
            false,

          providerExecution:
            false,

          gateConsumed:
            false,

          liveAllow:
            false,
        });
      },
    );


    it(
      'accepts seven-call certification check-only shape',
      async () => {
        const current =
          input(
            'BOUNDED_CERTIFICATION',
            7,
          );

        const result =
          await runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  intentText(
                    current,
                  ),

              executeAuthorizer:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    validStdout(
                      current,
                    ),

                  stderr:
                    '',
                }),
            },
          );

        expect(
          result,
        ).toMatchObject({
          status:
            'CHECK_ONLY_PASS',

          phase:
            'BOUNDED_CERTIFICATION',

          requestedProviderCalls:
            7,

          liveAllow:
            false,
        });
      },
    );


    it(
      'rejects widened probation before executor invocation',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            2,
          );

        let executions =
          0;

        await expect(
          runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  intentText(
                    current,
                  ),

              executeAuthorizer:
                async () => {
                  executions +=
                    1;

                  return {
                    exitCode:
                      0,

                    stdout:
                      validStdout(
                        current,
                      ),

                    stderr:
                      '',
                  };
                },
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_CHECK_BRIDGE_PHASE_CALL_COUNT_INVALID',
        );

        expect(
          executions,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects intent binding mismatch before executor invocation',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
          );

        const wrong =
          JSON.parse(
            intentText(
              current,
            ),
          );

        wrong.phase =
          'BOUNDED_CERTIFICATION';

        let executions =
          0;

        await expect(
          runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  JSON.stringify(
                    wrong,
                  ),

              executeAuthorizer:
                async () => {
                  executions +=
                    1;

                  return {
                    exitCode:
                      0,

                    stdout:
                      validStdout(
                        current,
                      ),

                    stderr:
                      '',
                  };
                },
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_CHECK_BRIDGE_INTENT_BINDING_INVALID',
        );

        expect(
          executions,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects an unknown stdout authority marker',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
          );

        await expect(
          runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  intentText(
                    current,
                  ),

              executeAuthorizer:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    validStdout(
                      current,
                    )
                    +
                    'RECOVERY_AUTHORIZATION=GRANTED\n',

                  stderr:
                    '',
                }),
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_CHECK_BRIDGE_STDOUT_KEY_INVALID',
        );
      },
    );


    it(
      'rejects duplicate stdout keys',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
          );

        await expect(
          runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  intentText(
                    current,
                  ),

              executeAuthorizer:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    validStdout(
                      current,
                    )
                    +
                    'PROVIDER_EXECUTION=NO\n',

                  stderr:
                    '',
                }),
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_CHECK_BRIDGE_STDOUT_DUPLICATE_KEY',
        );
      },
    );


    it(
      'rejects phase mismatch in stdout',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
          );

        const stdout =
          validStdout(
            current,
          ).replace(
            'RECOVERY_PHASE=PROBATION_BOOTSTRAP',
            'RECOVERY_PHASE=BOUNDED_CERTIFICATION',
          );

        await expect(
          runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  intentText(
                    current,
                  ),

              executeAuthorizer:
                async () => ({
                  exitCode:
                    0,

                  stdout,

                  stderr:
                    '',
                }),
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_CHECK_BRIDGE_STDOUT_BINDING_INVALID',
        );
      },
    );


    it(
      'rejects authorization-created or provider-executed claims',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
          );

        for (
          const stdout
          of [
            validStdout(
              current,
            ).replace(
              'RECOVERY_AUTHORIZATION_CREATED=NO',
              'RECOVERY_AUTHORIZATION_CREATED=YES',
            ),

            validStdout(
              current,
            ).replace(
              'PROVIDER_EXECUTION=NO',
              'PROVIDER_EXECUTION=YES',
            ),
          ]
        ) {
          await expect(
            runRecoveryAuthorityCheckOnly(
              current,
              {
                readIntent:
                  async () =>
                    intentText(
                      current,
                    ),

                executeAuthorizer:
                  async () => ({
                    exitCode:
                      0,

                    stdout,

                    stderr:
                      '',
                  }),
              },
            ),
          ).rejects.toThrow(
            'RECOVERY_CHECK_BRIDGE_STDOUT_BINDING_INVALID',
          );
        }
      },
    );


    it(
      'fails closed on non-zero exit and stderr',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
          );

        await expect(
          runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  intentText(
                    current,
                  ),

              executeAuthorizer:
                async () => ({
                  exitCode:
                    2,

                  stdout:
                    '',

                  stderr:
                    '',
                }),
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_CHECK_BRIDGE_EXIT_INVALID',
        );

        await expect(
          runRecoveryAuthorityCheckOnly(
            current,
            {
              readIntent:
                async () =>
                  intentText(
                    current,
                  ),

              executeAuthorizer:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    validStdout(
                      current,
                    ),

                  stderr:
                    'unexpected diagnostic',
                }),
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_CHECK_BRIDGE_STDERR_NOT_EMPTY',
        );
      },
    );
  },
);
