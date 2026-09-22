import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_chat2';
const COMMIT_SHA = '1234567890abcdef1234567890abcdef12345678';
const SNAPSHOT_CREATED = '2026-09-20T00:00:00.000Z';
const CANDIDATE_CREATED = '2026-09-21T00:00:00.000Z';

async function createCrossFileFixture() {
  const routesContent = [
    "import express from 'express';",
    "import { forwardRequest } from './service';",
    "",
    "function proxyHandler(req: any, res: any) {",
    "  return forwardRequest(req.query.target);",
    "}",
    "",
    "export function createApp() {",
    "  const app = express();",
    "  app.get('/proxy', proxyHandler);",
    "  return app;",
    "}",
  ].join('\n');

  const serviceContent = [
    "import { executeOutbound } from './client';",
    "",
    "export function forwardRequest(destUrl: string) {",
    "  return executeOutbound(destUrl);",
    "}",
  ].join('\n');

  const clientContent = [
    "export function executeOutbound(url: string) {",
    "  return url;",
    "}",
  ].join('\n');

  const snapshotInput = {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo-ssrf-cross-v1',
    organizationId: ORG,
    files: [
      { path: 'src/routes.ts', content: routesContent },
      { path: 'src/service.ts', content: serviceContent },
      { path: 'src/client.ts', content: clientContent },
    ],
  };

  const snapshot = await captureSnapshot(snapshotInput, ORG);
  const ingestion = await ingestExpress(snapshot, ORG);
  return { snapshot, ingestion };
}

