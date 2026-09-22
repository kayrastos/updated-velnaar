import { describe, expect, it } from 'vitest';
import { captureSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('M3 SQL injection detector malformed nested input handling', () => {
  it('verifies baseline nested router fixture detects SQL injection', async () => {
    const run = await analyzeInput(input(7));
    expect(run.result.status).toBe('DETECTED');
    expect(run.result.findings).toHaveLength(1);
    expect(run.result.findings[0].routeIdentity).toBe(run.ingestion.routes[0].routeIdentity);
  });

  it('fails closed with ROUTE_MISMATCH when route registration occurs after router mount', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "router.get('/search', searchRoute);\n  app.use('/api', router);",
      "app.use('/api', router);\n  router.get('/search', searchRoute);"
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);
    expect(run.result.limitations[0].code).toBe('ROUTE_MISMATCH');
  });

  it('rejects malformed route path without leading slash on nested router during ingestion', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "router.get('/search', searchRoute);",
      "router.get('search', searchRoute);"
    ));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('literal bounded route path required');
  });

  it('rejects malformed router mount prefix with trailing slash', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "app.use('/api', router);",
      "app.use('/api/', router);"
    ));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('literal bounded route path required');
  });

  it('rejects nested router mounting another router', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "const router = express.Router();",
      "const router = express.Router();\n  const sub = express.Router();\n  router.use('/sub', sub);"
    ));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('unsupported router mount');
  });

  it('rejects unmounted router during Express ingestion', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "app.use('/api', router);",
      ""
    ));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('unmounted router');
  });

  it('rejects duplicate mount of the same router', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "app.use('/api', router);",
      "app.use('/api', router);\n  app.use('/v2', router);"
    ));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('unsupported router mount');
  });

  it('rejects duplicate route registrations within the nested router', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "router.get('/search', searchRoute);",
      "router.get('/search', searchRoute);\n  router.get('/search', searchRoute);"
    ));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('ambiguous duplicate route');
  });

  it('rejects anonymous inline handler on nested router', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "router.get('/search', searchRoute);",
      "router.get('/search', (req: any, res: any) => { res.json([]); });"
    ));
    const snapshot = await captureSnapshot(raw, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('named handler required');
  });

  it('produces inconclusive analysis and empty candidate set for unsupported syntax inside nested handler', async () => {
    const raw = replaceSource(input(7), source => source.replace(
      "return res.json",
      "while (true) {} return res.json"
    ));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(run.result.findings).toHaveLength(0);

    const bridge = createSqlCandidateBridge(async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const candidates = await bridge(run.result, run.snapshot, run.ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('rejects foreign tenant on candidate bridge for nested router analysis', async () => {
    const run = await analyzeInput(input(7));
    expect(run.result.status).toBe('DETECTED');
    const bridge = createSqlCandidateBridge(async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await expect(bridge(run.result, run.snapshot, run.ingestion, 'foreign_org')).rejects.toThrow('tenant mismatch');
  });
});
