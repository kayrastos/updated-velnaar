import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  CONTRACT_VERSION,
  ASSERTION_BY_CLASS,
  computeCandidateBinding,
  validateFindingCandidate,
  createVerificationState,
  transitionVerificationState,
  type FindingCandidate,
} from '../../../worker/intelligence/contracts';
import { canonical, hash } from '../../../worker/intelligence/ingestion/snapshot';
import { currentCodeCommit } from '../m2/support/gitCodeState';
import { ORG } from '../fixtures';
import type { FlowKind, FlowStep } from '../../../worker/intelligence/detection/types';

interface ProvenancePoint {
  filePath: string;
  symbol: string;
  line: number;
  column: number;
}

interface ProvenanceTraceStep {
  kind: FlowKind;
  location: ProvenancePoint;
}

interface CommandInjectionHypothesis {
  status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  vulnerabilityClass?: 'COMMAND_INJECTION';
  source?: ProvenancePoint;
  sink?: ProvenancePoint;
  flow: ProvenanceTraceStep[];
  routeId?: string;
  handlerSymbol?: string;
  limitation?: string;
}

function lineAndCol(sf: ts.SourceFile, pos: number): { line: number; column: number } {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, column: lc.character + 1 };
}

function analyzeCommandProvenance(filePath: string, sourceText: string): CommandInjectionHypothesis {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const provenSinks = new Set<string>();
  const provenNamespaces = new Set<string>();
  const localFunctions = new Set<string>();

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const modSpec = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
      if (modSpec === 'child_process' || modSpec === 'node:child_process') {
        const clause = statement.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const spec of clause.namedBindings.elements) {
            const importedName = (spec.propertyName || spec.name).text;
            if (importedName === 'exec' || importedName === 'execSync') {
              provenSinks.add(spec.name.text);
            }
          }
        } else if (clause?.name) {
          provenNamespaces.add(clause.name.text);
        } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          provenNamespaces.add(clause.namedBindings.name.text);
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      localFunctions.add(statement.name.text);
    }
  }

  for (const local of localFunctions) {
    provenSinks.delete(local);
  }

  let finding: CommandInjectionHypothesis | null = null;
  let inconclusiveReason: string | null = null;

  function visit(node: ts.Node, env: Map<string, { flow: ProvenanceTraceStep[]; literal: string | null }>): void {
    if (inconclusiveReason) return;

    if (ts.isCallExpression(node)) {
      let isSink = false;
      let sinkSymbol = '';
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (provenSinks.has(name) && !localFunctions.has(name)) {
          isSink = true;
          sinkSymbol = `child_process.${name}`;
        }
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression.expression;
        const prop = node.expression.name.text;
        if (ts.isIdentifier(target) && provenNamespaces.has(target.text)) {
          if (prop === 'exec' || prop === 'execSync') {
            isSink = true;
            sinkSymbol = `child_process.${prop}`;
          }
        }
      }

      if (isSink && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        const lc = lineAndCol(sf, node.getStart(sf));
        const sinkLoc: ProvenancePoint = { filePath, symbol: sinkSymbol, line: lc.line, column: lc.column };

        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          return;
        }

        if (ts.isIdentifier(firstArg)) {
          const binding = env.get(firstArg.text);
          if (binding && binding.flow.length > 0) {
            const completeFlow: ProvenanceTraceStep[] = [
              ...binding.flow,
              { kind: 'SINK', location: sinkLoc },
            ];
            const sourceStep = completeFlow.find(s => s.kind === 'SOURCE');
            if (sourceStep) {
              finding = {
                status: 'DETECTED',
                vulnerabilityClass: 'COMMAND_INJECTION',
                source: sourceStep.location,
                sink: sinkLoc,
                flow: completeFlow,
                routeId: 'GET.run',
                handlerSymbol: 'runHandler',
              };
              return;
            }
          }
        }
      }
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const varName = decl.name.text;
          const init = decl.initializer;
          const lc = lineAndCol(sf, decl.name.getStart(sf));
          const varLoc: ProvenancePoint = { filePath, symbol: varName, line: lc.line, column: lc.column };

          if (
            ts.isPropertyAccessExpression(init) &&
            ts.isPropertyAccessExpression(init.expression) &&
            ts.isIdentifier(init.expression.expression) &&
            init.expression.expression.text === 'req' &&
            init.expression.name.text === 'query'
          ) {
            const param = init.name.text;
            const srcLc = lineAndCol(sf, init.getStart(sf));
            const sourceStep: ProvenanceTraceStep = {
              kind: 'SOURCE',
              location: { filePath, symbol: `query.${param}`, line: srcLc.line, column: srcLc.column },
            };
            const varStep: ProvenanceTraceStep = {
              kind: 'VARIABLE',
              location: varLoc,
            };
            env.set(varName, { flow: [sourceStep, varStep], literal: null });
          } else if (ts.isBinaryExpression(init) && init.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = ts.isIdentifier(init.left) ? env.get(init.left.text) : null;
            const right = ts.isIdentifier(init.right) ? env.get(init.right.text) : null;
            const sources = [left, right].filter((b): b is { flow: ProvenanceTraceStep[]; literal: string | null } => !!b && b.flow.length > 0);
            if (sources.length > 1) {
              inconclusiveReason = 'MULTIPLE_SOURCES';
              return;
            } else if (sources.length === 1) {
              const concatStep: ProvenanceTraceStep = {
                kind: 'CONCAT',
                location: { filePath, symbol: '+', line: lc.line, column: lc.column },
              };
              env.set(varName, { flow: [...sources[0].flow, concatStep], literal: null });
            }
          } else if (ts.isStringLiteral(init)) {
            env.set(varName, { flow: [], literal: init.text });
          }
        }
      }
    }

    ts.forEachChild(node, child => visit(child, env));
  }

  const scope = new Map<string, { flow: ProvenanceTraceStep[]; literal: string | null }>();
  visit(sf, scope);

  if (inconclusiveReason) {
    return { status: 'ANALYSIS_INCONCLUSIVE', flow: [], limitation: inconclusiveReason };
  }
  return finding || { status: 'NOT_DETECTED', flow: [] };
}

