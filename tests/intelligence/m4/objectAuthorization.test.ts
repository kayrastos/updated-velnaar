import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { captureSnapshot, canonical, type SnapshotInput } from '../../../worker/intelligence/ingestion/snapshot';
import { ingestExpress } from '../../../worker/intelligence/ingestion/express';
import { computeCandidateBinding, validateFindingCandidate, CONTRACT_VERSION } from '../../../worker/intelligence/contracts';
import {
  detectObjectAuthorization,
  validateObjectAuthorizationAnalysis,
  validateObjectAuthAnalysis,
  createObjectAuthorizationCandidateBridge,
  createObjectAuthCandidateBridge,
  DETECTOR_VERSION,
  RULE_ID,
  OBJECT_AUTH_DETECTOR_VERSION,
  OBJECT_AUTH_RULE_ID,
} from '../../../worker/intelligence/detection/objectAuthorization';

const ORG = 'org_m4_obj_auth';
const VALID_COMMIT = '1234567890abcdef1234567890abcdef12345678';

function makeSnapshotInput(code: string, fixtureId = 'm2-case-001', orgId = ORG): SnapshotInput {
  return {
    fixtureId,
    repositoryId: 'repo-obj-auth',
    organizationId: orgId,
    files: [
      {
        path: 'src/app.ts',
        content: code,
      },
    ],
  };
}

async function analyze(code: string, fixtureId = 'm2-case-001', orgId = ORG) {
  const input = makeSnapshotInput(code, fixtureId, orgId);
  const snapshot = await captureSnapshot(input, orgId);
  const ingestion = await ingestExpress(snapshot, orgId);
  const result = await detectObjectAuthorization(snapshot, ingestion, orgId);
  return { snapshot, ingestion, result };
}

const VULN_DIRECT = `import express from 'express';

function createApp(store: any) {
  const app = express();

  function getItem(req: any, res: any) {
    const item = store.get(req.query.id);
    return res.json(item);
  }

  app.get('/item', getItem);
  return app;
}
`;

const VULN_ALIAS = `import express from 'express';

function createApp(store: any) {
  const app = express();

  function getItem(req: any, res: any) {
    const x = req.query.id;
    const y = x;
    const item = store.findById(y);
    return res.json(item);
  }

  app.get('/item', getItem);
  return app;
}
`;

const SAFE_CONST = `import express from 'express';

function createApp(store: any) {
  const app = express();

  function getItem(req: any, res: any) {
    const item = store.get('static-item-id');
    return res.json(item);
  }

  app.get('/item', getItem);
  return app;
}
`;

const SAFE_SESSION = `import express from 'express';

function createApp(store: any) {
  const app = express();

  function getItem(req: any, res: any) {
    const item = store.get(req.session.userId);
    return res.json(item);
  }

  app.get('/item', getItem);
  return app;
}
`;

const DISCONNECTED = `import express from 'express';

function createApp(store: any) {
  const app = express();

  function safeRoute(req: any, res: any) {
    return res.json('ok');
  }

  function unusedHelper(req: any, res: any) {
    const item = store.get(req.query.id);
    return res.json(item);
  }

  app.get('/safe', safeRoute);
  return app;
}
`;

const INCONCLUSIVE = `import express from 'express';

function createApp(store: any) {
  const app = express();

  function getItem(req: any, res: any) {
    while (true) {}
    const item = store.get(req.query.id);
    return res.json(item);
  }

  app.get('/item', getItem);
  return app;
}
`;

