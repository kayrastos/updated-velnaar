import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  PROVIDER_WORK_PRODUCT_SCHEMA,
  parseProviderWorkProduct,
  type HostEvidenceCapsule,
} from '../../../scripts/fulgor/orchestration/providerWorkProductGate';

import {
  automaticQualityRetryAllowed,
  certifyProviderQuality,
  classifyAcceptedWork,
  closeQualityCircuit,
  countsAsUsefulCompletion,
  emptyProviderQualityCounters,
  productiveWorkRate,
  qualityAllowsScaleUp,
  recordWorkOutcome,
  stepQualityCircuit,
  workProductFingerprint,
} from '../../../scripts/fulgor/orchestration/providerWorkAccounting';

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const capsule:
HostEvidenceCapsule = {
  taskId:
    'quality-task-001',

  baseline,

  evidence: [
    {
      id: 'E1',
      path: 'worker/a.ts',
      sha256: 'a'.repeat(64),
    },

    {
      id: 'E2',
      path: 'tests/a.test.ts',
      sha256: 'b'.repeat(64),
    },
  ],
};

function accepted(
  summary =
    'Evidence-backed bounded change.',
  content =
    'export const x = 1;\n',
  provider:
    'codex' | 'antigravity' =
      'codex',
) {
  return parseProviderWorkProduct(
    JSON.stringify({
      schemaVersion:
        PROVIDER_WORK_PRODUCT_SCHEMA,

      provider,

      taskId:
        capsule.taskId,

      baseline,

      status:
        'PROPOSE_CHANGE',

      summary,

      evidenceIds:
        ['E1', 'E2'],

      candidate: {
        path:
          'tests/new-regression.test.ts',

        content,
      },

      tests: [
        'Run targeted regression.',
      ],

      blocker: null,
    }),
    capsule,
    provider,
  );
}