async function buildCandidateHypothesis(
  analysis: CommandInjectionHypothesis,
  commitSha: string,
  repositoryId = 'repo_m4',
  snapshotId = 'snap_m4_001'
): Promise<FindingCandidate> {
  if (analysis.status !== 'DETECTED' || !analysis.source || !analysis.sink) {
    throw new Error('Candidate construction requires DETECTED analysis');
  }
  const createdAt = '2026-09-04T00:00:00.000Z';
  const flowSteps: FlowStep[] = [];
  for (const s of analysis.flow) {
    const id = await hash('m4-flow-step-v1', { snapshotId, ...s });
    flowSteps.push({ id, kind: s.kind, location: { ...s.location, offset: 0 } });
  }

  const rawCandidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId: ORG,
    candidateId: await hash('m4-ci-candidate-v1', { snapshotId, commitSha, source: analysis.source, sink: analysis.sink }),
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      snapshotId,
      repositoryId,
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha,
      ref: 'local/m4-checked-code',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: { filePath: analysis.source.filePath, symbol: analysis.source.symbol, line: analysis.source.line, column: analysis.source.column },
    sink: { filePath: analysis.sink.filePath, symbol: analysis.sink.symbol, line: analysis.sink.line, column: analysis.sink.column },
    context: {
      entrypoint: { filePath: analysis.source.filePath, symbol: analysis.handlerSymbol || 'runHandler', line: 1, column: 1 },
      routeId: analysis.routeId || 'GET.run',
    },
    sensorEvidence: [{
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      sensorType: 'VELNAR_STRUCTURAL',
      sensorFindingId: 'finding_ci_001',
      ruleId: 'express-request-to-child-process-exec-v1',
      summary: 'VELNAR_STRUCTURAL: request-derived shell command reaches child_process sink.',
      sourceLocation: { filePath: analysis.source.filePath, symbol: analysis.source.symbol, line: analysis.source.line, column: analysis.source.column },
      sinkLocation: { filePath: analysis.sink.filePath, symbol: analysis.sink.symbol, line: analysis.sink.line, column: analysis.sink.column },
      rawEvidenceFingerprint: await hash('m4-raw-evidence-v1', { flow: flowSteps }),
    }],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };

  return validateFindingCandidate(rawCandidate, ORG);
}

