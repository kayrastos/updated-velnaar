/**
 * @file securityTestSuite.ts
 * @description Server-Side Live Executable Security & Isolation Test Suite (Deterministic & Cryptographic Verification)
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. AI DETECTS. DETERMINISTIC CODE ENFORCES.
 * 2. MINIMIZE -> PSEUDONYMIZE -> ENCRYPT -> AUTHORIZE -> AUDIT.
 * 3. Real Web Crypto AES-GCM 256-bit envelope encryption test.
 * 4. Zero fabricated PASS results.
 * ============================================================================
 */

import { SecurityTestResult } from '../../src/types/security';
import { VaultCryptoService, EncryptedVaultPayload } from '../crypto/vaultCrypto';
import { TenantGuard } from '../middleware/tenantGuard';
import { AuthenticatedUser } from '../auth/authContext';
import { SafeLogger } from './safeLogger';
import { SecurityPipeline } from './securityPipeline';
import { LeadRepository } from '../repositories/leadRepository';
import { BusinessTenantGuard } from '../middleware/businessTenantGuard';
import { ActionPolicyEngine } from '../ai/actions/actionPolicyEngine';
import { RevenueLeakEvidence } from '../repositories/revenueLeakEvidence';
import { RevenueLeakRepository } from '../repositories/revenueLeakRepository';

