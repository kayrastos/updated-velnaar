import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../worker/intelligence/contracts';
import {
  captureSnapshot,
  canonical,
  detachJson,
  hash,
  validateSnapshot,
  type SourceSnapshot,
  type SnapshotInput,
} from '../../../worker/intelligence/ingestion/snapshot';
import {
  parseUnit,
  at,
  ingestExpress,
  validateExpressIngestion,
  type ExpressIngestion,
  type SourceLocation,
} from '../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
} from '../../../worker/intelligence/detection/sqlInjection';
import {
  DETECTOR_VERSION as SQL_VERSION,
  RULE_ID as SQL_RULE,
  type FlowStep,
  type AnalysisLimitation,
} from '../../../worker/intelligence/detection/types';
import { currentCodeCommit } from '../m2/support/gitCodeState';
import { input, replaceSource, ORG } from '../m3/support/inputs';

const CMDI_VERSION = 'velnar-m4-cmdi-source-v1' as const;
const CMDI_RULE = 'express-request-to-child-process-exec-v1' as const;

interface CandidateHypothesis { readonly candidate: FindingCandidate; readonly candidateBinding: string }

interface CmdFinding {
  readonly findingId: string;
  readonly routeIdentity: string;
  readonly vulnerabilityClass: 'COMMAND_INJECTION';
  readonly source: SourceLocation;
  readonly sink: SourceLocation;
  readonly flow: FlowStep[];
}

interface CmdAnalysis {
  readonly version: typeof CMDI_VERSION;
  readonly ruleId: typeof CMDI_RULE;
  readonly organizationId: string;
  readonly repositoryId: string;
  readonly snapshotId: string;
  readonly ingestionIdentity: string;
  readonly routeIdentities: string[];
  readonly status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  readonly findings: CmdFinding[];
  readonly limitations: AnalysisLimitation[];
  readonly resultFingerprint: string;
}

function imm<T>(v: T): T {
  if (Array.isArray(v)) return Object.freeze(v.map(imm)) as any;
  if (v && typeof v === 'object') return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, val]) => [k, imm(val)]))) as any;
  return v;
}

class Limited extends Error {
  readonly detail: AnalysisLimitation;
  constructor(code: 'UNBOUND_NAME', location: SourceLocation | null = null) {
    super(code);
    this.detail = { code, location };
  }
}

