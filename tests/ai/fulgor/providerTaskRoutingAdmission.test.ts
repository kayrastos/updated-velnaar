import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  mkdtempSync,
  rmSync,
} from 'node:fs';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import {
  emptyProviderQualityCounters,
  recordWorkOutcome,
  type WorkOutcome,
} from '../../../scripts/fulgor/orchestration/providerWorkAccounting';

import {
  createProviderWorkOrder,
} from '../../../scripts/fulgor/orchestration/providerWorkOrder';

import {
  TransactionalProviderQueue,
} from '../../../scripts/fulgor/orchestration/transactionalProviderQueue';

import {
  routeAndEnqueueProviderWork,
} from '../../../scripts/fulgor/orchestration/providerTaskRoutingAdmission';

import type {
  ProviderTaskClass,
  ProviderTaskLaneEvidence,
} from '../../../scripts/fulgor/scheduler/providerTaskRouter';

const roots:
  string[] = [];

const baseline =
  '0123456789abcdef0123456789abcdef01234567';

function root(): string {
  const value =
    mkdtempSync(
      join(
        tmpdir(),
        'velnar-router-admission-',
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

function lane(
  provider:
    'codex' |
    'antigravity',

  taskClass:
    ProviderTaskClass,

  outcomes:
    readonly WorkOutcome[],

  options:
    Readonly<{
      certified?: boolean;
      qualityOpen?: boolean;
      quotaOpen?: boolean;
      availableSlots?: number;
    }> = {},
): ProviderTaskLaneEvidence {
  let counters =
    emptyProviderQualityCounters(
      provider,
    );

  for (
    const outcome
    of outcomes
  ) {
    counters =
      recordWorkOutcome(
        counters,
        outcome,
      );
  }

  return Object.freeze({
    provider,
    taskClass,
    counters,

    certified:
      options.certified ??
      true,

    qualityCircuit:
      options.qualityOpen
        ? 'OPEN'
        : 'CLOSED',

    quotaCircuit:
      options.quotaOpen
        ? 'OPEN'
        : 'CLOSED',

    availableSlots:
      options.availableSlots ??
      4,
  });
}

const eightUseful =
  Object.freeze(
    Array.from(
      {
        length:
          8,
      },

      () =>
        'USEFUL_UNIQUE' as const,
    ),
  );

const sevenOfEight =
  Object.freeze([
    'USEFUL_UNIQUE',
    'USEFUL_UNIQUE',
    'USEFUL_UNIQUE',
    'USEFUL_UNIQUE',
    'USEFUL_UNIQUE',
    'USEFUL_UNIQUE',
    'USEFUL_UNIQUE',
    'BLOCKED',
  ] as const);

function order(
  jobId:
    string,

  affinity:
    'codex' |
    'antigravity' |
    'either',
) {
  return createProviderWorkOrder({
    jobId,
    baseline,

    task:
      'Return bounded evidence-backed work only.',

    evidenceIds:
      [
        'E1',
        'E2',
      ],

    affinity,
  });
}

describe(
  'VELNAR provider task routing admission V1',
  () => {
    it(
      'pins an either-affinity order to the only eligible provider before enqueue',
      () => {
        const db =
          join(
            root(),
            'queue.sqlite',
          );

        const queue =
          new TransactionalProviderQueue(
            db,
          );

        try {
          const result =
            routeAndEnqueueProviderWork({
              queue,

              order:
                order(
                  'route-to-agy',
                  'either',
                ),

              taskClass:
                'SEMANTIC_CONTRACT',

              codex:
                lane(
                  'codex',
                  'SEMANTIC_CONTRACT',
                  sevenOfEight,
                ),

              antigravity:
                lane(
                  'antigravity',
                  'SEMANTIC_CONTRACT',
                  eightUseful,
                ),

              nowMs:
                1_000,
            });

          expect(
            result.status,
          ).toBe(
            'ENQUEUED',
          );

          expect(
            result.decision.provider,
          ).toBe(
            'antigravity',
          );

          expect(
            result.record
              ?.order.affinity,
          ).toBe(
            'antigravity',
          );

          expect(
            queue.get(
              'route-to-agy',
            )?.order.affinity,
          ).toBe(
            'antigravity',
          );

          expect(
            result.verificationGranted,
          ).toBe(false);

          expect(
            result.authorityGranted,
          ).toBe(false);

          expect(
            result.executionGranted,
          ).toBe(false);
        } finally {
          queue.close();
        }
      },
    );

    it(
      'holds an unproven task class and does not enqueue anything',
      () => {
        const db =
          join(
            root(),
            'hold.sqlite',
          );

        const queue =
          new TransactionalProviderQueue(
            db,
          );

        const fourUseful =
          Object.freeze([
            'USEFUL_UNIQUE',
            'USEFUL_UNIQUE',
            'USEFUL_UNIQUE',
            'USEFUL_UNIQUE',
          ] as const);

        try {
          const result =
            routeAndEnqueueProviderWork({
              queue,

              order:
                order(
                  'hold-unproven',
                  'either',
                ),

              taskClass:
                'INVOCATION_BOUND',

              codex:
                lane(
                  'codex',
                  'INVOCATION_BOUND',
                  fourUseful,
                ),

              antigravity:
                lane(
                  'antigravity',
                  'INVOCATION_BOUND',
                  fourUseful,
                ),

              nowMs:
                2_000,
            });

          expect(
            result.status,
          ).toBe(
            'HOLD',
          );

          expect(
            result.record,
          ).toBeNull();

          expect(
            queue.get(
              'hold-unproven',
            ),
          ).toBeNull();

          expect(
            result.decision
              .holdReason,
          ).toBe(
            'NO_ELIGIBLE_PROVIDER',
          );
        } finally {
          queue.close();
        }
      },
    );

    it(
      'does not silently reroute an explicitly pinned provider',
      () => {
        const db =
          join(
            root(),
            'explicit.sqlite',
          );

        const queue =
          new TransactionalProviderQueue(
            db,
          );

        try {
          const result =
            routeAndEnqueueProviderWork({
              queue,

              order:
                order(
                  'explicit-codex',
                  'codex',
                ),

              taskClass:
                'AUTHORITY_BOUNDARY',

              codex:
                lane(
                  'codex',
                  'AUTHORITY_BOUNDARY',
                  sevenOfEight,
                ),

              antigravity:
                lane(
                  'antigravity',
                  'AUTHORITY_BOUNDARY',
                  eightUseful,
                ),

              nowMs:
                3_000,
            });

          expect(
            result.status,
          ).toBe(
            'HOLD',
          );

          expect(
            result.decision
              .holdReason,
          ).toBe(
            'PREFERRED_PROVIDER_NOT_ELIGIBLE',
          );

          expect(
            queue.get(
              'explicit-codex',
            ),
          ).toBeNull();
        } finally {
          queue.close();
        }
      },
    );

    it(
      'cannot use routing admission to claim execute verify or settle work',
      () => {
        const source =
          routeAndEnqueueProviderWork
            .toString();

        expect(
          source.includes(
            'claimNext',
          ),
        ).toBe(false);

        expect(
          source.includes(
            'invokeProvider',
          ),
        ).toBe(false);

        expect(
          source.includes(
            'settle',
          ),
        ).toBe(false);
      },
    );
  },
);
