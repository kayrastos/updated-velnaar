import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import {
  captureSnapshot,
  type SnapshotInput,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
} from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_cmdi_case_cross';
const REPO = 'repo_cmdi_case_cross';
const COMMIT = 'a'.repeat(40);

function createCrossFileFixture(): SnapshotInput {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: REPO,
    organizationId: ORG,
    files: [
      {
        path: 'src/routes.ts',
        content: [
          "import express from 'express';",
          "import { runCommand } from './service';",
          'function runRoute(req: any, res: any) {',
          '  const cmd = req.query.cmd;',
          '  return runCommand(cmd, res);',
          '}',
          'export function createApp() {',
          '  const app = express();',
          "  app.get('/run', runRoute);",
          '  return app;',
          '}',
        ].join('\n'),
      },
      {
        path: 'src/service.ts',
        content: [
          'export function runCommand(cmd: any, res: any) {',
          "  return res.json({ status: 'ok', cmd });",
          '}',
        ].join('\n'),
      },
    ],
  };
}

describe('V1 discovery-intelligence: command-injection cross-file case-sensitivity roadmap', () => {
  it('ingests cross-file Express app with exact module case matching', async () => {
    const raw = createCrossFileFixture();
    const snapshot = await captureSnapshot(raw, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);

    expect(ingestion.routes).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/run');
    expect(ingestion.routes[0].method).toBe('GET');
    expect(ingestion.routes[0].handler.symbol).toBe('runRoute');
    expect(ingestion.sourceUnits).toHaveLength(2);
    expect(ingestion.sourceUnits.map(u => u.filePath).sort()).toEqual([
      'src/routes.ts',
      'src/service.ts',
    ]);
  });

  it('rejects cross-file import with mismatched case (fail-closed)', async () => {
    const raw = createCrossFileFixture();
    const mismatchedFiles = raw.files.map(f =>
      f.path === 'src/routes.ts'
        ? {
            ...f,
            content: f.content.replace("./service", "./Service"),
          }
        : f
    );
    const snapshot = await captureSnapshot(
      { ...raw, files: mismatchedFiles },
      ORG
    );
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow(
      'M2_INGESTION_ERROR: missing or ambiguous source import'
    );
  });

  it('rejects duplicate canonical paths with case variations in snapshot', async () => {
    const raw = createCrossFileFixture();
    const collidingFiles = [
      ...raw.files,
      {
        path: 'src/Service.ts',
        content: 'export const duplicate = true;\n',
      },
    ];
    await expect(
      captureSnapshot({ ...raw, files: collidingFiles }, ORG)
    ).rejects.toThrow('M2_INGESTION_ERROR: duplicate canonical path');
  });

  it('constructs and validates a bounded COMMAND_INJECTION candidate with exact case binding', async () => {
    const raw = createCrossFileFixture();
    const snapshot = await captureSnapshot(raw, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const route = ingestion.routes[0];

    const candidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      candidateId: 'cand_cmdi_case_cross_001',
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: snapshot.snapshotId,
        repositoryId: snapshot.repositoryId,
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: COMMIT,
        ref: 'refs/heads/main',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: {
        filePath: 'src/routes.ts',
        symbol: 'query.cmd',
        line: 4,
        column: 15,
      },
      sink: {
        filePath: 'src/service.ts',
        symbol: 'child_process.exec',
        line: 2,
        column: 3,
      },
      context: {
        entrypoint: {
          filePath: 'src/routes.ts',
          symbol: 'runRoute',
          line: 3,
          column: 1,
        },
        routeId: route.routeIdentity,
      },
      sensorEvidence: [
        {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: 'sensor_cmdi_001',
          ruleId: 'express-request-to-child-process-v1',
          summary:
            'velnar-cmdi-source-v1: source-to-child-process cross-file command execution hypothesis.',
          sourceLocation: {
            filePath: 'src/routes.ts',
            symbol: 'query.cmd',
            line: 4,
            column: 15,
          },
          sinkLocation: {
            filePath: 'src/service.ts',
            symbol: 'child_process.exec',
            line: 2,
            column: 3,
          },
          rawEvidenceFingerprint: 'sha256:' + 'e'.repeat(64),
        },
      ],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt: '2026-09-04T00:00:00.000Z',
    };

    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated).toEqual(candidate);
    expect(Object.isFrozen(validated)).toBe(true);

    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding).toContain(`${CONTRACT_VERSION}:FindingCandidate\n`);
    expect(binding).not.toMatch(/^sha256:/);

    const initial = createVerificationState(candidate, ORG);
    expect(initial.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(initial, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('case differences in source or sink symbol produce distinct candidate bindings', async () => {
    const raw = createCrossFileFixture();
    const snapshot = await captureSnapshot(raw, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const route = ingestion.routes[0];

    const baseCandidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      candidateId: 'cand_cmdi_case_cross_002',
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: snapshot.snapshotId,
        repositoryId: snapshot.repositoryId,
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: COMMIT,
        ref: 'refs/heads/main',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: {
        filePath: 'src/routes.ts',
        symbol: 'query.cmd',
        line: 4,
        column: 15,
      },
      sink: {
        filePath: 'src/service.ts',
        symbol: 'child_process.exec',
        line: 2,
        column: 3,
      },
      context: {
        entrypoint: {
          filePath: 'src/routes.ts',
          symbol: 'runRoute',
          line: 3,
          column: 1,
        },
        routeId: route.routeIdentity,
      },
      sensorEvidence: [
        {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: 'sensor_cmdi_002',
          ruleId: 'express-request-to-child-process-v1',
          summary: 'Negative control case sensitivity candidate binding check.',
          sourceLocation: {
            filePath: 'src/routes.ts',
            symbol: 'query.cmd',
            line: 4,
            column: 15,
          },
          sinkLocation: {
            filePath: 'src/service.ts',
            symbol: 'child_process.exec',
            line: 2,
            column: 3,
          },
          rawEvidenceFingerprint: 'sha256:' + 'f'.repeat(64),
        },
      ],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt: '2026-09-04T00:00:00.000Z',
    };

    const baseBinding = computeCandidateBinding(baseCandidate, ORG);

    const upperSource = {
      ...baseCandidate,
      source: { ...baseCandidate.source, symbol: 'query.CMD' },
    };
    expect(computeCandidateBinding(upperSource, ORG)).not.toBe(baseBinding);

    const upperSink = {
      ...baseCandidate,
      sink: { ...baseCandidate.sink, symbol: 'child_process.EXEC' },
    };
    expect(computeCandidateBinding(upperSink, ORG)).not.toBe(baseBinding);
  });

  it('safe controls and invalid commit hashes fail candidate validation', async () => {
    const raw = createCrossFileFixture();
    const snapshot = await captureSnapshot(raw, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const route = ingestion.routes[0];

    const validCandidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      candidateId: 'cand_cmdi_case_cross_003',
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: snapshot.snapshotId,
        repositoryId: snapshot.repositoryId,
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: COMMIT,
        ref: 'refs/heads/main',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: {
        filePath: 'src/routes.ts',
        symbol: 'query.cmd',
        line: 4,
        column: 15,
      },
      sink: {
        filePath: 'src/service.ts',
        symbol: 'child_process.exec',
        line: 2,
        column: 3,
      },
      context: {
        entrypoint: {
          filePath: 'src/routes.ts',
          symbol: 'runRoute',
          line: 3,
          column: 1,
        },
        routeId: route.routeIdentity,
      },
      sensorEvidence: [
        {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: 'sensor_cmdi_003',
          ruleId: 'express-request-to-child-process-v1',
          summary: 'Negative control validation check.',
          sourceLocation: {
            filePath: 'src/routes.ts',
            symbol: 'query.cmd',
            line: 4,
            column: 15,
          },
          rawEvidenceFingerprint: 'sha256:' + '0'.repeat(64),
        },
      ],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt: '2026-09-04T00:00:00.000Z',
    };

    const zeroCommit = {
      ...validCandidate,
      snapshot: { ...validCandidate.snapshot, commitSha: '0'.repeat(40) },
    };
    expect(() => validateFindingCandidate(zeroCommit, ORG)).toThrow(
      'INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha'
    );

    const verifiedState = {
      ...validCandidate,
      verificationState: 'VERIFIED' as any,
    };
    expect(() => validateFindingCandidate(verifiedState, ORG)).toThrow(
      'INTELLIGENCE_PROTOCOL_ERROR: invalid verificationState'
    );
  });
});
