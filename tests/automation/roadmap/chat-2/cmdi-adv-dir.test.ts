import { createHash } from 'node:crypto';
import ts from 'typescript';
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

const ORG = 'org_chat2';
const COMMIT_SHA = '46db4c208f886afda939c04ae93580fbabd57344';

interface CmdIFinding {
  vulnerabilityClass: 'COMMAND_INJECTION';
  source: CodeLocation;
  sink: CodeLocation;
  provenance: 'child_process.exec' | 'child_process.execSync';
}

interface CmdIAnalysis {
  status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  findings: CmdIFinding[];
  limitationCode?: string;
}

function getLocation(sf: ts.SourceFile, node: ts.Node, symbol: string): CodeLocation {
  const start = node.getStart(sf);
  const pos = sf.getLineAndCharacterOfPosition(start);
  return {
    filePath: sf.fileName,
    symbol,
    line: pos.line + 1,
    column: pos.character + 1,
  };
}

function analyzeDirectCommandInjection(sourceCode: string, filePath = 'src/routes.ts'): CmdIAnalysis {
  const sf = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const provenSinks = new Map<string, 'child_process.exec' | 'child_process.execSync'>();
  const localFunctions = new Set<string>();
  const findings: CmdIFinding[] = [];

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
      if (moduleSpecifier === 'child_process') {
        const clause = statement.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const importedName = (el.propertyName || el.name).text;
            if (importedName === 'exec') {
              provenSinks.set(el.name.text, 'child_process.exec');
            } else if (importedName === 'execSync') {
              provenSinks.set(el.name.text, 'child_process.execSync');
            }
          }
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      localFunctions.add(statement.name.text);
    }
  }

  let hasUnsupportedSyntax = false;

  function walk(node: ts.Node) {
    if (hasUnsupportedSyntax) return;

    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
        hasUnsupportedSyntax = true;
        return;
      }

      let calleeName = '';
      let provenance: 'child_process.exec' | 'child_process.execSync' | undefined;

      if (ts.isIdentifier(node.expression)) {
        calleeName = node.expression.text;
        if (!localFunctions.has(calleeName)) {
          provenance = provenSinks.get(calleeName);
        }
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        if (ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'child_process') {
          if (node.expression.name.text === 'exec') provenance = 'child_process.exec';
          if (node.expression.name.text === 'execSync') provenance = 'child_process.execSync';
        }
      }

      if (provenance && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          // Safe constant: negative control
        } else if (ts.isPropertyAccessExpression(arg)) {
          if (
            ts.isPropertyAccessExpression(arg.expression) &&
            ts.isIdentifier(arg.expression.expression) &&
            arg.expression.expression.text === 'req' &&
            arg.expression.name.text === 'query'
          ) {
            findings.push({
              vulnerabilityClass: 'COMMAND_INJECTION',
              source: getLocation(sf, arg, `req.query.${arg.name.text}`),
              sink: getLocation(sf, node, provenance),
              provenance,
            });
          }
        } else if (ts.isIdentifier(arg)) {
          let resolved = false;
          function findAssign(n: ts.Node) {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === (arg as ts.Identifier).text && n.initializer) {
              if (ts.isPropertyAccessExpression(n.initializer)) {
                const init = n.initializer;
                if (
                  ts.isPropertyAccessExpression(init.expression) &&
                  ts.isIdentifier(init.expression.expression) &&
                  init.expression.expression.text === 'req' &&
                  init.expression.name.text === 'query'
                ) {
                  findings.push({
                    vulnerabilityClass: 'COMMAND_INJECTION',
                    source: getLocation(sf, init, `req.query.${init.name.text}`),
                    sink: getLocation(sf, node, provenance!),
                    provenance: provenance!,
                  });
                  resolved = true;
                }
              }
            }
            ts.forEachChild(n, findAssign);
          }
          findAssign(sf);
        }
      }
    }
    ts.forEachChild(node, walk);
  }

  walk(sf);

  if (hasUnsupportedSyntax) {
    return {
      status: 'ANALYSIS_INCONCLUSIVE',
      findings: [],
      limitationCode: 'UNSUPPORTED_SYNTAX',
    };
  }

  return {
    status: findings.length > 0 ? 'DETECTED' : 'NOT_DETECTED',
    findings,
  };
}

function createCandidateFromFinding(
  finding: CmdIFinding,
  filePath: string,
  commitSha: string,
  organizationId: string
): FindingCandidate {
  const createdAt = '2026-09-04T00:00:00.000Z';
  const raw: FindingCandidate = {
    contractVersion: CONTRACT_VERSION,
    organizationId,
    candidateId: createHash('sha256')
      .update(`cmdi:${finding.source.symbol}:${finding.sink.symbol}:${commitSha}`)
      .digest('hex')
      .slice(0, 32),
    snapshot: {
      contractVersion: CONTRACT_VERSION,
      organizationId,
      snapshotId: 'snap_cmdi_direct_01',
      repositoryId: 'repo_discovery_cmdi',
      sourceProvider: 'LOCAL_FIXTURE',
      commitSha,
      ref: 'refs/heads/auto/v1-discovery-intelligence',
      createdAt,
    },
    vulnerabilityClass: 'COMMAND_INJECTION',
    source: finding.source,
    sink: finding.sink,
    context: {
      entrypoint: { filePath, symbol: 'handler', line: 1, column: 1 },
      routeId: 'GET.exec',
    },
    sensorEvidence: [
      {
        contractVersion: CONTRACT_VERSION,
        organizationId,
        sensorType: 'VELNAR_STRUCTURAL',
        sensorFindingId: 'sensor_cmdi_direct_1',
        ruleId: 'express-request-to-command-injection-v1',
        summary: 'Direct request parameter flow to proven child_process execution sink.',
        sourceLocation: finding.source,
        sinkLocation: finding.sink,
        rawEvidenceFingerprint: `sha256:${createHash('sha256').update(finding.source.symbol + finding.sink.symbol).digest('hex')}`,
      },
    ],
    reachabilityState: 'REACHABLE',
    verificationState: 'CANDIDATE',
    createdAt,
  };
  return validateFindingCandidate(raw, organizationId);
}

