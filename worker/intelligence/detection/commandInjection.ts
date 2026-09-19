// Abstract source analysis only. No fixture execution, shell commands, or host capabilities.
import ts from 'typescript';
import { CONTRACT_VERSION, type FindingCandidate } from '../contracts/types';
import { computeCandidateBinding, validateFindingCandidate, immutableCopy } from '../contracts/validators';
import { validateSnapshot, canonical, detachJson, hash, type SourceSnapshot } from '../ingestion/snapshot';
import { validateExpressIngestion, parseUnit, resolveImport, at, type ExpressIngestion, type SourceLocation, type Route } from '../ingestion/express';
import { ANALYSIS_LIMITS as LIMITS, type FlowKind, type AnalysisLimitation, type LimitationCode, type FlowStep } from './types';

export const COMMAND_DETECTOR_VERSION = 'velnar-m4-cmdi-source-v1' as const;
export const DETECTOR_VERSION = COMMAND_DETECTOR_VERSION;
export const COMMAND_INJECTION_DETECTOR_VERSION = COMMAND_DETECTOR_VERSION;

export const COMMAND_RULE_ID = 'express-request-to-child-process-v1' as const;
export const RULE_ID = COMMAND_RULE_ID;
export const COMMAND_INJECTION_RULE_ID = COMMAND_RULE_ID;

export interface CommandInjectionFinding {
  readonly findingId: string;
  readonly routeIdentity: string;
  readonly vulnerabilityClass: 'COMMAND_INJECTION';
  readonly source: SourceLocation;
  readonly sink: SourceLocation;
  readonly flow: readonly FlowStep[];
}
export type CommandFinding = CommandInjectionFinding;

export interface CommandInjectionAnalysis {
  readonly version: typeof COMMAND_DETECTOR_VERSION;
  readonly ruleId: typeof COMMAND_RULE_ID;
  readonly organizationId: string;
  readonly repositoryId: string;
  readonly snapshotId: string;
  readonly ingestionIdentity: string;
  readonly routeIdentities: readonly string[];
  readonly status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  readonly findings: readonly CommandInjectionFinding[];
  readonly limitations: readonly AnalysisLimitation[];
  readonly resultFingerprint: string;
}
export type CommandAnalysis = CommandInjectionAnalysis;

export interface CandidateHypothesis {
  readonly candidate: FindingCandidate;
  readonly candidateBinding: string;
}

interface Step { kind: FlowKind; location: SourceLocation }
interface Data { kind: 'data'; literal: string | null; flow: Step[] }
interface Closure { kind: 'closure'; node: ts.FunctionDeclaration; env: Scope; sf: ts.SourceFile }
interface Registered { method: string; path: string; handler: Closure }
interface Owner { kind: 'owner'; routes: Registered[] }
type Value = Data | Closure | Owner
  | { kind: 'request' | 'query' | 'params' | 'body' | 'headers' | 'response' | 'child_process' | 'void' }
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

