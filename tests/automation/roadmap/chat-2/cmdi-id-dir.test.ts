import ts from 'typescript';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type CodeLocation,
  type FindingCandidate,
} from '../../../../worker/intelligence/contracts';

const ORG = 'org_cmdi_direct';
const VALID_COMMIT = '46db4c208f886afda939c04ae93580fbabd57344';
const OTHER_COMMIT = 'b'.repeat(40);

interface DirectCmdiFinding {
  source: CodeLocation;
  sink: CodeLocation;
  flow: { kind: string; location: CodeLocation }[];
}

function findDirectCmdi(filePath: string, sourceCode: string): DirectCmdiFinding[] {
  const sf = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.ES2022, true);
  const provenSinks = new Set<string>();
  const provenNamespaces = new Set<string>();
  const localExecDeclarations = new Set<string>();

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.moduleSpecifier.text === 'child_process') {
        const clause = statement.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const imported = (el.propertyName || el.name).text;
            if (imported === 'exec' || imported === 'execSync') {
              provenSinks.add(el.name.text);
            }
          }
        } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          provenNamespaces.add(clause.namedBindings.name.text);
        } else if (clause?.name) {
          provenNamespaces.add(clause.name.text);
        }
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      if (statement.name.text === 'exec' || statement.name.text === 'execSync') {
        localExecDeclarations.add(statement.name.text);
      }
    }
  }

  const loc = (node: ts.Node, symbol: string): CodeLocation => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { filePath, symbol, line: line + 1, column: character + 1 };
  };

  const findings: DirectCmdiFinding[] = [];
  const variables = new Map<string, { source: CodeLocation; trace: { kind: string; location: CodeLocation }[] }>();

  function inspect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (ts.isPropertyAccessExpression(init)) {
        const prop = init.name.text;
        if (ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === 'query') {
          const sourceLocation = loc(init, `req.query.${prop}`);
          variables.set(node.name.text, {
            source: sourceLocation,
            trace: [{ kind: 'SOURCE', location: sourceLocation }],
          });
        }
      }
    }

    if (ts.isCallExpression(node)) {
      let isProvenSink = false;
      let sinkSymbol = '';
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (provenSinks.has(name) && !localExecDeclarations.has(name)) {
          isProvenSink = true;
          sinkSymbol = `child_process.${name}`;
        }
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression.expression;
        const method = node.expression.name.text;
        if (ts.isIdentifier(target) && provenNamespaces.has(target.text) && (method === 'exec' || method === 'execSync')) {
          isProvenSink = true;
          sinkSymbol = `child_process.${method}`;
        }
      }

      if (isProvenSink && node.arguments.length > 0) {
        const arg = node.arguments[0];
        const sinkLoc = loc(node.expression, sinkSymbol);
        if (ts.isPropertyAccessExpression(arg) && ts.isPropertyAccessExpression(arg.expression) && arg.expression.name.text === 'query') {
          const sourceLoc = loc(arg, `req.query.${arg.name.text}`);
          findings.push({
            source: sourceLoc,
            sink: sinkLoc,
            flow: [
              { kind: 'SOURCE', location: sourceLoc },
              { kind: 'SINK', location: sinkLoc },
            ],
          });
        } else if (ts.isIdentifier(arg) && variables.has(arg.text)) {
          const entry = variables.get(arg.text)!;
          findings.push({
            source: entry.source,
            sink: sinkLoc,
            flow: [
              ...entry.trace,
              { kind: 'VARIABLE', location: loc(arg, arg.text) },
              { kind: 'SINK', location: sinkLoc },
            ],
          });
        }
      }
    }

    ts.forEachChild(node, inspect);
  }

  inspect(sf);
  return findings;
}

function buildCandidate(params: {
  org: string;
  commitSha: string;
  finding: DirectCmdiFinding;
  routeId: string;
}): FindingCandidate {
  const { org, commitSha, finding, routeId } = params;
  const createdAt = '2026-09-04T00:00:00.000Z';
  const rawEvidenceFingerprint = 'sha256:' + createHash('sha256').update(`${routeId}:${finding.source.symbol}:${finding.sink.symbol}`).digest('hex');
  const candidateId = 'cmdi_' + createHash('sha256').update(`${commitSha}:${routeId}:${rawEvidenceFingerprint}`).digest('hex').slice(0, 32);

  return validateFindingCandidate({
    contractVersion: CONTRACT_VERSION,
    organizationId: org,
    candidateId,
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      snapshotId: 'snap_cmdi_direct_01',
      organizationId: org,
      repositoryId: 'repo_v1_discovery',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha,
      ref: 'refs/heads/main',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: finding.source,
    sink: finding.sink,
    context: {
      entrypoint: { filePath: finding.source.filePath, symbol: 'execRoute', line: 1, column: 1 },
      routeId,
    },
    sensorEvidence: [{
      contractVersion: CONTRACT_VERSION,
      organizationId: org,
      sensorType: 'VELNAR_STRUCTURAL',
      sensorFindingId: 'sensor_cmdi_' + candidateId.slice(5, 17),
      ruleId: 'express-child-process-exec-v1',
      summary: 'Direct child_process execution of request query input.',
      sourceLocation: finding.source,
      sinkLocation: finding.sink,
      rawEvidenceFingerprint,
    }],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  }, org);
}