describe('V1 discovery-intelligence command-injection-detector adversarial-edge-case direct', () => {
  it('detects direct request query flow into proven child_process.exec sink', () => {
    const code = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        exec(req.query.cmd);
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].provenance).toBe('child_process.exec');
    expect(analysis.findings[0].source.symbol).toBe('req.query.cmd');
    expect(analysis.findings[0].sink.symbol).toBe('child_process.exec');
  });

  it('detects direct request query flow into proven child_process.execSync sink', () => {
    const code = `
      import { execSync } from 'child_process';
      export function handler(req: any, res: any) {
        execSync(req.query.target);
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].provenance).toBe('child_process.execSync');
  });

  it('detects direct flow propagated through intermediate local variable alias', () => {
    const code = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        const cmd = req.query.cmd;
        exec(cmd);
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('DETECTED');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0].source.symbol).toBe('req.query.cmd');
  });

  it('negative control: unrelated local exec function without child_process provenance produces NOT_DETECTED', () => {
    const code = `
      function exec(input: string) {
        return input;
      }
      export function handler(req: any, res: any) {
        exec(req.query.cmd);
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('negative control: external non-child_process import named exec produces NOT_DETECTED', () => {
    const code = `
      import { exec } from './safe-runner';
      export function handler(req: any, res: any) {
        exec(req.query.cmd);
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('negative control: safe constant command produces NOT_DETECTED', () => {
    const code = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        exec('ls -la');
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('negative control: ambiguous or unbound variable produces NOT_DETECTED', () => {
    const code = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        exec(unboundVar);
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('NOT_DETECTED');
    expect(analysis.findings).toHaveLength(0);
  });

  it('fails closed with ANALYSIS_INCONCLUSIVE on unsupported syntax', () => {
    const code = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        eval(req.query.cmd);
        exec(req.query.cmd);
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.limitationCode).toBe('UNSUPPORTED_SYNTAX');
  });

  it('constructs valid FindingCandidate preserving CANDIDATE state and canonical binding semantics', async () => {
    const code = `
      import { exec } from 'child_process';
      export function handler(req: any, res: any) {
        exec(req.query.cmd);
        return res.json({ status: 'ok' });
      }
    `;
    const analysis = analyzeDirectCommandInjection(code);
    expect(analysis.status).toBe('DETECTED');
    const finding = analysis.findings[0];
    const candidate = createCandidateFromFinding(finding, 'src/routes.ts', COMMIT_SHA, ORG);

    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.vulnerabilityClass).toBe('COMMAND_INJECTION');
    expect(candidate.snapshot.commitSha).toBe(COMMIT_SHA);

    const binding = computeCandidateBinding(candidate, ORG);
    expect(binding.startsWith(`${CONTRACT_VERSION}:FindingCandidate\n`)).toBe(true);
    expect(binding.startsWith('sha256:')).toBe(false);

    const vState = createVerificationState(candidate, ORG);
    expect(vState.state).toBe('CANDIDATE');
    await expect(
      transitionVerificationState(vState, {
        type: 'COMPLETE',
        result: {} as any,
        evidence: {} as any,
      })
    ).rejects.toThrow('COMPLETE requires pending verification');
  });

  it('rejects candidate generation with zero or malformed commit SHA', () => {
    const finding: CmdIFinding = {
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: { filePath: 'src/routes.ts', symbol: 'req.query.cmd', line: 3, column: 14 },
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 3, column: 9 },
      provenance: 'child_process.exec',
    };

    expect(() => createCandidateFromFinding(finding, 'src/routes.ts', '0'.repeat(40), ORG)).toThrow(
      'INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha'
    );
    expect(() => createCandidateFromFinding(finding, 'src/routes.ts', 'not-a-valid-sha', ORG)).toThrow(
      'INTELLIGENCE_PROTOCOL_ERROR: invalid commitSha'
    );
  });

  it('enforces tenant isolation during candidate validation', () => {
    const finding: CmdIFinding = {
      vulnerabilityClass: 'COMMAND_INJECTION',
      source: { filePath: 'src/routes.ts', symbol: 'req.query.cmd', line: 3, column: 14 },
      sink: { filePath: 'src/routes.ts', symbol: 'child_process.exec', line: 3, column: 9 },
      provenance: 'child_process.exec',
    };
    const candidate = createCandidateFromFinding(finding, 'src/routes.ts', COMMIT_SHA, ORG);
    expect(() => validateFindingCandidate(candidate, 'foreign_org')).toThrow(
      'INTELLIGENCE_PROTOCOL_ERROR: organizationId mismatch'
    );
  });
});
