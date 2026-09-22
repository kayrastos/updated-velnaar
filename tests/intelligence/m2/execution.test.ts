import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { FIXTURES, validateCatalog } from './support/catalog';
import { loadFixture } from './support/loadFixture';
import { assertSingleQueryObservations, executeFixture } from './support/execute';
import { integrateExecution as integratePreSeal, createSealedIntegrator } from './support/integrate';
import { captureSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { computeCandidateBinding, createVerificationState, transitionVerificationState, validateEvidenceArtifact,
  validateVerificationResult } from '../../../worker/intelligence/contracts';

const org = 'org_m2';
let runs: Awaited<ReturnType<typeof executeFixture>>[];
// Unit-test model of the trusted host verifier, NOT a real Git commit or seal.
// None of these modeled protocol artifacts is written by either recorder.
const MODELED_COMMIT = 'a'.repeat(40);
const integrateExecution = createSealedIntegrator(async snapshot => {
  if (!runs.some(run => run.ingestion.snapshot.snapshotId === snapshot.snapshotId)) throw new Error('MODELED_COMMIT_MISSING_BYTES');
  return MODELED_COMMIT;
});
beforeAll(async () => {
  runs = [];
  for (const f of FIXTURES) runs.push(await executeFixture(await captureSnapshot(loadFixture(f.fixtureId), org), org));
});
describe('M2 executable fixture behavior and modeled post-seal contract integration', () => {
  it('records all eight results before the independent ground-truth evaluator reads answers', async () => {
    const { evaluateRecorded } = await import('./support/evaluate');
    const evaluations = await evaluateRecorded(runs.map(r => r.record));
    expect(evaluations).toHaveLength(8); expect(evaluations.every(e => e.matches)).toBe(true);
    const { SQL_INJECTION_BENCHMARK } = await import('../../../worker/intelligence/benchmarks/sqlInjectionBenchmark');
    expect(evaluations.map(e => e.fixtureId).sort()).toEqual(FIXTURES.map(f => f.fixtureId).sort());
    expect(evaluations.map(e => e.snapshotFixtureId).sort()).toEqual(SQL_INJECTION_BENCHMARK.map(c => c.snapshotFixtureId).sort());
    expect(new Set(evaluations.map(e => e.snapshotFixtureId)).size).toBe(8);
    for (const metadata of SQL_INJECTION_BENCHMARK) {
      const opaqueId = evaluations.find(e => e.snapshotFixtureId === metadata.snapshotFixtureId)!.fixtureId;
      const run = runs.find(r => r.record.fixtureId === opaqueId)!;
      const route = run.ingestion.routes[0];
      expect(route.handler).toMatchObject({ filePath: metadata.entrypoint.filePath, symbol: metadata.entrypoint.symbol });
      expect(`express.${route.method}.${route.declaredPath.slice(1)}`).toBe(metadata.entrypoint.semanticId);
      expect(run.ingestion.sourceUnits.every(unit => unit.language === metadata.language)).toBe(true);
      const artifacts = await integrateExecution(run.ingestion, run.record, org);
      expect(artifacts.candidate.vulnerabilityClass).toBe(metadata.vulnerabilityClass);
      expect(artifacts.completed.state).toBe(metadata.verificationExpectation);
    }
    // Exact sealed source-byte pin: detect any attempt to rewrite reviewed answers.
    const source = fs.readFileSync('worker/intelligence/benchmarks/sqlInjectionBenchmark.ts', 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(source).digest('hex')).toBe('d6c6b06836ef01c37e3778b457ab6837be882d81d76fdc4f60a05903ccaade15');
  });
  it('has exactly eight unique fixture IDs and refuses a duplicate or silent ninth fixture', () => {
    expect(new Set(FIXTURES.map(f => f.fixtureId)).size).toBe(8);
    expect(validateCatalog(FIXTURES)).toEqual(FIXTURES);
    expect(() => validateCatalog([...FIXTURES, { fixtureId: 'ninth', directory: 'f09' }])).toThrow('M2_CATALOG');
    expect(() => validateCatalog([FIXTURES[0], ...FIXTURES.slice(0, 7)])).toThrow('M2_CATALOG');
  });
  it.each([0, 2, 5, 6, 7])('fixture index %i demonstrates an actual SQLite result-set violation', index => {
    const r = runs[index].record;
    expect(r.benign.returnedIds).toEqual([1]); expect(r.attack.returnedIds).toEqual([1, 2]);
    expect(r.attack.queries[0].parameters).toEqual([]); expect(r.violationObserved).toBe(true);
  });
  it.each([1, 4])('parameterized fixture index %i remains safe with the same injection input', index => {
    const r = runs[index].record;
    expect(r.attack.returnedIds).toEqual([]); expect(r.violationObserved).toBe(false);
    expect(r.attack.queries[0].parameters).toEqual(["' OR 1=1 --"]);
    expect(r.attack.queries[0].sql).toBe('SELECT id, name FROM records WHERE name = ?');
  });
  it('unreachable unsafe SQL exists but is not called through the declared entrypoint', () => {
    const { ingestion, record } = runs[3];
    expect(ingestion.snapshot.files[0].content).toContain("WHERE name = '\"");
    expect(ingestion.sourceUnits[0].functions.map(f => f.symbol)).toContain('disconnectedRoute');
    expect(record.attack.calledFunctions.map(f => f.symbol)).not.toContain('disconnectedRoute');
    expect(record.violationObserved).toBe(false); expect(record.attack.returnedIds).toEqual([]);
    expect(record.attack.queries[0].parameters).toHaveLength(1);
  });
  it('records multi-function, multi-file and mounted Express router paths from execution', () => {
    expect(runs[5].record.attack.calledFunctions.map(f => f.symbol)).toEqual(['searchRoute', 'lookup', 'buildQuery']);
    expect(runs[6].record.attack.calledFunctions.map(f => f.filePath)).toEqual(['src/routes.ts', 'src/service.ts', 'src/repository.ts']);
    expect(runs[7].ingestion.routes[0]).toMatchObject({ method: 'GET', path: '/api/search', ownerKind: 'ROUTER', handler: { symbol: 'searchRoute' } });
  });
  it.each(FIXTURES.map((f, index) => [f.fixtureId, index] as const))('fixture %s integrates only through sealed pending completion', async (_id, index) => {
    const run = runs[index]; const out = await integrateExecution(run.ingestion, run.record, org);
    expect(out.initial.state).toBe('CANDIDATE'); expect(out.pending.state).toBe('PENDING_VERIFICATION');
    expect(out.completed.state).toBe(run.record.violationObserved ? 'VERIFIED' : 'NOT_VERIFIED');
    const binding = computeCandidateBinding(out.candidate, org);
    expect([out.request.candidateBinding, out.evidence.candidateBinding, out.result.candidateBinding]).toEqual([binding, binding, binding]);
    expect(out.evidence.reproduction.fixtureId).toBe(run.record.fixtureId);
    expect(out.evidence.observedBehavior.detailsFingerprint).toBe(run.record.recordDigest);
    expect(out.candidate.snapshot.snapshotId).toBe(run.record.snapshotId);
    expect(run.record.benign.queries).toHaveLength(1); expect(run.record.attack.queries).toHaveLength(1);
    const location = run.record.attack.queries[0].location;
    expect(out.candidate.sink).toEqual({ filePath: location.filePath, symbol: 'sqlite.prepare', line: location.line, column: location.column });
    expect([out.candidate.snapshot.commitSha, out.request.commitSha, out.evidence.commitSha, out.result.commitSha]).toEqual(Array(4).fill(MODELED_COMMIT));
    expect(Object.isFrozen(out.evidence.reproduction)).toBe(true);
    expect(Object.isFrozen(out)).toBe(true);
    await expect(validateEvidenceArtifact(out.evidence, out.request, out.candidate, org)).resolves.toEqual(out.evidence);
  });
  it('rejects direct CANDIDATE -> VERIFIED, raw/spread execution records and changed snapshots', async () => {
    const run = runs[0], out = await integrateExecution(run.ingestion, run.record, org);
    await expect(transitionVerificationState(out.initial, { type: 'COMPLETE', result: out.result, evidence: out.evidence })).rejects.toThrow('COMPLETE requires pending');
    await expect(integrateExecution(run.ingestion, { ...run.record }, org)).rejects.toThrow('unrecognized local execution record');
    await expect(integrateExecution(runs[1].ingestion, run.record, org)).rejects.toThrow('execution/snapshot binding');
  });
  it('M2 Commit A proof cannot verify Commit B after rebinding candidate/request/result', async () => {
    const out = await integrateExecution(runs[0].ingestion, runs[0].record, org);
    const c = structuredClone(out.candidate); (c.snapshot as any).commitSha = 'b'.repeat(40);
    const binding = computeCandidateBinding(c, org), q = { ...out.request, commitSha: c.snapshot.commitSha, candidateBinding: binding };
    const r = { ...out.result, commitSha: c.snapshot.commitSha, candidateBinding: binding };
    const pending = await transitionVerificationState(createVerificationState(c, org), { type: 'BEGIN', request: q });
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: out.evidence })).rejects.toThrow('commitSha mismatch');
  });
  it('M2 same-ID/same-commit semantic replay is rejected', async () => {
    const out = await integrateExecution(runs[0].ingestion, runs[0].record, org);
    const c = structuredClone(out.candidate); (c.source as any).symbol = 'different';
    const binding = computeCandidateBinding(c, org), q = { ...out.request, candidateBinding: binding }, r = { ...out.result, candidateBinding: binding };
    const pending = await transitionVerificationState(createVerificationState(c, org), { type: 'BEGIN', request: q });
    await expect(transitionVerificationState(pending, { type: 'COMPLETE', result: r, evidence: out.evidence })).rejects.toThrow('candidateBinding mismatch');
  });
  it.each(['missing', 'hash', 'observation', 'binding', 'model'])('M2 %s evidence cannot authorize VERIFIED', async kind => {
    const out = await integrateExecution(runs[0].ingestion, runs[0].record, org);
    let e: any = structuredClone(out.evidence);
    if (kind === 'missing') e = undefined;
    if (kind === 'hash') e.evidenceHash = `sha256:${'0'.repeat(64)}`;
    if (kind === 'observation') e.observedBehavior.detailsFingerprint = `sha256:${'f'.repeat(64)}`;
    if (kind === 'binding') e.candidateBinding += ' ';
    if (kind === 'model') e = { result: 'VERIFIED', confidence: 1 };
    await expect(validateVerificationResult(out.result, out.request, out.candidate, e, org)).rejects.toThrow('INTELLIGENCE_PROTOCOL_ERROR');
  });
  it('records deterministic outputs without using fixture identity labels to derive the result', async () => {
    const original = runs[0], raw = loadFixture(FIXTURES[0].fixtureId); (raw as any).fixtureId = FIXTURES[1].fixtureId;
    const renamed = await executeFixture(await captureSnapshot(raw, org), org);
    expect(renamed.record.violationObserved).toBe(original.record.violationObserved);
    expect(renamed.record.attack).toEqual(original.record.attack);
    expect(renamed.record.snapshotId).not.toBe(original.record.snapshotId);
    expect((await executeFixture(original.ingestion.snapshot, org)).record).toEqual(original.record);
  });
  it('all eight pre-seal runs have opaque identities and cannot mint commit-bound M1 artifacts', async () => {
    for (const run of runs) {
      const raw = loadFixture(run.record.fixtureId);
      expect(JSON.stringify({ raw, snapshot: run.ingestion.snapshot, record: run.record })).not.toMatch(/safe|vulnerable|fixture-sqli-express-/i);
      expect(run.record.fixtureId).toMatch(/^m2-case-00[1-8]$/);
      expect(raw).not.toHaveProperty('commitSha'); expect(run.record).not.toHaveProperty('commitSha');
      const preSeal = await integratePreSeal(run.ingestion, run.record, org);
      expect(preSeal.status).toBe('PRE_SEAL'); expect(preSeal.analyzedCodeCommitSha).toBeNull();
      for (const field of ['candidate', 'request', 'evidence', 'result', 'completed']) expect(preSeal).not.toHaveProperty(field);
    }
  });
  it.each(['fixture-sqli-express-obvious-vulnerable-v1', 'fixture-sqli-express-safe-twin-v1',
    'fixture-sqli-express-unreachable-vulnerable-code-v1', 'fixture-sqli-express-parameterized-safe-v1'])(
    'rejects semantic identity at snapshot and execution boundaries: %s', async fixtureId => {
      const raw = { ...loadFixture(FIXTURES[0].fixtureId), fixtureId };
      await expect(captureSnapshot(raw, org)).rejects.toThrow('opaque case identity required');
      await expect(executeFixture({ ...runs[0].ingestion.snapshot, fixtureId }, org)).rejects.toThrow('opaque case identity required');
      expect(() => loadFixture(fixtureId)).toThrow('unknown fixture ID');
    });
  it.each(['safe-then-unsafe', 'unsafe-then-safe'])('rejects multiple SQL sinks: %s', async order => {
    const raw = structuredClone(loadFixture(FIXTURES[0].fixtureId));
    const safe = "db.prepare('SELECT id, name FROM records WHERE name = ?').all(req.query.q)";
    const unsafe = 'db.prepare("SELECT id, name FROM records WHERE name = \'" + req.query.q + "\'").all()';
    const [first, second] = order === 'safe-then-unsafe' ? [safe, unsafe] : [unsafe, safe];
    (raw.files[0] as any).content = raw.files[0].content.replace(/return res\.json\([^\n]+/, `${first}; return res.json(${second});`);
    await expect(executeFixture(await captureSnapshot(raw, org), org)).rejects.toThrow('SQL argument/query budget');
  });
  it('rejects zero attack queries at the shared execution/integration assertion gate', () => {
    expect(() => assertSingleQueryObservations({ benign: runs[0].record.benign,
      attack: { ...runs[0].record.attack, queries: [] } })).toThrow('exactly one SQL query required');
  });
  it('rejects cached setup rows returned without an observed route query', async () => {
    const raw = structuredClone(loadFixture(FIXTURES[0].fixtureId));
    (raw.files[0] as any).content = raw.files[0].content.replace('const app = express();',
      "const app = express(); const cached = db.prepare('SELECT id, name FROM records WHERE name = ?').all('alice');")
      .replace(/return res\.json\([^\n]+/, 'return res.json(cached);');
    await expect(executeFixture(await captureSnapshot(raw, org), org)).rejects.toThrow('exactly one SQL query required');
  });
  it('rejects injected commit authority in snapshot data and propagates a failed trusted Git check', async () => {
    for (const key of ['commitSha', 'analyzedCodeCommitSha', 'engineBaselineSha', 'verifyCommittedCode']) {
      await expect(captureSnapshot({ ...loadFixture(FIXTURES[0].fixtureId), [key]: MODELED_COMMIT }, org)).rejects.toThrow('unknown or missing metadata');
    }
    const denied = createSealedIntegrator(async () => { throw new Error('COMMITTED_BYTES_NOT_FOUND'); });
    await expect(denied(runs[0].ingestion, runs[0].record, org)).rejects.toThrow('COMMITTED_BYTES_NOT_FOUND');
    await expect(integratePreSeal(runs[0].ingestion, runs[0].record, 'foreign')).rejects.toThrow('tenant mismatch');
  });
});
