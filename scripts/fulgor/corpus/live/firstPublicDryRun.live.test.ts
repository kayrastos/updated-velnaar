import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  runFirstPublicDryRun,
} from './firstPublicDryRun';

const liveIt =
  process.env.FULGOR_RUN_LIVE_CORPUS ===
    '1'
    ? it
    : it.skip;

describe(
  'FULGOR first public corpus dry run',
  () => {
    liveIt(
      'passes the real GHSA -> materialization -> review-candidate chain',
      async () => {
        await runFirstPublicDryRun();

        expect(true).toBe(true);
      },
      300_000,
    );
  },
);
