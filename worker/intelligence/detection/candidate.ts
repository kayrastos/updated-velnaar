import { CONTRACT_VERSION, type FindingCandidate } from '../contracts/types';
import { computeCandidateBinding, validateFindingCandidate, immutableCopy } from '../contracts/validators';
import { validateSnapshot, detachJson, hash, type SourceSnapshot } from '../ingestion/snapshot';
import { validateExpressIngestion, type ExpressIngestion, type SourceLocation } from '../ingestion/express';
import { validateSqlAnalysis } from './sqlInjection';
import { DETECTOR_VERSION, RULE_ID } from './types';

const location = (point: SourceLocation) => ({ filePath: point.filePath, symbol: point.symbol, line: point.line, column: point.column });
export interface CandidateHypothesis { readonly candidate: FindingCandidate; readonly candidateBinding: string }
/** Trusted host composition, as in M2: the callback must check actual committed bytes.
 * It is not detector input and cannot be supplied through captured source data.
 * Detection itself needs neither this callback nor a Git commit.
 */
export function createSqlCandidateBridge(verifyCommittedCode: (snapshot: SourceSnapshot) => Promise<string>) {
  return async (raw: unknown, rawSnapshot: SourceSnapshot, rawIngestion: ExpressIngestion, organizationId: string): Promise<readonly CandidateHypothesis[]> => {
    const resultCopy = detachJson(raw), snapshotCopy = detachJson(rawSnapshot), ingestionCopy = detachJson(rawIngestion);
    const snapshot = await validateSnapshot(snapshotCopy, organizationId);
    const ingestion = await validateExpressIngestion(ingestionCopy, organizationId);
    const analysis = await validateSqlAnalysis(resultCopy, snapshot, ingestion, organizationId);
    if (analysis.status !== 'DETECTED') return Object.freeze([]);
    const commitSha = await verifyCommittedCode(snapshot);
    if (typeof commitSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commitSha) || /^0+$/.test(commitSha)) throw new Error('M3_CHECKED_COMMIT_REQUIRED');
    const createdAt = '2026-09-04T00:00:00.000Z'; // Stable local logical clock, not elapsed execution time.
    const candidates: CandidateHypothesis[] = [];
    for (const finding of analysis.findings) {
      const route = ingestion.routes.find(r => r.routeIdentity === finding.routeIdentity)!;
      const source = location(finding.source), sink = location(finding.sink);
      const rawCandidate: FindingCandidate = {
        contractVersion: CONTRACT_VERSION, organizationId,
        candidateId: await hash('m3-sqli-candidate-v1', { resultFingerprint: analysis.resultFingerprint, findingId: finding.findingId, commitSha }),
        snapshot: { contractVersion: CONTRACT_VERSION, organizationId, snapshotId: snapshot.snapshotId, repositoryId: snapshot.repositoryId,
          sourceProvider: 'LOCAL_FIXTURE', commitSha, ref: 'local/m3-checked-captured-code', createdAt },
        vulnerabilityClass: 'SQL_INJECTION', source, sink,
        context: { entrypoint: location(route.handler), routeId: route.routeIdentity },
        sensorEvidence: [{ contractVersion: CONTRACT_VERSION, organizationId, sensorType: 'VELNAR_STRUCTURAL',
          sensorFindingId: finding.findingId, ruleId: RULE_ID,
          summary: DETECTOR_VERSION + ': source-analysis hypothesis within the closed registered-route subset.',
          sourceLocation: source, sinkLocation: sink, rawEvidenceFingerprint: analysis.resultFingerprint }],
        reachabilityState: 'REACHABLE', verificationState: 'CANDIDATE', createdAt,
      };
      const candidate = validateFindingCandidate(rawCandidate, organizationId);
      candidates.push({ candidate, candidateBinding: computeCandidateBinding(candidate, organizationId) });
    }
    return immutableCopy(candidates);
  };
}
