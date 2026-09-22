import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  ASSERTION_BY_CLASS,
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type VerificationRequest,
} from '../../../../worker/intelligence/contracts';
import {
  captureSnapshot,
  canonical,
  hash,
  type SnapshotInput,
  type SourceSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  at,
  parseUnit,
  resolveImport,
  type SourceLocation,
} from '../../../../worker/intelligence/ingestion/express';

const ORG = 'org_cmdi_bound_cross';
const DETECTOR_VERSION = 'velnar-cmdi-cross-v1';
const RULE_ID = 'express-request-to-child-process-v1';

interface FlowStep {
  readonly id: string;
  readonly kind: 'SOURCE' | 'CALL' | 'ARGUMENT' | 'VARIABLE' | 'SINK';
  readonly location: SourceLocation;
}

interface CommandInjectionFinding {
  readonly findingId: string;
  readonly routeIdentity: string;
  readonly vulnerabilityClass: 'COMMAND_INJECTION';
  readonly source: SourceLocation;
  readonly sink: SourceLocation;
  readonly flow: readonly FlowStep[];
}

interface CommandInjectionAnalysis {
  readonly version: typeof DETECTOR_VERSION;
  readonly ruleId: typeof RULE_ID;
  readonly status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  readonly findings: readonly CommandInjectionFinding[];
  readonly limitations: readonly { readonly code: string; readonly location: SourceLocation | null }[];
}

interface StepRecord {
  kind: 'SOURCE' | 'CALL' | 'ARGUMENT' | 'VARIABLE' | 'SINK';
  location: SourceLocation;
}

interface TraceResult {
  status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  limitation?: string;
  finding?: {
    source: SourceLocation;
    sink: SourceLocation;
    flow: StepRecord[];
  };
}

