import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  runTaskClassRecovery,
  taskClassRecoveryJobDescriptorSha256,
  type TaskClassRecoveryGateDecision,
  type TaskClassRecoveryHostOutcome,
  type TaskClassRecoveryJob,
  type TaskClassRecoveryOutcome,
  type TaskClassRecoveryRunInput,
  type TaskClassRecoverySecurityMetadata,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryRunner';


const BASELINE =
  '0123456789abcdef0123456789abcdef01234567';

const EVIDENCE_SHA =
  'a'.repeat(
    64,
  );


function job(
  ordinal:
    number,
): TaskClassRecoveryJob {
  return Object.freeze({
    jobId:
      `recovery-${ordinal}`,

    provider:
      'antigravity' as const,

    taskClass:
      'GENERAL' as const,

    task:
      `Recovery task ${ordinal}`,

    evidence:
      Object.freeze([
        Object.freeze({
          id:
            'E1',

          path:
            'scripts/fulgor/scheduler/providerTaskRouter.ts',

          sha256:
            EVIDENCE_SHA,
        }),

        Object.freeze({
          id:
            'E2',

          path:
            'scripts/fulgor/scheduler/providerTaskClassRecoveryPolicy.ts',

          sha256:
            ordinal
              .toString(
                16,
              )
              .padStart(
                64,
                '0',
              ),
        }),
      ]),
  });
}


function input(
  count:
    number,

  phase:
    'PROBATION_BOOTSTRAP' |
    'BOUNDED_CERTIFICATION' =
      'BOUNDED_CERTIFICATION',
): TaskClassRecoveryRunInput {
  return Object.freeze({
    batchId:
      'offline-recovery-test',

    baseline:
      BASELINE,

    provider:
      'antigravity' as const,

    taskClass:
      'GENERAL' as const,

    phase,

    requestedModel:
      'gemini-3.8-flash-high' as const,

    maxConcurrency:
      1 as const,

    jobs:
      Object.freeze(
        Array.from(
          {
            length:
              count,
          },
          (
            _,
            index,
          ) =>
            job(
              index + 1,
            ),
        ),
      ),
  });
}


function allow(
  ordinal:
    number,

  currentJob:
    TaskClassRecoveryJob,

  phase:
    'PROBATION_BOOTSTRAP' |
    'BOUNDED_CERTIFICATION' =
      'BOUNDED_CERTIFICATION',
): TaskClassRecoveryGateDecision {
  return Object.freeze({
    allowed:
      true,

    authorizationConsumed:
      true,

    batchId:
      'offline-recovery-test',

    ordinal,

    jobId:
      currentJob.jobId,

    phase,

    jobDescriptorSha256:
      taskClassRecoveryJobDescriptorSha256(
        currentJob,
      ),
  });
}


