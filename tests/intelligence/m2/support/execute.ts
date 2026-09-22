// Test-only bounded interpreter. Never imports a fixture as executable Node code.
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { immutableCopy } from '../../../../worker/intelligence/contracts/validators';
import { ingestExpress, parseUnit, resolveImport, at, type ExpressIngestion, type SourceLocation } from '../../../../worker/intelligence/ingestion/express';
import { hash, fail, type SourceSnapshot } from '../../../../worker/intelligence/ingestion/snapshot';

export const EXECUTION_PROFILE = 'm2-local-bounded-sqlite-v2';
const LIMITS = Object.freeze({ steps: 4096, calls: 32, queries: 1, sqlBytes: 512, argumentBytes: 128 });
type Rows = { id: number; name: string }[];
type Value = string | number | undefined | Closure | Capability | Owner | { kind: 'rows'; rows: Rows } | { kind: 'record'; fields: Map<string, Value> };
interface Closure { kind: 'function'; node: ts.FunctionDeclaration; env: Env; sf: ts.SourceFile }
interface Capability { kind: 'capability'; name: string; data?: any }
interface Owner { kind: 'owner'; routes: { method: string; path: string; handler: Closure }[] }
class Env {
  private values = new Map<string, Value>();
  constructor(private parent?: Env) {}
  set(name: string, value: Value) { if (this.values.has(name)) fail('duplicate execution binding'); this.values.set(name, value); }
  get(name: string): Value {
    if (this.values.has(name)) return this.values.get(name);
    if (this.parent) return this.parent.get(name);
    return fail('unavailable execution capability');
  }
}
interface QueryTrace { sql: string; parameters: string[]; location: SourceLocation; returnedIds: number[] }
interface Observation { readonly input: string; readonly returnedIds: readonly number[];
  readonly queries: readonly { readonly sql: string; readonly parameters: readonly string[]; readonly location: SourceLocation; readonly returnedIds: readonly number[] }[];
  readonly calledFunctions: readonly SourceLocation[] }
