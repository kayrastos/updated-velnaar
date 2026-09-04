import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { detectSqlInjection, validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { ANALYSIS_LIMITS, DETECTOR_VERSION } from '../../../worker/intelligence/detection/types';
import { captureSnapshot, canonical, hash } from '../../../worker/intelligence/ingestion/snapshot';
import { analyzeInput, input, replaceSource, ORG } from './support/inputs';

let runs: Awaited<ReturnType<typeof analyzeInput>>[];
beforeAll(async () => { runs = []; for (let i = 0; i < 8; i++) runs.push(await analyzeInput(input(i))); });
describe('M3 deterministic source-only detection', () => {
  it.each([[0, 'DETECTED'], [1, 'NOT_DETECTED'], [2, 'DETECTED'], [3, 'NOT_DETECTED'], [4, 'NOT_DETECTED'],
    [5, 'DETECTED'], [6, 'DETECTED'], [7, 'DETECTED']] as const)('opaque fixture index %i yields %s', (index, state) => {
    const { snapshot, ingestion, result } = runs[index];
    expect(result.status).toBe(state); expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(state === 'DETECTED' ? 1 : 0);
    expect(result.snapshotId).toBe(snapshot.snapshotId); expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(result.organizationId).toBe(ORG); expect(result.repositoryId).toBe(snapshot.repositoryId);
    expect(snapshot.fixtureId).toMatch(/^m2-case-00[1-8]$/);
    expect(JSON.stringify(snapshot)).not.toMatch(/safe|vulnerable|fixture-sqli-express-/i);
  });
  it('direct request concatenation has source-to-construction-to-sink provenance', () => {
    const finding = runs[0].result.findings[0];
    expect(finding.flow[0].kind).toBe('SOURCE'); expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(finding.flow.some(step => step.kind === 'CONCAT')).toBe(true);
    expect(finding.source.symbol).toBe('query.q'); expect(finding.sink.symbol).toBe('db.prepare');
    for (const point of [finding.source, finding.sink]) {
      const content = runs[0].snapshot.files.find(f => f.path === point.filePath)!.content;
      expect(content.slice(0, point.offset).split('\n').length).toBe(point.line);
      expect(point.offset - content.lastIndexOf('\n', point.offset - 1)).toBe(point.column);
    }
  });
  it.each(['prefix', 'suffix'])('detects alias chains with a tainted %s concatenation operand', async side => {
    const raw = replaceSource(input(), content => content.replace('return res.json',
      'const x = req.query.q; const y = x; const z = y; return res.json')
      .replace('" + req.query.q + "', side === 'prefix' ? '" + z + "' : '" + (z + "") + "'));
    const { result } = await analyzeInput(raw);
    expect(result.status).toBe('DETECTED');
    expect(result.findings[0].flow.filter(step => step.kind === 'VARIABLE').map(step => step.location.symbol)).toEqual(['x', 'y', 'z']);
  });
  it('records helper arguments and query-builder returns without executing the functions', () => {
    const flow = runs[5].result.findings[0].flow;
    expect(flow.filter(step => step.kind === 'CALL').map(step => step.location.symbol)).toEqual(['lookup', 'buildQuery']);
    expect(flow.filter(step => step.kind === 'ARGUMENT')).toHaveLength(2);
    expect(flow.some(step => step.kind === 'RETURN')).toBe(true);
  });
  it('cross-file named imports retain source, service and repository provenance', () => {
    const finding = runs[6].result.findings[0];
    expect([...new Set(finding.flow.map(step => step.location.filePath))]).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);
    expect(finding.source.filePath).toBe('src/routes.ts'); expect(finding.sink.filePath).toBe('src/repository.ts');
  });
  it('does not visit the disconnected unsafe function or taint bound query parameters as SQL text', () => {
    for (const index of [1, 3, 4]) expect(runs[index].result.findings).toEqual([]);
    expect(runs[3].ingestion.sourceUnits[0].functions.some(f => f.symbol === 'disconnectedRoute')).toBe(true);
  });
  it('binds mounted router findings to the effective route identity', () => {
    const run = runs[7], route = run.ingestion.routes[0];
    expect(route.path).toBe('/api/search'); expect(run.result.findings[0].routeIdentity).toBe(route.routeIdentity);
  });
  it('repeated analysis and source enumeration order produce identical results and ordered unique flows', async () => {
    const raw = input(6), reversed = { ...raw, files: [...raw.files].reverse() };
    const repeated = await detectSqlInjection(runs[6].snapshot, runs[6].ingestion, ORG);
    expect(repeated).toEqual(runs[6].result); expect((await analyzeInput(reversed)).result).toEqual(repeated);
    for (const run of runs) for (const finding of run.result.findings) {
      expect(new Set(finding.flow.map(step => step.id)).size).toBe(finding.flow.length);
      expect(finding.flow.length).toBeLessThanOrEqual(ANALYSIS_LIMITS.flowLength);
    }
    const { resultFingerprint, ...body } = repeated;
    expect(resultFingerprint).toBe('sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex'));
    expect(Object.isFrozen(repeated.findings[0].flow[0].location)).toBe(true);
  });
  it('source mutation changes snapshot and detector fingerprints', async () => {
    const changed = await analyzeInput(replaceSource(input(), content => '\n' + content));
    expect(changed.result.status).toBe('DETECTED'); expect(changed.result.resultFingerprint).not.toBe(runs[0].result.resultFingerprint);
    expect(changed.result.snapshotId).not.toBe(runs[0].result.snapshotId);
  });
  it('changing opaque case identity preserves the analysis decision and source-flow locations', async () => {
    const run = await analyzeInput({ ...input(), fixtureId: 'm2-case-008' });
    expect(run.result.status).toBe(runs[0].result.status);
    expect(run.result.findings[0].flow.map(({ id, ...step }) => step)).toEqual(runs[0].result.findings[0].flow.map(({ id, ...step }) => step));
  });
  it('rejects semantic case identity and execution/oracle fields at the detector boundary', async () => {
    const run = runs[0];
    await expect(detectSqlInjection({ ...run.snapshot, fixtureId: 'fixture-sqli-express-safe-twin-v1' }, run.ingestion, ORG)).rejects.toThrow('opaque case identity');
    for (const field of ['violationObserved', 'expectedSecurityState', 'attack', 'RecordedExecution']) {
      await expect(detectSqlInjection({ ...run.snapshot, [field]: true } as any, run.ingestion, ORG)).rejects.toThrow('unknown or missing metadata');
    }
  });
  it.each(['duplicate-flow', 'flow-id', 'source', 'sink', 'rule', 'route', 'fingerprint', 'state'])(
    'rejects %s tampering even if the caller recalculates a result fingerprint', async change => {
      const forged: any = structuredClone(runs[0].result);
      if (change === 'duplicate-flow') forged.findings[0].flow.push(forged.findings[0].flow[0]);
      if (change === 'flow-id') forged.findings[0].flow[0].id = 'sha256:' + '0'.repeat(64);
      if (change === 'source') forged.findings[0].source.column++;
      if (change === 'sink') forged.findings[0].sink.filePath = 'src/decoy.ts';
      if (change === 'rule') forged.ruleId = 'different-rule';
      if (change === 'route') forged.findings[0].routeIdentity = runs[7].ingestion.routes[0].routeIdentity;
      if (change === 'state') forged.status = 'NOT_DETECTED';
      const { resultFingerprint, ...body } = forged;
      forged.resultFingerprint = change === 'fingerprint' ? resultFingerprint + 'x' : await hash(DETECTOR_VERSION, body);
      await expect(validateSqlAnalysis(forged, runs[0].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
    });
  it('rejects foreign tenants and mismatched snapshots', async () => {
    await expect(detectSqlInjection(runs[0].snapshot, runs[0].ingestion, 'foreign')).rejects.toThrow('tenant mismatch');
    await expect(detectSqlInjection(runs[1].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_SNAPSHOT_MISMATCH');
    await expect(validateSqlAnalysis(runs[0].result, runs[1].snapshot, runs[1].ingestion, ORG)).rejects.toThrow('M3_ANALYSIS_INTEGRITY');
  });
  it('rejects result accessors without invoking them and detaches result metadata before awaiting', async () => {
    const bad = structuredClone(runs[0].result); let invoked = false;
    Object.defineProperty(bad.findings[0], 'source', { enumerable: true, get() { invoked = true; return {}; } });
    await expect(validateSqlAnalysis(bad, runs[0].snapshot, runs[0].ingestion, ORG)).rejects.toThrow('data fields required');
    expect(invoked).toBe(false);
    const copy: any = structuredClone(runs[0].result), pending = validateSqlAnalysis(copy, runs[0].snapshot, runs[0].ingestion, ORG);
    copy.findings[0].sink.column++; expect(await pending).toEqual(runs[0].result);
  });
  it('compares M2 executable observations only after independent detection is complete', async () => {
    const recordedDetections = runs.map(run => canonical(run.result));
    const { executeFixture } = await import('../m2/support/execute');
    const executions = [];
    for (const run of runs) executions.push(await executeFixture(run.snapshot, ORG));
    for (let i = 0; i < runs.length; i++) {
      expect(runs[i].result.status === 'DETECTED').toBe(executions[i].record.violationObserved);
      expect(canonical(runs[i].result)).toBe(recordedDetections[i]);
    }
    await expect(detectSqlInjection(executions[0].record as any, runs[0].ingestion, ORG)).rejects.toThrow('unknown or missing metadata');
  });
});
