import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA,
  type TaskClassRecoveryHostGateRequest,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryHostAdapter';

import {
  SEALED_RECOVERY_CALL_GATE_V3_SHA256,
  consumeRecoveryEffectGateThroughBridge,
  type RecoveryEffectGateBridgeInput,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryEffectGateBridge';

import {
  SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';


const BASELINE =
  '0123456789abcdef0123456789abcdef01234567';

const DESCRIPTOR =
  'a'.repeat(
    64,
  );


function request(
  phase:
    'PROBATION_BOOTSTRAP' |
    'BOUNDED_CERTIFICATION',

  ordinal:
    number,
): TaskClassRecoveryHostGateRequest {
  return Object.freeze({
    schemaVersion:
      TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA,

    batchId:
      phase ===
        'PROBATION_BOOTSTRAP'
        ? 'offline-gate-probation'
        : 'offline-gate-certification',

    baseline:
      BASELINE,

    provider:
      'antigravity' as const,

    taskClass:
      'GENERAL' as const,

    phase,

    requestedModel:
      'gemini-3.8-flash-high' as const,

    ordinal,

    jobId:
      `gate-job-${ordinal}`,

    jobDescriptorSha256:
      DESCRIPTOR,
  });
}


function input(
  phase:
    'PROBATION_BOOTSTRAP' |
    'BOUNDED_CERTIFICATION',

  ordinal:
    number,

  authorized:
    number,

  remaining:
    number,
): RecoveryEffectGateBridgeInput {
  return {
    request:
      request(
        phase,
        ordinal,
      ),

    authorizedProviderCalls:
      authorized,

    expectedRemainingProviderCalls:
      remaining,
  };
}


function allowStdout(
  current:
    RecoveryEffectGateBridgeInput,
): string {
  const req =
    current.request;

  return [
    'RECOVERY_CALL_GATE=ALLOW',
    'RECOVERY_CALL_AUTHORIZATION_CONSUMED=YES',
    `RECOVERY_BATCH_ID=${req.batchId}`,
    `RECOVERY_CALL_ORDINAL=${req.ordinal}`,
    `RECOVERY_JOB_ID=${req.jobId}`,
    `RECOVERY_JOB_DESCRIPTOR_SHA256=${req.jobDescriptorSha256}`,
    'RECOVERY_PROVIDER=antigravity',
    'RECOVERY_TASK_CLASS=GENERAL',
    `RECOVERY_PHASE=${req.phase}`,
    'RECOVERY_MODEL=gemini-3.8-flash-high',
    `RECOVERY_CALLS_REMAINING=${current.expectedRemainingProviderCalls}`,
    'SECURITY_METADATA_CONTINUITY=PASS',
    'AUTHORITY_RECHECK_AT_EFFECT_GATE=PASS',
    'PROVIDER_EXECUTION=NO',
    '',
  ].join(
    '\n',
  );
}


describe(
  'VELNAR recovery effect-gate bridge V1',
  () => {
    it(
      'normalizes exact one-call probation authorization consumption',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
            1,
            0,
          );

        const executions:
          unknown[] =
            [];

        const result =
          await consumeRecoveryEffectGateThroughBridge(
            current,
            {
              executeGate:
                async execution => {
                  executions.push(
                    execution,
                  );

                  return {
                    exitCode:
                      0,

                    stdout:
                      allowStdout(
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
            expectedGateSha256:
              SEALED_RECOVERY_CALL_GATE_V3_SHA256,

            expectedCommonSha256:
              SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,

            args: [
              '--consume-call',
              'offline-gate-probation',
              '1',
            ],
          },
        ]);

        expect(
          result.receipt,
        ).toMatchObject({
          allowed:
            true,

          authorizationConsumed:
            true,

          phase:
            'PROBATION_BOOTSTRAP',

          ordinal:
            1,

          jobId:
            'gate-job-1',
        });

        expect(
          result.authorizedProviderCalls,
        ).toBe(
          1,
        );

        expect(
          result.remainingProviderCalls,
        ).toBe(
          0,
        );

        expect(
          result.providerExecution,
        ).toBe(
          false,
        );
      },
    );


    it(
      'normalizes exact seven-call certification progress',
      async () => {
        const current =
          input(
            'BOUNDED_CERTIFICATION',
            3,
            7,
            4,
          );

        const result =
          await consumeRecoveryEffectGateThroughBridge(
            current,
            {
              executeGate:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    allowStdout(
                      current,
                    ),

                  stderr:
                    '',
                }),
            },
          );

        expect(
          result.receipt.phase,
        ).toBe(
          'BOUNDED_CERTIFICATION',
        );

        expect(
          result.receipt.ordinal,
        ).toBe(
          3,
        );

        expect(
          result.authorizedProviderCalls,
        ).toBe(
          7,
        );

        expect(
          result.remainingProviderCalls,
        ).toBe(
          4,
        );
      },
    );


    it(
      'supports resumed bounded certification with a smaller fresh budget',
      async () => {
        const current =
          input(
            'BOUNDED_CERTIFICATION',
            2,
            6,
            4,
          );

        const result =
          await consumeRecoveryEffectGateThroughBridge(
            current,
            {
              executeGate:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    allowStdout(
                      current,
                    ),

                  stderr:
                    '',
                }),
            },
          );

        expect(
          result.authorizedProviderCalls,
        ).toBe(
          6,
        );

        expect(
          result.remainingProviderCalls,
        ).toBe(
          4,
        );
      },
    );


    it(
      'rejects widened probation before fake gate invocation',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
            2,
            1,
          );

        let executions =
          0;

        await expect(
          consumeRecoveryEffectGateThroughBridge(
            current,
            {
              executeGate:
                async () => {
                  executions +=
                    1;

                  return {
                    exitCode:
                      0,

                    stdout:
                      allowStdout(
                        current,
                      ),

                    stderr:
                      '',
                  };
                },
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_EFFECT_GATE_BRIDGE_PROBATION_AUTHORIZED_CALLS_INVALID',
        );

        expect(
          executions,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects impossible ordinal and remaining-budget relationships',
      async () => {
        let executions =
          0;

        await expect(
          consumeRecoveryEffectGateThroughBridge(
            input(
              'BOUNDED_CERTIFICATION',
              4,
              3,
              0,
            ),
            {
              executeGate:
                async () => {
                  executions +=
                    1;

                  return {
                    exitCode:
                      0,

                    stdout:
                      '',

                    stderr:
                      '',
                  };
                },
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_EFFECT_GATE_BRIDGE_ORDINAL_EXCEEDS_AUTHORIZATION',
        );

        await expect(
          consumeRecoveryEffectGateThroughBridge(
            input(
              'BOUNDED_CERTIFICATION',
              2,
              7,
              4,
            ),
            {
              executeGate:
                async () => {
                  executions +=
                    1;

                  return {
                    exitCode:
                      0,

                    stdout:
                      '',

                    stderr:
                      '',
                  };
                },
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_EFFECT_GATE_BRIDGE_REMAINING_BUDGET_INVALID',
        );

        expect(
          executions,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects phase job descriptor and remaining-budget stdout mismatches',
      async () => {
        const current =
          input(
            'BOUNDED_CERTIFICATION',
            2,
            7,
            5,
          );

        const mutations = [
          [
            'RECOVERY_PHASE=BOUNDED_CERTIFICATION',
            'RECOVERY_PHASE=PROBATION_BOOTSTRAP',
          ],
          [
            'RECOVERY_JOB_ID=gate-job-2',
            'RECOVERY_JOB_ID=other-job',
          ],
          [
            `RECOVERY_JOB_DESCRIPTOR_SHA256=${DESCRIPTOR}`,
            `RECOVERY_JOB_DESCRIPTOR_SHA256=${'b'.repeat(64)}`,
          ],
          [
            'RECOVERY_CALLS_REMAINING=5',
            'RECOVERY_CALLS_REMAINING=4',
          ],
        ] as const;

        for (
          const [
            original,
            replacement,
          ]
          of mutations
        ) {
          await expect(
            consumeRecoveryEffectGateThroughBridge(
              current,
              {
                executeGate:
                  async () => ({
                    exitCode:
                      0,

                    stdout:
                      allowStdout(
                        current,
                      ).replace(
                        original,
                        replacement,
                      ),

                    stderr:
                      '',
                  }),
              },
            ),
          ).rejects.toThrow(
            'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_BINDING_INVALID',
          );
        }
      },
    );


    it(
      'rejects missing consumption failed recheck metadata loss or provider execution',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
            1,
            0,
          );

        const mutations = [
          [
            'RECOVERY_CALL_AUTHORIZATION_CONSUMED=YES',
            'RECOVERY_CALL_AUTHORIZATION_CONSUMED=NO',
          ],
          [
            'SECURITY_METADATA_CONTINUITY=PASS',
            'SECURITY_METADATA_CONTINUITY=FAIL',
          ],
          [
            'AUTHORITY_RECHECK_AT_EFFECT_GATE=PASS',
            'AUTHORITY_RECHECK_AT_EFFECT_GATE=FAIL',
          ],
          [
            'PROVIDER_EXECUTION=NO',
            'PROVIDER_EXECUTION=YES',
          ],
        ] as const;

        for (
          const [
            original,
            replacement,
          ]
          of mutations
        ) {
          await expect(
            consumeRecoveryEffectGateThroughBridge(
              current,
              {
                executeGate:
                  async () => ({
                    exitCode:
                      0,

                    stdout:
                      allowStdout(
                        current,
                      ).replace(
                        original,
                        replacement,
                      ),

                    stderr:
                      '',
                  }),
              },
            ),
          ).rejects.toThrow(
            'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_BINDING_INVALID',
          );
        }
      },
    );


    it(
      'rejects unknown and duplicate gate markers',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
            1,
            0,
          );

        await expect(
          consumeRecoveryEffectGateThroughBridge(
            current,
            {
              executeGate:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    allowStdout(
                      current,
                    )
                    +
                    'UNEXPECTED_AUTHORITY=YES\n',

                  stderr:
                    '',
                }),
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_KEY_INVALID',
        );

        await expect(
          consumeRecoveryEffectGateThroughBridge(
            current,
            {
              executeGate:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    allowStdout(
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
          'RECOVERY_EFFECT_GATE_BRIDGE_STDOUT_DUPLICATE_KEY',
        );
      },
    );


    it(
      'fails closed on gate deny and stderr',
      async () => {
        const current =
          input(
            'PROBATION_BOOTSTRAP',
            1,
            1,
            0,
          );

        await expect(
          consumeRecoveryEffectGateThroughBridge(
            current,
            {
              executeGate:
                async () => ({
                  exitCode:
                    2,

                  stdout:
                    [
                      'RECOVERY_CALL_GATE=DENY',
                      'RECOVERY_CALL_GATE_FAILURE=NO_AUTHORIZATION',
                      '',
                    ].join(
                      '\n',
                    ),

                  stderr:
                    '',
                }),
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_EFFECT_GATE_BRIDGE_EXIT_INVALID',
        );

        await expect(
          consumeRecoveryEffectGateThroughBridge(
            current,
            {
              executeGate:
                async () => ({
                  exitCode:
                    0,

                  stdout:
                    allowStdout(
                      current,
                    ),

                  stderr:
                    'unexpected diagnostic',
                }),
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_EFFECT_GATE_BRIDGE_STDERR_NOT_EMPTY',
        );
      },
    );
  },
);