describe(
  'VELNAR task-class recovery runner V1',
  () => {
    it(
      'executes strictly gate -> provider -> ledger before the next call',
      async () => {
        const events:
          string[] =
            [];

        const result =
          await runTaskClassRecovery(
            input(
              3,
            ),
            {
              consumeEffectGate:
                async request => {
                  events.push(
                    `gate:${request.ordinal}`,
                  );

                  return allow(
                    request.ordinal,
                    request.job,
                  );
                },

              invokeAntigravity:
                async request => {
                  events.push(
                    `provider:${request.securityMetadata.ordinal}`,
                  );

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async outcome => {
                  events.push(
                    `ledger:${outcome.securityMetadata.ordinal}`,
                  );
                },

              nowMs:
                () => 10_000,
            },
          );

        expect(
          events,
        ).toEqual([
          'gate:1',
          'provider:1',
          'ledger:1',
          'gate:2',
          'provider:2',
          'ledger:2',
          'gate:3',
          'provider:3',
          'ledger:3',
        ]);

        expect(
          result.status,
        ).toBe(
          'COMPLETE',
        );

        expect(
          result.attemptedProviderCalls,
        ).toBe(
          3,
        );

        expect(
          result.usefulUnique,
        ).toBe(
          3,
        );

        expect(
          result.automaticRetry,
        ).toBe(
          false,
        );

        expect(
          result.codexFallback,
        ).toBe(
          false,
        );
      },
    );


    it(
      'stops immediately after the first non-useful outcome',
      async () => {
        const events:
          string[] =
            [];

        const outcomes:
          TaskClassRecoveryOutcome[] =
            [
              'USEFUL_UNIQUE',
              'CONTRACT_REJECTED',
              'USEFUL_UNIQUE',
            ];

        const result =
          await runTaskClassRecovery(
            input(
              3,
            ),
            {
              consumeEffectGate:
                async request => {
                  events.push(
                    `gate:${request.ordinal}`,
                  );

                  return allow(
                    request.ordinal,
                    request.job,
                  );
                },

              invokeAntigravity:
                async request => {
                  const ordinal =
                    request
                      .securityMetadata
                      .ordinal;

                  events.push(
                    `provider:${ordinal}`,
                  );

                  return {
                    outcome:
                      outcomes[
                        ordinal - 1
                      ]!,
                  };
                },

              appendHostOutcome:
                async outcome => {
                  events.push(
                    `ledger:${outcome.securityMetadata.ordinal}:${outcome.outcome}`,
                  );
                },

              nowMs:
                () => 20_000,
            },
          );

        expect(
          events,
        ).toEqual([
          'gate:1',
          'provider:1',
          'ledger:1:USEFUL_UNIQUE',
          'gate:2',
          'provider:2',
          'ledger:2:CONTRACT_REJECTED',
        ]);

        expect(
          result.status,
        ).toBe(
          'STOPPED_NON_USEFUL',
        );

        expect(
          result.stopOutcome,
        ).toBe(
          'CONTRACT_REJECTED',
        );

        expect(
          result.attemptedProviderCalls,
        ).toBe(
          2,
        );
      },
    );


    it(
      'maps provider exceptions to one transport failure and never retries',
      async () => {
        let gates =
          0;

        let providerCalls =
          0;

        const recorded:
          TaskClassRecoveryHostOutcome[] =
            [];

        const result =
          await runTaskClassRecovery(
            input(
              3,
            ),
            {
              consumeEffectGate:
                async request => {
                  gates +=
                    1;

                  return allow(
                    request.ordinal,
                    request.job,
                  );
                },

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  throw new Error(
                    'fake transport failure',
                  );
                },

              appendHostOutcome:
                async outcome => {
                  recorded.push(
                    outcome,
                  );
                },

              nowMs:
                () => 30_000,
            },
          );

        expect(
          gates,
        ).toBe(
          1,
        );

        expect(
          providerCalls,
        ).toBe(
          1,
        );

        expect(
          recorded,
        ).toHaveLength(
          1,
        );

        expect(
          recorded[0]?.outcome,
        ).toBe(
          'TRANSPORT_FAILURE',
        );

        expect(
          result.status,
        ).toBe(
          'STOPPED_NON_USEFUL',
        );

        expect(
          result.stopOutcome,
        ).toBe(
          'TRANSPORT_FAILURE',
        );
      },
    );


    it(
      'does not execute provider work when gate metadata does not match',
      async () => {
        let providerCalls =
          0;

        let ledgerWrites =
          0;

        const result =
          await runTaskClassRecovery(
            input(
              1,
            ),
            {
              consumeEffectGate:
                async request => ({
                  ...allow(
                    request.ordinal,
                    request.job,
                  ),

                  jobDescriptorSha256:
                    'b'.repeat(
                      64,
                    ),
                }),

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async () => {
                  ledgerWrites +=
                    1;
                },

              nowMs:
                () => 40_000,
            },
          );

        expect(
          result.status,
        ).toBe(
          'STOPPED_GATE_DENIED',
        );

        expect(
          providerCalls,
        ).toBe(
          0,
        );

        expect(
          ledgerWrites,
        ).toBe(
          0,
        );

        expect(
          result.attemptedProviderCalls,
        ).toBe(
          0,
        );
      },
    );


    it(
      'fails closed after a provider effect if durable ledger append fails',
      async () => {
        const events:
          string[] =
            [];

        await expect(
          runTaskClassRecovery(
            input(
              2,
            ),
            {
              consumeEffectGate:
                async request => {
                  events.push(
                    `gate:${request.ordinal}`,
                  );

                  return allow(
                    request.ordinal,
                    request.job,
                  );
                },

              invokeAntigravity:
                async request => {
                  events.push(
                    `provider:${request.securityMetadata.ordinal}`,
                  );

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async outcome => {
                  events.push(
                    `ledger:${outcome.securityMetadata.ordinal}`,
                  );

                  throw new Error(
                    'fake durable write failure',
                  );
                },

              nowMs:
                () => 50_000,
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_RUNNER_LEDGER_APPEND_FAILED',
        );

        expect(
          events,
        ).toEqual([
          'gate:1',
          'provider:1',
          'ledger:1',
        ]);
      },
    );


    it(
      'preserves the same security metadata object across gate provider and ledger',
      async () => {
        let gateMetadata:
          TaskClassRecoverySecurityMetadata
          | null =
            null;

        let providerMetadata:
          TaskClassRecoverySecurityMetadata
          | null =
            null;

        let ledgerMetadata:
          TaskClassRecoverySecurityMetadata
          | null =
            null;

        const result =
          await runTaskClassRecovery(
            input(
              1,
            ),
            {
              consumeEffectGate:
                async request => {
                  gateMetadata =
                    request
                      .securityMetadata;

                  return allow(
                    request.ordinal,
                    request.job,
                  );
                },

              invokeAntigravity:
                async request => {
                  providerMetadata =
                    request
                      .securityMetadata;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async outcome => {
                  ledgerMetadata =
                    outcome
                      .securityMetadata;
                },

              nowMs:
                () => 60_000,
            },
          );

        expect(
          result.status,
        ).toBe(
          'COMPLETE',
        );

        expect(
          gateMetadata,
        ).not.toBeNull();

        expect(
          providerMetadata,
        ).toBe(
          gateMetadata,
        );

        expect(
          ledgerMetadata,
        ).toBe(
          gateMetadata,
        );

        expect(
          gateMetadata?.provider,
        ).toBe(
          'antigravity',
        );

        expect(
          gateMetadata?.taskClass,
        ).toBe(
          'GENERAL',
        );

        expect(
          gateMetadata?.requestedModel,
        ).toBe(
          'gemini-3.8-flash-high',
        );

        expect(
          gateMetadata?.phase,
        ).toBe(
          'BOUNDED_CERTIFICATION',
        );
      },
    );


    it(
      'rejects a widened probation transaction before any effect',
      async () => {
        let gateCalls =
          0;

        let providerCalls =
          0;

        await expect(
          runTaskClassRecovery(
            input(
              2,
              'PROBATION_BOOTSTRAP',
            ),
            {
              consumeEffectGate:
                async request => {
                  gateCalls +=
                    1;

                  return allow(
                    request.ordinal,
                    request.job,
                    request
                      .securityMetadata
                      .phase,
                  );
                },

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async () => undefined,

              nowMs:
                () => 65_000,
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_RUNNER_PHASE_CALL_COUNT_INVALID',
        );

        expect(
          gateCalls,
        ).toBe(
          0,
        );

        expect(
          providerCalls,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects a gate decision from the wrong recovery phase',
      async () => {
        let providerCalls =
          0;

        let ledgerWrites =
          0;

        const result =
          await runTaskClassRecovery(
            input(
              1,
              'PROBATION_BOOTSTRAP',
            ),
            {
              consumeEffectGate:
                async request =>
                  allow(
                    request.ordinal,
                    request.job,
                    'BOUNDED_CERTIFICATION',
                  ),

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async () => {
                  ledgerWrites +=
                    1;
                },

              nowMs:
                () => 66_000,
            },
          );

        expect(
          result.status,
        ).toBe(
          'STOPPED_GATE_DENIED',
        );

        expect(
          result.phase,
        ).toBe(
          'PROBATION_BOOTSTRAP',
        );

        expect(
          providerCalls,
        ).toBe(
          0,
        );

        expect(
          ledgerWrites,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects an eight-call bounded-certification transaction before any effect',
      async () => {
        let gateCalls =
          0;

        let providerCalls =
          0;

        await expect(
          runTaskClassRecovery(
            input(
              8,
              'BOUNDED_CERTIFICATION',
            ),
            {
              consumeEffectGate:
                async request => {
                  gateCalls +=
                    1;

                  return allow(
                    request.ordinal,
                    request.job,
                    request
                      .securityMetadata
                      .phase,
                  );
                },

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async () => undefined,

              nowMs:
                () => 67_000,
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_RUNNER_PHASE_CALL_COUNT_INVALID',
        );

        expect(
          gateCalls,
        ).toBe(
          0,
        );

        expect(
          providerCalls,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects widened concurrency before any gate or provider effect',
      async () => {
        let gateCalls =
          0;

        let providerCalls =
          0;

        const widened =
          {
            ...input(
              1,
            ),

            maxConcurrency:
              2,
          } as unknown as
            TaskClassRecoveryRunInput;

        await expect(
          runTaskClassRecovery(
            widened,
            {
              consumeEffectGate:
                async request => {
                  gateCalls +=
                    1;

                  return allow(
                    request.ordinal,
                    request.job,
                  );
                },

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async () => undefined,

              nowMs:
                () => 70_000,
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_RUNNER_CONCURRENCY_INVALID',
        );

        expect(
          gateCalls,
        ).toBe(
          0,
        );

        expect(
          providerCalls,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects recovery jobs with fewer than two independent host evidence bindings before any effect',
      async () => {
        const validJob =
          job(
            1,
          );

        const singleEvidenceJob =
          Object.freeze({
            ...validJob,

            evidence:
              Object.freeze([
                validJob
                  .evidence[
                    0
                  ]!,
              ]),
          });

        const invalid =
          Object.freeze({
            ...input(
              1,
              'PROBATION_BOOTSTRAP',
            ),

            jobs:
              Object.freeze([
                singleEvidenceJob,
              ]),
          });

        let gateCalls =
          0;

        let providerCalls =
          0;

        let ledgerWrites =
          0;

        await expect(
          runTaskClassRecovery(
            invalid,
            {
              consumeEffectGate:
                async request => {
                  gateCalls +=
                    1;

                  return allow(
                    request.ordinal,
                    request.job,
                    request
                      .securityMetadata
                      .phase,
                  );
                },

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async () => {
                  ledgerWrites +=
                    1;
                },

              nowMs:
                () => 71_000,
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_RUNNER_EVIDENCE_COUNT_INVALID',
        );

        expect(
          gateCalls,
        ).toBe(
          0,
        );

        expect(
          providerCalls,
        ).toBe(
          0,
        );

        expect(
          ledgerWrites,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects two evidence IDs that bind the same host evidence before any effect',
      async () => {
        const validJob =
          job(
            1,
          );

        const first =
          validJob
            .evidence[
              0
            ]!;

        const duplicate =
          Object.freeze({
            ...first,

            id:
              'E2',
          });

        const duplicateJob =
          Object.freeze({
            ...validJob,

            evidence:
              Object.freeze([
                first,
                duplicate,
              ]),
          });

        const invalid =
          Object.freeze({
            ...input(
              1,
              'PROBATION_BOOTSTRAP',
            ),

            jobs:
              Object.freeze([
                duplicateJob,
              ]),
          });

        let gateCalls =
          0;

        let providerCalls =
          0;

        await expect(
          runTaskClassRecovery(
            invalid,
            {
              consumeEffectGate:
                async request => {
                  gateCalls +=
                    1;

                  return allow(
                    request.ordinal,
                    request.job,
                    request
                      .securityMetadata
                      .phase,
                  );
                },

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async () =>
                  undefined,

              nowMs:
                () => 72_000,
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_RUNNER_EVIDENCE_NOT_INDEPENDENT',
        );

        expect(
          gateCalls,
        ).toBe(
          0,
        );

        expect(
          providerCalls,
        ).toBe(
          0,
        );
      },
    );


    it(
      'rejects a repeated certification evidence context before any effect',
      async () => {
        const firstJob =
          job(
            1,
          );

        const secondBase =
          job(
            2,
          );

        const secondJob =
          Object.freeze({
            ...secondBase,

            evidence:
              firstJob.evidence,
          });

        const invalid =
          Object.freeze({
            ...input(
              2,
              'BOUNDED_CERTIFICATION',
            ),

            jobs:
              Object.freeze([
                firstJob,
                secondJob,
              ]),
          });

        let gateCalls =
          0;

        let providerCalls =
          0;

        let ledgerWrites =
          0;

        await expect(
          runTaskClassRecovery(
            invalid,
            {
              consumeEffectGate:
                async request => {
                  gateCalls +=
                    1;

                  return allow(
                    request.ordinal,
                    request.job,
                    request
                      .securityMetadata
                      .phase,
                  );
                },

              invokeAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendHostOutcome:
                async () => {
                  ledgerWrites +=
                    1;
                },

              nowMs:
                () => 73_000,
            },
          ),
        ).rejects.toThrow(
          'RECOVERY_RUNNER_CERTIFICATION_EVIDENCE_CONTEXT_REUSED',
        );

        expect(
          gateCalls,
        ).toBe(
          0,
        );

        expect(
          providerCalls,
        ).toBe(
          0,
        );

        expect(
          ledgerWrites,
        ).toBe(
          0,
        );
      },
    );


  },
);
