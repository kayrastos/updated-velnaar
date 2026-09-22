// Abstract source analysis only. No fixture execution, storage engine, oracle or host capabilities.
import ts from 'typescript';
import { CONTRACT_VERSION, type FindingCandidate } from '../contracts/types';
import { computeCandidateBinding, validateFindingCandidate, immutableCopy } from '../contracts/validators';
import { validateSnapshot, canonical, detachJson, hash, type SourceSnapshot } from '../ingestion/snapshot';
import { validateExpressIngestion, parseUnit, at, resolveImport, type ExpressIngestion, type SourceLocation } from '../ingestion/express';
import { ANALYSIS_LIMITS as LIMITS, type FlowKind, type FlowStep, type AnalysisLimitation, type LimitationCode } from './types';

export const DETECTOR_VERSION = 'velnar-m4-objauth-source-v1' as const;
export const RULE_ID = 'express-request-to-unauthorized-object-access-v1' as const;
export const OBJECT_AUTH_DETECTOR_VERSION = DETECTOR_VERSION;
export const OBJECT_AUTH_RULE_ID = RULE_ID;

export interface ObjectAuthorizationFinding {
  readonly findingId: string;
  readonly routeIdentity: string;
  readonly vulnerabilityClass: 'OBJECT_AUTHORIZATION';
  readonly source: SourceLocation;
  readonly sink: SourceLocation;
  readonly flow: readonly FlowStep[];
}
export type ObjectAuthFinding = ObjectAuthorizationFinding;

export interface ObjectAuthorizationAnalysis {
  readonly version: typeof DETECTOR_VERSION;
  readonly ruleId: typeof RULE_ID;
  readonly organizationId: string;
  readonly repositoryId: string;
  readonly snapshotId: string;
  readonly ingestionIdentity: string;
  readonly routeIdentities: readonly string[];
  readonly status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  readonly findings: readonly ObjectAuthorizationFinding[];
  readonly limitations: readonly AnalysisLimitation[];
  readonly resultFingerprint: string;
}
export type ObjectAuthAnalysis = ObjectAuthorizationAnalysis;

export interface CandidateHypothesis {
  readonly candidate: FindingCandidate;
  readonly candidateBinding: string;
}

interface Step { kind: FlowKind; location: SourceLocation }
interface Data { kind: 'data'; literal: string | null; flow: Step[] }
interface Closure { kind: 'closure'; node: ts.FunctionDeclaration; env: Scope; sf: ts.SourceFile }
interface Owner { kind: 'owner'; routes: { method: string; path: string; handler: Closure }[] }
type Value = Data | Closure | Owner
  | { kind: 'request' | 'query' | 'store' | 'auth_context' | 'response' | 'record' | 'void' }
  | { kind: 'builtin'; name: string; receiver?: Value };

interface RawFinding { routeIdentity: string; source: SourceLocation; sink: SourceLocation; flow: Step[] }

class Limited extends Error {
  constructor(readonly detail: AnalysisLimitation) { super(detail.code); }
}
function limit(code: LimitationCode, location: SourceLocation | null = null): never { throw new Limited({ code, location }); }

class Scope {
  private values = new Map<string, Value>();
  constructor(private parent?: Scope) {}
  set(name: string, value: Value) { if (this.values.has(name)) limit('DUPLICATE_BINDING'); this.values.set(name, value); }
  get(name: string): Value {
    if (this.values.has(name)) return this.values.get(name)!;
    if (this.parent) return this.parent.get(name);
    if (['store', 'objectStore', 'repository', 'records', 'db'].includes(name)) return { kind: 'store' };
    return limit('UNBOUND_NAME');
  }
}

const clean = (literal: string | null = null): Data => ({ kind: 'data', literal, flow: [] });