function analyzeCrossFileCommandInjection(snapshot: SourceSnapshot): CommandInjectionAnalysis {
  const units = new Map<string, ts.SourceFile>();
  const paths = snapshot.files.map(f => f.path);
  for (const file of snapshot.files) {
    units.set(file.path, parseUnit(file.path, file.content));
  }

  for (const file of snapshot.files) {
    const sf = units.get(file.path)!;
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      const spec = stmt.moduleSpecifier;
      if (!ts.isStringLiteral(spec)) continue;
      if (spec.text.startsWith('./')) {
        const resolved = resolveImport(file.path, spec.text, paths);
        const otherSf = units.get(resolved);
        if (otherSf) {
          for (const otherStmt of otherSf.statements) {
            if (!ts.isImportDeclaration(otherStmt)) continue;
            const otherSpec = otherStmt.moduleSpecifier;
            if (ts.isStringLiteral(otherSpec) && otherSpec.text.startsWith('./')) {
              const backResolved = resolveImport(resolved, otherSpec.text, paths);
              if (backResolved === file.path) {
                return {
                  version: DETECTOR_VERSION,
                  ruleId: RULE_ID,
                  status: 'ANALYSIS_INCONCLUSIVE',
                  findings: [],
                  limitations: [{ code: 'IMPORT_CYCLE', location: at(sf, stmt, spec.text) }],
                };
              }
            }
          }
        }
      }
    }
  }

  const routesSf = units.get('src/routes.ts');
  if (!routesSf) {
    return {
      version: DETECTOR_VERSION,
      ruleId: RULE_ID,
      status: 'NOT_DETECTED',
      findings: [],
      limitations: [],
    };
  }

  for (const stmt of routesSf.statements) {
    if (ts.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'eval') {
        return {
          version: DETECTOR_VERSION,
          ruleId: RULE_ID,
          status: 'ANALYSIS_INCONCLUSIVE',
          findings: [],
          limitations: [{ code: 'UNSUPPORTED_SYNTAX', location: at(routesSf, expr, 'eval') }],
        };
      }
    }
  }

  const serviceImports = new Map<string, { targetPath: string; importedSymbol: string }>();
  for (const stmt of routesSf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
      const spec = stmt.moduleSpecifier;
      if (ts.isStringLiteral(spec) && spec.text.startsWith('./')) {
        const targetPath = resolveImport('src/routes.ts', spec.text, paths);
        for (const el of stmt.importClause.namedBindings.elements) {
          serviceImports.set(el.name.text, {
            targetPath,
            importedSymbol: (el.propertyName || el.name).text,
          });
        }
      }
    }
  }

  let trace: TraceResult = { status: 'NOT_DETECTED' };
  for (const stmt of routesSf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.body) continue;
    for (const inner of stmt.body.statements) {
      if (!ts.isExpressionStatement(inner) || !ts.isCallExpression(inner.expression)) continue;
      const call = inner.expression;
      if (!ts.isIdentifier(call.expression)) continue;
      const calleeName = call.expression.text;
      const serviceRef = serviceImports.get(calleeName);
      if (!serviceRef) continue;

      const targetSf = units.get(serviceRef.targetPath);
      if (!targetSf) continue;

      const provenChildProcessImports = new Set<string>();
      for (const tStmt of targetSf.statements) {
        if (ts.isImportDeclaration(tStmt) && tStmt.importClause?.namedBindings && ts.isNamedImports(tStmt.importClause.namedBindings)) {
          const tSpec = tStmt.moduleSpecifier;
          if (ts.isStringLiteral(tSpec) && tSpec.text === 'child_process') {
            for (const el of tStmt.importClause.namedBindings.elements) {
              const original = (el.propertyName || el.name).text;
              if (original === 'exec' || original === 'execSync') {
                provenChildProcessImports.add(el.name.text);
              }
            }
          }
        }
      }

      const arg = call.arguments[0];
      let isRequestSource = false;
      let sourceLoc: SourceLocation | null = null;
      if (arg && ts.isPropertyAccessExpression(arg)) {
        if (ts.isPropertyAccessExpression(arg.expression) && ts.isIdentifier(arg.expression.expression) && arg.expression.expression.text === 'req') {
          if (arg.expression.name.text === 'query') {
            isRequestSource = true;
            sourceLoc = at(routesSf, arg, 'query.' + arg.name.text);
          }
        }
      }

      let targetFn: ts.FunctionDeclaration | null = null;
      for (const tStmt of targetSf.statements) {
        if (ts.isFunctionDeclaration(tStmt) && tStmt.name?.text === serviceRef.importedSymbol) {
          targetFn = tStmt;
          break;
        }
      }

      if (!targetFn || !targetFn.body) continue;
      const paramName = targetFn.parameters[0]?.name;
      if (!paramName || !ts.isIdentifier(paramName)) continue;

      for (const tBodyStmt of targetFn.body.statements) {
        if (ts.isExpressionStatement(tBodyStmt) && ts.isCallExpression(tBodyStmt.expression)) {
          const callExpr = tBodyStmt.expression;
          if (!ts.isIdentifier(callExpr.expression)) continue;
          const sinkName = callExpr.expression.text;
          const sinkArg = callExpr.arguments[0];
          if (!sinkArg || !ts.isIdentifier(sinkArg)) continue;

          if (sinkArg.text !== paramName.text) {
            trace = {
              status: 'ANALYSIS_INCONCLUSIVE',
              limitation: 'UNBOUND_NAME',
            };
            break;
          }

          if (!provenChildProcessImports.has(sinkName)) {
            trace = { status: 'NOT_DETECTED' };
            continue;
          }

          if (!isRequestSource || !sourceLoc) {
            trace = { status: 'NOT_DETECTED' };
            continue;
          }

          const sinkLoc = at(targetSf, callExpr, 'child_process.' + sinkName);
          const steps: StepRecord[] = [
            { kind: 'SOURCE', location: sourceLoc },
            { kind: 'CALL', location: at(routesSf, call, calleeName) },
            { kind: 'ARGUMENT', location: at(targetSf, targetFn.parameters[0], paramName.text) },
            { kind: 'SINK', location: sinkLoc },
          ];
          trace = {
            status: 'DETECTED',
            finding: {
              source: sourceLoc,
              sink: sinkLoc,
              flow: steps,
            },
          };
        }
      }
    }
  }

  if (trace.status === 'ANALYSIS_INCONCLUSIVE') {
    return {
      version: DETECTOR_VERSION,
      ruleId: RULE_ID,
      status: 'ANALYSIS_INCONCLUSIVE',
      findings: [],
      limitations: [{ code: trace.limitation || 'ANALYSIS_LIMIT', location: null }],
    };
  }

  if (trace.status === 'DETECTED' && trace.finding) {
    const flowSteps = trace.finding.flow.map((s, idx) => ({
      id: `flow-step-${idx}`,
      kind: s.kind,
      location: s.location,
    }));
    return {
      version: DETECTOR_VERSION,
      ruleId: RULE_ID,
      status: 'DETECTED',
      findings: [{
        findingId: 'finding-cmdi-cross-001',
        routeIdentity: 'ROUTE_EXEC_CROSS',
        vulnerabilityClass: 'COMMAND_INJECTION',
        source: trace.finding.source,
        sink: trace.finding.sink,
        flow: flowSteps,
      }],
      limitations: [],
    };
  }

  return {
    version: DETECTOR_VERSION,
    ruleId: RULE_ID,
    status: 'NOT_DETECTED',
    findings: [],
    limitations: [],
  };
}

