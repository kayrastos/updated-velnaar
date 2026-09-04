import ts from 'typescript';
import path from 'node:path';

/** Audits the complete local dependency closure, not merely one direct-import string. */
export function assertOracleIsolation(files: ReadonlyMap<string, string>, roots: readonly string[]): void {
  const visited = new Set<string>();
  const forbidden = /expectedSecurityState|verificationExpectation|reachabilityExpectation|sinkExpectation|SQL_INJECTION_BENCHMARK|SQLI_SCENARIO_TYPES|fixture-sqli-express-/;
  function visit(file: string) {
    if (visited.has(file)) return; visited.add(file);
    if (/\/benchmarks\/|\.test\.|\/evaluate\.ts$|\/catalog\.ts$|\/fixtures\//.test('/' + file)) throw new Error('ORACLE_LEAKAGE');
    const source = files.get(file); if (source === undefined) throw new Error('ORACLE_UNREVIEWED_DEPENDENCY');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    function dependency(specifier: string) {
      if (['typescript', 'node:sqlite'].includes(specifier)) return;
      if (!specifier.startsWith('.')) throw new Error('ORACLE_UNREVIEWED_EXTERNAL');
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const candidates = [base, base + '.ts', base + '/index.ts'].filter(p => files.has(p));
      if (candidates.length !== 1) throw new Error('ORACLE_UNREVIEWED_DEPENDENCY'); visit(candidates[0]);
    }
    function walk(node: ts.Node) {
      if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && forbidden.test(node.text)) throw new Error('ORACLE_LEAKAGE');
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error('ORACLE_DYNAMIC_DEPENDENCY');
          dependency(node.moduleSpecifier.text);
        }
      }
      if (ts.isImportEqualsDeclaration(node)) throw new Error('ORACLE_DYNAMIC_DEPENDENCY');
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && ['require', 'eval', 'Function'].includes(node.expression.text))) throw new Error('ORACLE_DYNAMIC_DEPENDENCY');
      if (ts.isIdentifier(node) && ['process', 'globalThis', 'global', 'fetch', 'require', 'eval', 'Function'].includes(node.text)) throw new Error('ORACLE_AMBIENT_CAPABILITY');
      ts.forEachChild(node, walk);
    }
    walk(sf);
  }
  for (const root of roots) visit(root);
}
