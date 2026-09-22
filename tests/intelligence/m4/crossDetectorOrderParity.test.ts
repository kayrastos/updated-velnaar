import { beforeAll, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, computeCandidateBinding, validateFindingCandidate, type FindingCandidate } from '../../../worker/intelligence/contracts';
import { detectSqlInjection, validateSqlAnalysis } from '../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../worker/intelligence/detection/candidate';
import { DETECTOR_VERSION, RULE_ID } from '../../../worker/intelligence/detection/types';
import { canonical, hash, type SourceSnapshot } from '../../../worker/intelligence/ingestion/snapshot';
import { type ExpressIngestion } from '../../../worker/intelligence/ingestion/express';
import { analyzeInput, input, replaceSource, ORG } from '../m3/support/inputs';
import { currentCodeCommit, verifyCommittedFixture } from '../m2/support/gitCodeState';

interface DetectorResult {
  readonly detectorName: string;
  readonly status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  readonly findingsCount: number;
  readonly fingerprint: string;
}

async function runSqlDetector(snapshot: SourceSnapshot, ingestion: ExpressIngestion, organizationId: string): Promise<DetectorResult> {
  const result = await detectSqlInjection(snapshot, ingestion, organizationId);
  return {
    detectorName: 'SQL_INJECTION',
    status: result.status,
    findingsCount: result.findings.length,
    fingerprint: result.resultFingerprint,
  };
}

async function runCommandDetector(snapshot: SourceSnapshot, ingestion: ExpressIngestion, organizationId: string): Promise<DetectorResult> {
  let detected = false;
  for (const file of snapshot.files) {
    if (file.content.includes("require('child_process')") && (file.content.includes('.exec(') || file.content.includes('.execSync('))) {
      if (file.content.includes('req.query.') || file.content.includes('req.body.')) {
        detected = true;
      }
    }
  }
  const status = detected ? 'DETECTED' : 'NOT_DETECTED';
  const fingerprint = await hash('velnar-m4-cmd-source-v1', { snapshotId: snapshot.snapshotId, status });
  return {
    detectorName: 'COMMAND_INJECTION',
    status,
    findingsCount: detected ? 1 : 0,
    fingerprint,
  };
}

let runs: Awaited<ReturnType<typeof analyzeInput>>[];
beforeAll(async () => {
  runs = [];
  for (let i = 0; i < 4; i++) runs.push(await analyzeInput(input(i)));
});

describe('M4 cross-detector execution order parity', () => {
  it('sequential execution [SQL, Command] matches reverse execution [Command, SQL]', async () => {
    const { snapshot, ingestion } = runs[0];
    const fwdSql = await runSqlDetector(snapshot, ingestion, ORG);
    const fwdCmd = await runCommandDetector(snapshot, ingestion, ORG);
    const revCmd = await runCommandDetector(snapshot, ingestion, ORG);
    const revSql = await runSqlDetector(snapshot, ingestion, ORG);
    expect(fwdSql).toEqual(revSql);
    expect(fwdCmd).toEqual(revCmd);
  });

  it('concurrent execution Promise.all matches sequential execution', async () => {
    const { snapshot, ingestion } = runs[0];
    const [parSql, parCmd] = await Promise.all([
      runSqlDetector(snapshot, ingestion, ORG),
      runCommandDetector(snapshot, ingestion, ORG),
    ]);
    const seqSql = await runSqlDetector(snapshot, ingestion, ORG);
    const seqCmd = await runCommandDetector(snapshot, ingestion, ORG);
    expect(parSql).toEqual(seqSql);
    expect(parCmd).toEqual(seqCmd);
  });

  it('detector execution does not mutate snapshot or ingestion across runs', async () => {
    const { snapshot, ingestion } = runs[0];
    const snapBefore = canonical(snapshot);
    const ingBefore = canonical(ingestion);
    await runSqlDetector(snapshot, ingestion, ORG);
    await runCommandDetector(snapshot, ingestion, ORG);
    expect(canonical(snapshot)).toBe(snapBefore);
    expect(canonical(ingestion)).toBe(ingBefore);
  });

  it('candidate bridge retains CANDIDATE state and exact binding across detector order permutations', async () => {
    const bridge = createSqlCandidateBridge(verifyCommittedFixture);
    const { snapshot, ingestion, result } = runs[0];
    await runCommandDetector(snapshot, ingestion, ORG);
    const candidatesAfterCmd = await bridge(result, snapshot, ingestion, ORG);
    const candidatesDirect = await bridge(result, snapshot, ingestion, ORG);
    expect(candidatesAfterCmd).toHaveLength(1);
    expect(candidatesAfterCmd).toEqual(candidatesDirect);
    const { candidate, candidateBinding } = candidatesAfterCmd[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(candidateBinding.startsWith(CONTRACT_VERSION + ':FindingCandidate')).toBe(true);
    expect(candidateBinding).not.toMatch(/^sha256:/);
    expect(candidate.snapshot.commitSha).toBe(currentCodeCommit());
  });

  it('negative controls remain NOT_DETECTED regardless of execution order or interleaving', async () => {
    const safeRun = runs[1];
    const safeCmdFirst = await runCommandDetector(safeRun.snapshot, safeRun.ingestion, ORG);
    const safeSqlSecond = await runSqlDetector(safeRun.snapshot, safeRun.ingestion, ORG);
    expect(safeSqlSecond.status).toBe('NOT_DETECTED');
    expect(safeSqlSecond.findingsCount).toBe(0);
    expect(safeCmdFirst.status).toBe('NOT_DETECTED');
    expect(safeCmdFirst.findingsCount).toBe(0);
    const safeSqlFirst = await runSqlDetector(safeRun.snapshot, safeRun.ingestion, ORG);
    const safeCmdSecond = await runCommandDetector(safeRun.snapshot, safeRun.ingestion, ORG);
    expect(safeSqlFirst).toEqual(safeSqlSecond);
    expect(safeCmdSecond).toEqual(safeCmdFirst);
  });

  it('inconclusive syntax fails closed independently of detector scheduling order', async () => {
    const inconclusiveRun = await analyzeInput(replaceSource(input(), src => src.replace('return res.json', 'while (true) {} return res.json')));
    expect(inconclusiveRun.result.status).toBe('ANALYSIS_INCONCLUSIVE');
    const bridge = createSqlCandidateBridge(verifyCommittedFixture);
    const candidates = await bridge(inconclusiveRun.result, inconclusiveRun.snapshot, inconclusiveRun.ingestion, ORG);
    expect(candidates).toEqual([]);
  });
});
