import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  evaluateStaticPatchGate,
  type StaticPatchGatePolicy,
} from '../../../scripts/fulgor/verification/staticPatchGate';

const policy: StaticPatchGatePolicy = {
  allowedScope: ['src'],
  forbiddenPaths: [
    'src/secrets',
    'src/generated',
  ],
  maxFiles: 2,
  maxHunks: 3,
  maxChangedLines: 6,
};

function patch(
  path = 'src/a.ts',
  body = '-old\n+new',
): string {
  return [
    `diff --git a/${path} b/${path}`,
    '--- a/' + path,
    '+++ b/' + path,
    '@@ -1 +1 @@',
    body,
    '',
  ].join('\n');
}

describe('Fulgor static patch gate', () => {
  it('rejects an empty patch', () => {
    expect(
      evaluateStaticPatchGate(
        {
          patch: '',
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('EMPTY_PATCH');
  });

  it('rejects a diff header with no hunks', () => {
    const value = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '',
    ].join('\n');

    expect(
      evaluateStaticPatchGate(
        {
          patch: value,
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('EMPTY_PATCH');
  });

  it('rejects a hunk with no changed lines', () => {
    const value = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      ' context only',
      '',
    ].join('\n');

    expect(
      evaluateStaticPatchGate(
        {
          patch: value,
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('EMPTY_PATCH');
  });
  it('accepts a bounded in-scope patch', () => {
    const result = evaluateStaticPatchGate(
      {
        patch: patch(),
        dryRunApplySucceeded: true,
      },
      policy,
    );

    expect(result).toEqual({
      accepted: true,
      failureCode: null,
      touchedFiles: ['src/a.ts'],
      hunkCount: 1,
      changedLineCount: 2,
    });
  });

  it('rejects a patch outside declared scope', () => {
    expect(
      evaluateStaticPatchGate(
        {
          patch: patch('tests/a.test.ts'),
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('OUTSIDE_DECLARED_SCOPE');
  });

  it('rejects a forbidden path', () => {
    expect(
      evaluateStaticPatchGate(
        {
          patch: patch(
            'src/secrets/key.ts',
          ),
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('FORBIDDEN_PATH');
  });

  it('rejects too many files', () => {
    const value = [
      patch('src/a.ts'),
      patch('src/b.ts'),
      patch('src/c.ts'),
    ].join('\n');

    expect(
      evaluateStaticPatchGate(
        {
          patch: value,
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('MAX_FILES_EXCEEDED');
  });

  it('rejects too many hunks', () => {
    const value = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '@@ -3 +3 @@',
      '-c',
      '+d',
      '@@ -5 +5 @@',
      '-e',
      '+f',
      '@@ -7 +7 @@',
      '-g',
      '+h',
    ].join('\n');

    expect(
      evaluateStaticPatchGate(
        {
          patch: value,
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('MAX_HUNKS_EXCEEDED');
  });

  it('rejects too many changed lines', () => {
    const value = patch(
      'src/a.ts',
      [
        '-a',
        '-b',
        '-c',
        '-d',
        '+e',
        '+f',
        '+g',
      ].join('\n'),
    );

    expect(
      evaluateStaticPatchGate(
        {
          patch: value,
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('MAX_CHANGED_LINES_EXCEEDED');
  });

  it('rejects failed dry-run apply', () => {
    expect(
      evaluateStaticPatchGate(
        {
          patch: patch(),
          dryRunApplySucceeded: false,
        },
        policy,
      ).failureCode,
    ).toBe('PATCH_APPLY_FAILED');
  });

  it('rejects path traversal', () => {
    expect(
      evaluateStaticPatchGate(
        {
          patch: patch('../escape.ts'),
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('UNSAFE_PATH');
  });

  it('rejects malformed non-diff input', () => {
    expect(
      evaluateStaticPatchGate(
        {
          patch: 'hello world',
          dryRunApplySucceeded: true,
        },
        policy,
      ).failureCode,
    ).toBe('MALFORMED_PATCH');
  });

  it('counts additions and deletions only inside hunks', () => {
    const result = evaluateStaticPatchGate(
      {
        patch: patch(
          'src/a.ts',
          '-before\n context\n+after',
        ),
        dryRunApplySucceeded: true,
      },
      policy,
    );

    expect(result.changedLineCount).toBe(2);
  });
});