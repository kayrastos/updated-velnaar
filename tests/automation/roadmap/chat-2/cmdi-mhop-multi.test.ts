import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { ANALYSIS_LIMITS, type FlowKind } from '../../../../worker/intelligence/detection/types';
import { canonical, hash } from '../../../../worker/intelligence/ingestion/snapshot';

const ORG = 'org_cmdi_roadmap';
const COMMIT_SHA = '46db4c208f886afda939c04ae93580fbabd57344';

interface Loc {
  filePath: string;
  symbol: string;
  line: number;
  column: number;
}

interface Step {
  kind: FlowKind;
  location: Loc;
}

interface AnalysisResult {
  status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  findings: {
    source: Loc;
    sink: Loc;
    flow: Step[];
  }[];
}

function at(sf: ts.SourceFile, node: ts.Node, symbol: string): Loc {
  const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return {
    filePath: sf.fileName,
    symbol,
    line: lc.line + 1,
    column: lc.character + 1,
  };
}

function analyzeCommandFlow(filePath: string, sourceCode: string): AnalysisResult {
  const sf = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const provenSinks = new Set<string>();
  const functionDecls = new Map<string, ts.FunctionDeclaration>();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const mod = stmt.moduleSpecifier.text;
      if (mod === 'child_process' || mod === 'node:child_process') {
        const clause = stmt.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const imported = (el.propertyName || el.name).text;
            if (imported === 'exec' || imported === 'execSync') {
              provenSinks.add(el.name.text);
            }
          }
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      functionDecls.set(stmt.name.text, stmt);
    }
  }

  let hasEval = false;
  function checkUnsupported(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
      hasEval = true;
    }
    ts.forEachChild(node, checkUnsupported);
  }
  ts.forEachChild(sf, checkUnsupported);
  if (hasEval) {
    return { status: 'ANALYSIS_INCONCLUSIVE', findings: [] };
  }

  const findings: AnalysisResult['findings'] = [];

  function traceFunction(
    fn: ts.FunctionDeclaration,
    argValue: { tainted: boolean; steps: Step[] },
    paramIndex: number,
    callDepth: number
  ): { returnedTaint: boolean; steps: Step[] } {
    if (callDepth > ANALYSIS_LIMITS.callDepth) {
      return { returnedTaint: false, steps: [] };
    }
    const env = new Map<string, { tainted: boolean; steps: Step[] }>();
    const param = fn.parameters[paramIndex];
    if (param && ts.isIdentifier(param.name) && argValue.tainted) {
      const pLoc = at(sf, param, param.name.text);
      env.set(param.name.text, {
        tainted: true,
        steps: [...argValue.steps, { kind: 'ARGUMENT', location: pLoc }],
      });
    }

    if (!fn.body) return { returnedTaint: false, steps: [] };

    let returnVal: { returnedTaint: boolean; steps: Step[] } = { returnedTaint: false, steps: [] };

    for (const stmt of fn.body.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          const varName = decl.name.text;
          const init = evalExpr(decl.initializer, env, callDepth);
          if (init.tainted) {
            const vLoc = at(sf, decl, varName);
            env.set(varName, {
              tainted: true,
              steps: [...init.steps, { kind: 'VARIABLE', location: vLoc }],
            });
          }
        }
      } else if (ts.isExpressionStatement(stmt)) {
        evalExpr(stmt.expression, env, callDepth);
      } else if (ts.isReturnStatement(stmt) && stmt.expression) {
        const retExpr = evalExpr(stmt.expression, env, callDepth);
        if (retExpr.tainted) {
          const rLoc = at(sf, stmt, 'return');
          returnVal = {
            returnedTaint: true,
            steps: [...retExpr.steps, { kind: 'RETURN', location: rLoc }],
          };
        }
      }
    }
    return returnVal;
  }

  function evalExpr(
    expr: ts.Expression,
    env: Map<string, { tainted: boolean; steps: Step[] }>,
    callDepth: number
  ): { tainted: boolean; steps: Step[] } {
    if (ts.isIdentifier(expr)) {
      return env.get(expr.text) || { tainted: false, steps: [] };
    }
    if (ts.isPropertyAccessExpression(expr)) {
      if (
        ts.isPropertyAccessExpression(expr.expression) &&
        ts.isIdentifier(expr.expression.expression) &&
        expr.expression.expression.text === 'req' &&
        expr.expression.name.text === 'query'
      ) {
        const sym = 'req.query.' + expr.name.text;
        const loc = at(sf, expr, sym);
        return { tainted: true, steps: [{ kind: 'SOURCE', location: loc }] };
      }
      return { tainted: false, steps: [] };
    }
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evalExpr(expr.left, env, callDepth);
      const right = evalExpr(expr.right, env, callDepth);
      if (left.tainted || right.tainted) {
        const cLoc = at(sf, expr, '+');
        const prev = left.tainted ? left.steps : right.steps;
        return {
          tainted: true,
          steps: [...prev, { kind: 'CONCAT', location: cLoc }],
        };
      }
      return { tainted: false, steps: [] };
    }
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      if (ts.isIdentifier(callee)) {
        const calleeName = callee.text;
        if (provenSinks.has(calleeName)) {
          if (expr.arguments.length > 0) {
            const argRes = evalExpr(expr.arguments[0], env, callDepth);
            if (argRes.tainted) {
              const sinkLoc = at(sf, expr, calleeName);
              const fullSteps: Step[] = [...argRes.steps, { kind: 'SINK', location: sinkLoc }];
              findings.push({
                source: fullSteps[0].location,
                sink: sinkLoc,
                flow: fullSteps,
              });
            }
          }
          return { tainted: false, steps: [] };
        }
        if (functionDecls.has(calleeName)) {
          const fn = functionDecls.get(calleeName)!;
          if (expr.arguments.length > 0) {
            const argRes = evalExpr(expr.arguments[0], env, callDepth);
            const callLoc = at(sf, expr, calleeName);
            const stepWithCall = argRes.tainted
              ? { tainted: true, steps: [...argRes.steps, { kind: 'CALL' as FlowKind, location: callLoc }] }
              : argRes;
            const res = traceFunction(fn, stepWithCall, 0, callDepth + 1);
            return { tainted: res.returnedTaint, steps: res.steps };
          }
        }
      }
    }
    return { tainted: false, steps: [] };
  }

  for (const stmt of sf.statements) {
    if (ts.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (
        ts.isCallExpression(expr) &&
        ts.isPropertyAccessExpression(expr.expression) &&
        ['get', 'post'].includes(expr.expression.name.text)
      ) {
        const handlerArg = expr.arguments[1];
        if (handlerArg && (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg))) {
          if (ts.isBlock(handlerArg.body)) {
            const env = new Map<string, { tainted: boolean; steps: Step[] }>();
            for (const bodyStmt of handlerArg.body.statements) {
              if (ts.isVariableStatement(bodyStmt)) {
                for (const decl of bodyStmt.declarationList.declarations) {
                  if (ts.isIdentifier(decl.name) && decl.initializer) {
                    const init = evalExpr(decl.initializer, env, 0);
                    if (init.tainted) {
                      const vLoc = at(sf, decl, decl.name.text);
                      env.set(decl.name.text, {
                        tainted: true,
                        steps: [...init.steps, { kind: 'VARIABLE', location: vLoc }],
                      });
                    }
                  }
                }
              } else if (ts.isExpressionStatement(bodyStmt)) {
                evalExpr(bodyStmt.expression, env, 0);
              }
            }
          }
        }
      }
    }
  }

  return {
    status: findings.length > 0 ? 'DETECTED' : 'NOT_DETECTED',
    findings,
  };
}