describe('M4 source provenance chain: child_process command injection', () => {
  it('traces proven child_process.exec sink with request-derived query flow', async () => {
    const code = [
      "import { exec } from 'node:child_process';",
      'export function runHandler(req: any, res: any) {',
      '  const cmd = req.query.cmd;',
      '  exec(cmd);',
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/routes.ts', code);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(analysis.source?.symbol).toBe('query.cmd');
    expect(analysis.sink?.symbol).toBe('child_process.exec');
    expect(analysis.flow.map(f => f.kind)).toEqual(['SOURCE', 'VARIABLE', 'SINK']);

    const checkedCommit = currentCodeCommit();
    const candidate = await buildCandidateHypothesis(analysis, checkedCommit);
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(ASSERTION_BY_CLASS[candidate.vulnerabilityClass]).toBe('COMMAND_EXECUTION_OBSERVED');
  });

  it('traces aliased concatenation chain to child_process.execSync', async () => {
    const code = [
      "import { execSync } from 'child_process';",
      'export function runHandler(req: any, res: any) {',
      '  const target = req.query.host;',
      "  const fullCmd = 'ping -c 1 ' + target;",
      '  execSync(fullCmd);',
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/network.ts', code);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.sink?.symbol).toBe('child_process.execSync');
    expect(analysis.flow.map(f => f.kind)).toEqual(['SOURCE', 'VARIABLE', 'CONCAT', 'SINK']);
  });

  it('negative control: safe constant command produces no finding', () => {
    const code = [
      "import { exec } from 'child_process';",
      'export function runHandler(req: any, res: any) {',
      "  exec('ls -la');",
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/routes.ts', code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.flow).toEqual([]);
  });

  it('negative control: unrelated local exec function creates no sink authority', () => {
    const code = [
      'function exec(command: string) { return command; }',
      'export function runHandler(req: any, res: any) {',
      '  const cmd = req.query.cmd;',
      '  exec(cmd);',
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/routes.ts', code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.flow).toEqual([]);
  });

  it('negative control: ambiguous or unbound identifier produces no finding', () => {
    const code = [
      "import { exec } from 'child_process';",
      'declare const unknownCommand: string;',
      'export function runHandler(req: any, res: any) {',
      '  exec(unknownCommand);',
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/routes.ts', code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.flow).toEqual([]);
  });

  it('negative control: multi-source joins fail closed as inconclusive', () => {
    const code = [
      "import { exec } from 'child_process';",
      'export function runHandler(req: any, res: any) {',
      '  const a = req.query.a;',
      '  const b = req.query.b;',
      '  const joined = a + b;',
      '  exec(joined);',
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/routes.ts', code);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.limitation).toBe('MULTIPLE_SOURCES');
  });

  it('computes exact canonical candidate binding without a sha256 prefix', async () => {
    const code = [
      "import { exec } from 'node:child_process';",
      'export function runHandler(req: any, res: any) {',
      '  const cmd = req.query.cmd;',
      '  exec(cmd);',
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/routes.ts', code);
    const candidate = await buildCandidateHypothesis(analysis, currentCodeCommit());
    const binding = computeCandidateBinding(candidate, ORG);

    const expected = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(candidate)}`;
    expect(binding).toBe(expected);
    expect(binding).not.toMatch(/^sha256:/);
  });

  it('preserves candidate state and rejects direct completion without pending verification', async () => {
    const code = [
      "import { exec } from 'node:child_process';",
      'export function runHandler(req: any, res: any) {',
      '  const cmd = req.query.cmd;',
      '  exec(cmd);',
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/routes.ts', code);
    const candidate = await buildCandidateHypothesis(analysis, currentCodeCommit());
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('rejects all-zero or malformed commit identities for verified provenance', async () => {
    const code = [
      "import { exec } from 'node:child_process';",
      'export function runHandler(req: any, res: any) {',
      '  const cmd = req.query.cmd;',
      '  exec(cmd);',
      '}',
    ].join('\n');

    const analysis = analyzeCommandProvenance('src/routes.ts', code);
    await expect(buildCandidateHypothesis(analysis, '0'.repeat(40))).rejects.toThrow('invalid commitSha');
    await expect(buildCandidateHypothesis(analysis, 'not-a-sha')).rejects.toThrow('invalid commitSha');
  });
});
