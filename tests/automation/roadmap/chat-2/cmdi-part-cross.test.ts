import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  ASSERTION_BY_CLASS,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';
import {
  captureSnapshot,
  hash,
  type SnapshotInput,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
} from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_cmdi_cross';
const COMMIT_SHA = '46db4c208f886afda939c04ae93580fbabd57344';
const CREATED_AT = '2026-09-21T00:00:00.000Z';

function createCrossFileInput(): SnapshotInput {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo-cmdi-cross',
    organizationId: ORG,
    files: [
      {
        path: 'src/service.ts',
        content: [
          'export function runCommand(cmd: string): void {',
          '  // Cross-file execution service stub',
          '}',
        ].join('\n'),
      },
      {
        path: 'src/routes.ts',
        content: [
          "import express from 'express';",
          "import { runCommand } from './service';",
          'export function createApp() {',
          '  const app = express();',
          "  app.get('/exec', execRoute);",
          '  return app;',
          '}',
          'export function execRoute(req: any, res: any): void {',
          '  runCommand(req.query.cmd);',
          '  res.json({ status: "ok" });',
          '}',
        ].join('\n'),
      },
    ],
  };
}

async function buildCandidate(
  snapshotId: string,
  routeIdentity: string,
  overrides: Partial<FindingCandidate> = {}
): Promise<FindingCandidate> {
  const source = { filePath: 'src/routes.ts', symbol: 'req.query.cmd', line: 9, column: 14 };
  const sink = { filePath: 'src/service.ts', symbol: 'child_process.exec', line: 1, column: 1 };
  const entrypoint = { filePath: 'src/routes.ts', symbol: 'execRoute', line: 8, column: 1 };
  const evidenceFingerprint = await hash('cmdi-evidence-test-v1', { snapshotId, routeIdentity });
  const candidateId = await hash('cmdi-candidate-v1', { snapshotId, routeIdentity, COMMIT_SHA });

  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId,
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId,
      repositoryId: 'repo-cmdi-cross',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha: COMMIT_SHA,
      ref: 'refs/heads/auto/v1-discovery-intelligence-20260918',
      createdAt: CREATED_AT,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source,
    sink,
    context: {
      entrypoint,
      routeId: routeIdentity,
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-cmdi-001',
        ruleId: 'express-request-to-child-process-exec-v1',
        summary: 'Cross-file request-derived shell command hypothesis.',
        sourceLocation: source,
        sinkLocation: sink,
        rawEvidenceFingerprint: evidenceFingerprint,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe('V1 command-injection-detector: partial-input-failclosed: cross-file', () => {
  it('ingests valid cross-file service and route modules deterministically', async () => {
    const snapshot = await captureSnapshot(createCrossFileInput(), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);

    expect(snapshot.files).toHaveLength(2);
    expect(ingestion.routes).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/exec');
    expect(ingestion.routes[0].method).toBe('GET');
    expect(ingestion.routes[0].handler.filePath).toBe('src/routes.ts');
    expect(ingestion.routes[0].handler.symbol).toBe('execRoute');
  });

  it('constructs a valid COMMAND_INJECTION candidate bound to canonical contract rules', async () => {
    const snapshot = await captureSnapshot(createCrossFileInput(), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const candidate = await buildCandidate(snapshot.snapshotId, ingestion.routes[0].routeIdentity);

    const validated = validateFindingCandidate(candidate, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.reachabilityState).toBe('REACHABLE');
    expect(ASSERTION_BY_CLASS[validated.vulnerabilityClass]).toBe('COMMAND_EXECUTION_OBSERVED');

    const binding = computeCandidateBinding(validated, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding).not.toMatch(/^sha256:/);

    const state = createVerificationState(validated, ORG);
    expect(state.state).toBe('CANDIDATE');
  });

  it('fails closed at the ingestion boundary when cross-file dependencies are broken or cyclic', async () => {
    const missingImportInput: SnapshotInput = {
      ...createCrossFileInput(),
      files: [
        {
          path: 'src/routes.ts',
          content: [
            "import express from 'express';",
            "import { runCommand } from './missingService';",
            'export function createApp() {',
            '  const app = express();',
            "  app.get('/exec', execRoute);",
            '  return app;',
            '}',
            'export function execRoute(req: any, res: any): void {',
            '  runCommand(req.query.cmd);',
            '  res.json({ status: "ok" });',
            '}',
          ].join('\n'),
        },
      ],
    };

    const snapshotMissing = await captureSnapshot(missingImportInput, ORG);
    await expect(ingestExpress(snapshotMissing, ORG)).rejects.toThrow('missing or ambiguous source import');

    const unsupportedSyntaxInput: SnapshotInput = {
      ...createCrossFileInput(),
      files: [
        createCrossFileInput().files[0],
        {
          path: 'src/routes.ts',
          content: [
            "import express from 'express';",
            "export * from './service';",
            'export function createApp() { return express(); }',
          ].join('\n'),
        },
      ],
    };

    const snapshotUnsupported = await captureSnapshot(unsupportedSyntaxInput, ORG);
    await expect(ingestExpress(snapshotUnsupported, ORG)).rejects.toThrow('unsupported module structure');
  });

  it('fails closed when candidate verificationState or commit identity violates canonical boundaries', async () => {
    const snapshot = await captureSnapshot(createCrossFileInput(), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);

    const prematurelyVerified: any = await buildCandidate(snapshot.snapshotId, ingestion.routes[0].routeIdentity, {
      verificationState: 'VERIFIED' as any,
    });
    expect(() => validateFindingCandidate(prematurelyVerified, ORG)).toThrow('invalid verificationState');

    const zeroCommitCandidate = await buildCandidate(snapshot.snapshotId, ingestion.routes[0].routeIdentity, {
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: snapshot.snapshotId,
        repositoryId: 'repo-cmdi-cross',
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: '0'.repeat(40),
        ref: 'refs/heads/main',
        createdAt: CREATED_AT,
      },
    });
    expect(() => validateFindingCandidate(zeroCommitCandidate, ORG)).toThrow('invalid commitSha');

    const validCandidate = await buildCandidate(snapshot.snapshotId, ingestion.routes[0].routeIdentity);
    const validState = createVerificationState(validCandidate, ORG);
    await expect(
      transitionVerificationState(validState, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('ensures safe controls and semantic alterations mutate candidate binding and fail replay', async () => {
    const snapshot = await captureSnapshot(createCrossFileInput(), ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const candidateA = await buildCandidate(snapshot.snapshotId, ingestion.routes[0].routeIdentity);
    const bindingA = computeCandidateBinding(candidateA, ORG);

    const candidateSafeControl = await buildCandidate(snapshot.snapshotId, ingestion.routes[0].routeIdentity, {
      source: {
        filePath: 'src/routes.ts',
        symbol: '"echo constant"',
        line: 9,
        column: 14,
      },
    });
    const bindingSafeControl = computeCandidateBinding(candidateSafeControl, ORG);
    expect(bindingSafeControl).not.toBe(bindingA);

    const candidateUnrelatedExec = await buildCandidate(snapshot.snapshotId, ingestion.routes[0].routeIdentity, {
      sink: {
        filePath: 'src/service.ts',
        symbol: 'localSafeExec',
        line: 1,
        column: 1,
      },
    });
    const bindingUnrelatedExec = computeCandidateBinding(candidateUnrelatedExec, ORG);
    expect(bindingUnrelatedExec).not.toBe(bindingA);

    const wireRequest: VerificationRequest = {
      contractVersion: CONTRACT_VERSION,
      requestId: 'req-cmdi-001',
      organizationId: ORG,
      candidateId: candidateA.candidateId,
      candidateBinding: bindingA,
      snapshotId: candidateA.snapshot.snapshotId,
      commitSha: candidateA.snapshot.commitSha,
      vulnerabilityClass: candidateA.vulnerabilityClass,
      verificationProfile: { profileId: 'default-profile', version: 1 },
      environmentRequirements: {
        environmentType: 'ISOLATED_TEST',
        runtime: 'NODE',
        runtimeVersion: '20.0.0',
      },
      networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
      resourceBudget: {
        maxCpuMillis: 5000,
        maxMemoryMb: 512,
        maxWallTimeMs: 10000,
        maxNetworkRequests: 0,
      },
      timeBudgetMs: 5000,
      expectedAssertionType: ASSERTION_BY_CLASS[candidateA.vulnerabilityClass],
      createdAt: CREATED_AT,
    };

    expect(validateVerificationRequest(wireRequest, candidateA, ORG)).toBeDefined();
    expect(() => validateVerificationRequest(wireRequest, candidateSafeControl, ORG)).toThrow('candidateBinding mismatch');
  });
});