describe('M4 deterministic OBJECT_AUTHORIZATION discovery', () => {
  it('exposes canonical constants and compatibility aliases', () => {
    expect(DETECTOR_VERSION).toBe('velnar-m4-objauth-source-v1');
    expect(RULE_ID).toBe('express-request-to-unauthorized-object-access-v1');
    expect(OBJECT_AUTH_DETECTOR_VERSION).toBe(DETECTOR_VERSION);
    expect(OBJECT_AUTH_RULE_ID).toBe(RULE_ID);
    expect(validateObjectAuthAnalysis).toBe(validateObjectAuthorizationAnalysis);
    expect(createObjectAuthCandidateBridge).toBe(createObjectAuthorizationCandidateBridge);
  });

  it('1. detects direct request-derived object access', async () => {
    const { snapshot, ingestion, result } = await analyze(VULN_DIRECT);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.limitations).toEqual([]);
    const finding = result.findings[0];
    expect(finding.vulnerabilityClass).toBe('OBJECT_AUTHORIZATION');
    expect(finding.source.symbol).toBe('query.id');
    expect(finding.sink.symbol).toBe('store.get');
    expect(finding.flow[0].kind).toBe('SOURCE');
    expect(finding.flow.at(-1)!.kind).toBe('SINK');
    expect(result.snapshotId).toBe(snapshot.snapshotId);
    expect(result.ingestionIdentity).toBe(ingestion.ingestionIdentity);
    expect(result.organizationId).toBe(ORG);
    expect(result.repositoryId).toBe(snapshot.repositoryId);
    expect(result.ruleId).toBe(RULE_ID);
    expect(result.version).toBe(DETECTOR_VERSION);
  });

  it('2. secondary positive form: alias chains with intermediate variable bindings', async () => {
    const { result } = await analyze(VULN_ALIAS);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.sink.symbol).toBe('store.findById');
    const varSymbols = finding.flow.filter(s => s.kind === 'VARIABLE').map(s => s.location.symbol);
    expect(varSymbols).toEqual(['x', 'y']);
  });

  it('3. helper propagation through function call', async () => {
    const code = `import express from 'express';
function fetchFromStore(s: any, id: any) {
  return s.read(id);
}
function createApp(store: any) {
  const app = express();
  function getItem(req: any, res: any) {
    const item = fetchFromStore(store, req.query.id);
    return res.json(item);
  }
  app.get('/item', getItem);
  return app;
}
`;
    const { result } = await analyze(code);
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const kinds = result.findings[0].flow.map(s => s.kind);
    expect(kinds).toContain('CALL');
    expect(kinds).toContain('ARGUMENT');
  });

  it('4. negative control: safe constant object ID produces no finding', async () => {
    const { result } = await analyze(SAFE_CONST);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('5a. negative control: session-bound user ID produces no finding', async () => {
    const { result } = await analyze(SAFE_SESSION);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('5b. negative control: disconnected handler produces no finding', async () => {
    const { result } = await analyze(DISCONNECTED);
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
  });

  it('6. unsupported syntax fails closed with ANALYSIS_INCONCLUSIVE', async () => {
    const { result } = await analyze(INCONCLUSIVE);
    expect(result.status).toBe('ANALYSIS_INCONCLUSIVE');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toHaveLength(1);
    expect(result.limitations[0].code).toBe('UNSUPPORTED_STATEMENT');
  });

  it('7. tenant boundary: rejects foreign tenant at analysis and bridge boundaries', async () => {
    const { snapshot, ingestion, result } = await analyze(VULN_DIRECT, 'm2-case-001', ORG);
    await expect(detectObjectAuthorization(snapshot, ingestion, 'foreign_org')).rejects.toThrow();
    const bridge = createObjectAuthorizationCandidateBridge(async () => VALID_COMMIT);
    await expect(bridge(result, snapshot, ingestion, 'foreign_org')).rejects.toThrow();
  });

  it('8. snapshot boundary: rejects snapshot mismatch', async () => {
    const run1 = await analyze(VULN_DIRECT, 'm2-case-001');
    const run2 = await analyze(VULN_DIRECT, 'm2-case-002');
    await expect(detectObjectAuthorization(run1.snapshot, run2.ingestion, ORG)).rejects.toThrow('M4_ANALYSIS_SNAPSHOT_MISMATCH');
  });

  it('9. repeated analysis is deterministic and produces identical fingerprint', async () => {
    const run1 = await analyze(VULN_DIRECT);
    const run2 = await analyze(VULN_DIRECT);
    expect(run1.result).toEqual(run2.result);
    expect(run1.result.resultFingerprint).toBe(run2.result.resultFingerprint);
    const { resultFingerprint, ...body } = run1.result;
    const expectedDigest = 'sha256:' + createHash('sha256').update(DETECTOR_VERSION + '\n' + canonical(body)).digest('hex');
    expect(resultFingerprint).toBe(expectedDigest);
  });

  it('10. validateObjectAuthorizationAnalysis succeeds for unmodified analysis and rejects tampering', async () => {
    const run = await analyze(VULN_DIRECT);
    const validated = await validateObjectAuthorizationAnalysis(run.result, run.snapshot, run.ingestion, ORG);
    expect(validated).toEqual(run.result);

    const tampered: any = structuredClone(run.result);
    tampered.status = 'NOT_DETECTED';
    await expect(validateObjectAuthorizationAnalysis(tampered, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M4_ANALYSIS_INTEGRITY_MISMATCH');
  });

  it('11 & 12. createObjectAuthorizationCandidateBridge produces valid FindingCandidate hypotheses retaining CANDIDATE state', async () => {
    const run = await analyze(VULN_DIRECT);
    const bridge = createObjectAuthorizationCandidateBridge(async () => VALID_COMMIT);
    const hypotheses = await bridge(run.result, run.snapshot, run.ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const hypothesis = hypotheses[0];
    expect(hypothesis.candidate.contractVersion).toBe(CONTRACT_VERSION);
    expect(hypothesis.candidate.organizationId).toBe(ORG);
    expect(hypothesis.candidate.vulnerabilityClass).toBe('OBJECT_AUTHORIZATION');
    expect(hypothesis.candidate.reachabilityState).toBe('REACHABLE');
    expect(hypothesis.candidate.verificationState).toBe('CANDIDATE');
    expect(hypothesis.candidate.source.symbol).toBe('query.id');
    expect(hypothesis.candidate.sink.symbol).toBe('store.get');
    expect(hypothesis.candidate.snapshot.commitSha).toBe(VALID_COMMIT);
    expect(hypothesis.candidate.sensorEvidence).toHaveLength(1);
    expect(hypothesis.candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(hypothesis.candidate.sensorEvidence[0].ruleId).toBe(RULE_ID);
    expect(hypothesis.candidate.sensorEvidence[0].rawEvidenceFingerprint).toBe(run.result.resultFingerprint);
    expect(hypothesis.candidateBinding).toBe(computeCandidateBinding(hypothesis.candidate, ORG));
    expect(validateFindingCandidate(hypothesis.candidate, ORG)).toEqual(hypothesis.candidate);
  });

  it('13. bridge does not invoke commit verifier when analysis is NOT_DETECTED or ANALYSIS_INCONCLUSIVE', async () => {
    const { snapshot, ingestion, result } = await analyze(SAFE_CONST);
    expect(result.status).toBe('NOT_DETECTED');
    const verifierMock = vi.fn().mockResolvedValue(VALID_COMMIT);
    const bridge = createObjectAuthorizationCandidateBridge(verifierMock);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);
    expect(hypotheses).toEqual([]);
    expect(verifierMock).not.toHaveBeenCalled();
  });

  it('14. createObjectAuthorizationCandidateBridge rejects invalid or all-zero commitSha from verifier', async () => {
    const run = await analyze(VULN_DIRECT);
    for (const bad of ['', 'not-a-sha', '0'.repeat(40), '0'.repeat(64)]) {
      const bridge = createObjectAuthorizationCandidateBridge(async () => bad);
      await expect(bridge(run.result, run.snapshot, run.ingestion, ORG)).rejects.toThrow('M4_CHECKED_COMMIT_REQUIRED');
    }
  });
});
