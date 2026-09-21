import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  computeCandidateBinding,
  createVerificationState,
  transitionVerificationState,
  validateFindingCandidate,
  type FindingCandidate,
  type CodeLocation,
} from '../../../worker/intelligence/contracts';
import { captureSnapshot, hash, type SnapshotInput } from '../../../worker/intelligence/ingestion/snapshot';
import { currentCodeCommit } from '../m2/support/gitCodeState';
import { ORG } from '../fixtures';

interface ProvenanceAnalysis {
  status: 'DETECTED' | 'NOT_DETECTED' | 'INCONCLUSIVE';
  findings: readonly CommandInjectionFinding[];
}

interface CommandInjectionFinding {
  findingId: string;
  routeIdentity: string;
  vulnerabilityClass: 'COMMAND_INJECTION';
  source: CodeLocation;
  sink: CodeLocation;
  commandExpression: string;
}

interface CommandHypothesis {
  readonly candidate: FindingCandidate;
  readonly candidateBinding: string;
}

function analyzeCommandSinkProvenance(sourceText: string, filePath: string): ProvenanceAnalysis {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const provenSinks = new Map<string, 'child_process.exec' | 'child_process.execSync'>();
  const provenNamespaces = new Set<string>();
  const localFunctions = new Set<string>();

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const modSpec = statement.moduleSpecifier;
      if (ts.isStringLiteral(modSpec) && (modSpec.text === 'child_process' || modSpec.text === 'node:child_process')) {
        const clause = statement.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const importedName = (el.propertyName || el.name).text;
            if (importedName === 'exec' || importedName === 'execSync') {
              provenSinks.set(el.name.text, `child_process.${importedName}`);
            }
          }
        }
        if (clause?.name) {
          provenNamespaces.add(clause.name.text);
        }
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          provenNamespaces.add(clause.namedBindings.name.text);
        }
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      localFunctions.add(statement.name.text);
    }
  }

  for (const name of localFunctions) {
    provenSinks.delete(name);
  }

  const taintedNames = new Set<string>();
  const findings: CommandInjectionFinding[] = [];
  let sourceLoc: CodeLocation | null = null;

  function locate(node: ts.Node, symbol: string): CodeLocation {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { filePath, symbol, line: line + 1, column: character + 1 };
  }

  function inspect(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'req' &&
          node.expression.name.text === 'query') {
        taintedNames.add(node.name.text);
        if (!sourceLoc) {
          sourceLoc = locate(node, `req.query.${node.name.text}`);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isPropertyAccessExpression(node.initializer)) {
        const prop = node.initializer;
        if (ts.isPropertyAccessExpression(prop.expression) &&
            ts.isIdentifier(prop.expression.expression) &&
            prop.expression.expression.text === 'req' &&
            prop.expression.name.text === 'query') {
          taintedNames.add(node.name.text);
          if (!sourceLoc) {
            sourceLoc = locate(prop, `req.query.${prop.name.text}`);
          }
        }
      } else if (ts.isIdentifier(node.initializer) && taintedNames.has(node.initializer.text)) {
        taintedNames.add(node.name.text);
      }
    }
    if (ts.isCallExpression(node)) {
      let sinkSymbol: 'child_process.exec' | 'child_process.execSync' | null = null;
      if (ts.isIdentifier(node.expression)) {
        const fnName = node.expression.text;
        if (!localFunctions.has(fnName) && provenSinks.has(fnName)) {
          sinkSymbol = provenSinks.get(fnName)!;
        }
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const receiver = node.expression.expression;
        const method = node.expression.name.text;
        if (ts.isIdentifier(receiver) && provenNamespaces.has(receiver.text)) {
          if (method === 'exec' || method === 'execSync') {
            sinkSymbol = `child_process.${method}`;
          }
        }
      }

      if (sinkSymbol && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        let isTainted = false;
        if (ts.isIdentifier(firstArg) && taintedNames.has(firstArg.text)) {
          isTainted = true;
        } else if (ts.isBinaryExpression(firstArg) && firstArg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
          if ((ts.isIdentifier(firstArg.left) && taintedNames.has(firstArg.left.text)) ||
              (ts.isIdentifier(firstArg.right) && taintedNames.has(firstArg.right.text))) {
            isTainted = true;
          }
        }

        if (isTainted && sourceLoc) {
          findings.push({
            findingId: `finding-cmd-${findings.length + 1}`,
            routeIdentity: 'route-cmd-handler-v1',
            vulnerabilityClass: 'COMMAND_INJECTION',
            source: sourceLoc,
            sink: locate(node, sinkSymbol),
            commandExpression: firstArg.getText(sf),
          });
        }
      }
    }
    ts.forEachChild(node, inspect);
  }

  ts.forEachChild(sf, inspect);
  return {
    status: findings.length > 0 ? 'DETECTED' : 'NOT_DETECTED',
    findings,
  };
}