function flow(...parts: Step[][]): Step[] {
  const seen = new Set<string>(), result: Step[] = [];
  for (const part of parts) for (const step of part) {
    const key = canonical(step);
    if (!seen.has(key)) { seen.add(key); result.push(step); }
    if (result.length > LIMITS.flowLength) limit('FLOW_BUDGET', step.location);
  }
  if (result.filter(s => s.kind === 'SOURCE').length > 1) limit('MULTIPLE_SOURCES');
  return result;
}

function propagate(value: Value, kind: FlowKind, location: SourceLocation): Value {
  return value.kind === 'data' && value.flow.length ? { ...value, flow: flow(value.flow, [{ kind, location }]) } : value;
}

class Analyzer {
  private units = new Map<string, ts.SourceFile>();
  private modules = new Map<string, Map<string, Value>>();
  private active = new Set<ts.FunctionDeclaration>();
  private loading = new Set<string>();
  private steps = 0; private calls = 0; private findings: RawFinding[] = [];

  constructor(private ingestion: ExpressIngestion) {
    let nodes = 0;
    for (const file of ingestion.snapshot.files) {
      const sf = parseUnit(file.path, file.content), queue: ts.Node[] = [sf];
      while (queue.length) {
        const node = queue.pop()!; if (++nodes > LIMITS.nodes) limit('NODE_BUDGET');
        ts.forEachChild(node, child => { queue.push(child); });
      }
      this.units.set(file.path, sf);
    }
  }

  private tick() { if (++this.steps > LIMITS.steps) limit('STEP_BUDGET'); }
  private loc(sf: ts.SourceFile, node: ts.Node, symbol: string) { return at(sf, node, symbol); }

  private hoist(statements: ts.NodeArray<ts.Statement>, env: Scope, sf: ts.SourceFile) {
    for (const node of statements) if (ts.isFunctionDeclaration(node)) {
      if (!node.name || !node.body) limit('UNSUPPORTED_FUNCTION');
      env.set(node.name.text, { kind: 'closure', node, env, sf });
    }
  }