export interface RecordedExecution {
  readonly version: 'velnar-m2-recorded-execution-v2'; readonly profile: string;
  readonly fixtureId: string; readonly organizationId: string; readonly repositoryId: string;
  readonly snapshotId: string; readonly ingestionIdentity: string; readonly routeIdentity: string;
  readonly benign: Observation; readonly attack: Observation; readonly violationObserved: boolean;
  readonly steps: number; readonly recordDigest: string;
}
class Machine {
  steps = 0; depth = 0;
  private modules = new Map<string, Map<string, Value>>(); private loading = new Set<string>();
  queries: QueryTrace[] = []; calls: SourceLocation[] = [];
  constructor(private snapshot: SourceSnapshot, private db: DatabaseSync) {}
  tick() { if (++this.steps > LIMITS.steps) fail('execution step limit'); }
  private cap(name: string, data?: any): Capability { return { kind: 'capability', name, data }; }
  module(filePath: string): Map<string, Value> {
    if (this.modules.has(filePath)) return this.modules.get(filePath)!;
    if (this.loading.has(filePath)) fail('cyclic module execution'); this.loading.add(filePath);
    const file = this.snapshot.files.find(f => f.path === filePath); if (!file) fail('missing execution source');
    const sf = parseUnit(filePath, file.content), env = new Env(), exports = new Map<string, Value>();
    for (const node of sf.statements) {
      this.tick();
      if (ts.isImportDeclaration(node)) {
        if (!ts.isStringLiteral(node.moduleSpecifier) || !node.importClause) fail('execution import');
        const name = node.moduleSpecifier.text;
        if (name === 'express') {
          if (!node.importClause.name || node.importClause.namedBindings) fail('Express execution import');
          env.set(node.importClause.name.text, this.cap('express'));
        } else {
          if (node.importClause.name || !node.importClause.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) fail('named local imports required');
          const other = this.module(resolveImport(filePath, name, this.snapshot.files.map(f => f.path)));
          for (const imported of node.importClause.namedBindings.elements) {
            const key = (imported.propertyName || imported.name).text;
            if (!other.has(key)) fail('missing imported function'); env.set(imported.name.text, other.get(key));
          }
        }
      }
    }
    this.hoist(sf.statements, env, sf);
    for (const node of sf.statements) {
      if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) exports.set(node.name!.text, env.get(node.name!.text));
      if (!ts.isImportDeclaration(node) && !ts.isFunctionDeclaration(node)) this.statement(node, env, sf);
    }
    this.loading.delete(filePath); this.modules.set(filePath, exports); return exports;
  }
  private hoist(statements: ts.NodeArray<ts.Statement>, env: Env, sf: ts.SourceFile) {
    for (const node of statements) if (ts.isFunctionDeclaration(node)) {
      if (!node.name || !node.body || node.asteriskToken || node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) fail('unsupported function');
      env.set(node.name.text, { kind: 'function', node, env, sf });
    }
  }
  private statement(node: ts.Statement, env: Env, sf: ts.SourceFile): { returned: boolean; value?: Value } {
    this.tick();
    if (ts.isFunctionDeclaration(node)) return { returned: false };
    if (ts.isReturnStatement(node)) return { returned: true, value: node.expression ? this.expression(node.expression, env, sf) : undefined };
    if (ts.isVariableStatement(node)) {
      if (!(node.declarationList.flags & ts.NodeFlags.Const)) fail('only const local variables');
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) fail('unsupported variable');
        env.set(d.name.text, this.expression(d.initializer, env, sf));
      }
      return { returned: false };
    }
    if (ts.isExpressionStatement(node)) { this.expression(node.expression, env, sf); return { returned: false }; }
    return fail('unsupported executable statement');
  }
  private expression(node: ts.Expression, env: Env, sf: ts.SourceFile): Value {
    this.tick();
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isIdentifier(node)) return env.get(node.text);
    if (ts.isParenthesizedExpression(node)) return this.expression(node.expression, env, sf);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.expression(node.left, env, sf), right = this.expression(node.right, env, sf);
      if (typeof left !== 'string' || typeof right !== 'string') fail('only string concatenation supported');
      if (left.length + right.length > LIMITS.sqlBytes) fail('expression size'); return left + right;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = this.expression(node.expression, env, sf), name = node.name.text;
      if (!receiver || typeof receiver !== 'object') fail('unavailable property');
      if (receiver.kind === 'record' && receiver.fields.has(name)) return receiver.fields.get(name);
      if (receiver.kind === 'owner' && ['get', 'post', 'put', 'patch', 'delete', 'use'].includes(name)) return this.cap('route.' + name, receiver);
      if (receiver.kind === 'capability') {
        if (receiver.name === 'express' && name === 'Router') return this.cap('express');
        if (receiver.name === 'db' && name === 'prepare') return this.cap('prepare');
        if (receiver.name === 'statement' && name === 'all') return this.cap('all', receiver.data);
        if (receiver.name === 'response' && name === 'json') return this.cap('json');
      }
      return fail('unavailable property capability');
    }
    if (ts.isCallExpression(node)) {
      const fn = this.expression(node.expression, env, sf);
      const args = node.arguments.map(a => this.expression(a, env, sf));
      return this.call(fn, args, at(sf, node, 'call'));
    }
    return fail('unsupported executable expression');
  }
  call(fn: Value, args: Value[], location?: SourceLocation): Value {
    this.tick(); if (++this.depth > LIMITS.calls) fail('execution call depth');
    try {
      if (!fn || typeof fn !== 'object') fail('not a callable fixture capability');
      if (fn.kind === 'function') {
        const env = new Env(fn.env);
        if (args.length !== fn.node.parameters.length) fail('function argument count');
        fn.node.parameters.forEach((p, i) => {
          if (!ts.isIdentifier(p.name) || p.dotDotDotToken || p.initializer) fail('unsupported parameters'); env.set(p.name.text, args[i]);
        });
        this.calls.push(at(fn.sf, fn.node, fn.node.name!.text)); this.hoist(fn.node.body!.statements, env, fn.sf);
        for (const statement of fn.node.body!.statements) { const value = this.statement(statement, env, fn.sf); if (value.returned) return value.value; }
        return undefined;
      }
      if (fn.kind !== 'capability') fail('not callable');
      if (fn.name === 'express') { if (args.length) fail('Express arguments'); return { kind: 'owner', routes: [] }; }
      if (fn.name.startsWith('route.')) {
        const owner = fn.data as Owner, [path, handler] = args;
        if (args.length !== 2 || typeof path !== 'string' || !path.startsWith('/') || !handler || typeof handler !== 'object') fail('route execution metadata');
        if (fn.name === 'route.use') {
          if (handler.kind !== 'owner') fail('router mount');
          for (const route of handler.routes) owner.routes.push({ ...route, path: (path === '/' ? '' : path) + route.path });
        } else {
          if (handler.kind !== 'function') fail('route callable required');
          owner.routes.push({ method: fn.name.slice(6).toUpperCase(), path, handler });
        }
        if (owner.routes.length > 32) fail('runtime route limit'); return owner;
      }
      if (fn.name === 'prepare') {
        const sql = args[0];
        if (args.length !== 1 || typeof sql !== 'string' || sql.length > LIMITS.sqlBytes
          || !/^SELECT id, name FROM records WHERE name = (?:\?|'[A-Za-z0-9_ '?=\-]*')$/.test(sql)) fail('SQL outside bounded read-only profile');
        return this.cap('statement', { sql, location });
      }
      if (fn.name === 'all') {
        if (args.length > 1 || args.some(a => typeof a !== 'string' || a.length > LIMITS.argumentBytes) || this.queries.length >= LIMITS.queries) fail('SQL argument/query budget');
        const rows = this.db.prepare(fn.data.sql).all(...args as string[]) as Rows;
        this.queries.push({ sql: fn.data.sql, parameters: args as string[], location: fn.data.location, returnedIds: rows.map(r => r.id).sort() });
        return { kind: 'rows', rows };
      }
      if (fn.name === 'json') { if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || args[0].kind !== 'rows') fail('response type'); return args[0]; }
      return fail('unavailable execution capability');
    } finally { this.depth--; }
  }
  app(): Owner {
    const create = this.module('src/routes.ts').get('createApp');
    const app = this.call(create, [this.cap('db')]);
    if (!app || typeof app !== 'object' || app.kind !== 'owner') fail('app factory must return registered app'); return app;
  }
  observe(app: Owner, path: string, input: string): Observation {
    this.queries = []; this.calls = [];
    const routes = app.routes.filter(r => r.method === 'GET' && r.path === path);
    if (routes.length !== 1) fail('execution route not uniquely registered');
    const req: Value = { kind: 'record', fields: new Map([['query', { kind: 'record', fields: new Map([['q', input]]) }]]) };
    const value = this.call(routes[0].handler, [req, this.cap('response')]);
    if (this.queries.length !== 1) fail('exactly one SQL query required per observation');
    if (!value || typeof value !== 'object' || value.kind !== 'rows') fail('missing response');
    if (value.rows.map(r => r.id).sort().join(',') !== this.queries[0].returnedIds.join(',')) fail('response/query mismatch');
    return { input, returnedIds: value.rows.map(r => r.id).sort(), queries: this.queries, calledFunctions: this.calls };
  }
}
// Only this module can mint integration-eligible records; raw JSON/casts are not proof.
const recorded = new WeakSet<object>();
export function assertSingleQueryObservations(value: Pick<RecordedExecution, 'benign' | 'attack'>): void {
  if (value.benign.queries.length !== 1 || value.attack.queries.length !== 1) fail('exactly one SQL query required per observation');
}
export function isRecordedExecution(value: unknown): value is RecordedExecution { return !!value && typeof value === 'object' && recorded.has(value); }
export async function executeFixture(raw: SourceSnapshot, organizationId: string): Promise<{ ingestion: ExpressIngestion; record: RecordedExecution }> {
  const ingestion = await ingestExpress(raw, organizationId);
  if (ingestion.routes.length !== 1 || ingestion.routes[0].method !== 'GET') fail('fixture profile requires one GET entrypoint');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE records(id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO records VALUES(1,'alice'),(2,'bob');");
    const machine = new Machine(ingestion.snapshot, db), app = machine.app(), route = ingestion.routes[0];
    if (app.routes.length !== 1 || app.routes[0].path !== route.path || app.routes[0].handler.node.name!.text !== route.handler.symbol) fail('ingestion/execution route mismatch');
    const benign = machine.observe(app, route.path, 'alice');
    const attack = machine.observe(app, route.path, "' OR 1=1 --");
    if (benign.returnedIds.length !== 1 || benign.returnedIds[0] !== 1) fail('fixture baseline behavior');
    assertSingleQueryObservations({ benign, attack });
    const body = { version: 'velnar-m2-recorded-execution-v2' as const, profile: EXECUTION_PROFILE,
      fixtureId: ingestion.snapshot.fixtureId, organizationId, repositoryId: ingestion.snapshot.repositoryId,
      snapshotId: ingestion.snapshot.snapshotId,
      ingestionIdentity: ingestion.ingestionIdentity, routeIdentity: route.routeIdentity,
      benign, attack, violationObserved: attack.returnedIds.some(id => id !== 1), steps: machine.steps };
    const record = immutableCopy({ ...body, recordDigest: await hash('velnar-m2-recorded-execution-v2', body) });
    recorded.add(record); return { ingestion, record };
  } finally { db.close(); }
}
