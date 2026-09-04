import ts from 'typescript';
import path from 'node:path';
import { assertOracleIsolation } from '../../m2/support/oracleGuard';

/** Add M3 restrictions while invoking the SEALED M2 guard without changing it. */
export function assertDetectorIsolation(files: ReadonlyMap<string, string>, roots: readonly string[]): void {
  assertOracleIsolation(files, roots);
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return; visited.add(file);
    if (/\/tests\/|\/benchmarks\//.test('/' + file)) throw new Error('M3_ORACLE_DEPENDENCY');
    const source = files.get(file); if (source === undefined) throw new Error('M3_UNREVIEWED_DEPENDENCY');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    const sealedContract = file.startsWith('worker/intelligence/contracts/');
    function walk(node: ts.Node) {
      if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (/violationObserved|RecordedExecution|expectedCompletion|expectedState|benign|attack|sqlite/i.test(node.text)) throw new Error('M3_EXECUTION_ORACLE');
        if (/OBVIOUS_VULNERABLE|SAFE_TWIN|REFACTORED_VULNERABLE|UNREACHABLE_VULNERABLE_CODE|PARAMETERIZED_SAFE|MULTI_FUNCTION_FLOW|MULTI_FILE_FLOW|EXPRESS_ROUTE_FLOW/.test(node.text)) throw new Error('M3_SCENARIO_ORACLE');
        if (!sealedContract && /^(SAFE|VULNERABLE|VERIFIED|NOT_VERIFIED|VIOLATION_OBSERVED|NO_VIOLATION_OBSERVED|VerificationResult|EvidenceArtifact|evidenceHash|assertionResult|computeEvidenceHash|validateVerificationResult|transitionVerificationState)$/.test(node.text)) throw new Error('M3_PROOF_AUTHORITY');
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error('M3_DYNAMIC_DEPENDENCY');
        const specifier = node.moduleSpecifier.text;
        if (specifier !== 'typescript') {
          if (!specifier.startsWith('.')) throw new Error('M3_UNREVIEWED_EXTERNAL');
          const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
          const resolved = [base, base + '.ts', base + '/index.ts'].filter(p => files.has(p));
          if (resolved.length !== 1) throw new Error('M3_UNREVIEWED_DEPENDENCY');
          visit(resolved[0]);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sf);
  }
  for (const root of roots) visit(root);
}
