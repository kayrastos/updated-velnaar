import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  isStrictUtcTimestamp,
} from '../../../../scripts/fulgor/corpus/validation/strictUtcTimestamp';

describe(
  'FULGOR strict UTC timestamps',
  () => {
    it(
      'accepts canonical UTC second precision',
      () => {
        expect(
          isStrictUtcTimestamp(
            '2026-09-29T15:12:34Z',
          ),
        ).toBe(true);
      },
    );

    it(
      'accepts canonical UTC millisecond precision',
      () => {
        expect(
          isStrictUtcTimestamp(
            '2026-09-29T15:12:34.123Z',
          ),
        ).toBe(true);
      },
    );

    it(
      'rejects timezone offsets even when they represent UTC-equivalent instants',
      () => {
        expect(
          isStrictUtcTimestamp(
            '2026-09-29T18:12:34+03:00',
          ),
        ).toBe(false);
      },
    );

    it(
      'rejects date-only values',
      () => {
        expect(
          isStrictUtcTimestamp(
            '2026-09-29',
          ),
        ).toBe(false);
      },
    );

    it(
      'rejects timestamps without an explicit Z suffix',
      () => {
        expect(
          isStrictUtcTimestamp(
            '2026-09-29T15:12:34',
          ),
        ).toBe(false);
      },
    );

    it(
      'rejects lowercase z',
      () => {
        expect(
          isStrictUtcTimestamp(
            '2026-09-29T15:12:34z',
          ),
        ).toBe(false);
      },
    );

    it(
      'rejects non-canonical fractional precision',
      () => {
        expect(
          isStrictUtcTimestamp(
            '2026-09-29T15:12:34.12Z',
          ),
        ).toBe(false);

        expect(
          isStrictUtcTimestamp(
            '2026-09-29T15:12:34.123456Z',
          ),
        ).toBe(false);
      },
    );

    it(
      'rejects impossible calendar dates instead of allowing normalization',
      () => {
        expect(
          isStrictUtcTimestamp(
            '2026-02-30T12:00:00Z',
          ),
        ).toBe(false);
      },
    );

    it(
      'rejects leading or trailing whitespace',
      () => {
        expect(
          isStrictUtcTimestamp(
            ' 2026-09-29T15:12:34Z',
          ),
        ).toBe(false);

        expect(
          isStrictUtcTimestamp(
            '2026-09-29T15:12:34Z ',
          ),
        ).toBe(false);
      },
    );
  },
);