  private module(filePath: string): Map<string, Value> {
    if (this.modules.has(filePath)) return this.modules.get(filePath)!;
    if (this.loading.has(filePath)) limit('IMPORT_CYCLE');
    this.loading.add(filePath);
    const sf = this.units.get(filePath); if (!sf) return limit('UNSUPPORTED_IMPORT');
    const env = new Scope(), exports = new Map<string, Value>();
    for (const statement of sf.statements) {
      this.tick();
      if (!ts.isImportDeclaration(statement)) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) limit('UNSUPPORTED_IMPORT');
      if (statement.moduleSpecifier.text === 'express') {
        if (!clause.name || clause.namedBindings) limit('UNSUPPORTED_IMPORT');
        env.set(clause.name.text, { kind: 'builtin', name: 'express' });
      } else {
        if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) limit('UNSUPPORTED_IMPORT');
        const other = this.module(resolveImport(filePath, statement.moduleSpecifier.text, [...this.units.keys()]));
        for (const item of clause.namedBindings.elements) {
          if (item.isTypeOnly) limit('UNSUPPORTED_IMPORT');
          const value = other.get((item.propertyName || item.name).text);
          if (!value || value.kind !== 'closure') limit('UNSUPPORTED_IMPORT');
          env.set(item.name.text, value);
        }
      }
    }
    this.hoist(sf.statements, env, sf);
    for (const s of sf.statements) {
      if (ts.isImportDeclaration(s)) continue;
      if (ts.isFunctionDeclaration(s)) {
        if (s.name) exports.set(s.name.text, env.get(s.name.text));
      } else this.statement(s, env, sf);
    }
    this.loading.delete(filePath);
    this.modules.set(filePath, exports); return exports;
  }

  private statement(node: ts.Statement, env: Scope, sf: ts.SourceFile): { returned: boolean; value: Value } {
    this.tick(); const nothing = { returned: false, value: { kind: 'void' } as Value };
    if (ts.isFunctionDeclaration(node)) return nothing;
    if (ts.isReturnStatement(node)) {
      const value = node.expression ? this.expression(node.expression, env, sf) : nothing.value;
      return { returned: true, value: propagate(value, 'RETURN', this.loc(sf, node, 'return')) };
    }
    if (ts.isVariableStatement(node)) {
      if (!(node.declarationList.flags & ts.NodeFlags.Const)) limit('UNSUPPORTED_STATEMENT', this.loc(sf, node, 'variable'));
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) limit('UNSUPPORTED_STATEMENT');
        env.set(d.name.text, propagate(this.expression(d.initializer, env, sf), 'VARIABLE', this.loc(sf, d, d.name.text)));
      }
      return nothing;
    }
    if (ts.isExpressionStatement(node)) { this.expression(node.expression, env, sf); return nothing; }
    return limit('UNSUPPORTED_STATEMENT', this.loc(sf, node, 'statement'));
  }

  private expression(node: ts.Expression, env: Scope, sf: ts.SourceFile): Value {
    this.tick();
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return clean(node.text);
    if (ts.isIdentifier(node)) return env.get(node.text);
    if (ts.isParenthesizedExpression(node)) return this.expression(node.expression, env, sf);
    if (ts.isObjectLiteralExpression(node)) return clean(null);
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || ts.isNumericLiteral(node)) return clean(null);
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = this.expression(node.expression, env, sf), name = node.name.text;
      if (receiver.kind === 'request') {
        if (name === 'query' || name === 'params') return { kind: 'query' };
        if (name === 'session' || name === 'user' || name === 'auth') return { kind: 'auth_context' };
        return limit('UNSUPPORTED_EXPRESSION', this.loc(sf, node, 'property'));
      }
      if (receiver.kind === 'query') return { kind: 'data', literal: null, flow: [{ kind: 'SOURCE', location: this.loc(sf, node, 'query.' + name) }] };
      if (receiver.kind === 'auth_context') return clean(null);
      if (receiver.kind === 'store' && ['get', 'find', 'findById', 'load', 'read'].includes(name)) return { kind: 'builtin', name: 'store.' + name, receiver };
      if (receiver.kind === 'response' && name === 'json') return { kind: 'builtin', name: 'json' };
      if (receiver.kind === 'owner' && ['get', 'post', 'put', 'patch', 'delete'].includes(name)) return { kind: 'builtin', name: 'route.' + name, receiver };
      return limit('UNSUPPORTED_EXPRESSION', this.loc(sf, node, 'property'));
    }
    if (ts.isCallExpression(node)) {
      const target = this.expression(node.expression, env, sf), args = node.arguments.map(a => this.expression(a, env, sf));
      return this.call(target, args, this.loc(sf, node, 'call'));
    }
    return limit('UNSUPPORTED_EXPRESSION', this.loc(sf, node, 'expression'));
  }

  private call(target: Value, args: Value[], location: SourceLocation): Value {
    this.tick(); if (++this.calls > LIMITS.calls) limit('CALL_BUDGET', location);
    if (target.kind === 'closure') {
      const { node, sf } = target;
      if (this.active.has(node)) limit('CALL_CYCLE', location);
      if (this.active.size >= LIMITS.callDepth) limit('CALL_DEPTH', location);
      if (node.asteriskToken || node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || args.length !== node.parameters.length) limit('UNSUPPORTED_FUNCTION', location);
      const env = new Scope(target.env);
      node.parameters.forEach((p, i) => {
        if (!ts.isIdentifier(p.name) || p.initializer) limit('UNSUPPORTED_FUNCTION');
        env.set(p.name.text, propagate(propagate(args[i], 'CALL', location), 'ARGUMENT', this.loc(sf, p, p.name.text)));
      });
      this.active.add(node);
      try {
        this.hoist(node.body!.statements, env, sf);
        for (const s of node.body!.statements) { const r = this.statement(s, env, sf); if (r.returned) return r.value; }
        return { kind: 'void' };
      } finally { this.active.delete(node); }
    }
    if (target.kind !== 'builtin') return limit('UNSUPPORTED_CALL', location);
    if (target.name === 'express') return { kind: 'owner', routes: [] };
    if (target.name.startsWith('route.')) {
      const owner = target.receiver, [path, handler] = args;
      if (owner?.kind !== 'owner' || args.length !== 2 || path.kind !== 'data' || path.literal === null || handler.kind !== 'closure') limit('ROUTE_MISMATCH', location);
      owner.routes.push({ method: target.name.slice(6).toUpperCase(), path: path.literal, handler });
      return owner;
    }
    if (target.name.startsWith('store.')) {
      if (args.length !== 1 || args[0].kind !== 'data') limit('UNSUPPORTED_CALL', location);
      const idArg = args[0];
      if (idArg.flow.length) {
        const sink = { ...location, symbol: target.name };
        const trace = flow(idArg.flow, [{ kind: 'SINK', location: sink }]);
        const source = trace.find(s => s.kind === 'SOURCE')!.location;
        this.findings.push({ routeIdentity: '', source, sink, flow: trace });
      }
      return { kind: 'record' };
    }
    if (target.name === 'json') return { kind: 'void' };
    return limit('UNSUPPORTED_CALL', location);
  }

  analyze(): RawFinding[] {
    for (const route of this.ingestion.routes) {
      const factory = this.module(route.handler.filePath).get('createApp');
      if (!factory || factory.kind !== 'closure') limit('FACTORY_PROFILE');
      const app = this.call(factory, factory.node.parameters.map(() => ({ kind: 'store' as const })), at(factory.sf, factory.node, 'createApp'));
      if (app.kind !== 'owner') limit('FACTORY_PROFILE');
      const matched = app.routes.find(r => r.method === route.method && r.path === route.path);
      if (!matched) limit('ROUTE_MISMATCH');
      const countBefore = this.findings.length;
      this.call(matched.handler, [{ kind: 'request' }, { kind: 'response' }], route.handler);
      for (let i = countBefore; i < this.findings.length; i++) {
        (this.findings[i] as any).routeIdentity = route.routeIdentity;
      }
    }
    return this.findings;
  }
}

