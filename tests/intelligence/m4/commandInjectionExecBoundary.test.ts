import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  CONTRACT_VERSION,
  ASSERTION_BY_CLASS,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  validateVerificationRequest,
  type FindingCandidate,
  type CodeLocation,
} from '../../../worker/intelligence/contracts';

const ORG = 'org_m4';

interface BoundaryStep {
  kind: 'SOURCE' | 'VARIABLE' | 'CONCAT' | 'SINK';
  symbol: string;
  line: number;
  column: number;
}

interface BoundaryFinding {
  vulnerabilityClass: 'COMMAND_INJECTION';
  source: CodeLocation;
  sink: CodeLocation;
  flow: BoundaryStep[];
}

interface BoundaryAnalysis {
  status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  findings: BoundaryFinding[];
  limitation?: string;
}

function getLocation(sf: ts.SourceFile, node: ts.Node, symbol: string): CodeLocation {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { filePath: 'src/routes.ts', symbol, line: line + 1, column: character + 1 };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}

function analyzeCommandBoundary(code: string): BoundaryAnalysis {
  const sf = ts.createSourceFile('src/routes.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const cpNamed = new Map<string, 'EXEC' | 'EXEC_SYNC' | 'EXEC_FILE' | 'EXEC_FILE_SYNC'>();
  const cpNamespaces = new Set<string>();
  const localFunctions = new Set<string>();

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      localFunctions.add(stmt.name.text);
    }
    if (ts.isImportDeclaration(stmt)) {
      const mod = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : '';
      if (mod === 'child_process' || mod === 'node:child_process') {
        const clause = stmt.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const imported = (el.propertyName || el.name).text;
            const local = el.name.text;
            if (imported === 'exec') cpNamed.set(local, 'EXEC');
            if (imported === 'execSync') cpNamed.set(local, 'EXEC_SYNC');
            if (imported === 'execFile') cpNamed.set(local, 'EXEC_FILE');
            if (imported === 'execFileSync') cpNamed.set(local, 'EXEC_FILE_SYNC');
          }
        } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          cpNamespaces.add(clause.namedBindings.name.text);
        } else if (clause?.name) {
          cpNamespaces.add(clause.name.text);
        }
      }
    }
  }

  let inconclusiveReason: string | undefined;
  const tainted = new Map<string, { source: CodeLocation; steps: BoundaryStep[] }>();
  const findings: BoundaryFinding[] = [];

  function evaluateExpr(node: ts.Expression): { isTainted: boolean; source?: CodeLocation; steps: BoundaryStep[] } {
    if (ts.isIdentifier(node)) {
      const found = tainted.get(node.text);
      if (found) return { isTainted: true, source: found.source, steps: [...found.steps] };
      return { isTainted: false, steps: [] };
    }
    if (ts.isPropertyAccessExpression(node)) {
      const objText = node.expression.getText(sf);
      if (objText === 'req.query' || objText === 'req.params' || objText === 'req.body') {
        const loc = getLocation(sf, node, `${objText.slice(4)}.${node.name.text}`);
        const step: BoundaryStep = { kind: 'SOURCE', symbol: loc.symbol, line: loc.line!, column: loc.column! };
        return { isTainted: true, source: loc, steps: [step] };
      }
      return { isTainted: false, steps: [] };
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluateExpr(node.left);
      const right = evaluateExpr(node.right);
      if (left.isTainted && right.isTainted) {
        inconclusiveReason = 'MULTIPLE_SOURCES';
        return { isTainted: false, steps: [] };
      }
      const active = left.isTainted ? left : right.isTainted ? right : null;
      if (active) {
        const loc = getLocation(sf, node, '+');
        const step: BoundaryStep = { kind: 'CONCAT', symbol: '+', line: loc.line!, column: loc.column! };
        return { isTainted: true, source: active.source, steps: [...active.steps, step] };
      }
      return { isTainted: false, steps: [] };
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
      inconclusiveReason = 'UNSUPPORTED_STATEMENT';
      return { isTainted: false, steps: [] };
    }
    return { isTainted: false, steps: [] };
  }

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const res = evaluateExpr(node.initializer);
      if (res.isTainted) {
        const loc = getLocation(sf, node, node.name.text);
        const step: BoundaryStep = { kind: 'VARIABLE', symbol: node.name.text, line: loc.line!, column: loc.column! };
        tainted.set(node.name.text, { source: res.source!, steps: [...res.steps, step] });
      }
    }

    if (ts.isCallExpression(node)) {
      let sinkKind: 'EXEC' | 'EXEC_SYNC' | 'EXEC_FILE' | 'EXEC_FILE_SYNC' | null = null;
      let sinkSymbol = '';

      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (!localFunctions.has(name) && cpNamed.has(name)) {
          sinkKind = cpNamed.get(name)!;
          sinkSymbol = `child_process.${name}`;
        }
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const recv = node.expression.expression;
        const method = node.expression.name.text;
        if (ts.isIdentifier(recv) && cpNamespaces.has(recv.text)) {
          if (method === 'exec') sinkKind = 'EXEC';
          if (method === 'execSync') sinkKind = 'EXEC_SYNC';
          if (method === 'execFile') sinkKind = 'EXEC_FILE';
          if (method === 'execFileSync') sinkKind = 'EXEC_FILE_SYNC';
          sinkSymbol = `child_process.${method}`;
        }
      }

      if (sinkKind === 'EXEC' || sinkKind === 'EXEC_SYNC') {
        if (node.arguments.length > 0) {
          const argEval = evaluateExpr(node.arguments[0]);
          if (argEval.isTainted) {
            const sinkLoc = getLocation(sf, node, sinkSymbol);
            const sinkStep: BoundaryStep = { kind: 'SINK', symbol: sinkSymbol, line: sinkLoc.line!, column: sinkLoc.column! };
            findings.push({
              vulnerabilityClass: 'COMMAND_INJECTION',
              source: argEval.source!,
              sink: sinkLoc,
              flow: [...argEval.steps, sinkStep],
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);

  if (inconclusiveReason) {
    return { status: 'ANALYSIS_INCONCLUSIVE', findings: [], limitation: inconclusiveReason };
  }
  return findings.length > 0
    ? { status: 'DETECTED', findings }
    : { status: 'NOT_DETECTED', findings: [] };
}

function buildCandidate(
  finding: BoundaryFinding,
  orgId: string,
  commitSha = 'a'.repeat(40)
): FindingCandidate {
  const createdAt = '2026-09-04T00:00:00.000Z';
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: orgId,
    candidateId: 'cand-cmd-boundary-001',
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId: orgId,
      snapshotId: 'snap-cmd-001',
      repositoryId: 'repo-discovery-cmd',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha,
      ref: 'local/m4-cmd-boundary',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: finding.source,
    sink: finding.sink,
    context: {
      entrypoint: { filePath: 'src/routes.ts', symbol: 'execRouteHandler', line: 1, column: 1 },
      routeId: 'POST.exec',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId: orgId,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor-finding-cmd-001',
        ruleId: 'child-process-exec-shell-injection-v1',
        summary: 'Source-analysis candidate for child_process exec boundary.',
        sourceLocation: finding.source,
        sinkLocation: finding.sink,
        rawEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };
}

describe('M4 command injection detector: exec versus execFile boundary', () => {
  it('detects request-derived shell-string flow into proven child_process.exec', () => {
    const code = `
      import { exec } from 'child_process';
      function handler(req: any) {
        const cmd = req.query.cmd;
        const shellString = 'git log ' + cmd;
        exec(shellString);
      }
    `;
    const analysis = analyzeCommandBoundary(code);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(analysis.findings[0].source.symbol).toBe('query.cmd');
    expect(analysis.findings[0].sink.symbol).toBe('child_process.exec');
  });

  it('detects request-derived shell-string flow into proven node:child_process execSync', () => {
    const code = `
      import { execSync } from 'node:child_process';
      function handler(req: any) {
        const target = req.params.host;
        execSync('ping -c 1 ' + target);
      }
    `;
    const analysis = analyzeCommandBoundary(code);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].sink.symbol).toBe('child_process.execSync');
  });

  it('detects namespace import child_process invocation (cp.exec)', () => {
    const code = `
      import * as cp from 'child_process';
      function handler(req: any) {
        const arg = req.query.pattern;
        cp.exec('grep ' + arg);
      }
    `;
    const analysis = analyzeCommandBoundary(code);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings[0].sink.symbol).toBe('child_process.exec');
  });

  it('distinguishes execFile boundary as a negative control against shell command injection', () => {
    const code = `
      import { execFile } from 'child_process';
      function handler(req: any) {
        const filename = req.query.file;
        execFile('cat', [filename]);
      }
    `;
    const analysis = analyzeCommandBoundary(code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('distinguishes execFileSync boundary as a negative control', () => {
    const code = `
      import { execFileSync } from 'node:child_process';
      function handler(req: any) {
        const arg = req.body.arg;
        execFileSync('ls', [arg]);
      }
    `;
    const analysis = analyzeCommandBoundary(code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('treats safe string constants as negative controls', () => {
    const code = `
      import { exec } from 'child_process';
      function handler(req: any) {
        exec('git status --porcelain');
      }
    `;
    const analysis = analyzeCommandBoundary(code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('requires proven child_process provenance; local exec functions never create sink authority', () => {
    const code = `
      function exec(cmd: string) {
        return cmd.trim();
      }
      function handler(req: any) {
        const cmd = req.query.cmd;
        exec('ls ' + cmd);
      }
    `;
    const analysis = analyzeCommandBoundary(code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('fails closed when unsupported syntax or multi-source join is encountered', () => {
    const code = `
      import { exec } from 'child_process';
      function handler(req: any) {
        const cmd = req.query.a + req.query.b;
        exec(cmd);
      }
    `;
    const analysis = analyzeCommandBoundary(code);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.limitation).toBe('MULTIPLE_SOURCES');
  });
});

describe('M4 COMMAND_INJECTION FindingCandidate bridge and canonical contracts', () => {
  it('constructs a valid FindingCandidate bound to CANDIDATE verification state', () => {
    const finding: BoundaryFinding = {
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: { filePath: 'src/routes.ts', symbol: 'query.cmd', line: 4, column: 23 },
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 6, column: 9 },
      flow: [
        { kind: 'SOURCE', symbol: 'query.cmd', line: 4, column: 23 },
        { kind: 'VARIABLE', symbol: 'cmd', line: 4, column: 15 },
        { kind: 'SINK', symbol: 'child_process.exec', line: 6, column: 9 },
      ],
    };
    const cand = buildCandidate(finding, ORG);
    const validated = validateFindingCandidate(cand, ORG);
    expect(validated.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(validated.verificationState).toBe('CANDIDATE');
    expect(validated.reachabilityState).toBe('REACHABLE');
  });

  it('computes canonical candidate binding matching complete candidate representation without sha256 prefix', () => {
    const finding: BoundaryFinding = {
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: { filePath: 'src/routes.ts', symbol: 'query.cmd', line: 2, column: 10 },
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 3, column: 10 },
      flow: [],
    };
    const cand = buildCandidate(finding, ORG);
    const binding = computeCandidateBinding(cand, ORG);
    const expected = `${CONTRACT_VERSION}:FindingCandidate\n${canonical(cand)}`;
    expect(binding).toBe(expected);
    expect(binding.startsWith('sha256:')).toBe(false);
  });

  it('validates VerificationRequest with expectedAssertionType matching COMMAND_EXECUTION_OBSERVED', () => {
    const finding: BoundaryFinding = {
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: { filePath: 'src/routes.ts', symbol: 'query.cmd', line: 2, column: 10 },
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 3, column: 10 },
      flow: [],
    };
    const cand = buildCandidate(finding, ORG);
    const binding = computeCandidateBinding(cand, ORG);
    const req = {
      contractVersion: CONTRACT_VERSION,
      requestId: 'req-cmd-001',
      organizationId: ORG,
      candidateId: cand.candidateId,
      candidateBinding: binding,
      snapshotId: cand.snapshot.snapshotId,
      commitSha: cand.snapshot.commitSha,
      vulnerabilityClass: cand.vulnerabilityClass,
      verificationProfile: { profileId: 'profile-cmd-v1', version: 1 },
      environmentRequirements: {
        environmentType: 'ISOLATED_TEST' as const,
        runtime: 'NODE' as const,
        runtimeVersion: '20.0.0',
      },
      networkPolicy: {
        mode: 'DEFAULT_DENY' as const,
        allowedDestinations: [],
      },
      resourceBudget: {
        maxCpuMillis: 5000,
        maxMemoryMb: 1024,
        maxWallTimeMs: 10000,
        maxNetworkRequests: 0,
      },
      timeBudgetMs: 5000,
      expectedAssertionType: ASSERTION_BY_CLASS[cand.vulnerabilityClass],
      createdAt: cand.createdAt,
    };
    const validatedReq = validateVerificationRequest(req, cand, ORG);
    expect(validatedReq.expectedAssertionType).toBe('COMMAND_EXECUTION_OBSERVED');
    expect(validatedReq.candidateBinding).toBe(binding);
  });

  it('enforces that verification state begins at CANDIDATE and rejects direct completion without verification', async () => {
    const finding: BoundaryFinding = {
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: { filePath: 'src/routes.ts', symbol: 'query.cmd', line: 2, column: 10 },
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 3, column: 10 },
      flow: [],
    };
    const cand = buildCandidate(finding, ORG);
    const state = createVerificationState(cand, ORG);
    expect(state.state).toBe('CANDIDATE');

    await expect(
      transitionVerificationState(state, {
        type: 'COMPLETE',
        result: {} as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('rejects candidates with invalid, non-hex, or all-zero commit SHA identities', () => {
    const finding: BoundaryFinding = {
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: { filePath: 'src/routes.ts', symbol: 'query.cmd', line: 2, column: 10 },
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 3, column: 10 },
      flow: [],
    };
    for (const badSha of ['', 'not-a-commit-sha', '0'.repeat(40), 'g'.repeat(40)]) {
      const cand = buildCandidate(finding, ORG, badSha);
      expect(() => validateFindingCandidate(cand, ORG)).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');
    }
  });
});
