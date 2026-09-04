// Abstract source analysis only. No fixture execution, SQL engine, oracle or host capabilities.
import ts from 'typescript';
import { immutableCopy } from '../contracts/validators';
import { validateSnapshot, canonical, detachJson, hash, type SourceSnapshot } from '../ingestion/snapshot';
import { validateExpressIngestion, parseUnit, resolveImport, at, type ExpressIngestion, type SourceLocation, type Route } from '../ingestion/express';
import { ANALYSIS_LIMITS as LIMITS, DETECTOR_VERSION, RULE_ID, type SqlAnalysis, type SqlFinding,
  type FlowKind, type AnalysisLimitation, type LimitationCode } from './types';

interface Step { kind: FlowKind; location: SourceLocation }
interface Data { kind: 'data'; literal: string | null; flow: Step[] }
interface Closure { kind: 'closure'; node: ts.FunctionDeclaration; env: Scope; sf: ts.SourceFile }
interface Registered { method: string; path: string; handler: Closure }
interface Owner { kind: 'owner'; routes: Registered[] }
type Value = Data | Closure | Owner | { kind: 'request' | 'query' | 'database' | 'response' | 'rows' | 'void' }
  | { kind: 'statement'; sql: Data } | { kind: 'builtin'; name: string; receiver?: Value };
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
    return limit('UNBOUND_NAME');
  }
}
const clean = (literal: string | null = null): Data => ({ kind: 'data', literal, flow: [] });
/** Stable ordered set. One source per flow; joins need a later explicit model. */
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
  private loading = new Set<string>();
  private active = new Set<ts.FunctionDeclaration>();
  private steps = 0; private calls = 0; private route: Route | null = null;
  private findings: RawFinding[] = [];
  constructor(private ingestion: ExpressIngestion) {
    let nodes = 0;
    for (const file of ingestion.snapshot.files) {
      const sf = parseUnit(file.path, file.content), queue: ts.Node[] = [sf];
      while (queue.length) {
        const node = queue.pop()!;
        if (++nodes > LIMITS.nodes) limit('NODE_BUDGET');
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
    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement)) continue;
      if (ts.isFunctionDeclaration(statement)) {
        if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) limit('UNSUPPORTED_FUNCTION');
        if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) exports.set(statement.name!.text, env.get(statement.name!.text));
      } else this.statement(statement, env, sf);
    }
    this.loading.delete(filePath); this.modules.set(filePath, exports); return exports;
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
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) limit('UNSUPPORTED_STATEMENT');
        env.set(declaration.name.text, propagate(this.expression(declaration.initializer, env, sf), 'VARIABLE', this.loc(sf, declaration, declaration.name.text)));
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
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.expression(node.left, env, sf), right = this.expression(node.right, env, sf);
      if (left.kind !== 'data' || right.kind !== 'data') limit('UNSUPPORTED_EXPRESSION');
      const trace = flow(left.flow, right.flow);
      if (left.literal !== null && right.literal !== null && left.literal.length + right.literal.length > 1024) limit('UNSUPPORTED_EXPRESSION');
      return { kind: 'data', literal: left.literal !== null && right.literal !== null ? left.literal + right.literal : null,
        flow: trace.length ? flow(trace, [{ kind: 'CONCAT', location: this.loc(sf, node, '+') }]) : [] };
    }
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = this.expression(node.expression, env, sf), name = node.name.text;
      if (receiver.kind === 'request' && name === 'query') return { kind: 'query' };
      if (receiver.kind === 'query') return { kind: 'data', literal: null, flow: [{ kind: 'SOURCE', location: this.loc(sf, node, 'query.' + name) }] };
      if (receiver.kind === 'database' && name === 'prepare') return { kind: 'builtin', name: 'prepare' };
      if (receiver.kind === 'statement' && name === 'all') return { kind: 'builtin', name: 'all', receiver };
      if (receiver.kind === 'response' && name === 'json') return { kind: 'builtin', name: 'json' };
      if (receiver.kind === 'builtin' && receiver.name === 'express' && name === 'Router') return { kind: 'builtin', name: 'express' };
      if (receiver.kind === 'owner' && ['get', 'post', 'put', 'patch', 'delete', 'use'].includes(name)) return { kind: 'builtin', name: 'route.' + name, receiver };
      return limit('UNSUPPORTED_EXPRESSION', this.loc(sf, node, 'property'));
    }
    if (ts.isCallExpression(node)) {
      const target = this.expression(node.expression, env, sf), args = node.arguments.map(arg => this.expression(arg, env, sf));
      return this.call(target, args, this.loc(sf, node, target.kind === 'closure' ? target.node.name!.text : 'call'));
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
        if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken) limit('UNSUPPORTED_FUNCTION');
        env.set(p.name.text, propagate(propagate(args[i], 'CALL', location), 'ARGUMENT', this.loc(sf, p, p.name.text)));
      });
      this.active.add(node);
      try {
        this.hoist(node.body!.statements, env, sf);
        for (const statement of node.body!.statements) {
          const result = this.statement(statement, env, sf); if (result.returned) return result.value;
        }
        return { kind: 'void' };
      } finally { this.active.delete(node); }
    }
    if (target.kind !== 'builtin') return limit('UNSUPPORTED_CALL', location);
    if (target.name === 'express') {
      if (args.length) limit('FACTORY_PROFILE', location); return { kind: 'owner', routes: [] };
    }
    if (target.name.startsWith('route.')) {
      const owner = target.receiver, [path, handler] = args;
      if (this.route || owner?.kind !== 'owner' || args.length !== 2 || path.kind !== 'data' || path.literal === null || path.flow.length) limit('ROUTE_MISMATCH', location);
      if (target.name === 'route.use') {
        if (handler.kind !== 'owner') limit('ROUTE_MISMATCH', location);
        for (const route of handler.routes) owner.routes.push({ ...route, path: (path.literal === '/' ? '' : path.literal) + route.path });
      } else {
        if (handler.kind !== 'closure') limit('ROUTE_MISMATCH', location);
        owner.routes.push({ method: target.name.slice(6).toUpperCase(), path: path.literal, handler });
      }
      if (owner.routes.length > 32) limit('ROUTE_MISMATCH', location); return owner;
    }
    if (target.name === 'prepare') {
      if (args.length !== 1 || args[0].kind !== 'data') limit('UNSUPPORTED_CALL', location);
      const sql = args[0];
      if (!this.route) limit('FACTORY_PROFILE', location);
      if (sql.flow.length) {
        const sink = { ...location, symbol: 'db.prepare' }, trace = flow(sql.flow, [{ kind: 'SINK', location: sink }]);
        const source = trace.find(step => step.kind === 'SOURCE')!.location;
        const finding = { routeIdentity: this.route.routeIdentity, source, sink, flow: trace };
        if (!this.findings.some(f => canonical(f) === canonical(finding))) this.findings.push(finding);
        if (this.findings.length > LIMITS.findings) limit('FINDING_BUDGET', sink);
        if (this.findings.reduce((sum, f) => sum + f.flow.length, 0) > LIMITS.totalFlowNodes) limit('FLOW_BUDGET', sink);
      }
      return { kind: 'statement', sql };
    }
    if (target.name === 'all') {
      if (target.receiver?.kind !== 'statement' || args.length > 1 || args.some(arg => arg.kind !== 'data')) limit('UNSUPPORTED_CALL', location);
      const sql = target.receiver.sql;
      if (!sql.flow.length && sql.literal !== null && (sql.literal.match(/\?/g)?.length || 0) !== args.length) limit('UNSUPPORTED_CALL', location);
      return { kind: 'rows' };
    }
    if (target.name === 'json' && args.length === 1 && args[0].kind === 'rows') return args[0];
    return limit('UNSUPPORTED_CALL', location);
  }
  analyze(): RawFinding[] {
    const apps = new Map<string, Owner>();
    for (const route of this.ingestion.routes) {
      if (!apps.has(route.handler.filePath)) {
        const factory = this.module(route.handler.filePath).get('createApp');
        if (!factory || factory.kind !== 'closure') limit('FACTORY_PROFILE');
        const app = this.call(factory, [{ kind: 'database' }], at(factory.sf, factory.node, 'createApp'));
        if (app.kind !== 'owner') limit('FACTORY_PROFILE'); apps.set(route.handler.filePath, app);
      }
    }
    if ([...apps.values()].reduce((sum, app) => sum + app.routes.length, 0) !== this.ingestion.routes.length) limit('ROUTE_MISMATCH');
    for (const route of this.ingestion.routes) {
      const matches = apps.get(route.handler.filePath)!.routes.filter(r => r.method === route.method && r.path === route.path);
      if (matches.length !== 1) limit('ROUTE_MISMATCH');
      const handler = matches[0].handler;
      if (canonical(at(handler.sf, handler.node, handler.node.name!.text)) !== canonical(route.handler)) limit('ROUTE_MISMATCH');
      this.route = route;
      const result = this.call(handler, [{ kind: 'request' }, { kind: 'response' }], route.handler);
      if (result.kind !== 'rows' && result.kind !== 'void') limit('UNSUPPORTED_CALL', route.handler);
      this.route = null;
    }
    return this.findings;
  }
}
export async function detectSqlInjection(rawSnapshot: SourceSnapshot, rawIngestion: ExpressIngestion, organizationId: string): Promise<SqlAnalysis> {
  const snapshot = await validateSnapshot(rawSnapshot, organizationId);
  const ingestion = await validateExpressIngestion(rawIngestion, organizationId);
  if (snapshot.snapshotId !== ingestion.snapshot.snapshotId) throw new Error('M3_ANALYSIS_SNAPSHOT_MISMATCH');
  const findings: SqlFinding[] = []; const limitations: AnalysisLimitation[] = [];
  try {
    for (const finding of new Analyzer(ingestion).analyze()) {
      const steps = [];
      for (const step of finding.flow) steps.push({ ...step, id: await hash('m3-flow-node-v1', { snapshotId: snapshot.snapshotId, routeIdentity: finding.routeIdentity, ...step }) });
      const body = { routeIdentity: finding.routeIdentity, vulnerabilityClass: 'SQL_INJECTION' as const, source: finding.source, sink: finding.sink, flow: steps };
      findings.push({ ...body, findingId: await hash('m3-sqli-finding-v1', { snapshotId: snapshot.snapshotId, ...body }) });
    }
  } catch (error) {
    if (!(error instanceof Limited)) throw error;
    findings.length = 0; limitations.push(error.detail);
  }
  const body = { version: DETECTOR_VERSION, ruleId: RULE_ID, organizationId, repositoryId: snapshot.repositoryId,
    snapshotId: snapshot.snapshotId, ingestionIdentity: ingestion.ingestionIdentity, routeIdentities: ingestion.routes.map(r => r.routeIdentity),
    status: limitations.length ? 'ANALYSIS_INCONCLUSIVE' as const : findings.length ? 'DETECTED' as const : 'NOT_DETECTED' as const, findings, limitations };
  return immutableCopy({ ...body, resultFingerprint: await hash(DETECTOR_VERSION, body) });
}
/** Recompute from captured source; a self-consistent forged fingerprint is insufficient. */
export async function validateSqlAnalysis(raw: unknown, snapshot: SourceSnapshot, ingestion: ExpressIngestion, organizationId: string): Promise<SqlAnalysis> {
  const detached = detachJson(raw);
  const computed = await detectSqlInjection(snapshot, ingestion, organizationId);
  if (canonical(detached) !== canonical(computed)) throw new Error('M3_ANALYSIS_INTEGRITY_MISMATCH');
  return computed;
}