export async function detectObjectAuthorization(rawSnapshot: SourceSnapshot, rawIngestion: ExpressIngestion, organizationId: string): Promise<ObjectAuthorizationAnalysis> {
  const snapshot = await validateSnapshot(rawSnapshot, organizationId);
  const ingestion = await validateExpressIngestion(rawIngestion, organizationId);
  if (snapshot.snapshotId !== ingestion.snapshot.snapshotId) throw new Error('M4_ANALYSIS_SNAPSHOT_MISMATCH');
  const findings: ObjectAuthorizationFinding[] = []; const limitations: AnalysisLimitation[] = [];
  try {
    for (const f of new Analyzer(ingestion).analyze()) {
      const steps = [];
      for (const step of f.flow) steps.push({ ...step, id: await hash('m4-flow-node-v1', { snapshotId: snapshot.snapshotId, routeIdentity: f.routeIdentity, ...step }) });
      const body = { routeIdentity: f.routeIdentity, vulnerabilityClass: 'OBJECT_AUTHORIZATION' as const, source: f.source, sink: f.sink, flow: steps };
      findings.push({ ...body, findingId: await hash('m4-objauth-finding-v1', { snapshotId: snapshot.snapshotId, ...body }) });
    }
  } catch (error) {
    if (!(error instanceof Limited)) throw error;
    findings.length = 0; limitations.push(error.detail);
  }
  const body = {
    version: DETECTOR_VERSION, ruleId: RULE_ID, organizationId, repositoryId: snapshot.repositoryId,
    snapshotId: snapshot.snapshotId, ingestionIdentity: ingestion.ingestionIdentity, routeIdentities: ingestion.routes.map(r => r.routeIdentity),
    status: limitations.length ? 'ANALYSIS_INCONCLUSIVE' as const : findings.length ? 'DETECTED' as const : 'NOT_DETECTED' as const, findings, limitations,
  };
  return immutableCopy({ ...body, resultFingerprint: await hash(DETECTOR_VERSION, body) });
}

