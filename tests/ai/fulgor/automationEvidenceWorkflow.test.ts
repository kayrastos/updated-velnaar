import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  createAutomationEvidence,
} from '../../../scripts/fulgor/automation/evidenceWorkflow';

import type {
  FulgorAutomationJob,
} from '../../../scripts/fulgor/automation/types';

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-secret-old',
  '+secret-new',
].join('\n');

function job(): FulgorAutomationJob {
  return {
    jobId: 'evidence-1',
    problem: 'problem',
    diagnosis: 'diagnosis',
    plan: 'plan',
    candidate: {
      blindedId: 'blind-evidence',
      patch,
      canonicalDiffSummary: 'one file changed',
    },
    staticGatePolicy: {
      allowedScope: ['src'],
      forbiddenPaths: ['src/secrets'],
      maxFiles: 2,
      maxHunks: 2,
      maxChangedLines: 10,
    },
    dryRunApplySucceeded: true,
  };
}

const staticGateResult = {
  accepted: true,
  failureCode: null,
  touchedFiles: ['src/a.ts'],
  hunkCount: 1,
  changedLineCount: 2,
} as const;

describe('Fulgor automation evidence workflow', () => {
  it('is deterministic for identical bounded input', () => {
    const input = {
      job: job(),
      decision: 'PASS' as const,
      failureCode: null,
      staticGateResult,
      verifierVerdict: 'SUPPORTED' as const,
    };

    expect(
      createAutomationEvidence(input),
    ).toEqual(
      createAutomationEvidence(input),
    );
  });

  it('changes evidence hashes when patch changes', () => {
    const first = job();
    const second = job();

    second.candidate.patch =
      second.candidate.patch.replace(
        '+secret-new',
        '+different',
      );

    const a = createAutomationEvidence({
      job: first,
      decision: 'PASS',
      failureCode: null,
      staticGateResult,
      verifierVerdict: 'SUPPORTED',
    });

    const b = createAutomationEvidence({
      job: second,
      decision: 'PASS',
      failureCode: null,
      staticGateResult,
      verifierVerdict: 'SUPPORTED',
    });

    expect(a.patchSha256)
      .not.toBe(b.patchSha256);

    expect(a.inputSha256)
      .not.toBe(b.inputSha256);

    expect(a.evidenceSha256)
      .not.toBe(b.evidenceSha256);
  });

  it('does not place raw patch bytes in evidence', () => {
    const evidence = createAutomationEvidence({
      job: job(),
      decision: 'PASS',
      failureCode: null,
      staticGateResult,
      verifierVerdict: 'SUPPORTED',
    });

    const serialized = JSON.stringify(evidence);

    expect(serialized).not.toContain('secret-old');
    expect(serialized).not.toContain('secret-new');
    expect(evidence.patchSha256)
      .toMatch(/^[0-9a-f]{64}$/);
  });
});