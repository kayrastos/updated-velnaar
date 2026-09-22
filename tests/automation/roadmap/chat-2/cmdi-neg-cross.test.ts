import { describe, expect, it } from 'vitest';
import { captureSnapshot, type SnapshotInput } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { detectCommandInjection } from '../../../../worker/intelligence/detection/commandInjection';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_neg_cross';

function buildCrossFileNegativeSnapshot(): SnapshotInput {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo_cmdi_neg_cross',
    organizationId: ORG,
    files: [
      {
        path: 'src/routes.ts',
        content: [
          "import express from 'express';",
          "import { handleLocalExec, getSafeCommand } from './service';",
          '',
          'function localExecRoute(req: any, res: any) {',
          '  const q = req.query.q;',
          '  const result = handleLocalExec(q);',
          '  return res.json(result);',
          '}',
          '',
          'function safeCommandRoute(req: any, res: any) {',
          '  const q = req.query.q;',
          '  const result = getSafeCommand(q);',
          '  return res.json(result);',
          '}',
          '',
          'export function createApp(cp: any) {',
          '  const app = express();',
          "  app.get('/local-exec', localExecRoute);",
          "  app.get('/safe-command', safeCommandRoute);",
          '  return app;',
          '}',
          '',
        ].join('\n'),
      },
      {
        path: 'src/service.ts',
        content: [
          'function exec(command: string) {',
          '  return command;',
          '}',
          '',
          'export function handleLocalExec(input: string) {',
          '  return exec(input);',
          '}',
          '',
          'export function getSafeCommand(input: string) {',
          '  const safe = "echo safe_constant";',
          '  return safe;',
          '}',
          '',
        ].join('\n'),
      },
    ],
  };
}

describe('RM_CMDI_NEG_CROSS: cross-file command injection negative controls', () => {
  it('cross-file unrelated local exec function and safe constants produce NOT_DETECTED with 0 findings', async () => {
    const rawInput = buildCrossFileNegativeSnapshot();
    const snapshot = await captureSnapshot(rawInput, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);

    expect(ingestion.sourceUnits).toHaveLength(2);
    expect(ingestion.routes).toHaveLength(2);

    const result = await detectCommandInjection(snapshot, ingestion, ORG);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(result.organizationId).toBe(ORG);
    expect(result.repositoryId).toBe(snapshot.repositoryId);
    expect(result.resultFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('deterministic analysis on reversed file enumeration retains negative status and empty findings', async () => {
    const rawInput = buildCrossFileNegativeSnapshot();
    const reversedInput = { ...rawInput, files: [...rawInput.files].reverse() };

    const snapshot1 = await captureSnapshot(rawInput, ORG);
    const ingestion1 = await ingestExpress(snapshot1, ORG);
    const result1 = await detectCommandInjection(snapshot1, ingestion1, ORG);

    const snapshot2 = await captureSnapshot(reversedInput, ORG);
    const ingestion2 = await ingestExpress(snapshot2, ORG);
    const result2 = await detectCommandInjection(snapshot2, ingestion2, ORG);

    expect(result1.status).toBe('NOT_DETECTED');
    expect(result2.status).toBe('NOT_DETECTED');
    expect(result1.findings).toHaveLength(0);
    expect(result2.findings).toHaveLength(0);
    expect(result1.resultFingerprint).toBe(result2.resultFingerprint);
  });

  it('negative controls preserve CANDIDATE boundary without creating false verified findings', async () => {
    const rawInput = buildCrossFileNegativeSnapshot();
    const snapshot = await captureSnapshot(rawInput, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const result = await detectCommandInjection(snapshot, ingestion, ORG);

    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);

    const syntheticCandidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      candidateId: 'candidate-cmdi-neg-control-1',
      organizationId: ORG,
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        snapshotId: snapshot.snapshotId,
        organizationId: ORG,
        repositoryId: snapshot.repositoryId,
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: '1111111111111111111111111111111111111111',
        ref: 'refs/heads/negative-control',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: {
        filePath: 'src/routes.ts',
        symbol: 'query.q',
        line: 5,
        column: 15,
      },
      sink: {
        filePath: 'src/service.ts',
        symbol: 'exec',
        line: 2,
        column: 3,
      },
      context: {
        entrypoint: {
          filePath: 'src/routes.ts',
          symbol: 'localExecRoute',
          line: 4,
          column: 1,
        },
        routeId: ingestion.routes[0].routeIdentity,
      },
      sensorEvidence: [
        {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: 'sensor-cmdi-neg-1',
          ruleId: 'express-request-to-child-process-v1',
          summary: 'Cross-file negative control hypothesis: local exec is unproven.',
          sourceLocation: {
            filePath: 'src/routes.ts',
            symbol: 'query.q',
            line: 5,
            column: 15,
          },
          rawEvidenceFingerprint: result.resultFingerprint,
        },
      ],
      reachabilityState: 'UNKNOWN',
      verificationState: 'CANDIDATE',
      createdAt: '2026-09-04T00:00:00.000Z',
    };

    const validated = validateFindingCandidate(syntheticCandidate, ORG);
    expect(validated.verificationState).toBe('CANDIDATE');

    const binding = computeCandidateBinding(validated, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding).not.toMatch(/^sha256:/);
  });
});
