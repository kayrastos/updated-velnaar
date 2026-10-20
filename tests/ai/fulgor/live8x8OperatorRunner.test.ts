import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  createHash,
} from 'node:crypto';

import {
  join,
} from 'node:path';

import {
  tmpdir,
} from 'node:os';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  Live8x8OneShotInput,
  Live8x8OneShotResult,
} from '../../../scripts/fulgor/orchestration/live8x8OneShotRunner';

import {
  LIVE_8X8_OPERATOR_REQUEST_SCHEMA,
  LIVE_ANTIGRAVITY_PROVIDER_TIMEOUT_MS,
  isTaskClassRecoveryLiveEnabled,
  live8x8OperatorSummary,
  runLive8x8Operator,
} from '../../../scripts/fulgor/orchestration/live8x8OperatorRunner';

import {
  TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';

import {
  ProviderTaskClassEvidenceStore,
} from '../../../scripts/fulgor/scheduler/providerTaskClassEvidenceStore';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

import {
  HostProviderCapacityController,
} from '../../../scripts/fulgor/scheduler/sharedProviderCapacity';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const roots:
  string[] =
    [];

function root():
string {
  const value =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-live8x8-operator-',
      ),
    );

  roots.push(
    value,
  );

  return value;
}

afterEach(
  () => {
    while (
      roots.length >
        0
    ) {
      const value =
        roots.pop();

      if (
        value
      ) {
        rmSync(
          value,
          {
            recursive:
              true,

            force:
              true,
          },
        );
      }
    }
  },
);

function executable(
  directory:
    string,

  name:
    string,
): string {
  const file =
    join(
      directory,
      name,
    );

  writeFileSync(
    file,
    '#!/bin/sh\nexit 99\n',
    {
      mode:
        0o700,
    },
  );

  chmodSync(
    file,
    0o700,
  );

  return file;
}

function request() {
  const jobs =
    [
      ...Array.from(
        {
          length:
            8,
        },

        (
          _,
          index,
        ) => ({
          jobId:
            `codex-${index + 1}`,

          provider:
            'codex' as const,

          task:
            `Bounded Codex task ${index + 1}`,

          evidence: [
            {
              id:
                'E1',

              path:
                'src/a.ts',
            },
          ],
        }),
      ),

      ...Array.from(
        {
          length:
            8,
        },

        (
          _,
          index,
        ) => ({
          jobId:
            `agy-${index + 1}`,

          provider:
            'antigravity' as const,

          task:
            `Bounded Antigravity task ${index + 1}`,

          evidence: [
            {
              id:
                'E1',

              path:
                'src/a.ts',
            },
          ],
        }),
      ),
    ];

  return {
    schemaVersion:
      LIVE_8X8_OPERATOR_REQUEST_SCHEMA,

    requestId:
      'test-8x8',

    baseline,

    jobs,
  };
}

function fakeResult():
Live8x8OneShotResult {
  const stats =
    (
      provider:
        'codex'
        | 'antigravity',
    ) =>
      Object.freeze({
        provider,

        slots:
          8,

        claims:
          8,

        liveProviderCalls:
          8,

        usefulUnique:
          8,

        usefulDuplicate:
          0,

        blocked:
          0,

        protocolRejected:
          0,

        contractRejected:
          0,

        transportFailures:
          0,

        stoppedByQualityCircuit:
          0,
      });

  return Object.freeze({
    schemaVersion:
      'VELNAR_LIVE_8X8_ONE_SHOT_V1',

    baseline,

    startedAtMs:
      100,

    completedAtMs:
      200,

    elapsedMs:
      100,

    expectedProviderCalls:
      16,

    pool: Object.freeze({
      schemaVersion:
        'VELNAR_LIVE_TRANSACTIONAL_PROVIDER_POOL_V1',

      codex:
        stats(
          'codex',
        ),

      antigravity:
        stats(
          'antigravity',
        ),

      totalSlots:
        16,

      totalLiveProviderCalls:
        16,

      totalUsefulUnique:
        16,

      totalUsefulDuplicate:
        0,

      fulgorCalled:
        false,

      verificationGranted:
        false,

      authorityGranted:
        false,
    }),

    fulgorCalled:
      false,

    verificationGranted:
      false,

    authorityGranted:
      false,
  }) as Live8x8OneShotResult;
}