describe('RM_CMDI_ID_DIR: direct command injection candidate identity stability', () => {
  const vulnerableSource = [
    "import { exec } from 'child_process';",
    'export function execRoute(req: any, res: any) {',
    '  const command = req.query.cmd;',
    '  exec(command);',
    '}',
  ].join('\n');

  const memberVulnerableSource = [
    "import * as cp from 'child_process';",
    'export function execRoute(req: any, res: any) {',
    '  cp.execSync(req.query.script);',
    '}',
  ].join('\n');

  const safeConstantSource = [
    "import { exec } from 'child_process';",
    'export function execRoute(req: any, res: any) {',
    "  exec('ls -la');",
    '}',
  ].join('\n');

  const unrelatedExecSource = [
    'function exec(command: string) { return command.length; }',
    'export function execRoute(req: any, res: any) {',
    '  const command = req.query.cmd;',
    '  exec(command);',
    '}',
  ].join('\n');

  it('detects direct request-to-exec flow when explicit child_process provenance exists', () => {
    const findings = findDirectCmdi('src/routes.ts', vulnerableSource);
    expect(findings).toHaveLength(1);
    expect(findings[0].source.symbol).toBe('req.query.cmd');
    expect(findings[0].sink.symbol).toBe('child_process.exec');
    expect(findings[0].flow[0].kind).toBe('SOURCE');
    expect(findings[0].flow.at(-1)!.kind).toBe('SINK');
  });

  it('detects namespace import child_process.execSync direct usage', () => {
    const findings = findDirectCmdi('src/admin.ts', memberVulnerableSource);
    expect(findings).toHaveLength(1);
    expect(findings[0].source.symbol).toBe('req.query.script');
    expect(findings[0].sink.symbol).toBe('child_process.execSync');
  });

  it('rejects safe constant execution as negative control', () => {
    const findings = findDirectCmdi('src/safe.ts', safeConstantSource);
    expect(findings).toHaveLength(0);
  });

  it('rejects unrelated local exec function without child_process provenance as negative control', () => {
    const findings = findDirectCmdi('src/unrelated.ts', unrelatedExecSource);
    expect(findings).toHaveLength(0);
  });

  it('builds canonical FindingCandidate retaining CANDIDATE state and exact binding format', () => {
    const [finding] = findDirectCmdi('src/routes.ts', vulnerableSource);
    const candidate = buildCandidate({ org: ORG, commitSha: VALID_COMMIT, finding, routeId: 'route_cmdi_exec' });

    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(VALID_COMMIT);

    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding).toMatch(/^velnar-intelligence-contract-v1:FindingCandidate\n\{/);
    expect(binding).not.toMatch(/^sha256:/);

    const vState = createVerificationState(candidate, ORG);
    expect(vState.state).toBe('CANDIDATE');
  });

  it('verifies candidate identity stability: identical source produces identical binding', () => {
    const [finding1] = findDirectCmdi('src/routes.ts', vulnerableSource);
    const [finding2] = findDirectCmdi('src/routes.ts', vulnerableSource);
    const c1 = buildCandidate({ org: ORG, commitSha: VALID_COMMIT, finding: finding1, routeId: 'route_cmdi_exec' });
    const c2 = buildCandidate({ org: ORG, commitSha: VALID_COMMIT, finding: finding2, routeId: 'route_cmdi_exec' });

    expect(c1.candidateId).toBe(c2.candidateId);
    expect(computeCandidateBinding(c1, ORG)).toBe(computeCandidateBinding(c2, ORG));
  });

  it('changes candidate binding when semantic properties vary', () => {
    const [finding] = findDirectCmdi('src/routes.ts', vulnerableSource);
    const base = buildCandidate({ org: ORG, commitSha: VALID_COMMIT, finding, routeId: 'route_cmdi_exec' });
    const baseBinding = computeCandidateBinding(base, ORG);

    const differentRoute = buildCandidate({ org: ORG, commitSha: VALID_COMMIT, finding, routeId: 'route_cmdi_other' });
    expect(computeCandidateBinding(differentRoute, ORG)).not.toBe(baseBinding);

    const differentCommit = buildCandidate({ org: ORG, commitSha: OTHER_COMMIT, finding, routeId: 'route_cmdi_exec' });
    expect(computeCandidateBinding(differentCommit, ORG)).not.toBe(baseBinding);

    const alteredSourceFinding: DirectCmdiFinding = {
      ...finding,
      source: { ...finding.source, column: finding.source.column! + 1 },
    };
    const differentLoc = buildCandidate({ org: ORG, commitSha: VALID_COMMIT, finding: alteredSourceFinding, routeId: 'route_cmdi_exec' });
    expect(computeCandidateBinding(differentLoc, ORG)).not.toBe(baseBinding);
  });

  it('fails closed when direct completion is attempted on candidate state', async () => {
    const [finding] = findDirectCmdi('src/routes.ts', vulnerableSource);
    const candidate = buildCandidate({ org: ORG, commitSha: VALID_COMMIT, finding, routeId: 'route_cmdi_exec' });
    const initial = createVerificationState(candidate, ORG);

    await expect(transitionVerificationState(initial, {
      type: 'COMPLETE',
      result: { result: 'VERIFIED' } as any,
      evidence: {} as any,
    })).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('rejects tenant mismatch and invalid commit identity at candidate validation boundary', () => {
    const [finding] = findDirectCmdi('src/routes.ts', vulnerableSource);
    expect(() => {
      buildCandidate({ org: ORG, commitSha: '0'.repeat(40), finding, routeId: 'route_cmdi_exec' });
    }).toThrow('INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha');

    const validCandidate = buildCandidate({ org: ORG, commitSha: VALID_COMMIT, finding, routeId: 'route_cmdi_exec' });
    expect(() => computeCandidateBinding(validCandidate, 'org_foreign')).toThrow('INTELLIGENCE_PROTOCOL_ERROR:');
  });
});