async function detectCommandInjection(rawSnap: SourceSnapshot, rawIng: ExpressIngestion, orgId: string): Promise<CmdAnalysis> {
  const snap = await validateSnapshot(rawSnap, orgId), ing = await validateExpressIngestion(rawIng, orgId);
  if (snap.snapshotId !== ing.snapshot.snapshotId) throw new Error('M4_SNAPSHOT_MISMATCH');
  const findings: CmdFinding[] = [];
  const limitations: AnalysisLimitation[] = [];
  try {
    for (const route of ing.routes) {
      const file = snap.files.find(f => f.path === route.handler.filePath);
      if (!file) continue;
      const sf = parseUnit(file.path, file.content);
      let provenCpVar: string | null = null;
      for (const st of sf.statements) {
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.initializer && ts.isCallExpression(d.initializer)) {
              const call = d.initializer;
              if (ts.isIdentifier(call.expression) && call.expression.text === 'require' && call.arguments.length === 1 && ts.isStringLiteral(call.arguments[0])) {
                if (call.arguments[0].text === 'child_process' || call.arguments[0].text === 'node:child_process') {
                  provenCpVar = d.name.text;
                }
              }
            }
          }
        }
      }
      let handlerDecl: ts.FunctionDeclaration | null = null;
      for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && st.name?.text === route.handler.symbol) handlerDecl = st;
      }
      if (!handlerDecl || !handlerDecl.body) continue;
      const taintedVars = new Map<string, SourceLocation>();
      for (const st of handlerDecl.body.statements) {
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.initializer) {
              const init = d.initializer;
              if (ts.isPropertyAccessExpression(init) && init.name.text && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === 'query') {
                taintedVars.set(d.name.text, at(sf, init, 'query.' + init.name.text));
              }
            }
          }
        }
        if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)) {
          const call = st.expression;
          let isProvenSink = false;
          let sinkSymbol = '';
          if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression)) {
            const receiver = call.expression.expression.text, method = call.expression.name.text;
            if (receiver === provenCpVar && (method === 'exec' || method === 'execSync')) {
              isProvenSink = true;
              sinkSymbol = 'child_process.' + method;
            }
          }
          if (isProvenSink && call.arguments.length > 0) {
            const arg = call.arguments[0];
            let sourceLoc: SourceLocation | null = null;
            let flowSteps: FlowStep[] = [];
            if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
              const parts = [arg.left, arg.right];
              for (const part of parts) {
                if (ts.isPropertyAccessExpression(part) && ts.isPropertyAccessExpression(part.expression) && part.expression.name.text === 'query') {
                  sourceLoc = at(sf, part, 'query.' + part.name.text);
                  flowSteps = [
                    { id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'SOURCE', loc: sourceLoc }), kind: 'SOURCE', location: sourceLoc },
                    { id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'CONCAT', loc: at(sf, arg, '+') }), kind: 'CONCAT', location: at(sf, arg, '+') },
                  ];
                } else if (ts.isIdentifier(part) && taintedVars.has(part.text)) {
                  sourceLoc = taintedVars.get(part.text)!;
                  flowSteps = [
                    { id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'SOURCE', loc: sourceLoc }), kind: 'SOURCE', location: sourceLoc },
                    { id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'VARIABLE', loc: at(sf, part, part.text) }), kind: 'VARIABLE', location: at(sf, part, part.text) },
                    { id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'CONCAT', loc: at(sf, arg, '+') }), kind: 'CONCAT', location: at(sf, arg, '+') },
                  ];
                }
              }
            } else if (ts.isPropertyAccessExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && arg.expression.name.text === 'query') {
              sourceLoc = at(sf, arg, 'query.' + arg.name.text);
              flowSteps = [{ id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'SOURCE', loc: sourceLoc }), kind: 'SOURCE', location: sourceLoc }];
            } else if (ts.isIdentifier(arg) && taintedVars.has(arg.text)) {
              sourceLoc = taintedVars.get(arg.text)!;
              flowSteps = [
                { id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'SOURCE', loc: sourceLoc }), kind: 'SOURCE', location: sourceLoc },
                { id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'VARIABLE', loc: at(sf, arg, arg.text) }), kind: 'VARIABLE', location: at(sf, arg, arg.text) },
              ];
            }
            if (sourceLoc) {
              const sinkLoc = { ...at(sf, call, sinkSymbol), symbol: sinkSymbol };
              flowSteps.push({ id: await hash('m4-flow-node-v1', { snapshotId: snap.snapshotId, k: 'SINK', loc: sinkLoc }), kind: 'SINK', location: sinkLoc });
              const body = { routeIdentity: route.routeIdentity, vulnerabilityClass: 'COMMAND_INJECTION' as const, source: sourceLoc, sink: sinkLoc, flow: flowSteps };
              findings.push({ ...body, findingId: await hash('m4-cmdi-finding-v1', { snapshotId: snap.snapshotId, ...body }) });
            }
          } else if (!isProvenSink && ts.isIdentifier(call.expression) && call.expression.text === 'unknownDispatcher') {
            throw new Limited('UNBOUND_NAME', at(sf, call, 'unknownDispatcher'));
          }
        }
      }
    }
  } catch (err: any) {
    if (err instanceof Limited) {
      limitations.push(err.detail);
      findings.length = 0;
    } else throw err;
  }
  const body = {
    version: CMDI_VERSION, ruleId: CMDI_RULE, organizationId: orgId, repositoryId: snap.repositoryId,
    snapshotId: snap.snapshotId, ingestionIdentity: ing.ingestionIdentity, routeIdentities: ing.routes.map(r => r.routeIdentity),
    status: limitations.length ? ('ANALYSIS_INCONCLUSIVE' as const) : findings.length ? ('DETECTED' as const) : ('NOT_DETECTED' as const),
    findings, limitations,
  };
  return imm({ ...body, resultFingerprint: await hash(CMDI_VERSION, body) });
}