const locationOf = (point: SourceLocation) => ({ filePath: point.filePath, symbol: point.symbol, line: point.line, column: point.column });

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
    for (const node of statements) {
      if (ts.isFunctionDeclaration(node)) {
        if (!node.name || !node.body) limit('UNSUPPORTED_FUNCTION');
        env.set(node.name.text, { kind: 'closure', node, env, sf });
      }
    }
  }

  private module(filePath: string): Map<string, Value> {
    if (this.modules.has(filePath)) return this.modules.get(filePath)!;
    if (this.loading.has(filePath)) limit('IMPORT_CYCLE');
    this.loading.add(filePath);
    const sf = this.units.get(filePath);
    if (!sf) return limit('UNSUPPORTED_IMPORT');
    const env = new Scope(), exports = new Map<string, Value>();
    for (const statement of sf.statements) {
      this.tick();
      if (!ts.isImportDeclaration(statement)) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier)) limit('UNSUPPORTED_IMPORT');
      const target = statement.moduleSpecifier.text;
      if (target === 'express') {
        if (!clause.name || clause.namedBindings) limit('UNSUPPORTED_IMPORT');
        env.set(clause.name.text, { kind: 'builtin', name: 'express' });
      } else if (target === 'child_process' || target === 'node:child_process') {
        if (clause.name) env.set(clause.name.text, { kind: 'child_process' });
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            env.set(clause.namedBindings.name.text, { kind: 'child_process' });
          } else if (ts.isNamedImports(clause.namedBindings)) {
            for (const item of clause.namedBindings.elements) {
              if (item.isTypeOnly) limit('UNSUPPORTED_IMPORT');
              const prop = (item.propertyName || item.name).text;
              if (prop === 'exec') env.set(item.name.text, { kind: 'builtin', name: 'child_process.exec' });
              else if (prop === 'execSync') env.set(item.name.text, { kind: 'builtin', name: 'child_process.execSync' });
              else limit('UNSUPPORTED_IMPORT');
            }
          }
        }
      } else {
        if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) limit('UNSUPPORTED_IMPORT');
        const other = this.module(resolveImport(filePath, target, [...this.units.keys()]));
        for (const item of clause.namedBindings.elements) {
          if (item.isTypeOnly) limit('UNSUPPORTED_IMPORT');
          const value = other.get((item.propertyName || item.name).text);
          if (!value) limit('UNSUPPORTED_IMPORT');
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
        if (!declaration.initializer) limit('UNSUPPORTED_STATEMENT');
        if (ts.isIdentifier(declaration.name)) {
          env.set(declaration.name.text, propagate(this.expression(declaration.initializer, env, sf), 'VARIABLE', this.loc(sf, declaration, declaration.name.text)));
        } else if (ts.isObjectBindingPattern(declaration.name)) {
          const initVal = this.expression(declaration.initializer, env, sf);
          if (initVal.kind === 'child_process') {
            for (const elem of declaration.name.elements) {
              if (!ts.isIdentifier(elem.name)) limit('UNSUPPORTED_STATEMENT');
              const prop = elem.propertyName && ts.isIdentifier(elem.propertyName) ? elem.propertyName.text : elem.name.text;
              if (prop === 'exec') env.set(elem.name.text, { kind: 'builtin', name: 'child_process.exec' });
              else if (prop === 'execSync') env.set(elem.name.text, { kind: 'builtin', name: 'child_process.execSync' });
              else limit('UNSUPPORTED_STATEMENT', this.loc(sf, elem, prop));
            }
          } else {
            limit('UNSUPPORTED_STATEMENT', this.loc(sf, declaration, 'destructure'));
          }
        } else {
          limit('UNSUPPORTED_STATEMENT', this.loc(sf, declaration, 'variable'));
        }
      }
      return nothing;
    }
    if (ts.isExpressionStatement(node)) { this.expression(node.expression, env, sf); return nothing; }
    return limit('UNSUPPORTED_STATEMENT', this.loc(sf, node, 'statement'));
  }

  private expression(node: ts.Expression, env: Scope, sf: ts.SourceFile): Value {
    this.tick();
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return clean(node.text);
    if (ts.isIdentifier(node)) {
      if (node.text === 'require') return { kind: 'builtin', name: 'require' };
      return env.get(node.text);
    }
    if (ts.isParenthesizedExpression(node)) return this.expression(node.expression, env, sf);
    if (ts.isObjectLiteralExpression(node)) return clean(null);
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || ts.isNumericLiteral(node)) return clean(null);
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
      if (receiver.kind === 'request') {
        if (name === 'query') return { kind: 'query' };
        if (name === 'params') return { kind: 'params' };
        if (name === 'body') return { kind: 'body' };
        if (name === 'headers') return { kind: 'headers' };
      }
      if (receiver.kind === 'query' || receiver.kind === 'params' || receiver.kind === 'body' || receiver.kind === 'headers') {
        return { kind: 'data', literal: null, flow: [{ kind: 'SOURCE', location: this.loc(sf, node, receiver.kind + '.' + name) }] };
      }
      if (receiver.kind === 'child_process' && name === 'exec') return { kind: 'builtin', name: 'child_process.exec' };
      if (receiver.kind === 'child_process' && name === 'execSync') return { kind: 'builtin', name: 'child_process.execSync' };
      if (receiver.kind === 'response') {
        if (name === 'status') return { kind: 'response' };
        if (['json', 'send', 'end'].includes(name)) return { kind: 'builtin', name: 'response.' + name };
      }
      if (receiver.kind === 'builtin' && receiver.name === 'express' && name === 'Router') return { kind: 'builtin', name: 'express' };
      if (receiver.kind === 'owner' && ['get', 'post', 'put', 'patch', 'delete', 'use'].includes(name)) return { kind: 'builtin', name: 'route.' + name, receiver };
      return limit('UNSUPPORTED_EXPRESSION', this.loc(sf, node, 'property'));
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) limit('UNSUPPORTED_CALL');
        const mod = node.arguments[0].text;
        if (mod === 'child_process' || mod === 'node:child_process') return { kind: 'child_process' };
        if (mod === 'express') return { kind: 'builtin', name: 'express' };
        limit('UNSUPPORTED_IMPORT', this.loc(sf, node, mod));
      }
      const target = this.expression(node.expression, env, sf);
      const args = node.arguments.map(arg => this.expression(arg, env, sf));
      return this.call(target, args, this.loc(sf, node, target.kind === 'closure' ? target.node.name!.text : 'call'));
    }
    return limit('UNSUPPORTED_EXPRESSION', this.loc(sf, node, 'expression'));
  }

  private call(target: Value, args: Value[], location: SourceLocation): Value {
    this.tick();
    if (++this.calls > LIMITS.calls) limit('CALL_BUDGET', location);
    if (target.kind === 'closure') {
      const { node, sf } = target;
      if (this.active.has(node)) limit('CALL_CYCLE', location);
      if (this.active.size >= LIMITS.callDepth) limit('CALL_DEPTH', location);
      if (node.asteriskToken || node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || args.length !== node.parameters.length) {
        limit('UNSUPPORTED_FUNCTION', location);
      }
      const env = new Scope(target.env);
      node.parameters.forEach((p, i) => {
        if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken) limit('UNSUPPORTED_FUNCTION');
        env.set(p.name.text, propagate(propagate(args[i], 'CALL', location), 'ARGUMENT', this.loc(sf, p, p.name.text)));
      });
      this.active.add(node);
      try {
        this.hoist(node.body!.statements, env, sf);
        for (const statement of node.body!.statements) {
          const result = this.statement(statement, env, sf);
          if (result.returned) return result.value;
        }
        return { kind: 'void' };
      } finally { this.active.delete(node); }
    }
    if (target.kind !== 'builtin') return limit('UNSUPPORTED_CALL', location);
    if (target.name === 'express') {
      if (args.length) limit('FACTORY_PROFILE', location);
      return { kind: 'owner', routes: [] };
    }
    if (target.name === 'require') {
      if (args.length !== 1 || args[0].kind !== 'data' || args[0].literal === null) limit('UNSUPPORTED_CALL', location);
      const mod = args[0].literal;
      if (mod === 'child_process' || mod === 'node:child_process') return { kind: 'child_process' };
      if (mod === 'express') return { kind: 'builtin', name: 'express' };
      return limit('UNSUPPORTED_IMPORT', location);
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
    if (target.name === 'child_process.exec' || target.name === 'child_process.execSync') {
      if (args.length < 1 || args[0].kind !== 'data') limit('UNSUPPORTED_CALL', location);
      const cmd = args[0];
      if (!this.route) limit('FACTORY_PROFILE', location);
      if (cmd.flow.length) {
        const sink = { ...location, symbol: target.name };
        const trace = flow(cmd.flow, [{ kind: 'SINK', location: sink }]);
        const source = trace.find(step => step.kind === 'SOURCE')!.location;
        const finding: RawFinding = { routeIdentity: this.route.routeIdentity, source, sink, flow: trace };
        if (!this.findings.some(f => canonical(f) === canonical(finding))) this.findings.push(finding);
        if (this.findings.length > LIMITS.findings) limit('FINDING_BUDGET', sink);
        if (this.findings.reduce((sum, f) => sum + f.flow.length, 0) > LIMITS.totalFlowNodes) limit('FLOW_BUDGET', sink);
      }
      return clean(null);
    }
    if (target.name.startsWith('response.')) {
      return clean(null);
    }
    return limit('UNSUPPORTED_CALL', location);
  }

  analyze(): RawFinding[] {
    const apps = new Map<string, Owner>();
    for (const route of this.ingestion.routes) {
      if (!apps.has(route.handler.filePath)) {
        const factory = this.module(route.handler.filePath).get('createApp');
        if (!factory || factory.kind !== 'closure') limit('FACTORY_PROFILE');
        const factoryArgs = factory.node.parameters.map(() => ({ kind: 'void' } as Value));
        const app = this.call(factory, factoryArgs, at(factory.sf, factory.node, 'createApp'));
        if (app.kind !== 'owner') limit('FACTORY_PROFILE');
        apps.set(route.handler.filePath, app);
      }
    }
    if ([...apps.values()].reduce((sum, app) => sum + app.routes.length, 0) !== this.ingestion.routes.length) limit('ROUTE_MISMATCH');
    for (const route of this.ingestion.routes) {
      const matches = apps.get(route.handler.filePath)!.routes.filter(r => r.method === route.method && r.path === route.path);
      if (matches.length !== 1) limit('ROUTE_MISMATCH');
      const handler = matches[0].handler;
      if (canonical(at(handler.sf, handler.node, handler.node.name!.text)) !== canonical(route.handler)) limit('ROUTE_MISMATCH');
      this.route = route;
      const handlerArgs = [{ kind: 'request' } as Value, { kind: 'response' } as Value].slice(0, handler.node.parameters.length);
      const result = this.call(handler, handlerArgs, route.handler);
      if (result.kind !== 'void' && result.kind !== 'data') limit('UNSUPPORTED_CALL', route.handler);
      this.route = null;
    }
    return this.findings;
  }
}

