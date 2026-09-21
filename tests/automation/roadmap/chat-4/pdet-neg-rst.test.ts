import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  hash,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
} from '../../../../worker/intelligence/ingestion/repository';

describe('Chat-4 Pipeline Determinism Negative Control: Restart-Resume (pdet-neg-rst)', () => {
  const org = 'org_pdet_neg';

  it('fails closed when resuming a snapshot with tampered file content or forged identity', async () => {
    const genuineSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-neg',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const q = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
          },
        ],
      },
      org,
    );

    const tamperedContentSnapshot = {
      ...genuineSnapshot,
      files: [
        {
          ...genuineSnapshot.files[0],
          content: 'export const altered = true;\n',
        },
      ],
    };
    await expect(validateSnapshot(tamperedContentSnapshot, org)).rejects.toThrow();

    const forgedIdSnapshot = {
      ...genuineSnapshot,
      snapshotId: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(validateSnapshot(forgedIdSnapshot, org)).rejects.toThrow();

    await expect(validateSnapshot(genuineSnapshot, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });

  it('fails closed when resuming Express ingestion with tampered routes or forged identity', async () => {
    const genuineSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-neg',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const q = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
          },
        ],
      },
      org,
    );
    const genuineIngestion = await ingestExpress(genuineSnapshot, org);

    const tamperedRouteIngestion = {
      ...genuineIngestion,
      routes: [
        {
          ...genuineIngestion.routes[0],
          path: '/tampered',
        },
      ],
    };
    await expect(validateExpressIngestion(tamperedRouteIngestion, org)).rejects.toThrow();

    const forgedIdentityIngestion = {
      ...genuineIngestion,
      ingestionIdentity: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    };
    await expect(validateExpressIngestion(forgedIdentityIngestion, org)).rejects.toThrow();

    await expect(validateExpressIngestion(genuineIngestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });

  it('fails closed with snapshot mismatch when detection resumes with desynchronized snapshot and ingestion', async () => {
    const snapshotA = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-neg',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const q = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
          },
        ],
      },
      org,
    );

    const snapshotB = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-pdet-neg',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const q = req.query.name;
    const stmt = db.prepare('SELECT * FROM items WHERE name = ' + q);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
          },
        ],
      },
      org,
    );

    const ingestionA = await ingestExpress(snapshotA, org);

    await expect(detectSqlInjection(snapshotB, ingestionA, org)).rejects.toThrow(
      'M3_ANALYSIS_SNAPSHOT_MISMATCH',
    );
  });

  it('rejects tampered findings or forged fingerprint when re-validating resumed SQL analysis', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-neg',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const q = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
          },
        ],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);
    expect(analysis.status).toBe('DETECTED');

    const tamperedFindings = {
      ...analysis,
      findings: [],
      status: 'NOT_DETECTED' as const,
    };
    await expect(
      validateSqlAnalysis(tamperedFindings, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const forgedFingerprint = {
      ...analysis,
      resultFingerprint: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    };
    await expect(
      validateSqlAnalysis(forgedFingerprint, snapshot, ingestion, org),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('refuses invalid commit SHA and preserves strictly non-authoritative CANDIDATE status across resumption', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-neg',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const q = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
          },
        ],
      },
      org,
    );
    const ingestion = await ingestExpress(snapshot, org);
    const analysis = await detectSqlInjection(snapshot, ingestion, org);

    const zeroCommitBridge = createSqlCandidateBridge(async () => '0'.repeat(40));
    await expect(
      zeroCommitBridge(analysis, snapshot, ingestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const malformedCommitBridge = createSqlCandidateBridge(async () => 'not-a-valid-sha');
    await expect(
      malformedCommitBridge(analysis, snapshot, ingestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validCommit = 'a'.repeat(40);
    const validBridge = createSqlCandidateBridge(async () => validCommit);
    const hypotheses = await validBridge(analysis, snapshot, ingestion, org);
    expect(hypotheses.length).toBeGreaterThan(0);
    for (const h of hypotheses) {
      expect(h.candidate.verificationState).toBe('CANDIDATE');
      expect((h.candidate as any).verificationState).not.toBe('VERIFIED');
      expect((h.candidate as any).authority).toBeUndefined();
      expect((h as any).capability).toBeUndefined();
    }
  });

  it('rejects forged commit provenance and denies capability minting on resumed repository records', async () => {
    const snapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-neg',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: `import express from 'express';
export function createApp(db: any) {
  const app = express();
  function handler(req: any, res: any) {
    const q = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + q);
    const rows = stmt.all();
    res.json(rows);
  }
  app.get('/items', handler);
  return app;
}
`,
          },
        ],
      },
      org,
    );

    const malformedShaRecord = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: org,
      repositoryId: 'repo-pdet-neg',
      commitSha: 'bad-sha',
      snapshot,
      ingestionIdentity: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    await expect(validateRepositoryIngestion(malformedShaRecord, org)).rejects.toThrow(
      'Git commit identity',
    );

    const validSha = 'b'.repeat(40);
    const genuineRecordBody = {
      version: 'velnar-repository-ingestion-v1' as const,
      organizationId: org,
      repositoryId: 'repo-pdet-neg',
      commitSha: validSha,
      snapshot,
    };
    const expectedIdentity = await hash('velnar-repository-ingestion-v1', genuineRecordBody);
    const forgedIdentityRecord = {
      ...genuineRecordBody,
      ingestionIdentity: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };
    await expect(validateRepositoryIngestion(forgedIdentityRecord, org)).rejects.toThrow(
      'ingestion identity mismatch',
    );

    const validated = await validateRepositoryIngestion(
      { ...genuineRecordBody, ingestionIdentity: expectedIdentity },
      org,
    );
    expect((validated as any).capability).toBeUndefined();
    expect(isTrustedCommitCapability({}, validated)).toBe(false);
    expect(
      isTrustedCommitCapability(
        { [Symbol.toStringTag]: 'TrustedCommitCapability' },
        validated,
      ),
    ).toBe(false);
  });
});
