import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  runTaskClassRecoveryWithHostAdapter,
  TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA,
  type TaskClassRecoveryHostGateRequest,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryHostAdapter';

import {
  taskClassRecoveryJobDescriptorSha256,
  type TaskClassRecoveryHostOutcome,
  type TaskClassRecoveryJob,
  type TaskClassRecoveryRunInput,
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
      `host-adapter-${ordinal}`,

    provider:
      'antigravity' as const,

    taskClass:
      'GENERAL' as const,

    task:
      `Host adapter recovery task ${ordinal}`,

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
  phase:
    'PROBATION_BOOTSTRAP' |
    'BOUNDED_CERTIFICATION',

  count:
    number,
): TaskClassRecoveryRunInput {
  return Object.freeze({
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


function allowReceipt(
  request:
    TaskClassRecoveryHostGateRequest,
) {
  return Object.freeze({
    schemaVersion:
      TASK_CLASS_RECOVERY_HOST_GATE_SCHEMA,

    allowed:
      true,

    authorizationConsumed:
      true,

    batchId:
      request.batchId,

    baseline:
      request.baseline,

    provider:
      request.provider,

    taskClass:
      request.taskClass,

    phase:
      request.phase,

    requestedModel:
      request.requestedModel,

    ordinal:
      request.ordinal,

    jobId:
      request.jobId,

    jobDescriptorSha256:
      request.jobDescriptorSha256,
  });
}


describe(
  'VELNAR recovery host adapter V2',
  () => {
    it(
      'runs the one-call probation flow gate -> provider -> ledger with phase continuity',
      async () => {
        const events:
          string[] =
            [];

        const recorded:
          TaskClassRecoveryHostOutcome[] =
            [];

        const result =
          await runTaskClassRecoveryWithHostAdapter(
            input(
              'PROBATION_BOOTSTRAP',
              1,
            ),
            {
              consumeHostEffectGate:
                async request => {
                  events.push(
                    `gate:${request.phase}:${request.ordinal}`,
                  );

                  expect(
                    request.phase,
                  ).toBe(
                    'PROBATION_BOOTSTRAP',
                  );

                  expect(
                    request.jobDescriptorSha256,
                  ).toBe(
                    taskClassRecoveryJobDescriptorSha256(
                      job(
                        1,
                      ),
                    ),
                  );

                  return allowReceipt(
                    request,
                  );
                },

              invokeBoundAntigravity:
                async request => {
                  events.push(
                    `provider:${request.securityMetadata.phase}:${request.securityMetadata.ordinal}`,
                  );

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendBoundHostOutcome:
                async outcome => {
                  events.push(
                    `ledger:${outcome.securityMetadata.phase}:${outcome.securityMetadata.ordinal}`,
                  );

                  recorded.push(
                    outcome,
                  );
                },

              nowMs:
                () => 100_000,
            },
          );

        expect(
          events,
        ).toEqual([
          'gate:PROBATION_BOOTSTRAP:1',
          'provider:PROBATION_BOOTSTRAP:1',
          'ledger:PROBATION_BOOTSTRAP:1',
        ]);

        expect(
          result.status,
        ).toBe(
          'COMPLETE',
        );

        expect(
          result.phase,
        ).toBe(
          'PROBATION_BOOTSTRAP',
        );

        expect(
          result.attemptedProviderCalls,
        ).toBe(
          1,
        );

        expect(
          result.usefulUnique,
        ).toBe(
          1,
        );

        expect(
          recorded,
        ).toHaveLength(
          1,
        );

        expect(
          recorded[0]?.securityMetadata.phase,
        ).toBe(
          'PROBATION_BOOTSTRAP',
        );
      },
    );


    it(
      'runs a separately bounded seven-call certification flow sequentially',
      async () => {
        const events:
          string[] =
            [];

        const result =
          await runTaskClassRecoveryWithHostAdapter(
            input(
              'BOUNDED_CERTIFICATION',
              7,
            ),
            {
              consumeHostEffectGate:
                async request => {
                  events.push(
                    `gate:${request.ordinal}`,
                  );

                  expect(
                    request.phase,
                  ).toBe(
                    'BOUNDED_CERTIFICATION',
                  );

                  return allowReceipt(
                    request,
                  );
                },

              invokeBoundAntigravity:
                async request => {
                  events.push(
                    `provider:${request.securityMetadata.ordinal}`,
                  );

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendBoundHostOutcome:
                async outcome => {
                  events.push(
                    `ledger:${outcome.securityMetadata.ordinal}`,
                  );
                },

              nowMs:
                () => 110_000,
            },
          );

        expect(
          result.status,
        ).toBe(
          'COMPLETE',
        );

        expect(
          result.phase,
        ).toBe(
          'BOUNDED_CERTIFICATION',
        );

        expect(
          result.attemptedProviderCalls,
        ).toBe(
          7,
        );

        expect(
          result.usefulUnique,
        ).toBe(
          7,
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
          'gate:4',
          'provider:4',
          'ledger:4',
          'gate:5',
          'provider:5',
          'ledger:5',
          'gate:6',
          'provider:6',
          'ledger:6',
          'gate:7',
          'provider:7',
          'ledger:7',
        ]);
      },
    );


    it(
      'fails closed when the host gate returns the wrong phase',
      async () => {
        let providerCalls =
          0;

        let ledgerWrites =
          0;

        const result =
          await runTaskClassRecoveryWithHostAdapter(
            input(
              'PROBATION_BOOTSTRAP',
              1,
            ),
            {
              consumeHostEffectGate:
                async request => ({
                  ...allowReceipt(
                    request,
                  ),

                  phase:
                    'BOUNDED_CERTIFICATION',
                }),

              invokeBoundAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendBoundHostOutcome:
                async () => {
                  ledgerWrites +=
                    1;
                },

              nowMs:
                () => 120_000,
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
      },
    );


    it(
      'fails closed when authorization was not consumed',
      async () => {
        let providerCalls =
          0;

        const result =
          await runTaskClassRecoveryWithHostAdapter(
            input(
              'PROBATION_BOOTSTRAP',
              1,
            ),
            {
              consumeHostEffectGate:
                async request => ({
                  ...allowReceipt(
                    request,
                  ),

                  authorizationConsumed:
                    false,
                }),

              invokeBoundAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendBoundHostOutcome:
                async () => undefined,

              nowMs:
                () => 130_000,
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
      },
    );


    it(
      'fails closed on malformed or widened host gate metadata',
      async () => {
        let providerCalls =
          0;

        const result =
          await runTaskClassRecoveryWithHostAdapter(
            input(
              'PROBATION_BOOTSTRAP',
              1,
            ),
            {
              consumeHostEffectGate:
                async request => ({
                  ...allowReceipt(
                    request,
                  ),

                  unexpectedAuthority:
                    true,
                }),

              invokeBoundAntigravity:
                async () => {
                  providerCalls +=
                    1;

                  return {
                    outcome:
                      'USEFUL_UNIQUE',
                  };
                },

              appendBoundHostOutcome:
                async () => undefined,

              nowMs:
                () => 140_000,
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
      },
    );


    it(
      'stops the certification transaction after the first non-useful host-owned outcome',
      async () => {
        const events:
          string[] =
            [];

        const result =
          await runTaskClassRecoveryWithHostAdapter(
            input(
              'BOUNDED_CERTIFICATION',
              3,
            ),
            {
              consumeHostEffectGate:
                async request => {
                  events.push(
                    `gate:${request.ordinal}`,
                  );

                  return allowReceipt(
                    request,
                  );
                },

              invokeBoundAntigravity:
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
                      ordinal === 1
                        ? 'USEFUL_UNIQUE'
                        : 'CONTRACT_REJECTED',
                  };
                },

              appendBoundHostOutcome:
                async outcome => {
                  events.push(
                    `ledger:${outcome.securityMetadata.ordinal}:${outcome.outcome}`,
                  );
                },

              nowMs:
                () => 150_000,
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
  },
);