function createCommandCandidateBridge(verifyCommittedCode: () => Promise<string>) {
  return async (
    analysis: ProvenanceAnalysis,
    snapshotInput: SnapshotInput,
    organizationId: string,
  ): Promise<readonly CommandHypothesis[]> => {
    if (analysis.status !== 'DETECTED' || analysis.findings.length === 0) {
      return Object.freeze([]);
    }
    const commitSha = await verifyCommittedCode();
    if (typeof commitSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha) || /^0+$/.test(commitSha)) {
      throw new Error('M4_CHECKED_COMMIT_REQUIRED');
    }
    const snapshot = await captureSnapshot(snapshotInput, organizationId);
    const createdAt = '2026-09-18T00:00:00.000Z';
    const results: CommandHypothesis[] = [];

    for (const finding of analysis.findings) {
      const rawCandidate: FindingCandidate = {
        contractVersion: CONTRACT_VERSION,
        organizationId,
        candidateId: await hash('m4-cmdi-candidate-v1', {
          snapshotId: snapshot.snapshotId,
          findingId: finding.findingId,
          commitSha,
        }),
        snapshot: {
          contractVersion: CONTRACT_VERSION,
          organizationId,
          snapshotId: snapshot.snapshotId,
          repositoryId: snapshot.repositoryId,
          sourceProvider: 'LOCAL_FIXTURE',
          commitSha,
          ref: 'local/m4-sink-provenance-test',
          createdAt,
        },
        vulnerabilityClass: 'COMMAND_INJECTION',
        source: finding.source,
        sink: finding.sink,
        context: {
          entrypoint: { filePath: finding.source.filePath, symbol: 'commandRoute', line: 1, column: 1 },
          routeId: finding.routeIdentity,
        },
        sensorEvidence: [{
          contractVersion: CONTRACT_VERSION,
          organizationId,
          sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: finding.findingId,
          ruleId: 'express-request-to-child-process-v1',
          summary: 'Tainted request argument flow bound to child_process exec sink.',
          sourceLocation: finding.source,
          sinkLocation: finding.sink,
          rawEvidenceFingerprint: await hash('m4-sensor-evidence-v1', { findingId: finding.findingId }),
        }],
        reachabilityState: 'REACHABLE',
        verificationState: 'CANDIDATE',
        createdAt,
      };
      const candidate = validateFindingCandidate(rawCandidate, organizationId);
      results.push({
        candidate,
        candidateBinding: computeCandidateBinding(candidate, organizationId),
      });
    }
    return Object.freeze(results);
  };
}