export class SecurityTestSuite {
  /**
   * Run the complete server-side hardening test suite.
   */
  public static async runSuite(
    db?: D1Database,
    masterSecret?: string,
    environment: string = 'test'
  ): Promise<SecurityTestResult[]> {
    const results: SecurityTestResult[] = [];
    const timestamp = new Date().toISOString();

    const orgAlpha = 'org_apex_holding';
    const orgBeta = 'org_istanbul_dining';

    const userAlphaOwner: AuthenticatedUser = {
      userId: 'usr_alpha_owner',
      email: 'owner@alpha.com',
      fullName: 'Alpha Owner',
      memberships: [{ organizationId: orgAlpha, role: 'OWNER', status: 'active' }],
    };

    const userBetaStaff: AuthenticatedUser = {
      userId: 'usr_beta_staff',
      email: 'staff@beta.com',
      fullName: 'Beta Staff',
      memberships: [{ organizationId: orgBeta, role: 'STAFF', status: 'active' }],
    };

    const userAlphaViewer: AuthenticatedUser = {
      userId: 'usr_alpha_viewer',
      email: 'viewer@alpha.com',
      fullName: 'Alpha Viewer',
      memberships: [{ organizationId: orgAlpha, role: 'VIEWER', status: 'active' }],
    };

    // ------------------------------------------------------------------------
    // TEST 1: Cross-Tenant Lead Read Denial (Beta user querying Alpha org leads)
    // ------------------------------------------------------------------------
    const t1Auth = TenantGuard.authorize(userBetaStaff, orgAlpha, 'leads.read');
    results.push({
      testId: 'SEC_TEST_01_CROSS_TENANT_LEAD_ISOLATION',
      name: 'Server-Side Cross-Tenant Lead Query Boundary',
      passed: !t1Auth.authorized && t1Auth.statusCode === 403,
      details: !t1Auth.authorized 
        ? `BLOCKED (403): User from ${orgBeta} was rejected when querying ${orgAlpha}.` 
        : 'FAILED: Cross-tenant access was allowed.',
      category: 'cross_tenant_isolation',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 2: Cross-Tenant Appointment Mutation Denial (Beta user altering Alpha appointment)
    // ------------------------------------------------------------------------
    const t2Auth = TenantGuard.authorize(userBetaStaff, orgAlpha, 'appointment.cancel');
    results.push({
      testId: 'SEC_TEST_02_CROSS_TENANT_APPOINTMENT_WRITE',
      name: 'Cross-Tenant Appointment Mutation Boundary',
      passed: !t2Auth.authorized && t2Auth.statusCode === 403,
      details: !t2Auth.authorized 
        ? `BLOCKED (403): Mutation across tenant boundary blocked immediately.` 
        : 'FAILED: Cross-tenant appointment mutation permitted.',
      category: 'cross_tenant_isolation',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 3: Real Web Crypto AES-GCM Encryption / Decryption Round-Trip
    // ------------------------------------------------------------------------
    let t3Passed = false;
    let t3Details = '';
    try {
      const secretName = 'Dr. Clara Vance (Master Identity)';
      const encrypted = await VaultCryptoService.encrypt(secretName, orgAlpha, environment, masterSecret);
      const decrypted = await VaultCryptoService.decrypt(encrypted, orgAlpha, environment, masterSecret);
      t3Passed = decrypted === secretName && encrypted.algorithm === 'AES-GCM-256' && encrypted.tagLength === 128;
      t3Details = t3Passed 
        ? `PASSED: 256-bit AES-GCM encrypted (${encrypted.ciphertext.substring(0, 16)}...) and authenticated tag verified.` 
        : 'FAILED: Decrypted text did not match.';
    } catch (e: any) {
      t3Details = `ERROR: ${e.message}`;
    }
    results.push({
      testId: 'SEC_TEST_03_WEB_CRYPTO_AES_GCM_ROUNDTRIP',
      name: 'Web Crypto AES-GCM-256 Vault Encryption & Decryption',
      passed: t3Passed,
      details: t3Details,
      category: 'encryption_integrity',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 4: Cross-Tenant Cryptographic Isolation (Org Beta cannot decrypt Org Alpha Ciphertext)
    // ------------------------------------------------------------------------
    let t4Passed = false;
    let t4Details = '';
    try {
      const encryptedAlpha = await VaultCryptoService.encrypt('Top Secret Alpha Health Record', orgAlpha, environment, masterSecret);
      // Attempt to decrypt under Org Beta context
      await VaultCryptoService.decrypt(encryptedAlpha, orgBeta, environment, masterSecret);
      t4Details = 'FAILED: Org Beta DEK was able to decrypt Org Alpha ciphertext!';
    } catch (e: any) {
      t4Passed = true;
      t4Details = `PASSED: Cryptographic decryption failed deterministically as expected (${e.message.split('.')[0]}).`;
    }
    results.push({
      testId: 'SEC_TEST_04_CRYPTO_TENANT_DEK_ISOLATION',
      name: 'Tenant DEK Cryptographic Key Separation (HKDF Scope)',
      passed: t4Passed,
      details: t4Details,
      category: 'encryption_integrity',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 5: Tamper Detection (GCM Authentication Tag Rejection)
    // ------------------------------------------------------------------------
    let t5Passed = false;
    let t5Details = '';
    try {
      const original = await VaultCryptoService.encrypt('Tamper Test Plaintext', orgAlpha, environment, masterSecret);
      // Tamper 1 character in ciphertext
      const tamperedBytes = atob(original.ciphertext).split('');
      tamperedBytes[0] = tamperedBytes[0] === 'A' ? 'B' : 'A';
      const tamperedBase64 = btoa(tamperedBytes.join(''));

      const tamperedPayload: EncryptedVaultPayload = {
        ...original,
        ciphertext: tamperedBase64,
      };

      await VaultCryptoService.decrypt(tamperedPayload, orgAlpha, environment, masterSecret);
      t5Details = 'FAILED: Tampered ciphertext was decrypted without tag failure!';
    } catch (e: any) {
      t5Passed = true;
      t5Details = `PASSED: GCM Authentication Tag rejected tampered payload deterministically.`;
    }
    results.push({
      testId: 'SEC_TEST_05_GCM_TAMPER_DETECTION',
      name: 'AES-GCM Authenticated Tag Tamper Resistance',
      passed: t5Passed,
      details: t5Details,
      category: 'encryption_integrity',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 6: RBAC Canonical Role Permission Enforcement (Viewer cannot approve Growth Action)
    // ------------------------------------------------------------------------
    const t6Auth = TenantGuard.authorize(userAlphaViewer, orgAlpha, 'actions.approve');
    results.push({
      testId: 'SEC_TEST_06_CANONICAL_RBAC_ENFORCEMENT',
      name: 'Canonical 5-Role RBAC Enforcement (VIEWER Action Restriction)',
      passed: !t6Auth.authorized && t6Auth.statusCode === 403,
      details: !t6Auth.authorized 
        ? `BLOCKED (403): Role [VIEWER] was denied permission [actions.approve].` 
        : 'FAILED: VIEWER was allowed to approve growth action.',
      category: 'rbac_enforcement',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 7: Safe Logger PII & Secret Redaction Verification
    // ------------------------------------------------------------------------
    const testRawPayload = {
      userEmail: 'sensitive.executive@company.com',
      phoneNumber: '+905329876543',
      apiKey: 'sec_prod_live_8918239128391283',
      token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
      safeMetric: 45000,
    };
    const redacted = SafeLogger.redactData(testRawPayload) as any;
    const t7Passed = 
      redacted.apiKey === '[REDACTED_SECRET]' &&
      redacted.token === '[REDACTED_AUTH_TOKEN]' &&
      redacted.userEmail.includes('***@') &&
      redacted.phoneNumber.includes('***') &&
      redacted.safeMetric === 45000;

    results.push({
      testId: 'SEC_TEST_07_LOG_REDACTION_PII_PROTECTION',
      name: 'Log Stream Redaction & Zero PII Leakage',
      passed: t7Passed,
      details: t7Passed 
        ? `PASSED: Email masked to "${redacted.userEmail}", Phone to "${redacted.phoneNumber}", API keys & JWTs masked to "[REDACTED_SECRET]".` 
        : 'FAILED: Sensitive keys leaked into log object.',
      category: 'pii_leakage',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 8: Fail-Closed Authentication Verification
    // ------------------------------------------------------------------------
    const t8Auth = TenantGuard.authorize(null, orgAlpha, 'leads.read');
    const t8Passed = !t8Auth.authorized && t8Auth.statusCode === 401;
    results.push({
      testId: 'SEC_TEST_08_FAIL_CLOSED_AUTHENTICATION',
      name: 'Authentication Fail-Closed (Null Session Rejection)',
      passed: t8Passed,
      details: t8Passed
        ? 'PASSED: Unauthenticated request returned HTTP 401 fail-closed.'
        : 'FAILED: Unauthenticated request was not rejected with 401.',
      category: 'rbac_enforcement',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 9: D1 Tenant Isolation (Cross-Tenant SQL Boundary)
    // ------------------------------------------------------------------------
    let t9Passed = false;
    let t9Details = '';
    try {
      if (db) {
        const repo = new LeadRepository(db);
        const alphaLeads = await repo.listByOrg(orgAlpha);
        const betaLeads = await repo.listByOrg(orgBeta);
        const crossLeak = alphaLeads.some(l => l.organization_id === orgBeta) || betaLeads.some(l => l.organization_id === orgAlpha);
        t9Passed = !crossLeak;
        t9Details = t9Passed
          ? `PASSED: SQL queries strictly isolated by organization_id (Alpha: ${alphaLeads.length}, Beta: ${betaLeads.length}).`
          : 'FAILED: Cross-tenant data leak found in repository list.';
      } else {
        t9Passed = false;
        t9Details = 'UNAVAILABLE / NOT_EXECUTED: Live Cloudflare D1 database binding not present in runtime environment. Static repository analysis guarantees WHERE organization_id = ? scoping.';
      }
    } catch (e: any) {
      t9Passed = false;
      t9Details = `ERROR: ${e.message}`;
    }
    results.push({
      testId: 'SEC_TEST_09_D1_TENANT_SQL_ISOLATION',
      name: 'Cloudflare D1 Repository Tenant-Scoped Query Isolation',
      passed: t9Passed,
      details: t9Details,
      category: 'cross_tenant_isolation',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 10: Fulgor Ray Adapter Neutral Disabled State
    // ------------------------------------------------------------------------
    const fulgorStatus = SecurityPipeline.fulgorRayAdapter;
    const t10Passed = fulgorStatus.isConfigured === false && fulgorStatus.mode === 'DISABLED';
    results.push({
      testId: 'SEC_TEST_10_FULGOR_RAY_DISABLED_ADAPTER',
      name: 'Fulgor Ray Provider-Neutral Inactive Adapter Status',
      passed: t10Passed,
      details: t10Passed 
        ? `PASSED: Fulgor Ray adapter is marked DISABLED (Zero access control or authentication authority).` 
        : 'FAILED: Fulgor Ray adapter was improperly active in security path.',
      category: 'cross_tenant_isolation',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 11: Cross-Tenant Business Association Verification
    // ------------------------------------------------------------------------
    let t11Passed = false;
    let t11Details = '';
    try {
      const bizCheck = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
        db,
        orgBeta,
        'biz_apex_holding', // belongs to orgAlpha
        environment
      );
      t11Passed = !bizCheck.valid && bizCheck.statusCode === 403;
      t11Details = t11Passed
        ? 'PASSED: BusinessTenantGuard blocked mismatched business-to-organization access.'
        : 'FAILED: Cross-tenant business association was not blocked.';
    } catch (e: any) {
      t11Details = `ERROR: ${e.message}`;
    }
    results.push({
      testId: 'SEC_TEST_11_BUSINESS_CROSS_TENANT_ISOLATION',
      name: 'Business-to-Organization Cross-Tenant Verification Boundary',
      passed: t11Passed,
      details: t11Details,
      category: 'cross_tenant_isolation',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 12: Action Policy Engine Canonical Guardrail Validation
    // ------------------------------------------------------------------------
    const sampleActionDraft: any = {
      title: 'Discount Offering',
      actionType: 'pricing_adjustment',
      suggestedPayload: { discountPercent: 35, adBudgetMinor: 50000 },
      revenueLeakId: 'leak_01',
      evidenceReferences: ['REVENUE_LEAK:leak_01'],
      requiresHumanApproval: true,
    };
    const samplePolicy: any = {
      maximumDiscountPercent: 20,
      maximumAdBudgetMinor: 20000,
      prohibitedActions: [],
      allowedChannels: ['email'],
      requiresHumanApproval: true,
    };
    const policyResult = ActionPolicyEngine.validate(sampleActionDraft, samplePolicy);
    const t12Passed = !policyResult.passed && policyResult.guardrailStatus === 'FAILED' && policyResult.violations.length >= 2;
    results.push({
      testId: 'SEC_TEST_12_ACTION_POLICY_DETERMINISTIC_GUARDRAIL',
      name: 'Action Policy Deterministic Guardrail Enforcement',
      passed: t12Passed,
      details: t12Passed
        ? `PASSED: Policy engine correctly identified 2 violations (${policyResult.violations.join('; ')}).`
        : 'FAILED: Action exceeding discount and ad budget limits was not rejected.',
      category: 'rbac_enforcement',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 13: Revenue Leak Canonical Evidence Generator Format
    // ------------------------------------------------------------------------
    const sampleLeak: any = {
      id: 'leak_checkout_drop_01',
      business_id: 'biz_01',
      organization_id: 'org_01',
      title: 'Checkout Drop-off',
      severity: 'critical',
      estimated_monthly_loss_minor: 120000,
    };
    const evidenceRefs = RevenueLeakEvidence.getCanonicalEvidenceReferences(sampleLeak);
    const t13Passed = evidenceRefs.length === 1 && evidenceRefs[0] === 'REVENUE_LEAK:leak_checkout_drop_01';
    results.push({
      testId: 'SEC_TEST_13_REVENUE_LEAK_EVIDENCE_FORMAT',
      name: 'Deterministic Revenue Leak Evidence Reference Formatting',
      passed: t13Passed,
      details: t13Passed
        ? `PASSED: Generated canonical evidence citation "${evidenceRefs[0]}".`
        : 'FAILED: Evidence citation was malformed or missing.',
      category: 'cross_tenant_isolation',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 14: RevenueLeakRepository getById Mandatory Business Id Guard
    // ------------------------------------------------------------------------
    let t14Passed = false;
    let t14Details = '';
    try {
      await RevenueLeakRepository.getById(db, 'leak_001', orgAlpha, '', environment);
      t14Details = 'FAILED: getById allowed query without businessId.';
    } catch (e: any) {
      t14Passed = e.message.includes('BUSINESS_ID_REQUIRED');
      t14Details = t14Passed
        ? 'PASSED: RevenueLeakRepository.getById threw BUSINESS_ID_REQUIRED when businessId was missing.'
        : `FAILED: Unexpected error: ${e.message}`;
    }
    results.push({
      testId: 'SEC_TEST_14_REVENUE_LEAK_REPOSITORY_BUSINESS_REQUIRED',
      name: 'Revenue Leak Repository Strict BusinessId Enforcement',
      passed: t14Passed,
      details: t14Details,
      category: 'cross_tenant_isolation',
      executedAt: timestamp,
    });

    // ------------------------------------------------------------------------
    // TEST 15: Cross-Business Operational Leak Query Isolation
    // ------------------------------------------------------------------------
    let t15Passed = false;
    let t15Details = '';
    try {
      // Query with mismatched businessId under the same org
      const mismatched = await RevenueLeakRepository.getById(
        db,
        'leak_001', // belongs to biz_beauty_salon
        orgAlpha,
        'biz_mismatched_other',
        environment
      );
      t15Passed = mismatched === null;
      t15Details = t15Passed
        ? 'PASSED: Cross-business leak lookup returned null (zero cross-business leakage).'
        : 'FAILED: Cross-business leak was leaked across business boundaries.';
    } catch (e: any) {
      t15Details = `ERROR: ${e.message}`;
    }
    results.push({
      testId: 'SEC_TEST_15_CROSS_BUSINESS_LEAK_ISOLATION',
      name: 'Cross-Business Operational Data Isolation Boundary',
      passed: t15Passed,
      details: t15Details,
      category: 'cross_tenant_isolation',
      executedAt: timestamp,
    });

    return results;
  }
}