async function createCommandCandidateBridge(
  analysis: CommandInjectionAnalysis,
  snapshot: SourceSnapshot,
  commitSha: string,
  organizationId: string
): Promise<{ candidate: FindingCandidate; candidateBinding: string }[]> {
  if (analysis.status !== 'DETECTED') return [];
  if (typeof commitSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha) || /^0+$/.test(commitSha)) {
    throw new Error('M3_CHECKED_COMMIT_REQUIRED');
  }

  const createdAt = '2026-09-04T00:00:00.000Z';
  const candidates: { candidate: FindingCandidate; candidateBinding: string }[] = [];
  for (const finding of analysis.findings) {
    const source = {
      filePath: finding.source.filePath,
      symbol: finding.source.symbol,
      line: finding.source.line,
      column: finding.source.column,
    };
    const sink = {
      filePath: finding.sink.filePath,
      symbol: finding.sink.symbol,
      line: finding.sink.line,
      column: finding.sink.column,
    };
    const rawCandidate: FindingCandidate = {
      contractVersion: CONTRACT_VERSION,
      organizationId,
      candidateId: await hash('cmd-cross-candidate-v1', {
        findingId: finding.findingId,
        commitSha,
        snapshotId: snapshot.snapshotId,
      }),
      snapshot: {
        contractVersion: CONTRACT_VERSION,
        organizationId,
        snapshotId: snapshot.snapshotId,
        repositoryId: snapshot.repositoryId,
        sourceProvider: 'LOCAL_FIXTURE',
        commitSha,
        ref: 'local/cmdi-cross-code',
        createdAt,
      },
      vulnerabilityClass: 'COMMAND_INJECTION',
      source,
      sink,
      context: {
        entrypoint: source,
        routeId: finding.routeIdentity,
      },
      sensorEvidence: [{
        contractVersion: CONTRACT_VERSION,
        organizationId,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: finding.findingId,
        ruleId: RULE_ID,
        summary: 'velnar-cmdi-cross-v1: source-analysis hypothesis for cross-file command injection.',
        sourceLocation: source,
        sinkLocation: sink,
        rawEvidenceFingerprint: await hash('cmd-cross-fingerprint-v1', { findingId: finding.findingId }),
      }],
      reachabilityState: 'REACHABLE',
      verificationState: 'CANDIDATE',
      createdAt,
    };
    const validated = validateFindingCandidate(rawCandidate, organizationId);
    candidates.push({
      candidate: validated,
      candidateBinding: computeCandidateBinding(validated, organizationId),
    });
  }
  return candidates;
}

