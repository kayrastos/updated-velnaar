import ts from 'typescript';
import { immutableCopy } from '../contracts/validators';
import { fail, hash, canonical, dataObject, detachJson, INGESTION_LIMITS, validateSnapshot, type SourceSnapshot } from './snapshot';

export interface SourceLocation { readonly filePath: string; readonly symbol: string; readonly offset: number; readonly line: number; readonly column: number }
export interface Route {
  readonly method: string; readonly path: string; readonly declaredPath: string; readonly owner: string;
  readonly ownerKind: 'APP' | 'ROUTER'; readonly handler: SourceLocation; readonly registration: SourceLocation;
  readonly ownerLocation: SourceLocation;
  readonly mount: { readonly app: string; readonly prefix: string; readonly registration: SourceLocation } | null;
  readonly routeIdentity: string;
}
export interface ExpressIngestion {
  readonly version: 'velnar-express-ingestion-v1'; readonly snapshot: SourceSnapshot;
  readonly sourceUnits: readonly { filePath: string; fileIdentity: string; language: string; imports: readonly string[]; functions: readonly SourceLocation[] }[];
  readonly routes: readonly Route[]; readonly ingestionIdentity: string;
}
export function parseUnit(filePath: string, content: string): ts.SourceFile {
  let sf: ts.SourceFile;
  try { sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.ES2022, true, filePath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS); }
  catch { return fail('source parser limit'); }
  if ((sf as any).parseDiagnostics.length) fail('malformed source unit');
  let count = 0; const queue: ts.Node[] = [sf];
  while (queue.length) {
    const node = queue.pop()!; if (++count > INGESTION_LIMITS.maxAstNodes) fail('AST node limit');
    ts.forEachChild(node, child => { queue.push(child); });
  }
  return sf;
}
export function at(sf: ts.SourceFile, node: ts.Node, symbol: string): SourceLocation {
  const offset = node.getStart(sf), lc = sf.getLineAndCharacterOfPosition(offset);
  return { filePath: sf.fileName, symbol, offset, line: lc.line + 1, column: lc.character + 1 };
}
function routePath(value: ts.Expression): string {
  if (!ts.isStringLiteral(value) || !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(value.text)) fail('literal bounded route path required');
  if (value.text.length > 128) fail('route path limit'); return value.text;
}
export function resolveImport(from: string, target: string, paths: readonly string[]): string {
  if (!/^\.\/[A-Za-z0-9_/-]+$/.test(target) || target.includes('..')) fail('unsupported source import');
  const prefix = from.slice(0, from.lastIndexOf('/') + 1) + target.slice(2);
  const matches = paths.filter(p => p === prefix + '.ts' || p === prefix + '.js');
  if (matches.length !== 1) fail('missing or ambiguous source import'); return matches[0];
}
/** Closed Express syntax subset, not a dataflow/reachability engine. */
export async function ingestExpress(raw: unknown, expectedOrganizationId: string): Promise<ExpressIngestion> {
  const snapshot = await validateSnapshot(raw, expectedOrganizationId);
  const paths = snapshot.files.map(f => f.path);
  const sourceUnits: any[] = []; const routeBodies: Omit<Route, 'routeIdentity'>[] = [];
  for (const file of snapshot.files) {
    const sf = parseUnit(file.path, file.content); const imports: string[] = [];
    const functions = new Map<string, ts.FunctionDeclaration>();
    const owners = new Map<string, { kind: 'APP' | 'ROUTER'; scope: ts.Block; location: SourceLocation }>();
    const mounts = new Map<string, { app: string; prefix: string; registration: SourceLocation }>();
    let expressName: string | undefined;
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) fail('literal imports required');
      const target = statement.moduleSpecifier.text;
      if (target === 'express') {
        if (!statement.importClause?.name || statement.importClause.namedBindings || expressName) fail('default Express import required');
        expressName = statement.importClause.name.text;
      } else resolveImport(file.path, target, paths);
      imports.push(target);
    }
    const nodes: ts.Node[] = []; const queue: ts.Node[] = [sf];
    while (queue.length) { const node = queue.pop()!; nodes.push(node); ts.forEachChild(node, child => { queue.push(child); }); }
    nodes.sort((a, b) => a.getStart(sf) - b.getStart(sf));
    for (const node of nodes) {
      if (ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node) || ts.isClassDeclaration(node)) fail('unsupported module structure');
      if (ts.isFunctionDeclaration(node)) {
        if (!node.name || !node.body || functions.has(node.name.text)) fail('ambiguous handler/function identity');
        functions.set(node.name.text, node);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
        const callee = node.initializer.expression;
        const isApp = ts.isIdentifier(callee) && callee.text === expressName;
        const isRouter = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          && callee.expression.text === expressName && callee.name.text === 'Router';
        if (isApp || isRouter) {
          if (node.initializer.arguments.length || owners.has(node.name.text) || !(node.parent.flags & ts.NodeFlags.Const)) fail('ambiguous Express registration');
          const statement = node.parent.parent, scope = statement.parent;
          if (!ts.isVariableStatement(statement) || !ts.isBlock(scope) || !ts.isFunctionDeclaration(scope.parent)
            || scope.parent.name?.text !== 'createApp') fail('unsupported Express factory scope');
          if (scope.statements.some(s => !ts.isVariableStatement(s) && !ts.isFunctionDeclaration(s)
            && !ts.isExpressionStatement(s) && !ts.isReturnStatement(s))) fail('conditional factory not supported');
          const returns = scope.statements.filter(ts.isReturnStatement);
          if (returns.length !== 1 || scope.statements[scope.statements.length - 1] !== returns[0]
            || !returns[0].expression || !ts.isIdentifier(returns[0].expression)) fail('static factory return required');
          if (isApp && returns[0].expression.text !== node.name.text) fail('returned app mismatch');
          owners.set(node.name.text, { kind: isApp ? 'APP' : 'ROUTER', scope, location: at(sf, node, node.name.text) });
        }
      }
    }
    for (const node of nodes) {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !ts.isIdentifier(node.expression.expression)) continue;
      const owner = node.expression.expression.text, verb = node.expression.name.text;
      if (!owners.has(owner)) continue;
      if (!ts.isExpressionStatement(node.parent) || node.parent.parent !== owners.get(owner)!.scope) fail('conditional or indirect registration');
      if (verb === 'use') {
        if (owners.get(owner)!.kind !== 'APP' || node.arguments.length !== 2 || !ts.isIdentifier(node.arguments[1])
          || owners.get(node.arguments[1].text)?.kind !== 'ROUTER' || mounts.has(node.arguments[1].text)) fail('unsupported router mount');
        mounts.set(node.arguments[1].text, { app: owner, prefix: routePath(node.arguments[0]), registration: at(sf, node, owner + '.use') });
      } else if (!['get', 'post', 'put', 'patch', 'delete'].includes(verb)) fail('unsupported Express registration');
    }
    for (const node of nodes) {
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && owners.has(node.expression.text)) fail('computed route metadata');
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && owners.has(node.left.text)) fail('owner reassignment');
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !ts.isIdentifier(node.expression.expression)) continue;
      const owner = node.expression.expression.text, verb = node.expression.name.text, info = owners.get(owner);
      if (!info || verb === 'use') continue;
      if (node.arguments.length !== 2 || !ts.isIdentifier(node.arguments[1])) fail('named handler required');
      const handler = functions.get(node.arguments[1].text); if (!handler) fail('unknown route handler');
      const declaredPath = routePath(node.arguments[0]);
      if (info.kind === 'ROUTER' && !mounts.has(owner)) fail('unmounted router');
      const prefix = info.kind === 'ROUTER' ? mounts.get(owner)!.prefix : '';
      const path = (prefix === '/' ? '' : prefix) + declaredPath;
      routeBodies.push({ method: verb.toUpperCase(), path, declaredPath, owner, ownerKind: info.kind,
        ownerLocation: info.location, mount: info.kind === 'ROUTER' ? mounts.get(owner)! : null,
        handler: at(sf, handler, handler.name!.text), registration: at(sf, node, owner + '.' + verb) });
      if (routeBodies.length > INGESTION_LIMITS.maxRoutes) fail('route count');
    }
    sourceUnits.push({ filePath: file.path, fileIdentity: file.fileIdentity,
      language: file.path.endsWith('.ts') ? 'TYPESCRIPT' : 'JAVASCRIPT', imports,
      functions: [...functions.values()].map(f => at(sf, f, f.name!.text)) });
  }
  if (!routeBodies.length) fail('no supported Express route');
  const seen = new Set<string>(); const routes: Route[] = [];
  for (const route of routeBodies) {
    const key = route.method + ' ' + route.path;
    if (seen.has(key)) fail('ambiguous duplicate route'); seen.add(key);
    routes.push({ ...route, routeIdentity: await hash('velnar-express-route-v1', { snapshotId: snapshot.snapshotId, ...route }) });
  }
  const body = { version: 'velnar-express-ingestion-v1' as const, snapshot, sourceUnits, routes };
  return immutableCopy({ ...body, ingestionIdentity: await hash('velnar-express-ingestion-v1', body) });
}
export async function validateExpressIngestion(raw: ExpressIngestion, expectedOrganizationId: string): Promise<ExpressIngestion> {
  const r = dataObject(raw, ['version', 'snapshot', 'sourceUnits', 'routes', 'ingestionIdentity']);
  const detached = detachJson(r);
  const safe = await ingestExpress(detached.snapshot, expectedOrganizationId);
  if (canonical(detached) !== canonical(safe)) fail('ingestion metadata mismatch'); return safe;
}