export async function validateObjectAuthorizationAnalysis(raw: unknown, snapshot: SourceSnapshot, ingestion: ExpressIngestion, organizationId: string): Promise<ObjectAuthorizationAnalysis> {
  const detached = detachJson(raw);
  const computed = await detectObjectAuthorization(snapshot, ingestion, organizationId);
  if (canonical(detached) !== canonical(computed)) throw new Error('M4_ANALYSIS_INTEGRITY_MISMATCH');
  return computed;
}
export const validateObjectAuthAnalysis = validateObjectAuthorizationAnalysis;

const location = (p: SourceLocation) => ({ filePath: p.filePath, symbol: p.symbol, line: p.line, column: p.column });

export function createObjectAuthorizationCandidateBridge(verifyCommittedCode: (snapshot: SourceSnapshot) => Promise<string>) {
  return async (raw: unknown, rawSnapshot: SourceSnapshot, rawIngestion: ExpressIngestion, organizationId: string): Promise<readonly CandidateHypothesis[]> => {
    const resultCopy = detachJson(raw), snapshotCopy = detachJson(rawSnapshot), ingestionCopy = detachJson(rawIngestion);
    const snapshot = await validateSnapshot(snapshotCopy, organizationId);
    const ingestion = await validateExpressIngestion(ingestionCopy, organizationId);
    const analysis = await validateObjectAuthorizationAnalysis(resultCopy, snapshot, ingestion, organizationId);
    if (analysis.status !== 'DETECTED') return Object.freeze([]);
    const commitSha = await verifyCommittedCode(snapshot);
    if (typeof commitSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha) || /^0+$/.test(commitSha)) throw new Error('M4_CHECKED_COMMIT_REQUIRED');
    const createdAt = '2026-09-04T00:00:00.000Z';
    const candidates: CandidateHypothesis[] = [];
    for (const finding of analysis.findings) {
      const route = ingestion.routes.find(r => r.routeIdentity === finding.routeIdentity)!;
      const source = location(finding.source), sink = location(finding.sink);
      const rawCandidate: FindingCandidate = {
        contractVersion: CONTRACT_VERSION, organizationId,
        candidateId: await hash('m4-objauth-candidate-v1', { resultFingerprint: analysis.resultFingerprint, findingId: finding.findingId, commitSha }),
        snapshot: { contractVersion: CONTRACT_VERSION, organizationId, snapshotId: snapshot.snapshotId, repositoryId: snapshot.repositoryId,
          sourceProvider: 'LOCAL_FIXTURE', commitSha, ref: 'local/m4-checked-captured-code', createdAt },
        vulnerabilityClass: 'OBJECT_AUTHORIZATION', source, sink,
        context: { entrypoint: location(route.handler), routeId: route.routeIdentity },
        sensorEvidence: [{ contractVersion: CONTRACT_VERSION, organizationId, sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: finding.findingId, ruleId: RULE_ID,
          summary: DETECTOR_VERSION + ': source-analysis hypothesis within closed registered-route subset.',
          sourceLocation: source, sinkLocation: sink, rawEvidenceFingerprint: analysis.resultFingerprint }],
        reachabilityState: 'REACHABLE', verificationState: 'CANDIDATE', createdAt,
      };
      const candidate = validateFindingCandidate(rawCandidate, organizationId);
      candidates.push({ candidate, candidateBinding: computeCandidateBinding(candidate, organizationId) });
    }
    return immutableCopy(candidates);
  };
}
export const createObjectAuthCandidateBridge = createObjectAuthorizationCandidateBridge;