describe('SSRF positive control: cross-file discovery roadmap test', () => {
  it('captures cross-file Express ingestion across routes, service, and client modules', async () => {
    const { snapshot, ingestion } = await createCrossFileFixture();
    expect(snapshot.files).toHaveLength(3);
    expect(ingestion.routes).toHaveLength(1);
    const route = ingestion.routes[0];
    expect(route.method).toBe('GET');
    expect(route.path).toBe('/proxy');
    expect(route.handler.filePath).toBe('src/routes.ts');
    expect(route.handler.symbol).toBe('proxyHandler');
    expect(ingestion.sourceUnits.map(u => u.filePath).sort()).toEqual([
      'src/client.ts',
      'src/routes.ts',
      'src/service.ts',
    ]);
  });

  it('validates canonical SSRF FindingCandidate and computes binding without invented prefix', async () => {
    const { snapshot, ingestion } = await createCrossFileFixture();
    const route = ingestion.routes[0];

    const rawCandidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      candidateId: 'cand-ssrf-cross-001',
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: snapshot.snapshotId,
        repositoryId: snapshot.repositoryId,
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: COMMIT_SHA,
        ref: 'refs/heads/main',
        createdAt: SNAPSHOT_CREATED,
      },
      vulnerabilityClass: 'SSRF',
      source: {
        filePath: 'src/routes.ts',
        symbol: 'query.target',
        line: 5,
        column: 35,
      },
      sink: {
        filePath: 'src/client.ts',
        symbol: 'executeOutbound',
        line: 1,
        column: 1,
      },
      context: {
        entrypoint: {
          filePath: 'src/routes.ts',
          symbol: 'proxyHandler',
          line: 4,
          column: 1,
        },
        routeId: route.routeIdentity,
      },
      sensorEvidence: [
        {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: 'sensor-ssrf-cross-001',
          ruleId: 'express-request-to-ssrf-url-v1',
          summary: 'Cross-file request flow into outbound request dispatch sink.',
          sourceLocation: {
            filePath: 'src/routes.ts',
            symbol: 'query.target',
            line: 5,
            column: 35,
          },
          sinkLocation: {
            filePath: 'src/client.ts',
            symbol: 'executeOutbound',
            line: 1,
            column: 1,
          },
          rawEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
        },
      ],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt: CANDIDATE_CREATED,
    };

    const candidate = validateFindingCandidate(rawCandidate, ORG);
    expect(candidate.vulnerabilityClass).toBe('SSRF');
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(Object.isFrozen(candidate)).toBe(true);

    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);
    expect(computeCandidateBinding(candidate, ORG)).toBe(binding);
  });

  it('preserves initial CANDIDATE state and rejects direct completion without verification evidence', async () => {
    const { snapshot, ingestion } = await createCrossFileFixture();
    const route = ingestion.routes[0];

    const rawCandidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      candidateId: 'cand-ssrf-cross-002',
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: snapshot.snapshotId,
        repositoryId: snapshot.repositoryId,
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: COMMIT_SHA,
        ref: 'refs/heads/main',
        createdAt: SNAPSHOT_CREATED,
      },
      vulnerabilityClass: 'SSRF',
      source: {
        filePath: 'src/routes.ts',
        symbol: 'query.target',
        line: 5,
        column: 35,
      },
      sink: {
        filePath: 'src/client.ts',
        symbol: 'executeOutbound',
        line: 1,
        column: 1,
      },
      context: {
        entrypoint: {
          filePath: 'src/routes.ts',
          symbol: 'proxyHandler',
          line: 4,
          column: 1,
        },
        routeId: route.routeIdentity,
      },
      sensorEvidence: [
        {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: 'sensor-ssrf-cross-002',
          ruleId: 'express-request-to-ssrf-url-v1',
          summary: 'Cross-file request flow to outbound request sink.',
          sourceLocation: {
            filePath: 'src/routes.ts',
            symbol: 'query.target',
            line: 5,
            column: 35,
          },
          sinkLocation: {
            filePath: 'src/client.ts',
            symbol: 'executeOutbound',
            line: 1,
            column: 1,
          },
          rawEvidenceFingerprint: `sha256:${'d'.repeat(64)}`,
        },
      ],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt: CANDIDATE_CREATED,
    };

    const candidate = validateFindingCandidate(rawCandidate, ORG);
    const stateHandle = createVerificationState(candidate, ORG);
    expect(stateHandle.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(stateHandle, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('fails closed on negative controls including all-zero commit SHA and foreign tenants', async () => {
    const { snapshot, ingestion } = await createCrossFileFixture();
    const route = ingestion.routes[0];

    const baseCandidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      candidateId: 'cand-ssrf-cross-003',
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: snapshot.snapshotId,
        repositoryId: snapshot.repositoryId,
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: COMMIT_SHA,
        ref: 'refs/heads/main',
        createdAt: SNAPSHOT_CREATED,
      },
      vulnerabilityClass: 'SSRF',
      source: {
        filePath: 'src/routes.ts',
        symbol: 'query.target',
        line: 5,
        column: 35,
      },
      sink: {
        filePath: 'src/client.ts',
        symbol: 'executeOutbound',
        line: 1,
        column: 1,
      },
      context: {
        entrypoint: {
          filePath: 'src/routes.ts',
          symbol: 'proxyHandler',
          line: 4,
          column: 1,
        },
        routeId: route.routeIdentity,
      },
      sensorEvidence: [
        {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: 'sensor-ssrf-cross-003',
          ruleId: 'express-request-to-ssrf-url-v1',
          summary: 'Negative control validation candidate.',
          sourceLocation: {
            filePath: 'src/routes.ts',
            symbol: 'query.target',
            line: 5,
            column: 35,
          },
          sinkLocation: {
            filePath: 'src/client.ts',
            symbol: 'executeOutbound',
            line: 1,
            column: 1,
          },
          rawEvidenceFingerprint: `sha256:${'e'.repeat(64)}`,
        },
      ],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt: CANDIDATE_CREATED,
    };

    expect(() =>
      validateFindingCandidate(
        {
          ...baseCandidate,
          snapshot: {
            ...baseCandidate.snapshot,
            commitSha: '0'.repeat(40),
          },
        },
        ORG
      )
    ).toThrow('invalid commitSha');

    expect(() =>
      validateFindingCandidate(
        {
          ...baseCandidate,
          snapshot: {
            ...baseCandidate.snapshot,
            commitSha: 'invalid-sha-value',
          },
        },
        ORG
      )
    ).toThrow('invalid commitSha');

    expect(() => validateFindingCandidate(baseCandidate, 'org_foreign')).toThrow(
      'organizationId mismatch'
    );

    expect(() =>
      validateFindingCandidate(
        {
          ...baseCandidate,
          verificationState: 'VERIFIED' as any,
        },
        ORG
      )
    ).toThrow('invalid verificationState');
  });
});
