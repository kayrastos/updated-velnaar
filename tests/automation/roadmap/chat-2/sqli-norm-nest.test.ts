import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '../../../../worker/intelligence/contracts/types';
import { computeCandidateBinding, validateFindingCandidate } from '../../../../worker/intelligence/contracts/validators';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import { RULE_ID } from '../../../../worker/intelligence/detection/types';
import { ingestExpress } from '../../../../worker/intelligence/ingestion/express';
import { captureSnapshot, canonical } from '../../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from '../../../intelligence/m3/support/inputs';

describe('sqli-detector:normalization-boundary:nested roadmap verification', () => {
  it('detects SQL injection in baseline nested router fixture and binds effective route identity', async () => {
    const { result, ingestion } = await analyzeInput(input(7));
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    const route = ingestion.routes[0];
    expect(route.ownerKind).toBe('ROUTER');
    expect(route.path).toBe('/api/search');
    expect(route.declaredPath).toBe('/search');
    expect(route.mount?.prefix).toBe('/api');
    expect(finding.routeIdentity).toBe(route.routeIdentity);
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.symbol).toBe('db.prepare');
  });

  it('normalizes root mount prefix combined with declared route path', async () => {
    const modified = replaceSource(input(7), s => s.replace("app.use('/api', router);", "app.use('/', router);"));
    const { result, ingestion } = await analyzeInput(modified);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/search');
    expect(ingestion.routes[0].mount?.prefix).toBe('/');
    expect(result.findings[0].routeIdentity).toBe(ingestion.routes[0].routeIdentity);
  });

  it('normalizes multi-segment nested mount prefix', async () => {
    const modified = replaceSource(input(7), s => s.replace("app.use('/api', router);", "app.use('/api/v1', router);"));
    const { result, ingestion } = await analyzeInput(modified);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/api/v1/search');
    expect(result.findings[0].routeIdentity).toBe(ingestion.routes[0].routeIdentity);
  });

  it('normalizes multi-segment declared route path under nested mount', async () => {
    const modified = replaceSource(input(7), s => s.replace("router.get('/search', searchRoute);", "router.get('/v1/search', searchRoute);"));
    const { result, ingestion } = await analyzeInput(modified);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/api/v1/search');
    expect(result.findings[0].routeIdentity).toBe(ingestion.routes[0].routeIdentity);
  });

  it('normalizes root declared route path under nested mount', async () => {
    const modified = replaceSource(input(7), s => s.replace("router.get('/search', searchRoute);", "router.get('/', searchRoute);"));
    const { result, ingestion } = await analyzeInput(modified);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(ingestion.routes[0].path).toBe('/api/');
    expect(result.findings[0].routeIdentity).toBe(ingestion.routes[0].routeIdentity);
  });

  it.each([
    ['trailing slash in mount prefix', "app.use('/api/', router);"],
    ['missing leading slash in mount prefix', "app.use('api', router);"],
    ['path traversal dot segments in mount prefix', "app.use('/api/../v1', router);"],
    ['colon parameter in mount prefix', "app.use('/api/:id', router);"],
  ])('enforces normalization boundary by rejecting %s at ingestion', async (_label, replacement) => {
    const bad = replaceSource(input(7), s => s.replace("app.use('/api', router);", replacement));
    const snapshot = await captureSnapshot(bad, ORG);
    await expect(ingestExpress(snapshot, ORG)).rejects.toThrow('M2_INGESTION_ERROR: literal bounded route path required');
  });

  it('fails closed with ROUTE_MISMATCH when nested registration order is reversed', async () => {
    const outOfOrder = replaceSource(input(7), s => s.replace(
      "router.get('/search', searchRoute);\n  app.use('/api', router);",
      "app.use('/api', router);\n  router.get('/search', searchRoute);",
    ));
    const { result } = await analyzeInput(outOfOrder);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('ROUTE_MISMATCH');
  });

  it('produces NOT_DETECTED for negative control with safe query on nested router', async () => {
    const safe = replaceSource(input(7), s => s.replaceAll('req.query.q', '"safe_constant"'));
    const { result } = await analyzeInput(safe);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
    expect(result.limitations).toHaveLength(0);
  });

  it('creates exact CANDIDATE hypothesis preserving canonical binding on nested router finding', async () => {
    const validCommit = '1'.repeat(40);
    const bridge = createSqlCandidateBridge(async () => validCommit);
    const { snapshot, ingestion, result } = await analyzeInput(input(7));
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(validCommit);
    expect(candidate.context.routeId).toBe(ingestion.routes[0].routeIdentity);
    expect(candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding).toBe(`${CONTRACT_VERSION}:FindingCandidate\n${canonical(candidate)}`);
    expect(candidateBinding).not.toMatch(/^sha256:/);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });
});
