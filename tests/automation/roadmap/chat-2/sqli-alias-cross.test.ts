import { describe, expect, it, vi } from 'vitest';
import { detectSqlInjection, validateSqlAnalysis } from '../../../../worker/intelligence/detection/sqlInjection';
import { createSqlCandidateBridge } from '../../../../worker/intelligence/detection/candidate';
import {
  computeCandidateBinding,
  createVerificationState,
  validateFindingCandidate,
} from '../../../../worker/intelligence/contracts';
import { analyzeInput, input, ORG } from '../../../intelligence/m3/support/inputs';

function makeCrossFileAliasInput(options?: {
  serviceTaint?: boolean;
  repoTaint?: boolean;
  routeTaint?: boolean;
}) {
  const routeTaint = options?.routeTaint ?? true;
  const serviceTaint = options?.serviceTaint ?? true;
  const repoTaint = options?.repoTaint ?? true;

  const routesContent = `import express from 'express';
import { lookupUser } from './service';

export function createApp(db: any) {
  const app = express();
  function searchRoute(req: any, res: any) {
    const routeParam = ${routeTaint ? 'req.query.q' : '"clean_route"'};
    const routeAlias1 = routeParam;
    const routeAlias2 = routeAlias1;
    return res.json(lookupUser(db, routeAlias2));
  }
  app.get('/search', searchRoute);
  return app;
}
`;

  const serviceContent = `import { queryDatabase } from './repository';

export function lookupUser(db: any, term: string) {
  const serviceParam = ${serviceTaint ? 'term' : '"clean_service"'};
  const serviceAlias1 = serviceParam;
  const serviceAlias2 = serviceAlias1;
  return queryDatabase(db, serviceAlias2);
}
`;

  const repositoryContent = `export function queryDatabase(db: any, queryParam: string) {
  const repoParam = ${repoTaint ? 'queryParam' : '"clean_repo"'};
  const repoAlias1 = repoParam;
  const repoAlias2 = repoAlias1;
  return db.prepare("SELECT * FROM users WHERE name = '" + repoAlias2 + "'").all();
}
`;

  return {
    fixtureId: 'm2-case-007',
    repositoryId: 'repo_m3',
    organizationId: ORG,
    files: [
      { path: 'src/routes.ts', content: routesContent },
      { path: 'src/service.ts', content: serviceContent },
      { path: 'src/repository.ts', content: repositoryContent },
    ],
  };
}

describe('roadmap chat-2: SQL injection cross-file alias propagation', () => {
  it('propagates tainted variable alias chains across routes, service, and repository files', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(makeCrossFileAliasInput());
    expect(result.status).toBe('DETECTED');
    expect(result.limitations).toEqual([]);
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.source.symbol).toBe('query.q');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect(finding.sink.symbol).toBe('db.prepare');

    const filePaths = new Set(finding.flow.map(step => step.location.filePath));
    expect(filePaths).toEqual(new Set(['src/routes.ts', 'src/service.ts', 'src/repository.ts']));

    const variableSteps = finding.flow.filter(step => step.kind === 'VARIABLE');
    expect(variableSteps.map(step => step.location.symbol)).toEqual([
      'routeParam',
      'routeAlias1',
      'routeAlias2',
      'serviceParam',
      'serviceAlias1',
      'serviceAlias2',
      'repoParam',
      'repoAlias1',
      'repoAlias2',
    ]);

    expect(variableSteps.filter(s => s.location.filePath === 'src/routes.ts').map(s => s.location.symbol)).toEqual([
      'routeParam',
      'routeAlias1',
      'routeAlias2',
    ]);
    expect(variableSteps.filter(s => s.location.filePath === 'src/service.ts').map(s => s.location.symbol)).toEqual([
      'serviceParam',
      'serviceAlias1',
      'serviceAlias2',
    ]);
    expect(variableSteps.filter(s => s.location.filePath === 'src/repository.ts').map(s => s.location.symbol)).toEqual([
      'repoParam',
      'repoAlias1',
      'repoAlias2',
    ]);

    const validated = await validateSqlAnalysis(result, snapshot, ingestion, ORG);
    expect(validated).toEqual(result);
  });

  it('safe constant in intermediate service breaks cross-file alias taint chain', async () => {
    const { result } = await analyzeInput(makeCrossFileAliasInput({ serviceTaint: false }));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('safe constant in repository layer breaks cross-file alias taint chain', async () => {
    const { result } = await analyzeInput(makeCrossFileAliasInput({ repoTaint: false }));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('safe constant at route entrypoint prevents cross-file taint flow', async () => {
    const { result } = await analyzeInput(makeCrossFileAliasInput({ routeTaint: false }));
    expect(result.status).toBe('NOT_DETECTED');
    expect(result.findings).toEqual([]);
    expect(result.limitations).toEqual([]);
  });

  it('baseline opaque cross-file fixture retains end-to-end multi-file provenance', async () => {
    const { result } = await analyzeInput(input(6));
    expect(result.status).toBe('DETECTED');
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.source.filePath).toBe('src/routes.ts');
    expect(finding.sink.filePath).toBe('src/repository.ts');
    expect([...new Set(finding.flow.map(step => step.location.filePath))]).toEqual([
      'src/routes.ts',
      'src/service.ts',
      'src/repository.ts',
    ]);
  });

  it('bridge converts cross-file alias detection into bound CANDIDATE finding without elevating authority', async () => {
    const checkedCommit = '46db4c208f886afda939c04ae93580fbabd57344';
    const { snapshot, ingestion, result } = await analyzeInput(makeCrossFileAliasInput());
    const bridge = createSqlCandidateBridge(async () => checkedCommit);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toHaveLength(1);
    const { candidate, candidateBinding } = hypotheses[0];
    expect(candidate.verificationState).toBe('CANDIDATE');
    expect(candidate.vulnerabilityClass).toBe('SQL_INJECTION');
    expect(candidate.reachabilityState).toBe('REACHABLE');
    expect(candidate.snapshot.commitSha).toBe(checkedCommit);
    expect(candidate.source.filePath).toBe('src/routes.ts');
    expect(candidate.sink.filePath).toBe('src/repository.ts');
    expect(candidate.sensorEvidence[0].sensorType).toBe('VELNAR_STRUCTURAL');
    expect(candidateBinding).toBe(computeCandidateBinding(candidate, ORG));
    expect(validateFindingCandidate(candidate, ORG)).toEqual(candidate);
    expect(createVerificationState(candidate, ORG).state).toBe('CANDIDATE');
  });

  it('bridge produces no candidate when alias taint is broken', async () => {
    const { snapshot, ingestion, result } = await analyzeInput(makeCrossFileAliasInput({ serviceTaint: false }));
    const verify = vi.fn();
    const bridge = createSqlCandidateBridge(verify);
    const hypotheses = await bridge(result, snapshot, ingestion, ORG);

    expect(hypotheses).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  });
});
