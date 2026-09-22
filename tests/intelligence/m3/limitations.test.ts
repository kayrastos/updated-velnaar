import { describe, expect, it } from 'vitest';
import { ANALYSIS_LIMITS } from '../../../worker/intelligence/detection/types';
import { analyzeInput, input, replaceSource } from './support/inputs';

async function limitedBody(insertion: string, code?: string) {
  const raw = replaceSource(input(), source => source.replace('return res.json', insertion + '; return res.json'));
  const run = await analyzeInput(raw);
  expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.findings).toEqual([]);
  expect(run.result.limitations).toHaveLength(1);
  if (code) expect(run.result.limitations[0].code).toBe(code);
  return run;
}
describe('M3 fail-closed syntax and analysis budgets', () => {
  it.each(['if (req.query.q) return res.json(db.prepare(req.query.q).all())', 'while (true) {}',
    'let value = req.query.q', 'const value = req.query["q"]', 'const value = `${req.query.q}`',
    'const value = (() => req.query.q)()', 'const value = req.query.q.replace("x", "")',
    'fetch(req.query.q)', 'process.exit()', 'eval(req.query.q)', 'db.constructor("return process")()',
    'const value = req.query.q as string'])('unsupported relevant syntax is inconclusive: %s', async syntax => {
      await limitedBody(syntax);
    });
  it('does not retain partial detections when later reachable syntax is unsupported', async () => {
    const raw = replaceSource(input(), source => source.replace('return res.json', 'const rows = res.json')
      .replace(').all());', ').all()); while (true) {} return rows;'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.findings).toEqual([]);
  });
  it('direct recursive route calls are bounded by cycle detection', async () => {
    await limitedBody('return searchRoute(req, res)', 'CALL_CYCLE');
  });
  it('mutually recursive helpers are bounded by cycle detection', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute',
      'function one(value: string) { return two(value); } function two(value: string) { return one(value); } function searchRoute')
      .replace('return res.json', 'one(req.query.q); return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.limitations[0].code).toBe('CALL_CYCLE');
  });
  it('cyclic local named imports are inconclusive', async () => {
    const raw = input(6);
    const files = raw.files.map(file => file.path === 'src/repository.ts'
      ? { ...file, content: "import { lookup } from './service';\n" + file.content } : file);
    const run = await analyzeInput({ ...raw, files });
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.limitations[0].code).toBe('IMPORT_CYCLE');
  });
  it('acyclic call depth is bounded independently of cycle detection', async () => {
    const helpers = Array.from({ length: 20 }, (_, i) => `function f${i}(v: string) { return ${i === 19 ? 'v' : `f${i + 1}(v)`}; }`).join('\n');
    const raw = replaceSource(input(), source => source.replace('function searchRoute', helpers + '\nfunction searchRoute')
      .replace('return res.json', 'f0(req.query.q); return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.limitations[0].code).toBe('CALL_DEPTH');
  });
  it('bounds total AST analysis nodes without reducing the sealed ingestion limit', async () => {
    await limitedBody(Array.from({ length: 500 }, (_, i) => `const x${i} = ""`).join(';'), 'NODE_BUDGET');
  });
  it('bounds a single taint flow', async () => {
    const declarations = ['const x0 = req.query.q', ...Array.from({ length: ANALYSIS_LIMITS.flowLength + 1 }, (_, i) => `const x${i + 1} = x${i}`)].join(';');
    await limitedBody(declarations, 'FLOW_BUDGET');
  });
  it('bounds the number of source-to-sink findings', async () => {
    await limitedBody(Array.from({ length: 9 }, () => 'db.prepare(req.query.q).all()').join(';'), 'FINDING_BUDGET');
  });
  it('bounds cumulative flow nodes across separate findings', async () => {
    const declarations = ['const x0 = req.query.q', ...Array.from({ length: 50 }, (_, i) => `const x${i + 1} = x${i}`)].join(';');
    await limitedBody(declarations + ';' + 'db.prepare(x50).all();'.repeat(5), 'FLOW_BUDGET');
  });
  it('bounds total function/capability calls', async () => {
    const raw = replaceSource(input(), source => source.replace('function searchRoute', 'function noop() {} function searchRoute')
      .replace('return res.json', 'noop();'.repeat(130) + 'return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.limitations[0].code).toBe('CALL_BUDGET');
  });
  it('bounds abstract steps even when the AST and call counts are small', async () => {
    const body = Array.from({ length: 40 }, (_, i) => `const a${i} = "";`).join('');
    const raw = replaceSource(input(), source => source.replace('function searchRoute', `function work() {${body}} function searchRoute`)
      .replace('return res.json', 'work();'.repeat(60) + 'return res.json'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.limitations[0].code).toBe('STEP_BUDGET');
  });
  it('refuses multi-source joins instead of inventing provenance', async () => {
    const raw = replaceSource(input(), source => source.replace('req.query.q', '(req.query.q + req.query.other)'));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.limitations[0].code).toBe('MULTIPLE_SOURCES');
  });
  it('does not infer route reachability from a factory/runtime registration mismatch', async () => {
    const raw = replaceSource(input(7), source => source.replace("router.get('/search', searchRoute);\n  app.use('/api', router);",
      "app.use('/api', router);\n  router.get('/search', searchRoute);"));
    const run = await analyzeInput(raw);
    expect(run.result.status).toBe('ANALYSIS_INCONCLUSIVE'); expect(run.result.limitations[0].code).toBe('ROUTE_MISMATCH');
  });
});
