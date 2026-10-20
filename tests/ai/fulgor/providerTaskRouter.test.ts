import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  emptyProviderQualityCounters,
  recordWorkOutcome,
  type WorkOutcome,
} from '../../../scripts/fulgor/orchestration/providerWorkAccounting';

import {
  PROVIDER_TASK_CLASSES,
  PROVIDER_TASK_ROUTER_POLICY,
  routeProviderTask,
  type ProviderTaskClass,
  type ProviderTaskLaneEvidence,
} from '../../../scripts/fulgor/scheduler/providerTaskRouter';

function lane(
  provider:
    'codex'
    | 'antigravity',

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

describe(
  'VELNAR canonical provider task router V1',
  () => {
    it(
      'pins the canonical classes and ninety-percent floor',
      () => {
        expect(
          PROVIDER_TASK_CLASSES,
        ).toEqual([
          'GENERAL',
          'AUTHORITY_BOUNDARY',
          'SEMANTIC_CONTRACT',
          'INVOCATION_BOUND',
          'CONCURRENCY_CONTROL',
          'TRANSPORT_SAFETY',
          'PROTOCOL_VALIDATION',
          'EVIDENCE_BINDING',
        ]);

        expect(
          PROVIDER_TASK_ROUTER_POLICY
            .minimumAttemptsPerTaskClass,
        ).toBe(8);

        expect(
          PROVIDER_TASK_ROUTER_POLICY
            .minimumUsefulYield,
        ).toBe(0.90);

        expect(
          PROVIDER_TASK_ROUTER_POLICY
            .maxAvailableSlotsPerProvider,
        ).toBe(8);
      },
    );

    it(
      'routes a class away from Codex at 7/8 to Antigravity at 8/8',
      () => {
        const codexOutcomes:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'BLOCKED',
            ]);

        const result =
          routeProviderTask({
            taskClass:
              'SEMANTIC_CONTRACT',

            preference:
              'AUTO',

            codex:
              lane(
                'codex',
                'SEMANTIC_CONTRACT',
                codexOutcomes,
              ),

            antigravity:
              lane(
                'antigravity',
                'SEMANTIC_CONTRACT',
                eightUseful,
              ),
          });

        expect(
          result.codexUsefulYield,
        ).toBe(7 / 8);

        expect(
          result.codexEligible,
        ).toBe(false);

        expect(
          result.antigravityEligible,
        ).toBe(true);

        expect(
          result.status,
        ).toBe('ROUTE');

        expect(
          result.provider,
        ).toBe(
          'antigravity',
        );

        expect(
          result.routeReason,
        ).toBe(
          'ONLY_ELIGIBLE_PROVIDER',
        );
      },
    );

    it(
      'treats exactly ninety percent as eligible',
      () => {
        const ninety:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'BLOCKED',
            ]);

        const result =
          routeProviderTask({
            taskClass:
              'AUTHORITY_BOUNDARY',

            preference:
              'codex',

            codex:
              lane(
                'codex',
                'AUTHORITY_BOUNDARY',
                ninety,
              ),

            antigravity:
              lane(
                'antigravity',
                'AUTHORITY_BOUNDARY',
                eightUseful,
              ),
          });

        expect(
          result.codexUsefulYield,
        ).toBe(0.9);

        expect(
          result.provider,
        ).toBe('codex');
      },
    );

    it(
      'holds an unproven task class instead of gambling quota',
      () => {
        const fourUseful =
          Object.freeze(
            Array.from(
              {
                length:
                  4,
              },
              () =>
                'USEFUL_UNIQUE' as const,
            ),
          );

        const result =
          routeProviderTask({
            taskClass:
              'INVOCATION_BOUND',

            preference:
              'AUTO',

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
          });

        expect(
          result.status,
        ).toBe('HOLD');

        expect(
          result.provider,
        ).toBeNull();

        expect(
          result.holdReason,
        ).toBe(
          'NO_ELIGIBLE_PROVIDER',
        );
      },
    );

    it(
      'holds when class certification is absent even with perfect raw outcomes',
      () => {
        const result =
          routeProviderTask({
            taskClass:
              'TRANSPORT_SAFETY',

            preference:
              'AUTO',

            codex:
              lane(
                'codex',
                'TRANSPORT_SAFETY',
                eightUseful,
                {
                  certified:
                    false,
                },
              ),

            antigravity:
              lane(
                'antigravity',
                'TRANSPORT_SAFETY',
                eightUseful,
                {
                  certified:
                    false,
                },
              ),
          });

        expect(
          result.status,
        ).toBe('HOLD');
      },
    );

    it(
      'removes an open quality or quota lane from eligibility',
      () => {
        const result =
          routeProviderTask({
            taskClass:
              'PROTOCOL_VALIDATION',

            preference:
              'AUTO',

            codex:
              lane(
                'codex',
                'PROTOCOL_VALIDATION',
                eightUseful,
                {
                  qualityOpen:
                    true,
                },
              ),

            antigravity:
              lane(
                'antigravity',
                'PROTOCOL_VALIDATION',
                eightUseful,
              ),
          });

        expect(
          result.provider,
        ).toBe(
          'antigravity',
        );

        expect(
          result.codexEligible,
        ).toBe(false);
      },
    );

    it(
      'uses useful yield before spare capacity when both lanes are eligible',
      () => {
        const codex:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'BLOCKED',
            ]);

        const result =
          routeProviderTask({
            taskClass:
              'EVIDENCE_BINDING',

            preference:
              'AUTO',

            codex:
              lane(
                'codex',
                'EVIDENCE_BINDING',
                codex,
                {
                  availableSlots:
                    8,
                },
              ),

            antigravity:
              lane(
                'antigravity',
                'EVIDENCE_BINDING',
                eightUseful,
                {
                  availableSlots:
                    1,
                },
              ),
          });

        expect(
          result.provider,
        ).toBe(
          'antigravity',
        );

        expect(
          result.routeReason,
        ).toBe(
          'HIGHER_USEFUL_YIELD',
        );
      },
    );

    it(
      'uses greater available capacity only after an equal useful yield',
      () => {
        const result =
          routeProviderTask({
            taskClass:
              'CONCURRENCY_CONTROL',

            preference:
              'AUTO',

            codex:
              lane(
                'codex',
                'CONCURRENCY_CONTROL',
                eightUseful,
                {
                  availableSlots:
                    2,
                },
              ),

            antigravity:
              lane(
                'antigravity',
                'CONCURRENCY_CONTROL',
                eightUseful,
                {
                  availableSlots:
                    6,
                },
              ),
          });

        expect(
          result.provider,
        ).toBe(
          'antigravity',
        );

        expect(
          result.routeReason,
        ).toBe(
          'GREATER_AVAILABLE_CAPACITY',
        );
      },
    );

    it(
      'uses a deterministic provider tie break with no hidden model preference',
      () => {
        const result =
          routeProviderTask({
            taskClass:
              'GENERAL',

            preference:
              'AUTO',

            codex:
              lane(
                'codex',
                'GENERAL',
                eightUseful,
              ),

            antigravity:
              lane(
                'antigravity',
                'GENERAL',
                eightUseful,
              ),
          });

        expect(
          result.provider,
        ).toBe('codex');

        expect(
          result.routeReason,
        ).toBe(
          'DETERMINISTIC_TIE_BREAK',
        );
      },
    );

    it(
      'does not silently fall back when an explicitly pinned provider is ineligible',
      () => {
        const degraded:
          readonly WorkOutcome[] =
            Object.freeze([
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'USEFUL_UNIQUE',
              'BLOCKED',
            ]);

        const result =
          routeProviderTask({
            taskClass:
              'AUTHORITY_BOUNDARY',

            preference:
              'codex',

            codex:
              lane(
                'codex',
                'AUTHORITY_BOUNDARY',
                degraded,
              ),

            antigravity:
              lane(
                'antigravity',
                'AUTHORITY_BOUNDARY',
                eightUseful,
              ),
          });

        expect(
          result.status,
        ).toBe('HOLD');

        expect(
          result.provider,
        ).toBeNull();

        expect(
          result.holdReason,
        ).toBe(
          'PREFERRED_PROVIDER_NOT_ELIGIBLE',
        );
      },
    );

    it(
      'rejects more than eight available slots for either provider',
      () => {
        expect(() =>
          routeProviderTask({
            taskClass:
              'GENERAL',

            preference:
              'AUTO',

            codex:
              lane(
                'codex',
                'GENERAL',
                eightUseful,
                {
                  availableSlots:
                    9,
                },
              ),

            antigravity:
              lane(
                'antigravity',
                'GENERAL',
                eightUseful,
              ),
          }),
        ).toThrow(
          /AVAILABLE_SLOTS_INVALID/,
        );
      },
    );

    it(
      'grants no verification execution or promotion authority',
      () => {
        const result =
          routeProviderTask({
            taskClass:
              'GENERAL',

            preference:
              'AUTO',

            codex:
              lane(
                'codex',
                'GENERAL',
                eightUseful,
              ),

            antigravity:
              lane(
                'antigravity',
                'GENERAL',
                eightUseful,
              ),
          });

        expect(
          result.verificationGranted,
        ).toBe(false);

        expect(
          result.authorityGranted,
        ).toBe(false);

        expect(
          result.automaticPromotionAllowed,
        ).toBe(false);
      },
    );
  },
);