describe('M4 sink provenance tracking and argument provenance binding', () => {
  const vulnerableSource = `import { exec } from 'child_process';
export function commandRoute(req: any, res: any) {
  const cmd = req.query.cmd;
  exec(cmd);
}`;

  const syncVulnerableSource = `import cp from 'child_process';
export function commandRoute(req: any, res: any) {
  const target = req.query.target;
  cp.execSync('ping ' + target);
}`;

  const safeConstantSource = `import { exec } from 'child_process';
export function commandRoute(req: any, res: any) {
  const user = req.query.user;
  exec('whoami');
}`;

  const unrelatedLocalExecSource = `function exec(command: string) {
  return command.length;
}
export function commandRoute(req: any, res: any) {
  const cmd = req.query.cmd;
  exec(cmd);
}`;

  const ambiguousUnboundSource = `import { exec } from 'child_process';
export function commandRoute(req: any, res: any) {
  exec(undefined as any);
}`;

  function makeInput(content: string): SnapshotInput {
    return {
      fixtureId: 'm2-case-001',
      repositoryId: 'repo_m4',
      organizationId: ORG,
      files: [{ path: 'src/handler.ts', content }],
    };
  }

  it('detects proven child_process.exec sink with request-derived argument flow', () => {
    const analysis = analyzeCommandSinkProvenance(vulnerableSource, 'src/handler.ts');
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(analysis.findings[0].sink.symbol).toBe('child_process.exec');
    expect(analysis.findings[0].source.symbol).toBe('req.query.cmd');
  });

  it('detects proven child_process.execSync sink via namespace import with concatenated flow', () => {
    const analysis = analyzeCommandSinkProvenance(syncVulnerableSource, 'src/handler.ts');
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].sink.symbol).toBe('child_process.execSync');
  });

  it('negative control: safe constant command literal does not create a finding', () => {
    const analysis = analyzeCommandSinkProvenance(safeConstantSource, 'src/handler.ts');
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('negative control: unrelated local exec function without child_process provenance creates no sink authority', () => {
    const analysis = analyzeCommandSinkProvenance(unrelatedLocalExecSource, 'src/handler.ts');
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('negative control: ambiguous unbound identifier creates no finding', () => {
    const analysis = analyzeCommandSinkProvenance(ambiguousUnboundSource, 'src/handler.ts');
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('produces a valid FindingCandidate preserving CANDIDATE verificationState and canonical binding', async () => {
    const checkedCommit = currentCodeCommit();
    const analysis = analyzeCommandSinkProvenance(vulnerableSource, 'src/handler.ts');
    const bridge = createCommandCandidateBridge(async () => checkedCommit);
    const output = await bridge(analysis, makeInput(vulnerableSource), ORG);

    expect(output).toHaveLength(1);
    const { candidate, candidateBinding } = output[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith('sha256:')).toBe(false);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
  });

  it('rejects malformed or all-zero commit SHA at the bridge boundary', async () => {
    const analysis = analyzeCommandSinkProvenance(vulnerableSource, 'src/handler.ts');
    for (const badCommit of ['', 'invalid-commit', '0000000000000000000000000000000000000000']) {
      const bridge = createCommandCandidateBridge(async () => badCommit);
      await expect(bridge(analysis, makeInput(vulnerableSource), ORG)).rejects.toThrow('M4_CHECKED_COMMIT_REQUIRED');
    }
  });

  it('preserves fail-closed candidate gate against direct verification completion', async () => {
    const checkedCommit = currentCodeCommit();
    const analysis = analyzeCommandSinkProvenance(vulnerableSource, 'src/handler.ts');
    const bridge = createCommandCandidateBridge(async () => checkedCommit);
    const output = await bridge(analysis, makeInput(vulnerableSource), ORG);
    const { candidate } = output[0];
    const start = createVerificationState(candidate, ORG);

    await expect(
      transitionVerificationState(start, {
        type: 'COMPLETE',
        result: { result: 'VERIFIED' } as any,
        evidence: {} as any,
      }),
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('tampering with candidate sink symbol breaks candidate binding integrity', async () => {
    const checkedCommit = currentCodeCommit();
    const analysis = analyzeCommandSinkProvenance(vulnerableSource, 'src/handler.ts');
    const bridge = createCommandCandidateBridge(async () => checkedCommit);
    const output = await bridge(analysis, makeInput(vulnerableSource), ORG);
    const { candidate, candidateBinding } = output[0];

    const tampered = { ...candidate, sink: { ...candidate.sink, symbol: 'tampered.sink' } };
    expect(computeCandidateBinding(tampered, ORG)).not.toBe(candidateBinding);
  });
});