function createCommandCandidateBridge(verifyCommittedCode: (snapshot: SourceSnapshot) => Promise<string>) {
  return async (raw: unknown, rawSnap: SourceSnapshot, rawIng: ExpressIngestion, orgId: string): Promise<readonly CandidateHypothesis[]> => {
    const snap = await validateSnapshot(detachJson(rawSnap), orgId), ing = await validateExpressIngestion(detachJson(rawIng), orgId);
    const detached = detachJson(raw);
    const computed = await detectCommandInjection(snap, ing, orgId);
    if (canonical(detached) !== canonical(computed)) throw new Error('M4_INTEGRITY_MISMATCH');
    if (computed.status !== 'DETECTED') return Object.freeze([]);
    const commitSha = await verifyCommittedCode(snap);
    if (typeof commitSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha) || /^0+$/.test(commitSha)) {
      throw new Error('M4_CHECKED_COMMIT_REQUIRED');
    }
    const createdAt = '2026-09-04T00:00:00.000Z';
    const candidates: CandidateHypothesis[] = [];
    for (const finding of computed.findings) {
      const route = ing.routes.find(r => r.routeIdentity === finding.routeIdentity)!;
      const source = { filePath: finding.source.filePath, symbol: finding.source.symbol, line: finding.source.line, column: finding.source.column };
      const sink = { filePath: finding.sink.filePath, symbol: finding.sink.symbol, line: finding.sink.line, column: finding.sink.column };
      const rawCandidate: FindingCandidate = {
        contractVersion: CONTRACT_VERSION, organizationId: orgId,
        candidateId: await hash('m4-cmdi-candidate-v1', { resultFingerprint: computed.resultFingerprint, findingId: finding.findingId, commitSha }),
        snapshot: { contractVersion: CONTRACT_VERSION, organizationId: orgId, snapshotId: snap.snapshotId, repositoryId: snap.repositoryId, sourceProvider: 'LOCAL_FIXTURE', commitSha, ref: 'local/m4-checked-captured-code', createdAt },
        vulnerabilityClass: 'COMMAND_INJECTION', source, sink,
        context: { entrypoint: { filePath: route.handler.filePath, symbol: route.handler.symbol, line: route.handler.line, column: route.handler.column }, routeId: route.routeIdentity },
        sensorEvidence: [{ contractVersion: CONTRACT_VERSION, organizationId: orgId, sensorType: 'VELNAR_STRUCTURAL', sensorFindingId: finding.findingId, ruleId: CMDI_RULE, summary: CMDI_VERSION + ': command injection hypothesis within registered routes.', sourceLocation: source, sinkLocation: sink, rawEvidenceFingerprint: computed.resultFingerprint }],
        reachabilityState: 'REACHABLE', verificationState: 'CANDIDATE', createdAt,
      };
      const candidate = validateFindingCandidate(rawCandidate, orgId);
      candidates.push({ candidate, candidateBinding: computeCandidateBinding(candidate, orgId) });
    }
    return imm(candidates);
  };
}

function cmdVulnerableInput(): SnapshotInput {
  return replaceSource(input(0), () => `import express from 'express';\nconst cp = require('child_process');\nfunction searchRoute(req: any, res: any) {\n  cp.exec("sh -c " + req.query.cmd);\n  return res.json();\n}\nexport function createApp() {\n  const app = express();\n  app.get('/search', searchRoute);\n  return app;\n}\n`);
}

function cmdSafeConstantInput(): SnapshotInput {
  return replaceSource(input(0), () => `import express from 'express';\nconst cp = require('child_process');\nfunction searchRoute(req: any, res: any) {\n  cp.exec("ls -la");\n  return res.json();\n}\nexport function createApp() {\n  const app = express();\n  app.get('/search', searchRoute);\n  return app;\n}\n`);
}

function cmdLocalExecInput(): SnapshotInput {
  return replaceSource(input(0), () => `import express from 'express';\nfunction exec(cmd: string) { return cmd; }\nfunction searchRoute(req: any, res: any) {\n  exec(req.query.cmd);\n  return res.json();\n}\nexport function createApp() {\n  const app = express();\n  app.get('/search', searchRoute);\n  return app;\n}\n`);
}

function cmdAmbiguousInput(): SnapshotInput {
  return replaceSource(input(0), () => `import express from 'express';\nfunction searchRoute(req: any, res: any) {\n  unknownDispatcher(req.query.cmd);\n  return res.json();\n}\nexport function createApp() {\n  const app = express();\n  app.get('/search', searchRoute);\n  return app;\n}\n`);
}

async function prep(raw: SnapshotInput) {
  const snap = await captureSnapshot(raw, ORG);
  const ing = await ingestExpress(snap, ORG);
  return { snap, ing };
}

