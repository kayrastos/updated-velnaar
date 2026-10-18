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

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

const capsule:
HostEvidenceCapsule = {
  taskId: 'task-001',
  baseline,

  evidence: [
    {
      id: 'E1',
      path:
        'worker/intelligence/a.ts',

      sha256:
        'a'.repeat(64),
    },

    {
      id: 'E2',
      path:
        'tests/intelligence/a.test.ts',

      sha256:
        'b'.repeat(64),
    },

    {
      id: 'E3',
      path:
        'worker/intelligence/b.ts',

      sha256:
        'c'.repeat(64),
    },
  ],
};

function base() {
  return {
    schemaVersion:
      PROVIDER_WORK_PRODUCT_SCHEMA,

    provider: 'codex',

    taskId:
      capsule.taskId,

    baseline,

    status:
      'PROPOSE_CHANGE',

    summary:
      'A bounded repository change is supported by host-provided evidence.',

    evidenceIds:
      ['E1', 'E2'],

    candidate: {
      path:
        'tests/intelligence/new-regression.test.ts',

      content:
        'export const regression = true;\n',
    },

    tests: [
      'Run the targeted regression test.',
    ],

    blocker: null,
  };
}

describe(
  'provider work-product acceptance',
  () => {
    it(
      'accepts an evidence-backed proposal as usable but never verified',
      () => {
        const result =
          parseProviderWorkProduct(
            JSON.stringify(base()),
            capsule,
            'codex',
          );

        expect(result.usable)
          .toBe(true);

        expect(result.verified)
          .toBe(false);

        expect(
          result.authorityGranted,
        ).toBe(false);

        expect(
          result.evidenceCount,
        ).toBe(2);
      },
    );

    it(
      'does not count transport-shaped junk as useful work',
      () => {
        expect(() =>
          parseProviderWorkProduct(
            '{"status":"success"}',
            capsule,
            'codex',
          ),
        ).toThrow();
      },
    );

    it(
      'rejects unknown model-invented evidence IDs',
      () => {
        const value = base();

        value.evidenceIds =
          ['E1', 'INVENTED'];

        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          ),
        ).toThrow(
          /UNKNOWN_EVIDENCE_ID/,
        );
      },
    );

    it(
      'rejects stale baseline output',
      () => {
        const value = base();

        value.baseline =
          'f'.repeat(40);

        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          ),
        ).toThrow(
          /BASELINE_MISMATCH/,
        );
      },
    );

    it(
      'rejects cross-provider output',
      () => {
        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(base()),
            capsule,
            'antigravity',
          ),
        ).toThrow(
          /PROVIDER_MISMATCH/,
        );
      },
    );

    it(
      'rejects proposals without enough host evidence',
      () => {
        const value = base();

        value.evidenceIds =
          ['E1'];

        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          ),
        ).toThrow(
          /PROPOSAL_INCOMPLETE/,
        );
      },
    );

    it(
      'rejects proposals without a candidate',
      () => {
        const value = {
          ...base(),
          candidate: null,
        };

        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          ),
        ).toThrow(
          /PROPOSAL_INCOMPLETE/,
        );
      },
    );

    it(
      'rejects proposals without a regression test',
      () => {
        const value = base();

        value.tests = [];

        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          ),
        ).toThrow(
          /PROPOSAL_INCOMPLETE/,
        );
      },
    );

    it(
      'accepts evidence-backed no-change as useful',
      () => {
        const value = {
          ...base(),

          status:
            'NO_CHANGE_NEEDED',

          candidate: null,

          tests: [],

          blocker: null,
        };

        const result =
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          );

        expect(result.usable)
          .toBe(true);

        expect(
          result.workProduct.status,
        ).toBe(
          'NO_CHANGE_NEEDED',
        );
      },
    );

    it(
      'treats BLOCKED as valid protocol but not useful work',
      () => {
        const value = {
          ...base(),

          status: 'BLOCKED',

          evidenceIds: [],

          candidate: null,

          tests: [],

          blocker:
            'Required repository evidence is unavailable.',
        };

        const result =
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          );

        expect(result.usable)
          .toBe(false);
      },
    );

    it(
      'rejects unsafe candidate paths',
      () => {
        const value = base();

        value.candidate.path =
          '../escape.ts';

        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          ),
        ).toThrow(
          /PATH_UNSAFE/,
        );
      },
    );

    it(
      'rejects duplicate evidence IDs',
      () => {
        const value = base();

        value.evidenceIds =
          ['E1', 'E1'];

        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          ),
        ).toThrow(
          /EVIDENCE_IDS_DUPLICATE/,
        );
      },
    );

    it(
      'rejects extra unrecognized output fields',
      () => {
        const value = {
          ...base(),

          claimedVerified:
            true,
        };

        expect(() =>
          parseProviderWorkProduct(
            JSON.stringify(value),
            capsule,
            'codex',
          ),
        ).toThrow(
          /ROOT_KEYS_INVALID/,
        );
      },
    );

    it(
      'rejects malformed JSON',
      () => {
        expect(() =>
          parseProviderWorkProduct(
            '{bad',
            capsule,
            'codex',
          ),
        ).toThrow(
          /INVALID_JSON/,
        );
      },
    );
  },
);
