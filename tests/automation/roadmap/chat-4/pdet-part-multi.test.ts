import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';

const org = 'org_pdet_multi';

const VALID_APP_SOURCE = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function getItems(req: any, res: any) {
    const query = req.query.id;
    const stmt = db.prepare('SELECT * FROM items WHERE id = ' + query);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/items', getItems);
  return app;
}
`;

function makeValidInput() {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo-pdet-multi',
    organizationId: org,
    files: [
      {
        path: 'src/app.ts',
        content: VALID_APP_SOURCE,
      },
    ],
  };
}

describe('Multi-Stage Pipeline Determinism and Partial-Input Fail-Closed Suite', () => {
  it('fails closed at stage 1 on partial snapshot inputs', async () => {
    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-multi',
          files: [{ path: 'src/app.ts', content: VALID_APP_SOURCE }],
        } as any,
        org,
      ),
    ).rejects.toThrow('M2_INGESTION_ERROR');

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-multi',
          organizationId: org,
          files: [],
        },
        org,
      ),
    ).rejects.toThrow('M2_INGESTION_ERROR');

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-multi',
          organizationId: org,
          files: [{ path: 'src/app.ts' }] as any,
        },
        org,
      ),
    ).rejects.toThrow('M2_INGESTION_ERROR');

    await expect(
      captureSnapshot(
        {
          fixtureId: 'm2-case-001',
          repositoryId: 'repo-pdet-multi',
          organizationId: org,
          files: [{ path: 'src/app.ts', content: 'export const v = 1;\0' }],
        },
        org,
      ),
    ).rejects.toThrow('M2_INGESTION_ERROR');

    await expect(
      validateSnapshot(
        {
          version: 'velnar-local-source-snapshot-v2',
          fixtureId: 'm2-case-001',
        } as any,
        org,
      ),
    ).rejects.toThrow('M2_INGESTION_ERROR');
  });

  it('fails closed at stage 2 on partial express registration and structural input', async () => {
    const noFactorySnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-multi',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: 'export const orphan = true;\n' }],
      },
      org,
    );

    await expect(ingestExpress(noFactorySnapshot, org)).rejects.toThrow(
      'M2_INGESTION_ERROR',
    );

    const noReturnSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-multi',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: "import express from 'express';\nexport function createApp(db: any) {\n  const app = express();\n}\n",
          },
        ],
      },
      org,
    );

    await expect(ingestExpress(noReturnSnapshot, org)).rejects.toThrow(
      'M2_INGESTION_ERROR',
    );

    const missingHandlerSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-001',
        repositoryId: 'repo-pdet-multi',
        organizationId: org,
        files: [
          {
            path: 'src/app.ts',
            content: "import express from 'express';\nexport function createApp(db: any) {\n  const app = express();\n  app.get('/items', missingHandler);\n  return app;\n}\n",
          },
        ],
      },
      org,
    );

    await expect(ingestExpress(missingHandlerSnapshot, org)).rejects.toThrow(
      'M2_INGESTION_ERROR',
    );

    const validSnapshot = await captureSnapshot(makeValidInput(), org);
    await expect(
      validateExpressIngestion(
        {
          version: 'velnar-express-ingestion-v1',
          snapshot: validSnapshot,
        } as any,
        org,
      ),
    ).rejects.toThrow('M2_INGESTION_ERROR');
  });

  it('fails closed at stage 3 on snapshot mismatches and partial analysis records', async () => {
    const validSnapshot = await captureSnapshot(makeValidInput(), org);
    const validIngestion = await ingestExpress(validSnapshot, org);

    const mismatchedSnapshot = await captureSnapshot(
      {
        fixtureId: 'm2-case-002',
        repositoryId: 'repo-other-pdet',
        organizationId: org,
        files: [{ path: 'src/app.ts', content: VALID_APP_SOURCE }],
      },
      org,
    );

    await expect(
      detectSqlInjection(mismatchedSnapshot, validIngestion, org),
    ).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');

    const validAnalysis = await detectSqlInjection(
      validSnapshot,
      validIngestion,
      org,
    );
    expect(validAnalysis.status).toBe('DETECTED');
    expect(validAnalysis.findings.length).toBeGreaterThan(0);

    await expect(
      validateSqlAnalysis(
        {
          ...validAnalysis,
          findings: [],
        },
        validSnapshot,
        validIngestion,
        org,
      ),
    ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('fails closed at stage 4 on invalid or partial commit verification', async () => {
    const validSnapshot = await captureSnapshot(makeValidInput(), org);
    const validIngestion = await ingestExpress(validSnapshot, org);
    const validAnalysis = await detectSqlInjection(
      validSnapshot,
      validIngestion,
      org,
    );

    const emptyShaBridge = createSqlCandidateBridge(async () => '');
    await expect(
      emptyShaBridge(validAnalysis, validSnapshot, validIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const shortShaBridge = createSqlCandidateBridge(async () => 'abc1234');
    await expect(
      shortShaBridge(validAnalysis, validSnapshot, validIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const allZeroShaBridge = createSqlCandidateBridge(
      async () => '0'.repeat(40),
    );
    await expect(
      allZeroShaBridge(validAnalysis, validSnapshot, validIngestion, org),
    ).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');

    const validBridge = createSqlCandidateBridge(async () => 'a'.repeat(40));
    const hypotheses = await validBridge(
      validAnalysis,
      validSnapshot,
      validIngestion,
      org,
    );

    expect(hypotheses.length).toBe(1);
    expect(hypotheses[0].candidate.verificationState).toBe('CANDIDATE');
    expect((hypotheses[0].candidate as any).verificationState).not.toBe(
      'VERIFIED',
    );
  });

  it('preserves multi-stage determinism and enforces fail-closed propagation', async () => {
    const input1 = makeValidInput();
    const input2 = makeValidInput();

    const snapshot1 = await captureSnapshot(input1, org);
    const snapshot2 = await captureSnapshot(input2, org);
    expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);

    const ingestion1 = await ingestExpress(snapshot1, org);
    const ingestion2 = await ingestExpress(snapshot2, org);
    expect(ingestion1.ingestionIdentity).toBe(ingestion2.ingestionIdentity);

    const analysis1 = await detectSqlInjection(snapshot1, ingestion1, org);
    const analysis2 = await detectSqlInjection(snapshot2, ingestion2, org);
    expect(analysis1.resultFingerprint).toBe(analysis2.resultFingerprint);

    const commitSha = 'b'.repeat(40);
    const bridge1 = createSqlCandidateBridge(async () => commitSha);
    const bridge2 = createSqlCandidateBridge(async () => commitSha);

    const candidates1 = await bridge1(analysis1, snapshot1, ingestion1, org);
    const candidates2 = await bridge2(analysis2, snapshot2, ingestion2, org);

    expect(candidates1.length).toBe(candidates2.length);
    expect(candidates1[0].candidateBinding).toBe(candidates2[0].candidateBinding);
    expect(candidates1[0].candidate.candidateId).toBe(
      candidates2[0].candidate.candidateId,
    );

    const badInput = { ...input1, files: [] };
    await expect(captureSnapshot(badInput, org)).rejects.toThrow(
      'M2_INGESTION_ERROR',
    );
    await expect(captureSnapshot(badInput, org)).rejects.toThrow(
      'M2_INGESTION_ERROR',
    );
  });
});
