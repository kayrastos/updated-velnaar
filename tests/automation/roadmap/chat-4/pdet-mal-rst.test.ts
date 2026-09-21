import { describe, it, expect } from 'vitest';
import {
  captureSnapshot,
  validateSnapshot,
  type SourceSnapshot,
} from '../../../../worker/intelligence/ingestion/snapshot';
import {
  ingestExpress,
} from '../../../../worker/intelligence/ingestion/express';
import {
  detectSqlInjection,
} from '../../../../worker/intelligence/detection/sqlInjection';
import {
  createSqlCandidateBridge,
} from '../../../../worker/intelligence/detection/candidate';
import {
  validateRepositoryIngestion,
  isTrustedCommitCapability,
  assertTrustedCommitCapability,
  type RepositoryIngestion,
} from '../../../../worker/intelligence/ingestion/repository';

const ORG = 'org_pdet_mal_rst';
const REPO = 'repo-pdet-mal-rst';
const FIXTURE = 'm2-case-001';

const VALID_APP_SOURCE = `
import express from 'express';

function healthHandler(req: any, res: any) {
  return;
}

export function createApp(db: any) {
  const app = express();
  app.get('/health', healthHandler);
  return app;
}
`;

const MALFORMED_SYNTAX_SOURCE = `
import express from 'express';
function broken( {
`;

const MALFORMED_ROUTER_SOURCE = `
import express from 'express';

function pingHandler(req: any, res: any) {
  return;
}

export function createApp(db: any) {
  const app = express();
  const router = express.Router();
  router.get('/ping', pingHandler);
  return app;
}
`;

const MALFORMED_ROUTE_PATH_SOURCE = `
import express from 'express';

function invalidPathHandler(req: any, res: any) {
  return;
}

export function createApp(db: any) {
  const app = express();
  app.get('no-leading-slash', invalidPathHandler);
  return app;
}
`;

