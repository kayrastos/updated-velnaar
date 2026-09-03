import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Security Verification Snapshot & Code Integrity', () => {
  const rootDir = path.resolve(__dirname, '../..');

  it('Production security files must all exist and fail if missing', () => {
    const requiredSecurityFiles = [
      'src/services/tenantSecurity.ts',
      'worker/middleware/tenantGuard.ts',
      'worker/security/securityTestSuite.ts',
    ];

    for (const relPath of requiredSecurityFiles) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Required security file missing: ${relPath}`).toBe(true);
    }
  });

  it('Frontend TenantSecurityEngine must call Worker API and not return static fabricated PASS', () => {
    const tenantSecurityPath = path.join(rootDir, 'src/services/tenantSecurity.ts');
    expect(fs.existsSync(tenantSecurityPath), 'src/services/tenantSecurity.ts must exist').toBe(true);

    const content = fs.readFileSync(tenantSecurityPath, 'utf-8');

    // Must call real Worker API via ApiClient
    expect(content).toContain('ApiClient.runSecurityTests');
    expect(content).toContain('runCrossTenantTestsAsync');

    // Must not contain fabricated static PASS mocks
    expect(content).not.toContain('return { passed: true } // mock');
    expect(content).not.toContain('return [{ passed: true }]');

    // Must perform deterministic client-side RBAC validation helper
    expect(content).toContain('authorize');
    expect(content).toContain('isActionAllowedForRole');
    expect(content).toContain('Cross-Tenant Access Denied');
  });

  it('TenantGuard middleware must enforce deterministic fail-closed auth and RBAC', () => {
    const tenantGuardPath = path.join(rootDir, 'worker/middleware/tenantGuard.ts');
    expect(fs.existsSync(tenantGuardPath), 'worker/middleware/tenantGuard.ts must exist').toBe(true);

    const content = fs.readFileSync(tenantGuardPath, 'utf-8');

    // Must reject unauthenticated and cross-tenant attempts with deterministic codes
    expect(content).not.toContain('return { authorized: true } // bypass');
    expect(content).toContain('UNAUTHENTICATED');
    expect(content).toContain('CROSS_TENANT_ACCESS_DENIED');
    expect(content).toContain('authorization.denied');
    expect(content).toContain('statusCode: 401');
    expect(content).toContain('statusCode: 403');
  });

  it('Server SecurityTestSuite must execute real cryptographic and RBAC verifications', () => {
    const testSuitePath = path.join(rootDir, 'worker/security/securityTestSuite.ts');
    expect(fs.existsSync(testSuitePath), 'worker/security/securityTestSuite.ts must exist').toBe(true);

    const content = fs.readFileSync(testSuitePath, 'utf-8');

    // Must perform real WebCrypto envelope encryption & decryption
    expect(content).toContain('VaultCryptoService.encrypt');
    expect(content).toContain('VaultCryptoService.decrypt');
    expect(content).toContain('AES-GCM-256');

    // Must evaluate real TenantGuard authorization
    expect(content).toContain('TenantGuard.authorize');

    // Must test log redaction with SafeLogger
    expect(content).toContain('SafeLogger.redactData');

    // Must contain standard test IDs
    expect(content).toContain('SEC_TEST_01_CROSS_TENANT_LEAD_ISOLATION');
    expect(content).toContain('SEC_TEST_03_WEB_CRYPTO_AES_GCM_ROUNDTRIP');
    expect(content).toContain('SEC_TEST_06_CANONICAL_RBAC_ENFORCEMENT');
  });
});
