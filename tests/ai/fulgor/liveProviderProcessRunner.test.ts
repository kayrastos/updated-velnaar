import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  createHash,
} from 'node:crypto';

import {
  createBoundedLiveProviderInvoker,
} from '../../../scripts/fulgor/orchestration/liveProviderProcessRunner';

import {
  runLiveTransactionalProviderWorkerPool,
  type LiveProviderInput,
} from '../../../scripts/fulgor/orchestration/liveTransactionalProviderWorkerPool';

import {
  createProviderWorkOrder,
  createProviderWorkRecord,
  type ProviderWorkRecord,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

import type {
  HostEvidenceCapsule,
} from '../../../scripts/fulgor/orchestration/providerWorkProductGate';

import {
  buildProviderWorkProductPrompt,
  type BoundHostEvidenceText,
} from '../../../scripts/fulgor/orchestration/liveProviderProtocolBindings';

const roots:
  string[] = [];

function root():
  string {
  const value =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-runner-',
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
      roots.length > 0
    ) {
      rmSync(
        roots.pop()!,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);

function sha(
  value: string,
): string {
  return createHash(
    'sha256',
  )
    .update(
      value,
      'utf8',
    )
    .digest(
      'hex',
    );
}

const baseline =
  'a'.repeat(40);

const evidenceA =
  'export const evidenceA = true;\n';

const evidenceB =
  'export const evidenceB = true;\n';

const preparedEvidence:
  readonly BoundHostEvidenceText[] =
    Object.freeze([
      Object.freeze({
        id:
          'E1',

        path:
          'src/evidence-a.ts',

        sha256:
          sha(
            evidenceA,
          ),

        content:
          evidenceA,
      }),

      Object.freeze({
        id:
          'E2',

        path:
          'src/evidence-b.ts',

        sha256:
          sha(
            evidenceB,
          ),

        content:
          evidenceB,
      }),
    ]);

function capsule(
  record:
    ProviderWorkRecord,
): HostEvidenceCapsule {
  return Object.freeze({
    taskId:
      record.order.jobId,

    baseline:
      record.order.baseline,

    evidence:
      Object.freeze(
        preparedEvidence.map(
          item =>
            Object.freeze({
              id:
                item.id,

              path:
                item.path,

              sha256:
                item.sha256,
            }),
        ),
      ),
  });
}

function fakeExecutable(
  directory:
    string,

  name:
    string,

  body:
    string,
): string {
  const file =
    join(
      directory,
      `${name}.cjs`,
    );

  writeFileSync(
    file,
    `#!${process.execPath}\n${body}`,
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

const providerScript = `
const fs = require('fs');

if (fs.readFileSync(0).length !== 0) {
  process.exit(90);
}

const args = process.argv.slice(2);
const prompt = args.at(-1);

const task =
  /TASK_ID=([^\\n]+)/.exec(prompt)?.[1];

const baseline =
  /BASELINE=([^\\n]+)/.exec(prompt)?.[1];

if (!task || !baseline) {
  process.exit(91);
}

function product(provider) {
  const safe =
    task.replace(/[^A-Za-z0-9_]/g, '_');

  return {
    schemaVersion:
      'VELNAR_PROVIDER_WORK_PRODUCT_V1',

    provider,

    taskId:
      task,

    baseline,

    status:
      'PROPOSE_CHANGE',

    summary:
      'Bounded fake provider proposal.',

    evidenceIds:
      ['E1', 'E2'],

    candidate: {
      path:
        'tests/' + task + '.test.ts',

      content:
        'export const ' + safe + ' = true;\\n',
    },

    tests: [
      'npx vitest run tests/' + task + '.test.ts',
    ],

    blocker:
      null,
  };
}
`;

function codexExecutable(
  directory:
    string,

  mode:
    'ok'
    | 'diverge'
    | 'nonzero'
    | 'overflow'
    | 'timeout',
): string {
  let tail:
    string;

  if (mode === 'nonzero') {
    tail = `
process.exit(7);
`;
  } else if (
    mode === 'overflow'
  ) {
    tail = `
process.stdout.write('x'.repeat(8192));
`;
  } else if (
    mode === 'timeout'
  ) {
    tail = `
setTimeout(() => {}, 5000);
`;
  } else {
    tail = `
const schemaIndex =
  args.indexOf('--output-schema');

const finalIndex =
  args.indexOf('--output-last-message');

if (
  schemaIndex < 0 ||
  finalIndex < 0 ||
  !fs.existsSync(args[schemaIndex + 1])
) {
  process.exit(92);
}

const output =
  product('codex');

const native =
  ${mode === 'diverge'
    ? "{ ...output, summary: 'divergent' }"
    : "output"};

fs.writeFileSync(
  args[finalIndex + 1],
  JSON.stringify(native),
);

const stream = [
  {
    type:
      'thread.started',

    thread_id:
      'fake-codex',
  },

  {
    type:
      'turn.started',
  },

  {
    type:
      'item.completed',

    item: {
      id:
        'final-1',

      type:
        'agent_message',

      text:
        JSON.stringify(output),
    },
  },

  {
    type:
      'turn.completed',

    usage: {
      input_tokens:
        1,

      cached_input_tokens:
        0,

      output_tokens:
        1,
    },
  },
];

process.stdout.write(
  stream
    .map(JSON.stringify)
    .join('\\n') +
  '\\n'
);
`;
  }

  return fakeExecutable(
    directory,
    `fake-codex-${mode}`,
    providerScript + tail,
  );
}

function antigravityExecutable(
  directory:
    string,

  mode:
    'ok'
    | 'denied'
    | 'env'
    | 'nonzero',
): string {
  let tail:
    string;

  if (mode === 'nonzero') {
    tail = `
process.exit(8);
`;
  } else if (
    mode === 'env'
  ) {
    tail = `
if (process.env.VELNAR_TEST_SECRET) {
  process.exit(93);
}

const output =
  product('antigravity');

process.stdout.write(
  JSON.stringify({
    conversation_id:
      'fake-agy',

    status:
      'SUCCESS',

    json_schema: {
      type:
        'object',
    },

    denied_actions:
      [],

    response:
      JSON.stringify(output),
  })
);
`;
  } else {
    tail = `
const output =
  product('antigravity');

process.stdout.write(
  JSON.stringify({
    conversation_id:
      'fake-agy',

    status:
      'SUCCESS',

    json_schema: {
      type:
        'object',
    },

    denied_actions:
      ${
        mode === 'denied'
          ? "[{ action: 'read_file' }]"
          : "[]"
      },

    response:
      JSON.stringify(output),
  })
);
`;
  }

  return fakeExecutable(
    directory,
    `fake-agy-${mode}`,
    providerScript + tail,
  );
}

function record(
  provider:
    'codex'
    | 'antigravity',

  jobId:
    string,
): ProviderWorkRecord {
  return createProviderWorkRecord(
    createProviderWorkOrder({
      jobId,

      baseline,

      task:
        'Produce one bounded fake regression proposal.',

      evidenceIds:
        ['E1', 'E2'],

      affinity:
        provider,
    }),
    100,
  );
}

function input(
  provider:
    'codex'
    | 'antigravity',

  jobId:
    string,
): LiveProviderInput {
  const value =
    record(
      provider,
      jobId,
    );

  return {
    provider,

    slotId:
      `slot-${provider}`,

    record:
      value,

    capsule:
      capsule(
        value,
      ),
  };
}

function config(
  directory:
    string,

  codexMode:
    'ok'
    | 'diverge'
    | 'nonzero'
    | 'overflow'
    | 'timeout' =
      'ok',

  agyMode:
    'ok'
    | 'denied'
    | 'env'
    | 'nonzero' =
      'ok',
) {
  return {
    repoRoot:
      directory,

    tempRoot:
      directory,

    codex: {
      executable:
        codexExecutable(
          directory,
          codexMode,
        ),

      timeoutMs:
        codexMode ===
          'timeout'
          ? 100
          : 2000,

      maxStdoutBytes:
        codexMode ===
          'overflow'
          ? 1024
          : 131072,

      maxStderrBytes:
        4096,
    },

    antigravity: {
      executable:
        antigravityExecutable(
          directory,
          agyMode,
        ),

      timeoutMs:
        2000,

      maxStdoutBytes:
        131072,

      maxStderrBytes:
        4096,
    },

    resolvePreparedEvidence:
      () =>
        preparedEvidence,
  } as const;
}

function enqueue(
  database:
    string,

  provider:
    'codex'
    | 'antigravity',

  jobId:
    string,

  atMs:
    number,
): void {
  const queue =
    new TransactionalProviderQueue(
      database,
    );

  try {
    queue.enqueue(
      createProviderWorkOrder({
        jobId,

        baseline,

        task:
          'Produce one bounded fake regression proposal.',

        evidenceIds:
          ['E1', 'E2'],

        affinity:
          provider,
      }),

      atMs,
    );
  } finally {
    queue.close();
  }
}

function clock() {
  let value =
    10_000;

  return () => {
    value += 10;

    return value;
  };
}

describe(
  'VELNAR bounded live provider process runner',
  () => {
    it(
      'runs one bounded fake Codex process and admits exact protocol',
      async () => {
        const directory =
          root();

        const invoke =
          createBoundedLiveProviderInvoker(
            config(
              directory,
            ),
          );

        const result =
          await invoke(
            input(
              'codex',
              'job-codex-direct',
            ),
          );

        expect(
          result,
        ).toMatchObject({
          source:
            'LIVE_PROVIDER',

          transport:
            'OK',

          protocol:
            'PASS',
        });
      },
    );

    it(
      'runs one bounded fake Antigravity process and admits exact envelope',
      async () => {
        const directory =
          root();

        const invoke =
          createBoundedLiveProviderInvoker(
            config(
              directory,
            ),
          );

        const result =
          await invoke(
            input(
              'antigravity',
              'job-agy-direct',
            ),
          );

        expect(
          result,
        ).toMatchObject({
          source:
            'LIVE_PROVIDER',

          transport:
            'OK',

          protocol:
            'PASS',
        });
      },
    );

    it(
      'connects fake 1+1 provider processes through the transactional pool',
      async () => {
        const directory =
          root();

        const database =
          join(
            directory,
            'queue.sqlite',
          );

        enqueue(
          database,
          'codex',
          'job-codex-pool',
          1,
        );

        enqueue(
          database,
          'antigravity',
          'job-agy-pool',
          2,
        );

        const invoke =
          createBoundedLiveProviderInvoker(
            config(
              directory,
            ),
          );

        const result =
          await runLiveTransactionalProviderWorkerPool({
            queuePath:
              database,

            mode:
              'DUAL',

            codexSlots:
              1,

            antigravitySlots:
              1,

            leaseDurationMs:
              60_000,

            maxClaimsPerSlot:
              1,

            loadCapsule:
              capsule,

            invokeProvider:
              invoke,

            nowMs:
              clock(),
          });

        expect(
          result.totalLiveProviderCalls,
        ).toBe(2);

        expect(
          result.totalUsefulUnique,
        ).toBe(2);

        expect(
          result.codex.usefulUnique,
        ).toBe(1);

        expect(
          result.antigravity.usefulUnique,
        ).toBe(1);

        expect(
          result.fulgorCalled,
        ).toBe(false);

        expect(
          result.authorityGranted,
        ).toBe(false);
      },
    );

    it(
      'maps non-zero provider exit to transport failure',
      async () => {
        const directory =
          root();

        const invoke =
          createBoundedLiveProviderInvoker(
            config(
              directory,
              'nonzero',
              'nonzero',
            ),
          );

        expect(
          await invoke(
            input(
              'codex',
              'job-codex-exit',
            ),
          ),
        ).toEqual({
          source:
            'LIVE_PROVIDER',

          transport:
            'FAILURE',
        });

        expect(
          await invoke(
            input(
              'antigravity',
              'job-agy-exit',
            ),
          ),
        ).toEqual({
          source:
            'LIVE_PROVIDER',

          transport:
            'FAILURE',
        });
      },
    );

    it(
      'kills a timed-out process and performs no retry',
      async () => {
        const directory =
          root();

        const invoke =
          createBoundedLiveProviderInvoker(
            config(
              directory,
              'timeout',
            ),
          );

        const started =
          Date.now();

        const result =
          await invoke(
            input(
              'codex',
              'job-codex-timeout',
            ),
          );

        expect(
          result,
        ).toEqual({
          source:
            'LIVE_PROVIDER',

          transport:
            'FAILURE',
        });

        expect(
          Date.now() -
          started,
        ).toBeLessThan(
          2000,
        );
      },
    );

    it(
      'kills stdout overflow and admits no protocol payload',
      async () => {
        const directory =
          root();

        const invoke =
          createBoundedLiveProviderInvoker(
            config(
              directory,
              'overflow',
            ),
          );

        expect(
          await invoke(
            input(
              'codex',
              'job-codex-overflow',
            ),
          ),
        ).toEqual({
          source:
            'LIVE_PROVIDER',

          transport:
            'FAILURE',
        });
      },
    );

    it(
      'rejects Codex JSONL/native-final divergence as protocol failure',
      async () => {
        const directory =
          root();

        const invoke =
          createBoundedLiveProviderInvoker(
            config(
              directory,
              'diverge',
            ),
          );

        expect(
          await invoke(
            input(
              'codex',
              'job-codex-diverge',
            ),
          ),
        ).toEqual({
          source:
            'LIVE_PROVIDER',

          transport:
            'OK',

          protocol:
            'REJECTED',
        });
      },
    );

    it(
      'rejects Antigravity denied actions as protocol failure',
      async () => {
        const directory =
          root();

        const invoke =
          createBoundedLiveProviderInvoker(
            config(
              directory,
              'ok',
              'denied',
            ),
          );

        expect(
          await invoke(
            input(
              'antigravity',
              'job-agy-denied',
            ),
          ),
        ).toEqual({
          source:
            'LIVE_PROVIDER',

          transport:
            'OK',

          protocol:
            'REJECTED',
        });
      },
    );

    it(
      'does not leak arbitrary host environment variables to provider processes',
      async () => {
        const directory =
          root();

        const previous =
          process.env
            .VELNAR_TEST_SECRET;

        process.env
          .VELNAR_TEST_SECRET =
            'must-not-cross-boundary';

        try {
          const invoke =
            createBoundedLiveProviderInvoker(
              config(
                directory,
                'ok',
                'env',
              ),
            );

          expect(
            await invoke(
              input(
                'antigravity',
                'job-agy-env',
              ),
            ),
          ).toMatchObject({
            source:
              'LIVE_PROVIDER',

            transport:
              'OK',

            protocol:
              'PASS',
          });
        } finally {
          if (
            previous ===
              undefined
          ) {
            delete process.env
              .VELNAR_TEST_SECRET;
          } else {
            process.env
              .VELNAR_TEST_SECRET =
                previous;
          }
        }
      },
    );

    it(
      'fails construction on unsafe executable and resource configuration',
      () => {
        const directory =
          root();

        expect(() =>
          createBoundedLiveProviderInvoker({
            ...config(
              directory,
            ),

            codex: {
              ...config(
                directory,
              ).codex,

              executable:
                'relative-codex',
            },
          }),
        ).toThrow(
          /CODEX_EXECUTABLE_INVALID/,
        );

        expect(() =>
          createBoundedLiveProviderInvoker({
            ...config(
              directory,
            ),

            antigravity: {
              ...config(
                directory,
              ).antigravity,

              timeoutMs:
                360_001,
            },
          }),
        ).toThrow(
          /ANTIGRAVITY_TIMEOUT_INVALID/,
        );
      },
    );
  },
);


describe(
  'sanitized process telemetry',
  () => {
    it(
      'classifies non-zero exit without exposing raw streams',
      async () => {
        const directory =
          root();

        const telemetry:
          any[] = [];

        const invoke =
          createBoundedLiveProviderInvoker({
            ...config(
              directory,
              'nonzero',
            ),

            observeProcessTelemetry:
              value => {
                telemetry.push(
                  value,
                );
              },
          });

        expect(
          await invoke(
            input(
              'codex',
              'job-telemetry-nonzero',
            ),
          ),
        ).toEqual({
          source:
            'LIVE_PROVIDER',

          transport:
            'FAILURE',
        });

        expect(
          telemetry,
        ).toHaveLength(1);

        expect(
          telemetry[0],
        ).toMatchObject({
          provider:
            'codex',

          outcome:
            'FAILURE',

          failureReason:
            'NON_ZERO_EXIT',

          exitCode:
            7,

          timedOut:
            false,

          outputOverflow:
            false,
        });

        expect(
          telemetry[0]
            .stdoutBytes,
        ).toBe(0);

        expect(
          telemetry[0]
            .stderrBytes,
        ).toBe(0);

        expect(
          Object.keys(
            telemetry[0],
          ),
        ).not.toContain(
          'stdout',
        );

        expect(
          Object.keys(
            telemetry[0],
          ),
        ).not.toContain(
          'stderr',
        );
      },
    );

    it(
      'classifies timeout independently from signal termination',
      async () => {
        const directory =
          root();

        const telemetry:
          any[] = [];

        const invoke =
          createBoundedLiveProviderInvoker({
            ...config(
              directory,
              'timeout',
            ),

            observeProcessTelemetry:
              value => {
                telemetry.push(
                  value,
                );
              },
          });

        await invoke(
          input(
            'codex',
            'job-telemetry-timeout',
          ),
        );

        expect(
          telemetry,
        ).toHaveLength(1);

        expect(
          telemetry[0],
        ).toMatchObject({
          provider:
            'codex',

          outcome:
            'FAILURE',

          failureReason:
            'TIMEOUT',

          timedOut:
            true,
        });
      },
    );

    it(
      'classifies output ceiling independently from process signal',
      async () => {
        const directory =
          root();

        const telemetry:
          any[] = [];

        const invoke =
          createBoundedLiveProviderInvoker({
            ...config(
              directory,
              'overflow',
            ),

            observeProcessTelemetry:
              value => {
                telemetry.push(
                  value,
                );
              },
          });

        await invoke(
          input(
            'codex',
            'job-telemetry-overflow',
          ),
        );

        expect(
          telemetry,
        ).toHaveLength(1);

        expect(
          telemetry[0],
        ).toMatchObject({
          provider:
            'codex',

          outcome:
            'FAILURE',

          failureReason:
            'OUTPUT_LIMIT',

          timedOut:
            false,

          outputOverflow:
            true,
        });

        expect(
          telemetry[0]
            .stdoutBytes,
        ).toBeGreaterThan(
          1024,
        );
      },
    );

    it(
      'keeps telemetry observer non-authoritative',
      async () => {
        const directory =
          root();

        const invoke =
          createBoundedLiveProviderInvoker({
            ...config(
              directory,
            ),

            observeProcessTelemetry:
              () => {
                throw new Error(
                  'OBSERVER_FAILURE',
                );
              },
          });

        expect(
          await invoke(
            input(
              'antigravity',
              'job-telemetry-observer',
            ),
          ),
        ).toMatchObject({
          source:
            'LIVE_PROVIDER',

          transport:
            'OK',

          protocol:
            'PASS',
        });
      },
    );
  },
);


// VELNAR_ANTIGRAVITY_FINISH_SUBMISSION_CONTRACT

describe(
  'Antigravity structured-output finalization contract',
  () => {
    it(
      'permits only internal finish submission for Antigravity while Codex remains tool-free',
      () => {
        const directory =
          root();

        const agyRecord =
          record(
            'antigravity',
            'job-agy-finish-contract',
          );

        const agyPrompt =
          buildProviderWorkProductPrompt({
            provider:
              'antigravity',

            repoRoot:
              directory,

            record:
              agyRecord,

            capsule:
              capsule(
                agyRecord,
              ),

            evidence:
              preparedEvidence,
          });

        expect(
          agyPrompt,
        ).toContain(
          '- Do not invoke any tool except the Antigravity internal `finish` structured-output submission tool.',
        );

        expect(
          agyPrompt,
        ).toContain(
          '- Invoke `finish` exactly once, only after analysis is complete, to submit the final schema-constrained VELNAR_PROVIDER_WORK_PRODUCT_V1 object.',
        );

        expect(
          agyPrompt,
        ).toContain(
          '- `finish` is output transport only and grants no permission for shell, filesystem, repository, network, credential, deployment, promotion or authority actions.',
        );

        expect(
          agyPrompt,
        ).not.toContain(
          '\n- Do not invoke any tool.\n',
        );

        const codexRecord =
          record(
            'codex',
            'job-codex-no-tool-contract',
          );

        const codexPrompt =
          buildProviderWorkProductPrompt({
            provider:
              'codex',

            repoRoot:
              directory,

            record:
              codexRecord,

            capsule:
              capsule(
                codexRecord,
              ),

            evidence:
              preparedEvidence,
          });

        expect(
          codexPrompt,
        ).toContain(
          '- Do not invoke any tool.',
        );

        expect(
          codexPrompt,
        ).not.toContain(
          'Antigravity internal `finish`',
        );
      },
    );
  },
);