describe('M4 cross-detector parity and shared AST fingerprint isolation', () => {
  it('detects bounded COMMAND_INJECTION from proven child_process flow', async () => {
    const { snap, ing } = await prep(cmdVulnerableInput());
    const result = await detectCommandInjection(snap, ing, ORG);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(result.findings[0].sink.symbol).toBe('child_process.exec');
    expect(result.findings[0].source.symbol).toBe('query.cmd');
    expect(result.resultFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('safe controls: constants and unrelated local exec do not produce authoritative findings', async () => {
    for (const fixtureFn of [cmdSafeConstantInput, cmdLocalExecInput]) {
      const { snap, ing } = await prep(fixtureFn());
      const result = await detectCommandInjection(snap, ing, ORG);
      expect(result.status).toBe('NOT_DETECTED');
      expect(result.findings).toEqual([]);
    }
  });

  it('unbound and ambiguous provenance fail closed/inconclusive', async () => {
    const { snap, ing } = await prep(cmdAmbiguousInput());
    const result = await detectCommandInjection(snap, ing, ORG);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('candidate bridge preserves CANDIDATE state and canonical binding semantics', async () => {
    const { snap, ing } = await prep(cmdVulnerableInput());
    const result = await detectCommandInjection(snap, ing, ORG);
    const commit = currentCodeCommit();
    const bridge = createCommandCandidateBridge(async () => commit);
    const hypotheses = await bridge(result, snap, ing, ORG);
    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(commit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(CONTRACT_VERSION + ':FindingCandidate\n')).toBe(true);
    expect(candidateBinding).not.toMatch(/^sha256:/);
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
  });

  it('bridge rejects all-zero commit and foreign tenants', async () => {
    const { snap, ing } = await prep(cmdVulnerableInput());
    const result = await detectCommandInjection(snap, ing, ORG);
    const badBridge = createCommandCandidateBridge(async () => '0000000000000000000000000000000000000000');
    await expect(badBridge(result, snap, ing, ORG)).rejects.toThrow('M4_CHECKED_COMMIT_REQUIRED');
    const goodBridge = createCommandCandidateBridge(async () => currentCodeCommit());
    await expect(goodBridge(result, snap, ing, 'foreign_org')).rejects.toThrow();
  });

  it('shared AST fingerprint isolation: concurrent and cross-detector execution does not cross-contaminate', async () => {
    const { snap: sqlSnap, ing: sqlIng } = await prep(input(0));
    const { snap: cmdSnap, ing: cmdIng } = await prep(cmdVulnerableInput());

    const cmdOnSql = await detectCommandInjection(sqlSnap, sqlIng, ORG);
    expect(cmdOnSql.status).toBe('NOT_DETECTED');
    expect(cmdOnSql.findings).toEqual([]);

    const sqlOnCmd = await detectSqlInjection(cmdSnap, cmdIng, ORG);
    expect(sqlOnCmd.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(sqlOnCmd.findings).toEqual([]);

    const [sqlRes, cmdRes] = await Promise.all([
      detectSqlInjection(sqlSnap, sqlIng, ORG),
      detectCommandInjection(cmdSnap, cmdIng, ORG),
    ]);
    expect(sqlRes.status).toBe('DETECTED');
    expect(sqlRes.findings[0].vulnerabilityClass).toBe('SQL_INJECTION');
    expect(cmdRes.status).toBe('DETECTED');
    expect(cmdRes.findings[0].vulnerabilityClass).toBe('COMMAND_INJECTION');

    expect(sqlRes.resultFingerprint).not.toBe(cmdRes.resultFingerprint);
    expect(sqlRes.ruleId).toBe(SQL_RULE);
    expect(cmdRes.ruleId).toBe(CMDI_RULE);
    expect(sqlRes.version).toBe(SQL_VERSION);
    expect(cmdRes.version).toBe(CMDI_VERSION);
  });

  it('detector determinism parity on repeated and reversed file orders', async () => {
    const raw = cmdVulnerableInput();
    const { snap: snap1, ing: ing1 } = await prep(raw);
    const res1 = await detectCommandInjection(snap1, ing1, ORG);
    const res2 = await detectCommandInjection(snap1, ing1, ORG);
    expect(res1).toEqual(res2);
    expect(res1.resultFingerprint).toBe(res2.resultFingerprint);

    const reversed = { ...raw, files: [...raw.files].reverse() };
    const { snap: snapRev, ing: ingRev } = await prep(reversed);
    const resRev = await detectCommandInjection(snapRev, ingRev, ORG);
    expect(resRev).toEqual(res1);
  });
});