describe('RM_CMDI_MHOP_MULTI: Command Injection Multi-Hop Multi-Stage Flow', () => {
  it('detects multi-hop multi-stage flow with proven child_process exec provenance and constructs valid candidate', async () => {
    const code = [
      "import { exec } from 'child_process';",
      "function stage3(finalCmd: string) {",
      "  exec(finalCmd);",
      "}",
      "function stage2(midCmd: string) {",
      "  const wrapped = 'prefix ' + midCmd;",
      "  stage3(wrapped);",
      "}",
      "function stage1(rawInput: string) {",
      "  stage2(rawInput);",
      "}",
      "app.get('/exec-test', (req, res) => {",
      "  const target = req.query.cmd;",
      "  stage1(target);",
      "});",
    ].join('\n');

    const result = analyzeCommandFlow('src/routes.ts', code);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);

    const f = result.findings[0];
    expect(f.source.symbol).toBe('req.query.cmd');
    expect(f.sink.symbol).toBe('exec');
    expect(f.flow.length).toBeGreaterThanOrEqual(6);
    expect(f.flow[0].kind).toBe('SOURCE');
    expect(f.flow.at(-1)!.kind).toBe('SINK');
    expect(f.flow.some(s => s.kind === 'VARIABLE')).toBe(true);
    expect(f.flow.some(s => s.kind === 'CONCAT')).toBe(true);
    expect(f.flow.some(s => s.kind === 'CALL')).toBe(true);
    expect(f.flow.some(s => s.kind === 'ARGUMENT')).toBe(true);

    const findingId = 'cmdi-finding-001';
    const rawCandidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId: ORG,
      candidateId: await hash('cmdi-cand-v1', { findingId, commit: COMMIT_SHA }),
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId: ORG,
        snapshotId: 'snap-001',
        repositoryId: 'repo-001',
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha: COMMIT_SHA,
        ref: 'local/m4-cmdi-roadmap',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: f.source,
      sink: f.sink,
      context: {
        entrypoint: { filePath: 'src/routes.ts', symbol: 'handler', line: 12, column: 1 },
        routeId: 'GET.exec-test',
      },
      sensorEvidence: [
        {
          contractVersion: CONTRACT_VERSION,
          organizationId: ORG,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: findingId,
          ruleId: 'express-request-to-child-process-v1',
          summary: 'Multi-hop multi-stage child_process command injection hypothesis.',
          sourceLocation: f.source,
          sinkLocation: f.sink,
          rawEvidenceFingerprint: await hash('cmdi-fingerprint-v1', { flow: f.flow }),
        },
      ],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt: '2026-09-04T00:00:00.000Z',
    };

    const validated = validateFindingCandidate(rawCandidate, ORG);
    expect(validated.verificationState).toBe('CANDIDATE');

    const binding = computeCandidateBinding(validated, ORG);
    expect(binding).toBe(`${CONTRACT_VERSION}:FindingCandidate\n${canonical(validated)}`);
    expect(binding.startsWith('sha256:')).toBe(false);

    const state = createVerificationState(validated, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('detects node:child_process execSync multi-hop provenance', () => {
    const code = [
      "import { execSync } from 'node:child_process';",
      "function runSync(cmd: string) {",
      "  execSync(cmd);",
      "}",
      "app.post('/sync-test', (req, res) => {",
      "  const val = req.query.input;",
      "  runSync(val);",
      "});",
    ].join('\n');

    const result = analyzeCommandFlow('src/routes.ts', code);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].sink.symbol).toBe('execSync');
  });

  it('negative control: safe constant command produces no finding', () => {
    const code = [
      "import { exec } from 'child_process';",
      "app.get('/safe', (req, res) => {",
      "  exec('echo constant');",
      "});",
    ].join('\n');

    const result = analyzeCommandFlow('src/routes.ts', code);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
  });

  it('negative control: unrelated local exec function produces no sink authority', () => {
    const code = [
      "function exec(cmd: string) {",
      "  return cmd;",
      "}",
      "app.get('/local-exec', (req, res) => {",
      "  const c = req.query.cmd;",
      "  exec(c);",
      "});",
    ].join('\n');

    const result = analyzeCommandFlow('src/routes.ts', code);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toHaveLength(0);
  });

  it('negative control: unsupported syntax fails closed / inconclusive', () => {
    const code = [
      "import { exec } from 'child_process';",
      "app.get('/eval-test', (req, res) => {",
      "  eval(req.query.cmd);",
      "});",
    ].join('\n');

    const result = analyzeCommandFlow('src/routes.ts', code);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toHaveLength(0);
  });
});