export async function detectCommandInjection(rawSnapshot: SourceSnapshot, rawIngestion: ExpressIngestion, organizationId: string): Promise<CommandInjectionAnalysis> {
  const snapshot = await validateSnapshot(rawSnapshot, organizationId);
  const ingestion = await validateExpressIngestion(rawIngestion, organizationId);
  if (snapshot.snapshotId !== ingestion.snapshot.snapshotId) throw new Error('M4_ANALYSIS_SNAPSHOT_MISMATCH');
  const findings: CommandInjectionFinding[] = []; const limitations: AnalysisLimitation[] = [];
  try {
    for (const finding of new Analyzer(ingestion).analyze()) {
      const steps: FlowStep[] = [];
      for (const step of finding.flow) {
        steps.push({ ...step, id: await hash('m4-flow-node-v1', { snapshotId: snapshot.snapshotId, routeIdentity: finding.routeIdentity, ...step }) });
      }
      const body = { routeIdentity: finding.routeIdentity, vulnerabilityClass: 'COMMAND_INJECTION' as const, source: finding.source, sink: finding.sink, flow: steps };
      findings.push({ ...body, findingId: await hash('m4-cmdi-finding-v1', { snapshotId: snapshot.snapshotId, ...body }) });
    }
  } catch (error) {
    if (!(error instanceof Limited)) throw error;
    findings.length = 0; limitations.push(error.detail);
  }
  const body = {
    version: COMMAND_DETECTOR_VERSION, ruleId: COMMAND_RULE_ID, organizationId, repositoryId: snapshot.repositoryId,
    snapshotId: snapshot.snapshotId, ingestionIdentity: ingestion.ingestionIdentity, routeIdentities: ingestion.routes.map(r => r.routeIdentity),
    status: limitations.length ? 'ANALYSIS_INCONCLUSIVE' as const : findings.length ? 'DETECTED' as const : 'NOT_DETECTED' as const, findings, limitations,
  };
  return immutableCopy({ ...body, resultFingerprint: await hash(COMMAND_DETECTOR_VERSION, body) });
}

