import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  evaluateBacklogGroundingPreflight,
} from '../../../scripts/fulgor/orchestration/backlogGroundingPreflight';

const evidence = [
  {
    id: 'E1',
    content: [
      'export function validateRfc3339(value: string) {',
      '  return value.endsWith("Z");',
      '}',
    ].join('\n'),
  },

  {
    id: 'E2',
    content: [
      'export function getTenantResource(',
      '  organizationId: string,',
      ') {',
      '  return organizationId;',
      '}',
    ].join('\n'),
  },
] as const;

describe(
  'VELNAR backlog grounding preflight',
  () => {
    it(
      'accepts one bounded focus with two real evidence anchors',
      () => {
        const result =
          evaluateBacklogGroundingPreflight(
            [
              'GROUNDING_V1',
              'FOCUS: Review tenant resource timestamp validation.',
              'EVIDENCE: E1|validateRfc3339',
              'EVIDENCE: E2|getTenantResource',
            ].join('\n'),
            evidence,
          );

        expect(
          result.accepted,
        ).toBe(true);

        expect(
          result.failureCode,
        ).toBeNull();

        expect(
          result.task?.requirements,
        ).toHaveLength(2);
      },
    );

    it(
      'rejects a missing evidence anchor before provider execution',
      () => {
        const result =
          evaluateBacklogGroundingPreflight(
            [
              'GROUNDING_V1',
              'FOCUS: Review slot-window validation.',
              'EVIDENCE: E1|validateRfc3339',
              'EVIDENCE: E2|slotWindowBoundary',
            ].join('\n'),
            evidence,
          );

        expect(
          result,
        ).toMatchObject({
          accepted:
            false,

          failureCode:
            'GROUNDING_ANCHOR_NOT_FOUND',
        });
      },
    );

    it(
      'rejects multi-scope focus before provider execution',
      () => {
        const result =
          evaluateBacklogGroundingPreflight(
            [
              'GROUNDING_V1',
              'FOCUS: Review RFC3339 validation and slot-window boundaries.',
              'EVIDENCE: E1|validateRfc3339',
              'EVIDENCE: E2|getTenantResource',
            ].join('\n'),
            evidence,
          );

        expect(
          result,
        ).toMatchObject({
          accepted:
            false,

          failureCode:
            'GROUNDING_FOCUS_INVALID',
        });
      },
    );

    it(
      'requires two distinct evidence IDs',
      () => {
        const result =
          evaluateBacklogGroundingPreflight(
            [
              'GROUNDING_V1',
              'FOCUS: Review timestamp validation.',
              'EVIDENCE: E1|validateRfc3339',
              'EVIDENCE: E1|endsWith',
            ].join('\n'),
            evidence,
          );

        expect(
          result.accepted,
        ).toBe(false);
      },
    );

    it(
      'rejects unknown evidence IDs',
      () => {
        const result =
          evaluateBacklogGroundingPreflight(
            [
              'GROUNDING_V1',
              'FOCUS: Review timestamp validation.',
              'EVIDENCE: E1|validateRfc3339',
              'EVIDENCE: E9|getTenantResource',
            ].join('\n'),
            evidence,
          );

        expect(
          result,
        ).toMatchObject({
          accepted:
            false,

          failureCode:
            'GROUNDING_EVIDENCE_ID_UNKNOWN',
        });
      },
    );
  },
);