describe('V1 Pipeline Determinism: Malformed Input Restart and Resume (RM_PDET_MAL_RST)', () => {
  it('re-executes malformed source syntax deterministically across restart cycles without state leakage', async () => {
    const malformedInput = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: MALFORMED_SYNTAX_SOURCE }],
    };

    const snapshot = await captureSnapshot(malformedInput, ORG);

    for (let restartCycle = 1; restartCycle <= 3; restartCycle++) {
      let caughtError: unknown = null;
      try {
        await ingestExpress(snapshot, ORG);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe('M2_INGESTION_ERROR: malformed source unit');
    }
  });

  it('fails closed deterministically on unmounted router across restart cycles and recovers on valid input', async () => {
    const malformedInput = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: MALFORMED_ROUTER_SOURCE }],
    };

    const malformedSnapshot = await captureSnapshot(malformedInput, ORG);

    await expect(ingestExpress(malformedSnapshot, ORG)).rejects.toThrow('unmounted router');
    await expect(ingestExpress(malformedSnapshot, ORG)).rejects.toThrow('unmounted router');

    const validInput = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: VALID_APP_SOURCE }],
    };

    const validSnapshot = await captureSnapshot(validInput, ORG);
    const validIngestion = await ingestExpress(validSnapshot, ORG);
    expect(validIngestion.routes.length).toBe(1);
    expect(validIngestion.routes[0].path).toBe('/health');

    await expect(ingestExpress(malformedSnapshot, ORG)).rejects.toThrow('unmounted router');
  });

  it('fails closed deterministically on malformed route paths across resume attempts', async () => {
    const malformedInput = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: MALFORMED_ROUTE_PATH_SOURCE }],
    };

    const snapshot = await captureSnapshot(malformedInput, ORG);

    for (let i = 0; i < 3; i++) {
      await expect(ingestExpress(snapshot, ORG)).rejects.toThrow(
        'literal bounded route path required',
      );
    }
  });

  it('rejects tampered or corrupted snapshot checkpoints deterministically upon resume', async () => {
    const validInput = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: VALID_APP_SOURCE }],
    };

    const originalSnapshot = await captureSnapshot(validInput, ORG);

    const corruptedSnapshot: SourceSnapshot = {
      ...originalSnapshot,
      files: [
        {
          ...originalSnapshot.files[0],
          content: 'export const altered = true;\n',
        },
      ],
    };

    for (let resumeAttempt = 1; resumeAttempt <= 3; resumeAttempt++) {
      await expect(validateSnapshot(corruptedSnapshot, ORG)).rejects.toThrow(
        'snapshot integrity mismatch',
      );
      await expect(ingestExpress(corruptedSnapshot, ORG)).rejects.toThrow(
        'snapshot integrity mismatch',
      );
    }
  });

  it('rejects cross-snapshot resume mismatch deterministically in detection stage', async () => {
    const inputA = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: VALID_APP_SOURCE }],
    };
    const inputB = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: 'export function createApp(db: any) { const app = (require("express"))(); return app; }\n' }],
    };

    const snapshotA = await captureSnapshot(inputA, ORG);
    const snapshotB = await captureSnapshot(inputB, ORG);
    const ingestionA = await ingestExpress(snapshotA, ORG);

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(detectSqlInjection(snapshotB, ingestionA, ORG)).rejects.toThrow(
        'M3_ANALYSIS_SNAPSHOT_MISMATCH',
      );
    }
  });

  it('rejects tampered analysis result and malformed commit SHA in candidate bridge resume', async () => {
    const validInput = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: VALID_APP_SOURCE }],
    };

    const snapshot = await captureSnapshot(validInput, ORG);
    const ingestion = await ingestExpress(snapshot, ORG);
    const analysis = await detectSqlInjection(snapshot, ingestion, ORG);

    const tamperedAnalysis = {
      ...analysis,
      status: 'DETECTED',
      findings: [
        {
          routeIdentity: ingestion.routes[0].routeIdentity,
          vulnerabilityClass: 'SQL_INJECTION',
          source: ingestion.routes[0].handler,
          sink: ingestion.routes[0].handler,
          flow: [],
          findingId: 'sha256:' + 'a'.repeat(64),
        },
      ],
    };

    const genuineVerifier = async () => 'a'.repeat(40);
    const bridge = createSqlCandidateBridge(genuineVerifier);

    for (let i = 0; i < 3; i++) {
      await expect(
        bridge(tamperedAnalysis, snapshot, ingestion, ORG),
      ).rejects.toThrow('M3_ANALYSIS_INTEGRITY_MISMATCH');
    }

    const malformedCommitVerifier = async () => '0'.repeat(40);
    const malformedCommitBridge = createSqlCandidateBridge(malformedCommitVerifier);
    const candidates = await malformedCommitBridge(analysis, snapshot, ingestion, ORG);
    expect(candidates).toEqual([]);
  });

  it('rejects malformed repository ingestion records deterministically without minting capability', async () => {
    const validInput = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: VALID_APP_SOURCE }],
    };

    const snapshot = await captureSnapshot(validInput, ORG);

    const malformedRecord = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: ORG,
      repositoryId: REPO,
      commitSha: 'not-a-valid-sha',
      snapshot,
      ingestionIdentity: 'sha256:' + 'f'.repeat(64),
    };

    for (let restart = 0; restart < 3; restart++) {
      await expect(
        validateRepositoryIngestion(malformedRecord, ORG),
      ).rejects.toThrow('Git commit identity');

      expect(isTrustedCommitCapability(undefined, malformedRecord as unknown as RepositoryIngestion)).toBe(false);
      expect(() =>
        assertTrustedCommitCapability(undefined, malformedRecord as unknown as RepositoryIngestion),
      ).toThrow('unauthorized commit capability');
    }
  });

  it('rejects foreign tenant metadata in resumed repository ingestion record', async () => {
    const validInput = {
      fixtureId: FIXTURE,
      repositoryId: REPO,
      organizationId: ORG,
      files: [{ path: 'src/app.ts', content: VALID_APP_SOURCE }],
    };

    const snapshot = await captureSnapshot(validInput, ORG);

    const foreignTenantRecord = {
      version: 'velnar-repository-ingestion-v1',
      organizationId: 'foreign_org',
      repositoryId: REPO,
      commitSha: 'a'.repeat(40),
      snapshot,
      ingestionIdentity: 'sha256:' + '0'.repeat(64),
    };

    for (let restart = 0; restart < 3; restart++) {
      await expect(
        validateRepositoryIngestion(foreignTenantRecord, ORG),
      ).rejects.toThrow('tenant mismatch');
    }
  });
});
