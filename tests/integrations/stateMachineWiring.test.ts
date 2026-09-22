import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../worker/intelligence/ingestion/express';
import { detectSqlInjection, validateSqlAnalysis } from '../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../worker/intelligence/detection/candidate';

const vulnerableApp = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleUser(req: any, res: any) {
    const query = req.query.id;
    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/user', handleUser);

  return app;
}
`;

const safeApp = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleSafe(req: any, res: any) {
    const query = req.query.id;
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const rows = stmt.all(query);
    return res.json(rows);
  }

  app.get('/safe', handleSafe);

  return app;
}
`;

const inconclusiveApp = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function handleInconclusive(req: any, res: any) {
    const query = req.query.id ? '1' : '2';
    const stmt = db.prepare('SELECT * FROM users WHERE id = ' + query);
    const rows = stmt.all();
    return res.json(rows);
  }

  app.get('/inconclusive', handleInconclusive);

  return app;
}
`;

const org = 'org_state_machine';
const validCommitSha = '1234567890abcdef1234567890abcdef12345678';

describe('Worker Orchestrator State Machine Wiring Integration', () => {
  it('wires truthful state progression from snapshot ingestion to detected candidate hypothesis', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-state-wiring',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableApp }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    expect(expressIngestion.routes).toHaveLength(1);
    expect(expressIngestion.routes[0].method).toBe('GET');
    expect(expressIngestion.routes[0].path).toBe('/user');

    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.limitations).toHaveLength(0);

    let commitVerificationCount = 0;
    const bridge = createSqlCandidateBridge(async (snap) => {
      commitVerificationCount++;
      expect(snap.snapshotId).toBe(snapshot.snapshotId);
      return validCommitSha;
    });

    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(commitVerificationCount).toBe(1);
    expect(hypotheses).toHaveLength(1);

    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect((candidate as any).verificationState).not.toBe('VERIFIED');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.organizationId).toBe(org);
    expect(candidate.snapshot.commitSha).toBe(validCommitSha);
    expect(typeof candidateBinding).toBe('string');
    expect(candidateBinding.length).toBeGreaterThan(0);
    expect(Object.isFrozen(hypotheses)).toBe(true);
  });

  it('short-circuits candidate bridge to empty state when detection status is NOT_DETECTED', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-state-safe',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: safeApp }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);

    let commitVerificationCount = 0;
    const bridge = createSqlCandidateBridge(async () => {
      commitVerificationCount++;
      return validCommitSha;
    });

    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(commitVerificationCount).toBe(0);
    expect(hypotheses).toEqual([]);
    expect(Object.isFrozen(hypotheses)).toBe(true);
  });

  it('short-circuits candidate bridge when analysis status is ANALYSIS_INCONCLUSIVE', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-003',
        repositoryId: 'repo-state-inconclusive',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: inconclusiveApp }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.limitations.length).toBeGreaterThan(0);

    let commitVerificationCount = 0;
    const bridge = createSqlCandidateBridge(async () => {
      commitVerificationCount++;
      return validCommitSha;
    });

    const hypotheses = await bridge(analysis, snapshot, expressIngestion, org);
    expect(commitVerificationCount).toBe(0);
    expect(hypotheses).toEqual([]);
  });

  it('fails closed when commit provenance callback yields invalid commit SHA', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-004',
        repositoryId: 'repo-invalid-sha',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableApp }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);
    expect(analysis.status).toBe('DETECTED');

    const zeroShaBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(zeroShaBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const nonHexBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(nonHexBridge(analysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('rejects state transition when snapshot identity mismatches express ingestion snapshot ID', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-005',
        repositoryId: 'repo-mismatch-a',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableApp }],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-006',
        repositoryId: 'repo-mismatch-b',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: safeApp }],
      },
      org,
    );

    const expressIngestionB = await ingestExpress(snapshotB, org);

    await expect(detectSqlInjection(snapshotA, expressIngestionB, org)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('fails closed when analysis payload integrity is forged before candidate bridge entry', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-007',
        repositoryId: 'repo-forged-analysis',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: vulnerableApp }],
      },
      org,
    );

    const expressIngestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, expressIngestion, org);

    const forgedAnalysis = {
      ...analysis,
      resultFingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };

    const bridge = createSqlCandidateBridge(async () => validCommitSha);
    await expect(bridge(forgedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    await expect(validateSqlAnalysis(forgedAnalysis, snapshot, expressIngestion, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });
});