describe(
  'VELNAR useful-work accounting',
  () => {
    it(
      'counts only unique useful work as productive completion',
      () => {
        expect(
          countsAsUsefulCompletion(
            'USEFUL_UNIQUE',
          ),
        ).toBe(true);

        for (
          const outcome of [
            'TRANSPORT_FAILURE',
            'PROTOCOL_REJECTED',
            'CONTRACT_REJECTED',
            'BLOCKED',
            'USEFUL_DUPLICATE',
          ] as const
        ) {
          expect(
            countsAsUsefulCompletion(
              outcome,
            ),
          ).toBe(false);
        }
      },
    );

    it(
      'does not let paraphrased summaries evade deduplication',
      () => {
        const a =
          accepted(
            'First wording.',
          );

        const b =
          accepted(
            'Completely different wording.',
          );

        expect(
          workProductFingerprint(a),
        ).toBe(
          workProductFingerprint(b),
        );
      },
    );

    it(
      'treats identical Codex and Antigravity work as one useful-work identity',
      () => {
        const codex =
          accepted(
            'Codex wording.',
            'export const x = 1;\n',
            'codex',
          );

        const antigravity =
          accepted(
            'Antigravity wording.',
            'export const x = 1;\n',
            'antigravity',
          );

        expect(
          workProductFingerprint(
            codex,
          ),
        ).toBe(
          workProductFingerprint(
            antigravity,
          ),
        );
      },
    );

    it(
      'does not collide when different capsules reuse the same local evidence IDs',
      () => {
        const raw =
          JSON.stringify({
            schemaVersion:
              PROVIDER_WORK_PRODUCT_SCHEMA,

            provider: 'codex',

            taskId:
              capsule.taskId,

            baseline,

            status:
              'PROPOSE_CHANGE',

            summary:
              'Same candidate, different host evidence.',

            evidenceIds:
              ['E1', 'E2'],

            candidate: {
              path:
                'tests/new-regression.test.ts',

              content:
                'export const x = 1;\n',
            },

            tests: [
              'Run targeted regression.',
            ],

            blocker: null,
          });

        const first =
          parseProviderWorkProduct(
            raw,
            capsule,
            'codex',
          );

        const changedCapsule:
          HostEvidenceCapsule = {
            ...capsule,

            evidence: [
              {
                id: 'E1',
                path:
                  'worker/a.ts',

                sha256:
                  'c'.repeat(64),
              },

              {
                id: 'E2',
                path:
                  'tests/a.test.ts',

                sha256:
                  'd'.repeat(64),
              },
            ],
          };

        const second =
          parseProviderWorkProduct(
            raw,
            changedCapsule,
            'codex',
          );

        expect(
          first.workProduct
            .evidenceIds,
        ).toEqual(
          second.workProduct
            .evidenceIds,
        );

        expect(
          workProductFingerprint(
            first,
          ),
        ).not.toBe(
          workProductFingerprint(
            second,
          ),
        );
      },
    );

    it(
      'different candidate bytes create different fingerprints',
      () => {
        const a =
          accepted(
            'same',
            'export const x = 1;\n',
          );

        const b =
          accepted(
            'same',
            'export const x = 2;\n',
          );

        expect(
          workProductFingerprint(a),
        ).not.toBe(
          workProductFingerprint(b),
        );
      },
    );

    it(
      'classifies first usable output as unique and repeated output as duplicate',
      () => {
        const value =
          accepted();

        const fingerprint =
          workProductFingerprint(
            value,
          );

        expect(
          classifyAcceptedWork(
            value,
            new Set(),
          ).outcome,
        ).toBe(
          'USEFUL_UNIQUE',
        );

        expect(
          classifyAcceptedWork(
            value,
            new Set([
              fingerprint,
            ]),
          ).outcome,
        ).toBe(
          'USEFUL_DUPLICATE',
        );
      },
    );

    it(
      'records productive rate from unique useful work rather than raw completion',
      () => {
        let state =
          emptyProviderQualityCounters(
            'codex',
          );

        state =
          recordWorkOutcome(
            state,
            'USEFUL_UNIQUE',
          );

        state =
          recordWorkOutcome(
            state,
            'USEFUL_DUPLICATE',
          );

        state =
          recordWorkOutcome(
            state,
            'BLOCKED',
          );

        state =
          recordWorkOutcome(
            state,
            'CONTRACT_REJECTED',
          );

        expect(state.attempts)
          .toBe(4);

        expect(state.usefulUnique)
          .toBe(1);

        expect(
          productiveWorkRate(
            state,
          ),
        ).toBe(0.25);
      },
    );

    it(
      'opens provider-local quality circuit on protocol failure',
      () => {
        expect(
          stepQualityCircuit(
            'CLOSED',
            'PROTOCOL_REJECTED',
          ),
        ).toBe('OPEN');
      },
    );

    it(
      'opens provider-local quality circuit on contract failure',
      () => {
        expect(
          stepQualityCircuit(
            'CLOSED',
            'CONTRACT_REJECTED',
          ),
        ).toBe('OPEN');
      },
    );

    it(
      'does not open provider quality circuit for a legitimate BLOCKED task',
      () => {
        expect(
          stepQualityCircuit(
            'CLOSED',
            'BLOCKED',
          ),
        ).toBe('CLOSED');
      },
    );

    it(
      'does not automatically close an opened circuit',
      () => {
        expect(
          stepQualityCircuit(
            'OPEN',
            'USEFUL_UNIQUE',
          ),
        ).toBe('OPEN');
      },
    );

    it(
      'requires every selected certification sample to be unique usable work',
      () => {
        const pass =
          certifyProviderQuality(
            'codex',
            baseline,
            [
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
            ],
          );

        expect(pass.certified)
          .toBe(true);

        const fail =
          certifyProviderQuality(
            'codex',
            baseline,
            [
              'USEFUL_UNIQUE',
              'BLOCKED',
            ],
          );

        expect(fail.certified)
          .toBe(false);
      },
    );

    it(
      'closes an opened quality circuit only after successful certification',
      () => {
        const cert =
          certifyProviderQuality(
            'antigravity',
            baseline,
            [
              'USEFUL_UNIQUE',
            ],
          );

        expect(
          closeQualityCircuit(
            'OPEN',
            cert,
          ),
        ).toBe('CLOSED');
      },
    );

    it(
      'never allows scale-up without successful work-quality certification',
      () => {
        expect(
          qualityAllowsScaleUp(
            null,
          ),
        ).toBe(false);

        const failed =
          certifyProviderQuality(
            'codex',
            baseline,
            [
              'USEFUL_DUPLICATE',
            ],
          );

        expect(
          qualityAllowsScaleUp(
            failed,
          ),
        ).toBe(false);

        const pass =
          certifyProviderQuality(
            'codex',
            baseline,
            [
              'USEFUL_UNIQUE',
            ],
          );

        expect(
          qualityAllowsScaleUp(
            pass,
          ),
        ).toBe(true);
      },
    );

    it(
      'never blindly retries output-quality failures',
      () => {
        for (
          const outcome of [
            'TRANSPORT_FAILURE',
            'PROTOCOL_REJECTED',
            'CONTRACT_REJECTED',
            'BLOCKED',
            'USEFUL_DUPLICATE',
            'USEFUL_UNIQUE',
          ] as const
        ) {
          expect(
            automaticQualityRetryAllowed(
              outcome,
            ),
          ).toBe(false);
        }
      },
    );
  },
);
