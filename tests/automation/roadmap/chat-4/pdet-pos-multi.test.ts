import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  canonical,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
  validateExpressIngestion,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
  validateSqlAnalysis,
} from '../../../../worker/intelligence/detection/sqlInjection';

const org = 'org_chat4';

const appSource = `import express from 'express';

export function createApp(db: any) {
  const app = express();

  function sanitizeFilter(raw: any) {
    return 'WHERE account_id = ' + raw;
  }

  function composeQuery(filter: any) {
    return 'SELECT id, balance FROM accounts ' + filter;
  }

  function handleAccountSearch(req: any, res: any) {
    const rawInput = req.query.accountId;
    const filter = sanitizeFilter(rawInput);
    const sql = composeQuery(filter);
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  }

  app.get('/accounts/search', handleAccountSearch);

  return app;
}
`;

function createInput() {
  return {
    fixtureId: 'm2-case-001',
    repositoryId: 'repo-pdet-multi',
    organizationId: org,
    files: [
      {
        path: 'src/app.ts',
        content: appSource,
      },
    ],
  };
}

describe('Chat-4 Positive Multi-Stage Pipeline Determinism (RM_PDET_POS_MULTI)', () => {
  it('deterministically captures and validates snapshot across multiple runs', async () => {
    const snap1 = await captureSnapshot(createInput(), org);
    const snap2 = await captureSnapshot(createInput(), org);

    expect(snap1.snapshotId).toBe(snap2.snapshotId);
    expect(snap1.totalBytes).toBe(snap2.totalBytes);
    expect(snap1.files).toHaveLength(1);
    expect(snap1.files[0].fileIdentity).toBe(snap2.files[0].fileIdentity);
    expect(snap1.files[0].contentDigest).toBe(snap2.files[0].contentDigest);
    expect(canonical(snap1)).toBe(canonical(snap2));

    const validated1 = await validateSnapshot(snap1, org);
    const validated2 = await validateSnapshot(snap2, org);
    expect(validated1.snapshotId).toBe(snap1.snapshotId);
    expect(validated2.snapshotId).toBe(snap2.snapshotId);
  });

  it('deterministically ingests multi-stage express routing across multiple runs', async () => {
    const snap1 = await captureSnapshot(createInput(), org);
    const snap2 = await captureSnapshot(createInput(), org);

    const ing1 = await ingestExpress(snap1, org);
    const ing2 = await ingestExpress(snap2, org);

    expect(ing1.ingestionIdentity).toBe(ing2.ingestionIdentity);
    expect(canonical(ing1)).toBe(canonical(ing2));
    expect(ing1.routes).toHaveLength(1);
    expect(ing1.routes[0].routeIdentity).toBe(ing2.routes[0].routeIdentity);
    expect(ing1.routes[0].method).toBe('GET');
    expect(ing1.routes[0].path).toBe('/accounts/search');

    const validatedIng = await validateExpressIngestion(ing1, org);
    expect(validatedIng.ingestionIdentity).toBe(ing1.ingestionIdentity);
  });

  it('deterministically detects multi-stage SQL injection with complete flow trace across runs', async () => {
    const snap1 = await captureSnapshot(createInput(), org);
    const snap2 = await captureSnapshot(createInput(), org);

    const ing1 = await ingestExpress(snap1, org);
    const ing2 = await ingestExpress(snap2, org);

    const det1 = await detectSqlInjection(snap1, ing1, org);
    const det2 = await detectSqlInjection(snap2, ing2, org);

    expect(det1.status).toBe('DETECTED');
    expect(det2.status).toBe('DETECTED');
    expect(det1.resultFingerprint).toBe(det2.resultFingerprint);
    expect(canonical(det1)).toBe(canonical(det2));

    expect(det1.findings).toHaveLength(1);
    expect(det2.findings).toHaveLength(1);

    const f1 = det1.findings[0];
    const f2 = det2.findings[0];

    expect(f1.findingId).toBe(f2.findingId);
    expect(f1.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(f1.routeIdentity).toBe(ing1.routes[0].routeIdentity);
    expect(f1.source.symbol).toBe('query.accountId');
    expect(f1.sink.symbol).toBe('db.prepare');

    expect(f1.flow.length).toBe(f2.flow.length);
    expect(f1.flow.length).toBeGreaterThanOrEqual(8);

    const kinds = f1.flow.map(step => step.kind);
    expect(kinds[0]).toBe('SOURCE');
    expect(kinds[kinds.length - 1]).toBe('SINK');
    expect(kinds).toContain('VARIABLE');
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
    expect(kinds).toContain('CONCAT');
    expect(kinds).toContain('RETURN');

    for (let i = 0; i < f1.flow.length; i++) {
      expect(f1.flow[i].id).toBe(f2.flow[i].id);
      expect(f1.flow[i].kind).toBe(f2.flow[i].kind);
      expect(f1.flow[i].id).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('recomputes and validates end-to-end analysis integrity matching captured source', async () => {
    const snap = await captureSnapshot(createInput(), org);
    const ing = await ingestExpress(snap, org);
    const det = await detectSqlInjection(snap, ing, org);

    const validatedAnalysis = await validateSqlAnalysis(det, snap, ing, org);
    expect(validatedAnalysis.resultFingerprint).toBe(det.resultFingerprint);
    expect(canonical(validatedAnalysis)).toBe(canonical(det));
  });

  it('fails closed on tenant mismatch or forged analysis artifacts', async () => {
    const snap = await captureSnapshot(createInput(), org);
    const ing = await ingestExpress(snap, org);
    const det = await detectSqlInjection(snap, ing, org);

    await expect(validateSnapshot(snap, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateExpressIngestion(ing, 'foreign_org')).rejects.toThrow('tenant mismatch');
    await expect(validateSqlAnalysis(det, snap, ing, 'foreign_org')).rejects.toThrow('tenant mismatch');

    const forgedAnalysis = {
      ...det,
      resultFingerprint: 'sha256:' + '0'.repeat(64),
    };
    await expect(validateSqlAnalysis(forgedAnalysis, snap, ing, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');

    const alteredStatus = {
      ...det,
      status: 'NOT_DETECTED',
    };
    await expect(validateSqlAnalysis(alteredStatus, snap, ing, org)).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('preserves non-authoritative boundary without candidate or execution capability', async () => {
    const snap = await captureSnapshot(createInput(), org);
    const ing = await ingestExpress(snap, org);
    const det = await detectSqlInjection(snap, ing, org);

    expect((det as any).capability).toBeUndefined();
    expect((det as any).verificationState).toBeUndefined();
    expect((ing as any).capability).toBeUndefined();
    expect(det.status).toBe('DETECTED');
  });
});