export async function validateCommandInjectionAnalysis(raw: unknown, snapshot: SourceSnapshot, ingestion: ExpressIngestion, organizationId: string): Promise<CommandInjectionAnalysis> {
  const detached = detachJson(raw);
  const computed = await detectCommandInjection(snapshot, ingestion, organizationId);
  if (canonical(detached) !== canonical(computed)) throw new Error('M4_ANALYSIS_INTEGRITY_MISMATCH');
  return computed;
}

export function createCommandInjectionCandidateBridge(verifyCommittedCode: (snapshot: SourceSnapshot) => Promise<string>) {
  return async (raw: unknown, rawSnapshot: SourceSnapshot, rawIngestion: ExpressIngestion, organizationId: string): Promise<readonly CandidateHypothesis[]> => {
    const resultCopy = detachJson(raw), snapshotCopy = detachJson(rawSnapshot), ingestionCopy = detachJson(rawIngestion);
    const snapshot = await validateSnapshot(snapshotCopy, organizationId);
    const ingestion = await validateExpressIngestion(ingestionCopy, organizationId);
    const analysis = await validateCommandInjectionAnalysis(resultCopy, snapshot, ingestion, organizationId);
    if (analysis.status !== 'DETECTED') return Object.freeze([]);
    const commitSha = await verifyCommittedCode(snapshot);
    if (typeof commitSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha) || /^0+$/.test(commitSha)) throw new Error('M4_CHECKED_COMMIT_REQUIRED');
    const createdAt = '2026-09-04T00:00:00.000Z';
    const candidates: CandidateHypothesis[] = [];
    for (const finding of analysis.findings) {
      const route = ingestion.routes.find(r => r.routeIdentity === finding.routeIdentity)!;
      const source = locationOf(finding.source), sink = locationOf(finding.sink);
      const rawCandidate: FindingCandidate = {
        contractVersion: CONTRACT_VERSION, organizationId,
        candidateId: await hash('m4-cmdi-candidate-v1', { resultFingerprint: analysis.resultFingerprint, findingId: finding.findingId, commitSha }),
        snapshot: { contractVersion: CONTRACT_VERSION, organizationId, snapshotId: snapshot.snapshotId, repositoryId: snapshot.repositoryId,
          sourceProvider: 'LOCAL_FIXTURE', commitSha, ref: 'local/m4-checked-captured-code', createdAt },
        vulnerabilityClass: 'COMMAND_INJECTION', source, sink,
        context: { entrypoint: locationOf(route.handler), routeId: route.routeIdentity },
        sensorEvidence: [{ contractVersion: CONTRACT_VERSION, organizationId, sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: finding.findingId, ruleId: COMMAND_RULE_ID,
          summary: COMMAND_DETECTOR_VERSION + ': deterministic child_process command injection hypothesis within closed registered route.',
          sourceLocation: source, sinkLocation: sink, rawEvidenceFingerprint: analysis.resultFingerprint }],
        reachabilityState: 'REACHABLE', verificationState: 'CANDIDATE', createdAt,
      };
      const candidate = validateFindingCandidate(rawCandidate, organizationId);
      candidates.push({ candidate, candidateBinding: computeCandidateBinding(candidate, organizationId) });
    }
    return immutableCopy(candidates);
  };
}
export const createCommandCandidateBridge = createCommandInjectionCandidateBridge;
