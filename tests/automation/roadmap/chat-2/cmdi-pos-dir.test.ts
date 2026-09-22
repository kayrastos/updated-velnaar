import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';
import {
  type FlowStep,
} from '../../../../worker/intelligence/detection/types';
import {
  at,
  parseUnit,
  type SourceLocation,
} from '../../../../worker/intelligence/ingestion/express';
import {
  hash,
} from '../../../../worker/intelligence/ingestion/snapshot';

const ORG = 'org_test_cmdi';

interface CmdIFinding {
  readonly routeIdentity: string;
  readonly vulnerabilityClass: 'COMMAND_INJECTION';
  readonly source: SourceLocation;
  readonly sink: SourceLocation;
  readonly flow: readonly FlowStep[];
}

interface CmdIAnalysis {
  readonly status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  readonly findings: readonly CmdIFinding[];
  readonly limitation?: string;
}

function analyzeCommandInjection(sourceCode: string, filePath = 'src/routes.ts'): CmdIAnalysis {
  const sf = parseUnit(filePath, sourceCode);
  const provenSinks = new Set<string>();
  const provenNamespaces = new Set<string>();
  const localFunctions = new Set<string>();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (ts.isStringLiteral(stmt.moduleSpecifier)) {
        const mod = stmt.moduleSpecifier.text;
        if (mod === 'child_process' || mod === 'node:child_process') {
          const clause = stmt.importClause;
          if (clause) {
            if (clause.name) {
              provenNamespaces.add(clause.name.text);
            }
            if (clause.namedBindings) {
              if (ts.isNamespaceImport(clause.namedBindings)) {
                provenNamespaces.add(clause.namedBindings.name.text);
              } else if (ts.isNamedImports(clause.namedBindings)) {
                for (const el of clause.namedBindings.elements) {
                  const imported = (el.propertyName || el.name).text;
                  if (imported === 'exec' || imported === 'execSync') {
                    provenSinks.add(el.name.text);
                  }
                }
              }
            }
          }
        }
      }
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer && ts.isCallExpression(decl.initializer)) {
          const call = decl.initializer;
          if (ts.isIdentifier(call.expression) && call.expression.text === 'require' && call.arguments.length === 1) {
            const arg = call.arguments[0];
            if (ts.isStringLiteral(arg) && (arg.text === 'child_process' || arg.text === 'node:child_process')) {
              if (ts.isIdentifier(decl.name)) {
                provenNamespaces.add(decl.name.text);
              } else if (ts.isObjectBindingPattern(decl.name)) {
                for (const el of decl.name.elements) {
                  if (ts.isIdentifier(el.name)) {
                    const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
                    if (prop === 'exec' || prop === 'execSync') {
                      provenSinks.add(el.name.text);
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else if (ts.isFunctionDeclaration(stmt)) {
      if (stmt.name) {
        localFunctions.add(stmt.name.text);
      }
    }
  }

  let unsupported = false;
  const checkUnsupported = (node: ts.Node) => {
    if (ts.isWhileStatement(node) || ts.isForStatement(node) || ts.isDoStatement(node)) {
      unsupported = true;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
      unsupported = true;
    }
    ts.forEachChild(node, checkUnsupported);
  };
  checkUnsupported(sf);
  if (unsupported) {
    return { status: 'ANALYSIS_INCONCLUSIVE', findings: [], limitation: 'UNSUPPORTED_SYNTAX' };
  }

  const findings: CmdIFinding[] = [];
  const taintMap = new Map<string, FlowStep[]>();

  const isProvenSink = (expr: ts.Expression): { isSink: boolean; symbol: string } => {
    if (ts.isIdentifier(expr)) {
      if (localFunctions.has(expr.text)) return { isSink: false, symbol: expr.text };
      if (provenSinks.has(expr.text)) return { isSink: true, symbol: `child_process.${expr.text}` };
      return { isSink: false, symbol: expr.text };
    }
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && ts.isIdentifier(expr.name)) {
      if (provenNamespaces.has(expr.expression.text) && (expr.name.text === 'exec' || expr.name.text === 'execSync')) {
        return { isSink: true, symbol: `child_process.${expr.name.text}` };
      }
    }
    return { isSink: false, symbol: 'call' };
  };

  const getTaint = (expr: ts.Expression): FlowStep[] | null => {
    if (ts.isIdentifier(expr)) {
      return taintMap.get(expr.text) || null;
    }
    if (ts.isPropertyAccessExpression(expr)) {
      const name = expr.name.text;
      if (ts.isPropertyAccessExpression(expr.expression)) {
        const receiver = expr.expression;
        if (ts.isIdentifier(receiver.name) && (receiver.name.text === 'query' || receiver.name.text === 'params')) {
          const loc = at(sf, expr, `req.${receiver.name.text}.${name}`);
          return [{ id: 'step_src', kind: 'SOURCE', location: loc }];
        }
      }
      if (ts.isIdentifier(expr.expression) && (expr.expression.text === 'query' || expr.expression.text === 'params')) {
        const loc = at(sf, expr, `${expr.expression.text}.${name}`);
        return [{ id: 'step_src', kind: 'SOURCE', location: loc }];
      }
    }
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const leftTaint = getTaint(expr.left);
      const rightTaint = getTaint(expr.right);
      const active = leftTaint || rightTaint;
      if (active) {
        const loc = at(sf, expr, '+');
        return [...active, { id: `step_concat_${loc.offset}`, kind: 'CONCAT', location: loc }];
      }
    }
    return null;
  };

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const taint = getTaint(node.initializer);
      if (taint) {
        const loc = at(sf, node, node.name.text);
        taintMap.set(node.name.text, [...taint, { id: `step_var_${loc.offset}`, kind: 'VARIABLE', location: loc }]);
      }
    }
    if (ts.isCallExpression(node)) {
      const sinkCheck = isProvenSink(node.expression);
      if (sinkCheck.isSink && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        const taint = getTaint(firstArg);
        if (taint && taint.length > 0) {
          const sinkLoc = at(sf, node, sinkCheck.symbol);
          const flow: FlowStep[] = [
            ...taint,
            { id: `step_sink_${sinkLoc.offset}`, kind: 'SINK', location: sinkLoc },
          ];
          findings.push({
            routeIdentity: 'route_cmd_01',
            vulnerabilityClass: 'COMMAND_INJECTION',
            source: flow[0].location,
            sink: sinkLoc,
            flow,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);

  return {
    status: findings.length > 0 ? 'DETECTED' : 'NOT_DETECTED',
    findings,
  };
}

async function buildCommandInjectionCandidate(
  finding: CmdIFinding,
  commitSha: string,
  organizationId: string,
): Promise<{ candidate: FindingCandidate; candidateBinding: string }> {
  const createdAt = '2026-09-04T00:00:00.000Z';
  const rawCandidate: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId,
    candidateId: await hash('cmdi-candidate-v1', { finding, commitSha }),
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId,
      snapshotId: 'snapshot-cmdi-001',
      repositoryId: 'repo-cmdi-001',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha,
      ref: 'local/cmdi-positive-direct',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: { filePath: finding.source.filePath, symbol: finding.source.symbol, line: finding.source.line, column: finding.source.column },
    sink: { filePath: finding.sink.filePath, symbol: finding.sink.symbol, line: finding.sink.line, column: finding.sink.column },
    context: {
      entrypoint: { filePath: finding.source.filePath, symbol: 'handler', line: 1, column: 1 },
      routeId: finding.routeIdentity,
    },
    sensorEvidence: [{
      contractVersion: CONTRACT_VERSION,
      organizationId,
      sensorType: 'VELNAR_STRUCTURAL',
      sensorFindingId: 'sensor-cmdi-001',
      ruleId: 'express-request-to-child-process-exec-v1',
      summary: 'Direct command injection from request query into child_process execution sink.',
      sourceLocation: { filePath: finding.source.filePath, symbol: finding.source.symbol, line: finding.source.line, column: finding.source.column },
      sinkLocation: { filePath: finding.sink.filePath, symbol: finding.sink.symbol, line: finding.sink.line, column: finding.sink.column },
      rawEvidenceFingerprint: await hash('sensor-cmdi-fingerprint-v1', { finding }),
    }],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };

  const candidate = validateFindingCandidate(rawCandidate, organizationId);
  const candidateBinding = computeCandidateBinding(candidate, organizationId);
  return { candidate, candidateBinding };
}

describe('Command Injection positive-control direct roadmap test', () => {
  it('detects direct request-derived query flow to child_process exec', async () => {
    const source = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        exec(req.query.cmd);
      }
    `;
    const analysis = analyzeCommandInjection(source);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    const finding = analysis.findings[0];
    expect(finding.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(finding.source.symbol).toBe('req.query.cmd');
    expect(finding.sink.symbol).toBe('child_process.exec');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow[finding.flow.length - 1].kind).toBe('SINK');

    const commit = 'a'.repeat(40);
    const { candidate, candidateBinding } = await buildCommandInjectionCandidate(finding, commit, ORG);
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
  });

  it('detects execSync with command concatenation through alias variable', async () => {
    const source = `
      import * as cp from 'child_process';
      export function handler(req: any, res: any) {
        const fullCommand = 'ping -c 1 ' + req.query.host;
        cp.execSync(fullCommand);
      }
    `;
    const analysis = analyzeCommandInjection(source);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    const finding = analysis.findings[0];
    expect(finding.sink.symbol).toBe('child_process.execSync');
    expect(finding.flow.some(s => s.kind === 'CONCAT')).toBe(true);
    expect(finding.flow.some(s => s.kind === 'VARIABLE')).toBe(true);
  });

  it('negative control: safe constant command produces no finding', () => {
    const source = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        exec('uptime');
      }
    `;
    const analysis = analyzeCommandInjection(source);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('negative control: unrelated local exec function does not grant sink authority', () => {
    const source = `
      function exec(command: string) {
        return command;
      }
      export function handler(req: any, res: any) {
        exec(req.query.cmd);
      }
    `;
    const analysis = analyzeCommandInjection(source);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('negative control: ambiguous unbound identifier produces no finding', () => {
    const source = `
      export function handler(req: any, res: any) {
        unboundRunner(req.query.cmd);
      }
    `;
    const analysis = analyzeCommandInjection(source);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('fails closed on unsupported syntax', () => {
    const source = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        while (true) {}
        exec(req.query.cmd);
      }
    `;
    const analysis = analyzeCommandInjection(source);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toHaveLength(0);
  });

  it('preserves CANDIDATE verification state and rejects direct verification completion', async () => {
    const source = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        exec(req.query.cmd);
      }
    `;
    const analysis = analyzeCommandInjection(source);
    const { candidate } = await buildCommandInjectionCandidate(analysis.findings[0], 'b'.repeat(40), ORG);
    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(state, { type: 'COMPLETE', result: {} as any, evidence: {} as any }),
    ).rejects.toThrow('COMPLETE requires pending verification');
  });
});
