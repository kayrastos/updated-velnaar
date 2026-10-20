import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEALED_RECOVERY_AUTHORIZER_V3_SHA256,
  SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256,
} from '../../../scripts/fulgor/orchestration/taskClassRecoveryAuthorityCheckBridge';
import { SEALED_RECOVERY_CALL_GATE_V3_SHA256 } from '../../../scripts/fulgor/orchestration/taskClassRecoveryEffectGateBridge';

describe('sealed V3 contract in an audit-enforced disposable fixture', () => {
  it('tests copies with no production state, subprocess, or network capability', () => {
    const root = mkdtempSync(join(tmpdir(), 'velnar-v3-'));
    const sources = process.env.VELNAR_RECOVERY_V3_TEST_SOURCE ?? join(homedir(), '.local/libexec');
    try {
      const pins = [
        ['velnar-task-class-recovery-authorize.py', SEALED_RECOVERY_AUTHORIZER_V3_SHA256],
        ['velnar_recovery_authority_common.py', SEALED_RECOVERY_AUTHORITY_COMMON_V3_SHA256],
        ['velnar-task-class-recovery-call-gate.py', SEALED_RECOVERY_CALL_GATE_V3_SHA256],
      ];
      for (const [filename, digest] of pins) {
        const source = join(sources, filename);
        expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(digest);
        copyFileSync(source, join(root, filename));
      }
      copyFileSync(join(sources, 'velnar-recovery-foundation-v3.json'), join(root, 'velnar-recovery-foundation-v3.json'));
      copyFileSync(join(import.meta.dirname, 'fixtures/recoveryAuthorityV3.py'), join(root, 'fixture.py'));
      let output: string;
      try { output = execFileSync('/usr/bin/python3', ['-B', join(root, 'fixture.py')], {
        cwd: root, env: { HOME: root, PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' },
        encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
      });
      } catch (error) {
        throw new Error('SEALED_V3_ISOLATED_FIXTURE_FAILED: ' + String((error as { stdout?: unknown }).stdout ?? error));
      }
      const result = JSON.parse(output);
      expect(result).toMatchObject({ tests: 38, failures: 0, errors: 0 });
      expect(result.fixtureAuthorizationCreations).toBeGreaterThan(0);
      console.info(`SEALED_V3_FIXTURE_TESTS=${result.tests}/${result.tests} PASS; FIXTURE_AUTHORIZATION_CREATIONS=${result.fixtureAuthorizationCreations}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