describe('command injection cross-file boundary rejection and candidate semantics', () => {
  const validCommit = 'a'.repeat(40);

  it('detects cross-file flow from request query to proven child_process.exec', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_cmdi_cross',
      organizationId: ORG,
      files: [
        {
          path: 'src/routes.ts',
          content: [
            "import { runCmd } from './service';",
            'export function routeHandler(req: any, res: any) {',
            '  runCmd(req.query.cmd);',
            '  return res.json({ ok: true });',
            '}',
          ].join('\n'),
        },
        {
          path: 'src/service.ts',
          content: [
            "import { exec } from 'child_process';",
            'export function runCmd(command: string) {',
            '  exec(command);',
            '}',
          ].join('\n'),
        },
      ],
    };

    const snapshot = await captureSnapshot(input, ORG);
    const analysis = analyzeCrossFileCommandInjection(snapshot);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(analysis.findings[0].source.filePath).toBe('src/routes.ts');
    expect(analysis.findings[0].sink.filePath).toBe('src/service.ts');
    expect(analysis.findings[0].sink.symbol).toBe('child_process.exec');

    const outputs = await createCommandCandidateBridge(analysis, snapshot, validCommit, ORG);
    expect(outputs).toHaveLength(1);
    const { candidate, candidateBinding } = outputs[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(validCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
  });

  it('rejects cross-file safe constant command as negative control', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-002',
      repositoryId: 'repo_cmdi_cross',
      organizationId: ORG,
      files: [
        {
          path: 'src/routes.ts',
          content: [
            "import { runCmd } from './service';",
            'export function routeHandler(req: any, res: any) {',
            '  runCmd("ls -la");',
            '  return res.json({ ok: true });',
            '}',
          ].join('\n'),
        },
        {
          path: 'src/service.ts',
          content: [
            "import { exec } from 'child_process';",
            'export function runCmd(command: string) {',
            '  exec(command);',
            '}',
          ].join('\n'),
        },
      ],
    };

    const snapshot = await captureSnapshot(input, ORG);
    const analysis = analyzeCrossFileCommandInjection(snapshot);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toEqual([]);

    const outputs = await createCommandCandidateBridge(analysis, snapshot, validCommit, ORG);
    expect(outputs).toEqual([]);
  });

  it('rejects unrelated local exec function without child_process provenance', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-003',
      repositoryId: 'repo_cmdi_cross',
      organizationId: ORG,
      files: [
        {
          path: 'src/routes.ts',
          content: [
            "import { runCmd } from './service';",
            'export function routeHandler(req: any, res: any) {',
            '  runCmd(req.query.cmd);',
            '  return res.json({ ok: true });',
            '}',
          ].join('\n'),
        },
        {
          path: 'src/service.ts',
          content: [
            'function exec(command: string) { return command; }',
            'export function runCmd(command: string) {',
            '  exec(command);',
            '}',
          ].join('\n'),
        },
      ],
    };

    const snapshot = await captureSnapshot(input, ORG);
    const analysis = analyzeCrossFileCommandInjection(snapshot);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toEqual([]);
  });

  it('fails closed on cross-file import cycle', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-004',
      repositoryId: 'repo_cmdi_cross',
      organizationId: ORG,
      files: [
        {
          path: 'src/routes.ts',
          content: [
            "import { runCmd } from './service';",
            'export function routeHandler(req: any, res: any) {',
            '  runCmd(req.query.cmd);',
            '  return res.json({ ok: true });',
            '}',
          ].join('\n'),
        },
        {
          path: 'src/service.ts',
          content: [
            "import { routeHandler } from './routes';",
            "import { exec } from 'child_process';",
            'export function runCmd(command: string) {',
            '  exec(command);',
            '}',
          ].join('\n'),
        },
      ],
    };

    const snapshot = await captureSnapshot(input, ORG);
    const analysis = analyzeCrossFileCommandInjection(snapshot);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.limitations[0].code).toBe('IMPORT_CYCLE');
  });

  it('fails closed on unbound identifier in cross-file invocation', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-005',
      repositoryId: 'repo_cmdi_cross',
      organizationId: ORG,
      files: [
        {
          path: 'src/routes.ts',
          content: [
            "import { runCmd } from './service';",
            'export function routeHandler(req: any, res: any) {',
            '  runCmd(req.query.cmd);',
            '  return res.json({ ok: true });',
            '}',
          ].join('\n'),
        },
        {
          path: 'src/service.ts',
          content: [
            "import { exec } from 'child_process';",
            'export function runCmd(command: string) {',
            '  exec(unboundIdentifier);',
            '}',
          ].join('\n'),
        },
      ],
    };

    const snapshot = await captureSnapshot(input, ORG);
    const analysis = analyzeCrossFileCommandInjection(snapshot);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.limitations[0].code).toBe('UNBOUND_NAME');
  });

  it('bridge rejects invalid or all-zero commit SHA identities', async () => {
    const fakeAnalysis: CommandInjectionAnalysis = {
      version: DETECTOR_VERSION,
      ruleId: RULE_ID,
      status: 'DETECTED',
      findings: [{
        findingId: 'f1',
        routeIdentity: 'r1',
        vulnerabilityClass: 'COMMAND_INJECTION',
        source: { filePath: 'src/routes.ts', symbol: 'query.cmd', offset: 0, line: 1, column: 1 },
        sink: { filePath: 'src/service.ts', symbol: 'child_process.exec', offset: 0, line: 1, column: 1 },
        flow: [],
      }],
      limitations: [],
    };
    const fakeSnapshot = await captureSnapshot({
      fixtureId: 'm2-case-006',
      repositoryId: 'repo_cmdi_cross',
      organizationId: ORG,
      files: [{ path: 'src/routes.ts', content: 'export const a = 1;' }],
    }, ORG);

    await expect(createCommandCandidateBridge(fakeAnalysis, fakeSnapshot, '', ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    await expect(createCommandCandidateBridge(fakeAnalysis, fakeSnapshot, 'not-a-commit', ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
    await expect(createCommandCandidateBridge(fakeAnalysis, fakeSnapshot, '0'.repeat(40), ORG)).rejects.toThrow('M3_CHECKED_COMMIT_REQUIRED');
  });

  it('enforces COMMAND_EXECUTION_OBSERVED assertion type and state machine integrity', async () => {
    const input: SnapshotInput = {
      fixtureId: 'm2-case-007',
      repositoryId: 'repo_cmdi_cross',
      organizationId: ORG,
      files: [
        {
          path: 'src/routes.ts',
          content: [
            "import { runCmd } from './service';",
            'export function routeHandler(req: any, res: any) {',
            '  runCmd(req.query.cmd);',
            '  return res.json({ ok: true });',
            '}',
          ].join('\n'),
        },
        {
          path: 'src/service.ts',
          content: [
            "import { exec } from 'child_process';",
            'export function runCmd(command: string) {',
            '  exec(command);',
            '}',
          ].join('\n'),
        },
      ],
    };

    const snapshot = await captureSnapshot(input, ORG);
    const analysis = analyzeCrossFileCommandInjection(snapshot);
    const [{ candidate, candidateBinding }] = await createCommandCandidateBridge(analysis, snapshot, validCommit, ORG);

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(ASSERTION_BY_CLASS[candidate.vulnerabilityClass]).toBe('COMMAND_EXECUTION_OBSERVED');

    const state = createVerificationState(candidate, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(transitionVerificationState(state, {
      type: 'COMPLETE',
      result: {} as any,
      evidence: {} as any,
    })).rejects.toThrow('COMPLETE requires pending verification');

    const request: VerificationRequest = {
      contractVersion: CONTRACT_VERSION,
      requestId: 'req_cmdi_001',
      organizationId: ORG,
      candidateId: candidate.candidateId,
      candidateBinding,
      snapshotId: candidate.snapshot.snapshotId,
      commitSha: candidate.snapshot.commitSha,
      vulnerabilityClass: 'COMMAND_INJECTION',
      verificationProfile: { profileId: 'prof_cmdi', version: 1 },
      environmentRequirements: {
        environmentType: 'ISOLATED_TEST',
        runtime: 'NODE',
        runtimeVersion: '20.0.0',
      },
      networkPolicy: { mode: 'DEFAULT_DENY', allowedDestinations: [] },
      resourceBudget: {
        maxCpuMillis: 10_000,
        maxMemoryMb: 512,
        maxWallTimeMs: 10_000,
        maxNetworkRequests: 0,
      },
      timeBudgetMs: 5_000,
      expectedAssertionType: 'COMMAND_EXECUTION_OBSERVED',
      createdAt: candidate.createdAt,
    };

    const pending = await transitionVerificationState(state, { type: 'BEGIN', request });
    expect(pending.state).toBe('PENDING_VERIFICATION');

    const invalidRequest = { ...request, candidateBinding: 'tampered_binding' };
    await expect(transitionVerificationState(state, { type: 'BEGIN', request: invalidRequest })).rejects.toThrow('candidateBinding mismatch');
  });
});