describe(
  'VELNAR live 8+8 operator runner',
  () => {
    it(
      'materializes host evidence from baseline and prepares exact 8+8 without executing providers',
      async () => {
        const directory =
          root();

        const repoRoot =
          join(
            directory,
            'repo',
          );

        const stateRoot =
          join(
            directory,
            'state',
          );

        const requestFile =
          join(
            directory,
            'request.json',
          );

        const fs =
          await import(
            'node:fs/promises'
          );

        await fs.mkdir(
          repoRoot,
          {
            mode:
              0o700,
          },
        );

        writeFileSync(
          requestFile,
          JSON.stringify(
            request(),
          ),
          {
            mode:
              0o600,
          },
        );

        const codex =
          executable(
            directory,
            'codex-fake',
          );

        const antigravity =
          executable(
            directory,
            'agy-fake',
          );

        let captured:
          Live8x8OneShotInput
          | null =
            null;

        const result =
          await runLive8x8Operator({
            env: {
              HOME:
                directory,

              VELNAR_REPO_ROOT:
                repoRoot,

              VELNAR_8X8_REQUEST_FILE:
                requestFile,

              VELNAR_CODEX_EXECUTABLE:
                codex,

              VELNAR_ANTIGRAVITY_EXECUTABLE:
                antigravity,
            },

            stateRoot,

            gitText:
              async (
                _repoRoot,
                args,
              ) => {
                const key =
                  args.join(' ');

                if (
                  key ===
                    'rev-parse --show-toplevel'
                ) {
                  return `${repoRoot}\n`;
                }

                if (
                  key ===
                    'status --porcelain=v1 --untracked-files=all --ignore-submodules=none'
                ) {
                  return '';
                }

                if (
                  key ===
                    'rev-parse HEAD'
                ) {
                  return `${baseline}\n`;
                }

                if (
                  key ===
                    `rev-parse --verify ${baseline}^{commit}`
                ) {
                  return `${baseline}\n`;
                }

                if (
                  key ===
                    `show ${baseline}:src/a.ts`
                ) {
                  return 'export const evidence = 1;\n';
                }

                throw new Error(
                  `UNEXPECTED_GIT=${key}`,
                );
              },

            runOneShot:
              async input => {
                captured =
                  input;

                writeFileSync(
                  input.queuePath,
                  'test-queue',
                  {
                    mode:
                      0o600,
                  },
                );

                return fakeResult();
              },
          });

        expect(
          captured,
        ).not.toBeNull();

        expect(
          captured?.jobs,
        ).toHaveLength(
          16,
        );

        expect(
          captured?.jobs.filter(
            item =>
              item.order.affinity ===
                'codex',
          ),
        ).toHaveLength(
          8,
        );

        expect(
          captured?.jobs.filter(
            item =>
              item.order.affinity ===
                'antigravity',
          ),
        ).toHaveLength(
          8,
        );

        expect(
          result.actualProviderCalls,
        ).toBe(16);

        expect(
          result.usefulUnique,
        ).toBe(16);

        expect(
          result.acceptedWorkPointerPath,
        ).toBe(
          join(
            stateRoot,
            'accepted-work-latest.json',
          ),
        );

        expect(
          result.fulgorCalled,
        ).toBe(false);

        expect(
          result.authorityGranted,
        ).toBe(false);
      },
    );

    it(
      'fails closed on a dirty repository before provider execution',
      async () => {
        const directory =
          root();

        const repoRoot =
          join(
            directory,
            'repo',
          );

        const requestFile =
          join(
            directory,
            'request.json',
          );

        const fs =
          await import(
            'node:fs/promises'
          );

        await fs.mkdir(
          repoRoot,
          {
            mode:
              0o700,
          },
        );

        writeFileSync(
          requestFile,
          JSON.stringify(
            request(),
          ),
          {
            mode:
              0o600,
          },
        );

        const codex =
          executable(
            directory,
            'codex-fake',
          );

        const antigravity =
          executable(
            directory,
            'agy-fake',
          );

        let oneShotCalled =
          false;

        await expect(
          runLive8x8Operator({
            env: {
              HOME:
                directory,

              VELNAR_REPO_ROOT:
                repoRoot,

              VELNAR_8X8_REQUEST_FILE:
                requestFile,

              VELNAR_CODEX_EXECUTABLE:
                codex,

              VELNAR_ANTIGRAVITY_EXECUTABLE:
                antigravity,
            },

            stateRoot:
              join(
                directory,
                'state',
              ),

            gitText:
              async (
                _repoRoot,
                args,
              ) => {
                const key =
                  args.join(' ');

                if (
                  key ===
                    'rev-parse --show-toplevel'
                ) {
                  return `${repoRoot}\n`;
                }

                if (
                  key ===
                    'status --porcelain=v1 --untracked-files=all --ignore-submodules=none'
                ) {
                  return '?? dirty.txt\n';
                }

                throw new Error(
                  `UNEXPECTED_GIT=${key}`,
                );
              },

            runOneShot:
              async () => {
                oneShotCalled =
                  true;

                return fakeResult();
              },
          }),
        ).rejects.toThrow(
          /LIVE_8X8_OPERATOR_FAILURE/,
        );

        expect(
          oneShotCalled,
        ).toBe(false);
      },
    );

    it(
      'keeps recovery default-OFF and rejects any non-"1" switch or request-injected recovery enablement',
      async () => {
        expect(
          isTaskClassRecoveryLiveEnabled({}),
        ).toBe(false);

        for (
          const value
          of [
            '',
            '0',
            'true',
            'yes',
            'TRUE',
            '2',
            '1 ',
            ' 1',
            'enabled',
          ]
        ) {
          expect(
            isTaskClassRecoveryLiveEnabled({
              VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
                value,
            }),
          ).toBe(false);
        }

        expect(
          isTaskClassRecoveryLiveEnabled({
            VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
              '1',
          }),
        ).toBe(true);

        const directory =
          root();

        const repoRoot =
          join(
            directory,
            'repo',
          );

        const stateRoot =
          join(
            directory,
            'state',
          );

        const requestFile =
          join(
            directory,
            'request.json',
          );

        mkdirSync(
          repoRoot,
          {
            mode:
              0o700,
          },
        );

        writeFileSync(
          requestFile,
          JSON.stringify(
            request(),
          ),
          {
            mode:
              0o600,
          },
        );

        const codex =
          executable(
            directory,
            'codex-fake',
          );

        const antigravity =
          executable(
            directory,
            'agy-fake',
          );

        const executeAuthorizer =
          vi.fn();

        const executeAuthorization =
          vi.fn();

        const executeGate =
          vi.fn();

        const invokeBoundAntigravity =
          vi.fn();

        const result =
          await runLive8x8Operator({
            env: {
              HOME:
                directory,

              VELNAR_REPO_ROOT:
                repoRoot,

              VELNAR_8X8_REQUEST_FILE:
                requestFile,

              VELNAR_CODEX_EXECUTABLE:
                codex,

              VELNAR_ANTIGRAVITY_EXECUTABLE:
                antigravity,

              VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
                'true',
            },

            stateRoot,

            gitText:
              async (
                _repoRoot,
                args,
              ) => {
                const key =
                  args.join(' ');

                if (
                  key ===
                    'rev-parse --show-toplevel'
                ) {
                  return `${repoRoot}\n`;
                }

                if (
                  key ===
                    'status --porcelain=v1 --untracked-files=all --ignore-submodules=none'
                ) {
                  return '';
                }

                if (
                  key ===
                    'rev-parse HEAD' ||
                  key ===
                    `rev-parse --verify ${baseline}^{commit}`
                ) {
                  return `${baseline}\n`;
                }

                if (
                  key ===
                    `show ${baseline}:src/a.ts`
                ) {
                  return 'export const evidence = 1;\n';
                }

                throw new Error(
                  `UNEXPECTED_GIT=${key}`,
                );
              },

            runOneShot:
              async input => {
                writeFileSync(
                  input.queuePath,
                  'test-queue',
                  {
                    mode:
                      0o600,
                  },
                );

                return fakeResult();
              },

            recovery: {
              batchId:
                'should-not-run',

              intentPath:
                '/tmp/should-not-run.json',

              executeAuthorizer,
              executeAuthorization,
              executeGate,
              invokeBoundAntigravity,
            },
          });

        expect(
          result.recoveryEnabled,
        ).toBe(false);

        expect(
          result.recoveryStatus,
        ).toBe('DISABLED');

        expect(
          result.recoveryProviderCalls,
        ).toBe(0);

        expect(
          result.normalProviderCalls,
        ).toBe(16);

        expect(
          result.totalProviderCalls,
        ).toBe(16);

        expect(
          executeAuthorizer,
        ).not.toHaveBeenCalled();

        expect(
          executeAuthorization,
        ).not.toHaveBeenCalled();

        expect(
          executeGate,
        ).not.toHaveBeenCalled();

        expect(
          invokeBoundAntigravity,
        ).not.toHaveBeenCalled();

        // Request JSON attempting to inject recoveryEnabled fails closed before execution
        const poisonedRequestFile =
          join(
            directory,
            'request-poisoned.json',
          );

        writeFileSync(
          poisonedRequestFile,
          JSON.stringify({
            ...request(),
            recoveryEnabled:
              true,
          }),
          {
            mode:
              0o600,
          },
        );

        await expect(
          runLive8x8Operator({
            env: {
              HOME:
                directory,

              VELNAR_REPO_ROOT:
                repoRoot,

              VELNAR_8X8_REQUEST_FILE:
                poisonedRequestFile,

              VELNAR_CODEX_EXECUTABLE:
                codex,

              VELNAR_ANTIGRAVITY_EXECUTABLE:
                antigravity,
            },

            stateRoot,
          }),
        ).rejects.toThrow(
          /LIVE_8X8_OPERATOR_FAILURE/,
        );
      },
    );

    it(
      'runs offline recovery through shared capacity when VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED="1" and holds when all 8 AGY slots are occupied',
      async () => {
        const directory =
          root();

        const repoRoot =
          join(
            directory,
            'repo',
          );

        const stateRoot =
          join(
            directory,
            'state',
          );

        const evidenceDir =
          join(
            stateRoot,
            'task-class-evidence',
          );

        mkdirSync(
          repoRoot,
          {
            mode:
              0o700,
          },
        );

        mkdirSync(
          stateRoot,
          {
            mode:
              0o700,
          },
        );

        mkdirSync(
          evidenceDir,
          {
            mode:
              0o700,
          },
        );

        // Seed 8 prior USEFUL_UNIQUE + 1 TRANSPORT_FAILURE on ('antigravity', 'GENERAL')
        const evidenceDbPath =
          join(
            evidenceDir,
            `${baseline}.sqlite`,
          );

        const seedStore =
          new ProviderTaskClassEvidenceStore(
            evidenceDbPath,
            baseline,
          );

        try {
          for (
            let i = 0;
            i < 8;
            i += 1
          ) {
            seedStore.appendHostOutcome({
              jobId:
                `seed-agy-useful-${i + 1}`,

              baseline,

              provider:
                'antigravity',

              taskClass:
                'GENERAL',

              outcome:
                'USEFUL_UNIQUE',

              observedAtMs:
                1_000 + i,
            });
          }

          seedStore.appendHostOutcome({
            jobId:
              'seed-agy-transport-fail',

            baseline,

            provider:
              'antigravity',

            taskClass:
              'GENERAL',

            outcome:
              'TRANSPORT_FAILURE',

            observedAtMs:
              2_000,
          });
        } finally {
          seedStore.close();
        }

        const codex =
          executable(
            directory,
            'codex-fake',
          );

        const antigravity =
          executable(
            directory,
            'agy-fake',
          );

        const batchId =
          'operator-offline-probation';

        const intentPath =
          join(
            directory,
            'recovery-intent.json',
          );

        const intentRaw =
          JSON.stringify({
            schemaVersion:
              TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3,

            baseline,
            batchId,

            provider:
              'antigravity',

            taskClass:
              'GENERAL',

            phase:
              'PROBATION_BOOTSTRAP',

            requestedModel:
              'gemini-3.8-flash-high',

            requestedProviderCalls:
              1,

            requestedConcurrency:
              1,

            latestTransportFailureObservedAtMs:
              2_000,

            antigravityExecutableSha256:
              'a'.repeat(64),

            codexExecutableSha256:
              'a'.repeat(64),

            nodeExecutableSha256:
              'a'.repeat(64),

            tsxCliSha256:
              'a'.repeat(64),

            liveEnvSha256:
              'a'.repeat(64),

            liveUnitSha256:
              'a'.repeat(64),

            foundationHashes: {
              'scripts/fulgor/policy.ts':
                'a'.repeat(64),
            },

            jobs: [
              {
                jobId:
                  'recovery-probation-01',

                provider:
                  'antigravity',

                taskClass:
                  'GENERAL',

                task:
                  'Offline probation recovery task',

                evidence: [
                  {
                    id:
                      'E1',

                    path:
                      'src/a.ts',

                    sha256:
                      createHash(
                        'sha256',
                      )
                        .update(
                          'export const evidence = 1;\n',
                        )
                        .digest(
                          'hex',
                        ),
                  },
                  {
                    id:
                      'E2',

                    path:
                      'src/b.ts',

                    sha256:
                      createHash(
                        'sha256',
                      )
                        .update(
                          'export const evidenceB = 2;\n',
                        )
                        .digest(
                          'hex',
                        ),
                  },
                ],
              },
            ],
          });

        const intentDigest =
          createHash(
            'sha256',
          )
            .update(
              intentRaw,
              'utf8',
            )
            .digest(
              'hex',
            );

        const policyLines = [
          'RECOVERY_POLICY_ELIGIBILITY=PASS',
          'RECOVERY_PROVIDER=antigravity',
          'RECOVERY_TASK_CLASS=GENERAL',
          'RECOVERY_PHASE=PROBATION_BOOTSTRAP',
          'RECOVERY_CALLS=1',
          'RECOVERY_CONCURRENCY=1',
          'RUNTIME_CONTEXT_RECHECK=PASS',
          `RECOVERY_INTENT_SHA256=${intentDigest}`,
        ];

        // Part A: When all 8 Antigravity units are held in sharedCapacity, recovery holds with 0 authorizer/authorization/gate/provider calls
        const contendedCapacity =
          new HostProviderCapacityController({
            nowMs:
              () =>
                100_000,
          });

        try {
          for (
            let i = 0;
            i < 8;
            i += 1
          ) {
            contendedCapacity.acquireNormalSlot(
              'antigravity',
            );
          }

          const reqHoldFile =
            join(
              directory,
              'request-hold.json',
            );

          writeFileSync(
            reqHoldFile,
            JSON.stringify({
              ...request(),
              requestId:
                'test-8x8-contended-hold',
            }),
            {
              mode:
                0o600,
            },
          );

          const holdAuthorizer =
            vi.fn();

          const holdAuthorization =
            vi.fn();

          const holdGate =
            vi.fn();

          const holdProvider =
            vi.fn();

          const holdResult =
            await runLive8x8Operator({
              env: {
                HOME:
                  directory,

                VELNAR_REPO_ROOT:
                  repoRoot,

                VELNAR_8X8_REQUEST_FILE:
                  reqHoldFile,

                VELNAR_CODEX_EXECUTABLE:
                  codex,

                VELNAR_ANTIGRAVITY_EXECUTABLE:
                  antigravity,

                VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
                  '1',
              },

              stateRoot,

              nowMs:
                () =>
                  100_000,

              sharedCapacity:
                contendedCapacity,

              gitText:
                async (
                  _repoRoot,
                  args,
                ) => {
                  const key =
                    args.join(' ');

                  if (
                    key ===
                      'rev-parse --show-toplevel'
                  ) {
                    return `${repoRoot}\n`;
                  }

                  if (
                    key ===
                      'status --porcelain=v1 --untracked-files=all --ignore-submodules=none'
                  ) {
                    return '';
                  }

                  if (
                    key ===
                      'rev-parse HEAD' ||
                    key ===
                      `rev-parse --verify ${baseline}^{commit}`
                  ) {
                    return `${baseline}\n`;
                  }

                  if (
                    key ===
                      `show ${baseline}:src/a.ts`
                  ) {
                    return 'export const evidence = 1;\n';
                  }

                  throw new Error(
                    `UNEXPECTED_GIT=${key}`,
                  );
                },

              runOneShot:
                async input => {
                  const q =
                    new TransactionalProviderQueue(
                      input.queuePath,
                    );

                  q.close();

                  chmodSync(
                    input.queuePath,
                    0o600,
                  );

                  return fakeResult();
                },

              recovery: {
                batchId,
                intentPath,
                expectedIntentSha256:
                  intentDigest,

                readIntent:
                  async () =>
                    intentRaw,

                executeAuthorizer:
                  holdAuthorizer,

                executeAuthorization:
                  holdAuthorization,

                executeGate:
                  holdGate,

                invokeBoundAntigravity:
                  holdProvider,
              },
            });

          expect(
            holdResult.recoveryEnabled,
          ).toBe(true);

          expect(
            holdResult.recoveryStatus,
          ).toBe('HOLD');

          expect(
            holdResult.recoveryProviderCalls,
          ).toBe(0);

          expect(
            holdAuthorizer,
          ).not.toHaveBeenCalled();

          expect(
            holdAuthorization,
          ).not.toHaveBeenCalled();

          expect(
            holdGate,
          ).not.toHaveBeenCalled();

          expect(
            holdProvider,
          ).not.toHaveBeenCalled();
        } finally {
          contendedCapacity.close();
        }

        // Part B: With shared capacity available, offline recovery runs end-to-end using fake dependencies
        const sharedCapacity =
          new HostProviderCapacityController({
            nowMs:
              () =>
                100_000,
          });

        try {
          const reqPassFile =
            join(
              directory,
              'request-pass.json',
            );

          writeFileSync(
            reqPassFile,
            JSON.stringify({
              ...request(),
              requestId:
                'test-8x8-recovery-pass',
            }),
            {
              mode:
                0o600,
            },
          );

          const events:
            string[] =
              [];

          let observedRecoveryHeldDuringCall =
            0;

          const passResult =
            await runLive8x8Operator({
              env: {
                HOME:
                  directory,

                VELNAR_REPO_ROOT:
                  repoRoot,

                VELNAR_8X8_REQUEST_FILE:
                  reqPassFile,

                VELNAR_CODEX_EXECUTABLE:
                  codex,

                VELNAR_ANTIGRAVITY_EXECUTABLE:
                  antigravity,

                VELNAR_TASK_CLASS_RECOVERY_LIVE_ENABLED:
                  '1',
              },

              stateRoot,

              nowMs:
                () =>
                  100_000,

              sharedCapacity,

              gitText:
                async (
                  _repoRoot,
                  args,
                ) => {
                  const key =
                    args.join(' ');

                  if (
                    key ===
                      'rev-parse --show-toplevel'
                  ) {
                    return `${repoRoot}\n`;
                  }

                  if (
                    key ===
                      'status --porcelain=v1 --untracked-files=all --ignore-submodules=none'
                  ) {
                    return '';
                  }

                  if (
                    key ===
                      'rev-parse HEAD' ||
                    key ===
                      `rev-parse --verify ${baseline}^{commit}`
                  ) {
                    return `${baseline}\n`;
                  }

                  if (
                    key ===
                      `show ${baseline}:src/a.ts`
                  ) {
                    return 'export const evidence = 1;\n';
                  }

                  throw new Error(
                    `UNEXPECTED_GIT=${key}`,
                  );
                },

              runOneShot:
                async input => {
                  expect(
                    input.sharedCapacity,
                  ).toBe(
                    sharedCapacity,
                  );

                  writeFileSync(
                    input.queuePath,
                    'test-queue',
                    {
                      mode:
                        0o600,
                    },
                  );

                  return fakeResult();
                },

              recovery: {
                batchId,
                intentPath,
                expectedIntentSha256:
                  intentDigest,

                readIntent:
                  async () =>
                    intentRaw,

                executeAuthorizer:
                  async () => {
                    events.push(
                      'check',
                    );

                    return {
                      exitCode:
                        0,

                      stderr:
                        '',

                      stdout: [
                        ...policyLines,
                        'RECOVERY_AUTHORIZATION_CHECK=PASS',
                        'RECOVERY_AUTHORIZATION_CREATED=NO',
                        'PROVIDER_EXECUTION=NO',
                      ].join('\n'),
                    };
                  },

                executeAuthorization:
                  async () => {
                    events.push(
                      'authorize',
                    );

                    return {
                      exitCode:
                        0,

                      stderr:
                        '',

                      stdout: [
                        ...policyLines,
                        'RECOVERY_AUTHORIZATION=GRANTED',
                        'RECOVERY_AUTHORIZATION_SCHEMA=VELNAR_TASK_CLASS_RECOVERY_AUTHORIZATION_V3',
                        `RECOVERY_BASELINE=${baseline}`,
                        'RECOVERY_MODEL=gemini-3.8-flash-high',
                        `RECOVERY_BATCH_ID=${batchId}`,
                        'RECOVERY_PROVIDER_CALL_HARD_MAX=1',
                        'RECOVERY_MAX_CONCURRENCY=1',
                        'RECOVERY_AUTHORIZATION_TTL_MS=600000',
                        'PROVIDER_EXECUTION=NO',
                      ].join('\n'),
                    };
                  },

                executeGate:
                  async gateReq => {
                    const ordinal =
                      Number(
                        gateReq.args[2],
                      );

                    events.push(
                      `gate-${ordinal}`,
                    );

                    return {
                      exitCode:
                        0,

                      stderr:
                        '',

                      transaction:
                        gateReq.transaction,

                      stdout: [
                        'RECOVERY_CALL_GATE=ALLOW',
                        'RECOVERY_CALL_AUTHORIZATION_CONSUMED=YES',
                        `RECOVERY_BATCH_ID=${batchId}`,
                        `RECOVERY_CALL_ORDINAL=${ordinal}`,
                        `RECOVERY_JOB_ID=${gateReq.call.jobId}`,
                        `RECOVERY_JOB_DESCRIPTOR_SHA256=${gateReq.call.jobDescriptorSha256}`,
                        'RECOVERY_PROVIDER=antigravity',
                        'RECOVERY_TASK_CLASS=GENERAL',
                        'RECOVERY_PHASE=PROBATION_BOOTSTRAP',
                        'RECOVERY_MODEL=gemini-3.8-flash-high',
                        'RECOVERY_CALLS_REMAINING=0',
                        'SECURITY_METADATA_CONTINUITY=PASS',
                        'AUTHORITY_RECHECK_AT_EFFECT_GATE=PASS',
                        'PROVIDER_EXECUTION=NO',
                      ].join('\n'),
                    };
                  },

                invokeBoundAntigravity:
                  async providerReq => {
                    events.push(
                      `provider-${providerReq.securityMetadata.ordinal}`,
                    );

                    const snap =
                      sharedCapacity.snapshot();

                    observedRecoveryHeldDuringCall =
                      snap.recoveryAntigravityHeld;

                    expect(
                      snap.antigravityHeld,
                    ).toBe(1);

                    expect(
                      snap.globalHeld,
                    ).toBe(1);

                    return {
                      outcome:
                        'USEFUL_UNIQUE',
                    };
                  },

                appendBoundHostOutcome:
                  async outcome => {
                    events.push(
                      `ledger-${outcome.securityMetadata.ordinal}`,
                    );
                  },
              },
            });

          expect(
            observedRecoveryHeldDuringCall,
          ).toBe(1);

          expect(
            events,
          ).toEqual([
            'check',
            'authorize',
            'gate-1',
            'provider-1',
            'ledger-1',
          ]);

          expect(
            passResult.recoveryEnabled,
          ).toBe(true);

          expect(
            passResult.recoveryStatus,
          ).toBe('COMPLETE');

          expect(
            passResult.expectedProviderCalls,
          ).toBe(16);

          expect(
            passResult.actualProviderCalls,
          ).toBe(16);

          expect(
            passResult.normalProviderCalls,
          ).toBe(16);

          expect(
            passResult.recoveryProviderCalls,
          ).toBe(1);

          expect(
            passResult.recoveryUsefulUnique,
          ).toBe(1);

          expect(
            passResult.totalProviderCalls,
          ).toBe(17);

          expect(
            passResult.capacityControllerId,
          ).toBe(
            sharedCapacity.controllerId,
          );

          expect(
            sharedCapacity.snapshot(),
          ).toMatchObject({
            normalCodexHeld:
              0,

            normalAntigravityHeld:
              0,

            recoveryAntigravityHeld:
              0,

            globalHeld:
              0,
          });

          const summary =
            live8x8OperatorSummary(
              passResult,
            );

          expect(
            summary,
          ).toContain(
            'NORMAL_PROVIDER_CALLS=16',
          );

          expect(
            summary,
          ).toContain(
            'RECOVERY_ENABLED=True',
          );

          expect(
            summary,
          ).toContain(
            'RECOVERY_STATUS=COMPLETE',
          );

          expect(
            summary,
          ).toContain(
            'RECOVERY_PROVIDER_CALLS=1',
          );

          expect(
            summary,
          ).toContain(
            'TOTAL_PROVIDER_CALLS=17',
          );

          const verifyStore =
            new ProviderTaskClassEvidenceStore(
              evidenceDbPath,
              baseline,
            );

          try {
            expect(
              verifyStore.count(),
            ).toBe(10);
          } finally {
            verifyStore.close();
          }
        } finally {
          sharedCapacity.close();
        }
      },
    );
  },
);

// VELNAR_ANTIGRAVITY_COMPLETION_ENVELOPE


it(
  'uses a six-minute hard Antigravity completion envelope',
  () => {
    expect(
      LIVE_ANTIGRAVITY_PROVIDER_TIMEOUT_MS,
    ).toBe(
      360_000,
    );
  },
);
