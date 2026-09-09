/**
 * @file tests/security/phaseA12B2C5U33BProductionOperationalAuth.test.ts
 * @description Phase A.12B.2C-5U.3.3B-R Production Operational Authentication Foundation Security Tests
 *
 * Mandate: Offline cryptographic certification of Cloudflare Access JWT verification,
 * fail-closed operational identity validation, and operational-superadmin registry foundation.
 *
 * HARDENED REPAIR MANDATES (5U.3.3B-R):
 * - Zero caller-injected trust root in canonical production wrapper.
 * - Genuine mocked-fetch offline test for canonical remote JWKS resolution.
 * - True local JWKS unknown-kid test distinct from wrong-public-key test.
 * - Granular JWKS/internal error classification (JWKS_UNAVAILABLE, AUTH_INTERNAL_FAILURE).
 * - Full JWT claims stripped from exported result.
 * - Static redaction of registry duplicate-subject diagnostic reason.
 * - Documented Cloudflare service-token shape rejection.
 * - ES256 and PS256 explicit algorithm rejection.
 * - Array audience positive and negative tests.
 * - Temporal relationship hardening (exp <= iat, nbf > exp).
 * - Instrumented fetch spy and source-inspected provider/D1 isolation (no vacuous assertions).
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateKeyPair,
  SignJWT,
  exportJWK,
  createLocalJWKSet,
  type GenerateKeyPairResult,
} from 'jose';
import {
  verifyCloudflareAccessIdentity,
  verifyCloudflareAccessRequest,
  resolveCanonicalProductionOperationalPrincipal,
  validateCloudflareAccessConfig,
  validateSuperAdminRegistry,
  authorizeOperationalPrincipalAgainstRegistry,
  isValidEmail,
  PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY,
  OperationalAuthErrorCode,
  OPERATIONAL_AUTH_ERROR_MESSAGES,
  MAX_ACCESS_JWT_LENGTH_BYTES,
  CLOCK_TOLERANCE_SECONDS,
  ALLOWED_JWT_ALGORITHM,
  EXPECTED_TOKEN_TYPE,
  CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL,
  type OperationalSuperAdminEntry,
  type ValidatedCloudflareAccessConfig,
  type OperationalAuthFailure,
} from '../../worker/auth/cloudflareAccessOperationalAuth';
import { AuthContextService } from '../../worker/auth/authContext';
import {
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED,
  PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY,
} from '../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
} from '../../worker/ai/canary/canarySpecification';
import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import { PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED } from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import { RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED } from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';
import {
  D1_REPLAY_BACKEND_PRODUCTION_BOUND,
  D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED,
  D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED,
} from '../../worker/ai/canary/d1AuthorizationReplayBackend';
import { DEEPSEEK_FIRST_PROVIDER_STRATEGY } from '../../worker/ai/canary/deepSeekFirstProviderStrategy';

describe('Phase A.12B.2C-5U.3.3B-R: Hardened Production Operational Authentication Foundation', () => {
  const TEST_TEAM_DOMAIN = 'https://velnar-test.cloudflareaccess.com';
  const TEST_AUD = 'test-aud-64char-hex-operational-canary-lane-1234567890abcdef12345678';
  const TEST_CONFIG: ValidatedCloudflareAccessConfig = {
    teamDomain: TEST_TEAM_DOMAIN,
    expectedIssuer: TEST_TEAM_DOMAIN,
    expectedAudience: TEST_AUD,
    jwksUrl: `${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`,
  };

  let primaryKeyPair: GenerateKeyPairResult;
  let secondaryKeyPair: GenerateKeyPairResult;
  let attackerKeyPair: GenerateKeyPairResult;

  beforeAll(async () => {
    // Generate isolated in-memory RSA keypairs for offline testing (strictly zero external network)
    primaryKeyPair = await generateKeyPair('RS256');
    secondaryKeyPair = await generateKeyPair('RS256');
    attackerKeyPair = await generateKeyPair('RS256');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Helper to construct synthetic Access JWTs
   */
  async function createSyntheticAccessJwt(overrides: {
    sub?: string | null;
    email?: string | null;
    type?: string | null;
    iss?: string | null;
    aud?: string | string[] | null;
    exp?: number | null;
    iat?: number | null;
    nbf?: number | null;
    alg?: string;
    kid?: string;
    key?: any;
    omitSub?: boolean;
    omitEmail?: boolean;
    omitExp?: boolean;
    omitIat?: boolean;
    extraClaims?: Record<string, unknown>;
  } = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const key = overrides.key ?? primaryKeyPair.privateKey;
    const alg = overrides.alg ?? 'RS256';

    const payload: Record<string, unknown> = {
      ...(overrides.extraClaims ?? {}),
    };

    if (!overrides.omitSub) {
      payload.sub = overrides.sub !== undefined ? overrides.sub : 'sub-ops-admin-01';
    }
    if (!overrides.omitEmail) {
      payload.email = overrides.email !== undefined ? overrides.email : 'ops.admin@velnar.io';
    }
    if (overrides.type !== null) {
      payload.type = overrides.type !== undefined ? overrides.type : 'app';
    }

    const signer = new SignJWT(payload);
    const protectedHeader: Record<string, unknown> = { alg };
    if (overrides.kid) {
      protectedHeader.kid = overrides.kid;
    }
    signer.setProtectedHeader(protectedHeader as any);

    if (overrides.iss !== null) {
      signer.setIssuer(overrides.iss !== undefined ? overrides.iss : TEST_TEAM_DOMAIN);
    }
    if (overrides.aud !== null) {
      signer.setAudience(overrides.aud !== undefined ? (overrides.aud as any) : TEST_AUD);
    }
    if (!overrides.omitExp && overrides.exp !== null) {
      signer.setExpirationTime(overrides.exp !== undefined ? overrides.exp : now + 3600);
    }
    if (!overrides.omitIat && overrides.iat !== null) {
      signer.setIssuedAt(overrides.iat !== undefined ? overrides.iat : now);
    }
    if (overrides.nbf !== undefined && overrides.nbf !== null) {
      signer.setNotBefore(overrides.nbf);
    }

    return signer.sign(key);
  }

  // ==========================================================================
  // SECTION A: TOKEN & CLAIMS CRYPTOGRAPHIC VALIDATION
  // ==========================================================================
  describe('Group A: Cryptographic Token & Claims Validation', () => {
    it('1. valid RS256 token passes cryptographic identity validation', async () => {
      const token = await createSyntheticAccessJwt();
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.principal.subject).toBe('sub-ops-admin-01');
        expect(result.principal.email).toBe('ops.admin@velnar.io');
        expect(result.principal.authSource).toBe('CLOUDFLARE_ACCESS');
        expect(result.principal.isSuperAdmin).toBe(false);
        // Repair 6: Assert full JWT claims are NOT exposed in result
        expect('claims' in result).toBe(false);
        expect((result as any).claims).toBeUndefined();
      }
    });

    it('2. missing token rejected (null / undefined)', async () => {
      const resNull = await verifyCloudflareAccessIdentity(null, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(resNull.success).toBe(false);
      if (!resNull.success) {
        expect((resNull as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.MISSING_TOKEN);
        expect((resNull as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.MISSING_TOKEN);
      }

      const resUndef = await verifyCloudflareAccessIdentity(undefined, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(resUndef.success).toBe(false);
      if (!resUndef.success) {
        expect((resUndef as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.MISSING_TOKEN);
      }
    });

    it('3. empty token rejected', async () => {
      const resEmpty = await verifyCloudflareAccessIdentity('', TEST_CONFIG, primaryKeyPair.publicKey);
      expect(resEmpty.success).toBe(false);
      if (!resEmpty.success) {
        expect((resEmpty as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.MISSING_TOKEN);
      }

      const resWhitespace = await verifyCloudflareAccessIdentity('   ', TEST_CONFIG, primaryKeyPair.publicKey);
      expect(resWhitespace.success).toBe(false);
      if (!resWhitespace.success) {
        expect((resWhitespace as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.MISSING_TOKEN);
      }
    });

    it('4. oversized token rejected (> 16 KiB ceiling)', async () => {
      const hugePadding = 'A'.repeat(MAX_ACCESS_JWT_LENGTH_BYTES);
      const token = await createSyntheticAccessJwt({
        extraClaims: { padding: hugePadding },
      });
      expect(new TextEncoder().encode(token).length).toBeGreaterThan(MAX_ACCESS_JWT_LENGTH_BYTES);

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.TOKEN_TOO_LARGE);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_TOO_LARGE);
      }
    });

    it('5. malformed 3-segment structure rejected', async () => {
      const malformedCases = [
        'single-segment-string',
        'part1.part2',
        'part1.part2.part3.part4',
        'part1..part3',
        '.part2.part3',
        'part1.part2.',
      ];

      for (const malformed of malformedCases) {
        const result = await verifyCloudflareAccessIdentity(malformed, TEST_CONFIG, primaryKeyPair.publicKey);
        expect(result.success, `Malformed case should fail: ${malformed}`).toBe(false);
        if (!result.success) {
          expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.MALFORMED_TOKEN);
        }
      }
    });

    it('6. modified payload after signing rejected (tampered payload)', async () => {
      const token = await createSyntheticAccessJwt();
      const parts = token.split('.');
      const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'hacker', email: 'hacker@evil.com', type: 'app' })).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const result = await verifyCloudflareAccessIdentity(tamperedToken, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SIGNATURE_INVALID);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.SIGNATURE_INVALID);
      }
    });

    it('7. modified signature rejected', async () => {
      const token = await createSyntheticAccessJwt();
      const parts = token.split('.');
      const tamperedSig = parts[2].slice(0, -4) + 'AAAA';
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;

      const result = await verifyCloudflareAccessIdentity(tamperedToken, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SIGNATURE_INVALID);
      }
    });

    it('8a. WRONG_PUBLIC_KEY_REJECTED (direct public key mismatch)', async () => {
      // Signed with primary key, verified directly against secondary key
      const token = await createSyntheticAccessJwt({ key: primaryKeyPair.privateKey });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, secondaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SIGNATURE_INVALID);
      }
    });

    it('8b. UNKNOWN_KID_LOCAL_JWKS_REJECTED (Repair 3: true local JWKS kid selection test)', async () => {
      // Local JWKS contains key A with kid='known-key-01'
      const jwkA = await exportJWK(primaryKeyPair.publicKey);
      jwkA.alg = 'RS256';
      jwkA.kid = 'known-key-01';
      const localJwks = createLocalJWKSet({ keys: [jwkA] });

      // Token signed with secondary key with kid='unknown-key-99'
      const token = await createSyntheticAccessJwt({
        key: secondaryKeyPair.privateKey,
        kid: 'unknown-key-99',
      });

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, localJwks);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SIGNATURE_INVALID);
      }
    });

    it('9. HS256 algorithm rejected', async () => {
      const secret = new TextEncoder().encode('super-secret-hmac-key-minimum-32-chars-long!');
      const hmacToken = await new SignJWT({
        sub: 'sub-ops-admin-01',
        email: 'ops.admin@velnar.io',
        type: 'app',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(TEST_TEAM_DOMAIN)
        .setAudience(TEST_AUD)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      const result = await verifyCloudflareAccessIdentity(hmacToken, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.ALGORITHM_NOT_ALLOWED);
      }
    });

    it('9b. ES256 algorithm rejected (Repair 12)', async () => {
      const esKp = await generateKeyPair('ES256');
      const esJwt = await new SignJWT({
        sub: 'sub-ops-admin-01',
        email: 'ops.admin@velnar.io',
        type: 'app',
      })
        .setProtectedHeader({ alg: 'ES256' })
        .setIssuer(TEST_TEAM_DOMAIN)
        .setAudience(TEST_AUD)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(esKp.privateKey);

      const result = await verifyCloudflareAccessIdentity(esJwt, TEST_CONFIG, esKp.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED);
      }
    });

    it('9c. PS256 algorithm rejected (Repair 12)', async () => {
      const psKp = await generateKeyPair('PS256');
      const psJwt = await new SignJWT({
        sub: 'sub-ops-admin-01',
        email: 'ops.admin@velnar.io',
        type: 'app',
      })
        .setProtectedHeader({ alg: 'PS256' })
        .setIssuer(TEST_TEAM_DOMAIN)
        .setAudience(TEST_AUD)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(psKp.privateKey);

      const result = await verifyCloudflareAccessIdentity(psJwt, TEST_CONFIG, psKp.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED);
      }
    });

    it('10. alg none rejected (unsigned token)', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        sub: 'sub-ops-admin-01',
        email: 'ops.admin@velnar.io',
        type: 'app',
        iss: TEST_TEAM_DOMAIN,
        aud: TEST_AUD,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      })).toString('base64url');
      const unsignedToken = `${header}.${payload}.`;

      const result = await verifyCloudflareAccessIdentity(unsignedToken, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED);
      }
    });

    it('11. wrong issuer rejected', async () => {
      const token = await createSyntheticAccessJwt({ iss: 'https://imposter.cloudflareaccess.com' });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.ISSUER_MISMATCH);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.ISSUER_MISMATCH);
      }
    });

    it('12. wrong audience rejected (string audience)', async () => {
      const token = await createSyntheticAccessJwt({ aud: 'wrong-audience-uuid-value' });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.AUDIENCE_MISMATCH);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.AUDIENCE_MISMATCH);
      }
    });

    it('12b. array audience positive test (Repair 13)', async () => {
      // Cloudflare Access may return aud as array of client IDs
      const token = await createSyntheticAccessJwt({
        aud: ['unrelated-aud-client-id', TEST_AUD],
      });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.principal.subject).toBe('sub-ops-admin-01');
      }
    });

    it('12c. array audience negative test (Repair 13)', async () => {
      const token = await createSyntheticAccessJwt({
        aud: ['unrelated-aud-1', 'unrelated-aud-2'],
      });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.AUDIENCE_MISMATCH);
      }
    });

    it('13. expired token rejected', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createSyntheticAccessJwt({
        iat: now - 3600,
        exp: now - 60, // Expired 60s ago (> 5s tolerance)
      });

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.TOKEN_EXPIRED);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_EXPIRED);
      }
    });

    it('14. future nbf rejected', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createSyntheticAccessJwt({
        nbf: now + 300, // Valid only in 5 minutes
      });

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.TOKEN_NOT_YET_VALID);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_NOT_YET_VALID);
      }
    });

    it('15. materially future iat rejected', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createSyntheticAccessJwt({
        iat: now + 120, // 2 minutes in the future (> 5s clock skew)
      });

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.IAT_INVALID);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.IAT_INVALID);
      }
    });

    it('15b. temporal relationship hardening: exp <= iat rejected (Repair 15)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createSyntheticAccessJwt({
        iat: now,
        exp: now, // exp === iat (invalid lifecycle)
      });

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.IAT_INVALID);
      }
    });

    it('15c. temporal relationship hardening: nbf > exp rejected (Repair 15)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createSyntheticAccessJwt({
        iat: now,
        exp: now + 600,
        nbf: now + 1200, // nbf after exp
      });

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.TOKEN_NOT_YET_VALID);
      }
    });

    it('16. missing exp rejected', async () => {
      const token = await createSyntheticAccessJwt({ omitExp: true });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.TOKEN_EXPIRED);
      }
    });

    it('17. missing iat rejected', async () => {
      const token = await createSyntheticAccessJwt({ omitIat: true });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.IAT_INVALID);
      }
    });

    it('18. missing sub rejected', async () => {
      const token = await createSyntheticAccessJwt({ omitSub: true });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.HUMAN_SUBJECT_REQUIRED);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.HUMAN_SUBJECT_REQUIRED);
      }
    });

    it('19. empty sub rejected', async () => {
      const token = await createSyntheticAccessJwt({ sub: '   ' });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.HUMAN_SUBJECT_REQUIRED);
      }
    });

    it('20. missing email rejected', async () => {
      const token = await createSyntheticAccessJwt({ omitEmail: true });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.EMAIL_REQUIRED);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.EMAIL_REQUIRED);
      }
    });

    it('21. invalid email rejected (conservative operational syntax validation)', async () => {
      const invalidEmails = ['not-an-email', 'missing@domain', '@missinguser.com', 'has spaces@domain.com'];
      for (const email of invalidEmails) {
        const token = await createSyntheticAccessJwt({ email });
        const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

        expect(result.success, `Invalid email should be rejected: ${email}`).toBe(false);
        if (!result.success) {
          expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.EMAIL_REQUIRED);
        }
      }
    });

    it('21b. locks conservative email-validation terminology and forbids full RFC 5322 compliance claims', async () => {
      // 1. Independently verify and lock the canonical JSON evidence contract
      const jsonEvidencePath = path.resolve(
        __dirname,
        '../../execution/a12b2c5u33b_production_operational_authentication_foundation.json'
      );
      const rawJson = fs.readFileSync(jsonEvidencePath, 'utf8');
      const jsonEvidence = JSON.parse(rawJson);

      expect(jsonEvidence.cryptographicPolicy).toBeDefined();
      expect(jsonEvidence.cryptographicPolicy.emailSyntaxRFC5322Enforced).toBe(false);
      expect(jsonEvidence.cryptographicPolicy.emailSyntaxConservativeBoundedValidation).toBe(true);
      expect(jsonEvidence.cryptographicPolicy.maxEmailLengthCharacters).toBe(320);
      expect('maxEmailLengthBytes' in jsonEvidence.cryptographicPolicy).toBe(false);
      expect((jsonEvidence.cryptographicPolicy as Record<string, unknown>).maxEmailLengthBytes).toBeUndefined();
      expect(rawJson).not.toContain('maxEmailLengthBytes');

      // 2. Inspect Markdown evidence: locks conservative/bounded terminology & forbids full RFC 5322 claims
      const mdEvidencePath = path.resolve(
        __dirname,
        '../../execution/a12b2c5u33b_production_operational_authentication_foundation.md'
      );
      const mdEvidence = fs.readFileSync(mdEvidencePath, 'utf8');

      expect(mdEvidence).toContain('conservative bounded operational email syntax description (<= 320 characters)');
      expect(mdEvidence).toContain('Replaced false RFC 5322 claims');
      expect(mdEvidence).not.toMatch(/RFC\s*5322\s+(?:compliant|compliance|enforced|parsing|parser)/i);

      // 3. Inspect worker implementation source: comments and code forbid RFC 5322 compliance claims
      const authModulePath = path.resolve(
        __dirname,
        '../../worker/auth/cloudflareAccessOperationalAuth.ts'
      );
      const authModuleSource = fs.readFileSync(authModulePath, 'utf8');

      expect(authModuleSource).toContain('Conservative bounded operational email syntax validation (<= 320 chars)');
      expect(authModuleSource).not.toContain('5322');
      expect(authModuleSource).not.toMatch(/RFC\s*5322/i);

      // 4. Bind assertions to actual implementation semantics in worker/auth/cloudflareAccessOperationalAuth.ts:
      // A. JavaScript string-length bound of 320 characters (character count, not bytes)
      const boundaryValidEmail = `${'a'.repeat(310)}@velnar.io`; // 310 + 10 = 320 characters
      expect(boundaryValidEmail.length).toBe(320);
      expect(isValidEmail(boundaryValidEmail)).toBe(true);

      const boundaryInvalidEmail = `${'a'.repeat(311)}@velnar.io`; // 311 + 10 = 321 characters
      expect(boundaryInvalidEmail.length).toBe(321);
      expect(isValidEmail(boundaryInvalidEmail)).toBe(false);

      // B. Rejection of RFC 5322 exotic forms (demonstrating non-claim of full RFC 5322 parsing)
      const rfc5322FormsRejected = [
        '"quoted.local"@velnar.io',
        'user(comment)@velnar.io',
        'user@[192.168.1.1]',
        'user@localdomain',
      ];
      for (const nonConservativeEmail of rfc5322FormsRejected) {
        expect(isValidEmail(nonConservativeEmail)).toBe(false);
      }

      // C. Bind to full verification pipeline (JWT assertion path)
      const validToken = await createSyntheticAccessJwt({ email: boundaryValidEmail });
      const validResult = await verifyCloudflareAccessIdentity(validToken, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(validResult.success).toBe(true);
      if (validResult.success) {
        expect(validResult.principal.email).toBe(boundaryValidEmail);
      }

      const invalidLengthToken = await createSyntheticAccessJwt({ email: boundaryInvalidEmail });
      const invalidLengthResult = await verifyCloudflareAccessIdentity(invalidLengthToken, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(invalidLengthResult.success).toBe(false);
      if (!invalidLengthResult.success) {
        expect((invalidLengthResult as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.EMAIL_REQUIRED);
      }

      const rfcFormToken = await createSyntheticAccessJwt({ email: '"quoted.local"@velnar.io' });
      const rfcFormResult = await verifyCloudflareAccessIdentity(rfcFormToken, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(rfcFormResult.success).toBe(false);
      if (!rfcFormResult.success) {
        expect((rfcFormResult as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.EMAIL_REQUIRED);
      }
    });

    it('22. token type != app rejected', async () => {
      const badTypes = ['session', 'user', 'service', 'admin', ''];
      for (const badType of badTypes) {
        const token = await createSyntheticAccessJwt({ type: badType });
        const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

        expect(result.success, `Invalid type should be rejected: ${badType}`).toBe(false);
        if (!result.success) {
          expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.TOKEN_TYPE_INVALID);
        }
      }
    });

    it('23a. documented Cloudflare service-token shape rejected (Repair 9: sub="" & no email)', async () => {
      // Documented Cloudflare service-token application JWT shape: type=app, sub="", common_name=client_id, no email
      const documentedServiceToken = await createSyntheticAccessJwt({
        sub: '',
        omitEmail: true,
        extraClaims: { common_name: 'service-token-app-id-12345' },
      });
      const result = await verifyCloudflareAccessIdentity(documentedServiceToken, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect([
          OperationalAuthErrorCode.HUMAN_SUBJECT_REQUIRED,
          OperationalAuthErrorCode.EMAIL_REQUIRED,
          OperationalAuthErrorCode.TOKEN_TYPE_INVALID,
        ]).toContain((result as OperationalAuthFailure).code);
      }
    });

    it('23b. defensive service-token heuristics rejected (Repair 9)', async () => {
      const serviceToken1 = await createSyntheticAccessJwt({
        extraClaims: { identity_type: 'service_token' },
      });
      const res1 = await verifyCloudflareAccessIdentity(serviceToken1, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect((res1 as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.TOKEN_TYPE_INVALID);
      }

      const serviceToken2 = await createSyntheticAccessJwt({
        extraClaims: { service_token: true },
      });
      const res2 = await verifyCloudflareAccessIdentity(serviceToken2, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect((res2 as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.TOKEN_TYPE_INVALID);
      }
    });

    it('23c. request header extraction helper works for Request instance', async () => {
      const token = await createSyntheticAccessJwt();
      const request = new Request('https://worker.velnar.io/api/ops/canary/deepseek-certification', {
        headers: {
          [CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL]: token,
        },
      });

      const result = await verifyCloudflareAccessRequest(request, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.principal.subject).toBe('sub-ops-admin-01');
      }
    });
  });

  // ==========================================================================
  // SECTION A-REPAIR: THROWING RESOLVER & ERROR CLASSIFICATION (Repairs 4 & 5)
  // ==========================================================================
  describe('Group A-Repair: Throwing Resolver & Error Classification (Repairs 4 & 5)', () => {
    it('throws generic Error -> AUTH_INTERNAL_FAILURE', async () => {
      const token = await createSyntheticAccessJwt();
      const throwingResolver = async () => {
        throw new Error('Unexpected internal explosion');
      };

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, throwingResolver as any);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.AUTH_INTERNAL_FAILURE);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.AUTH_INTERNAL_FAILURE);
      }
    });

    it('throws ERR_JWKS_TIMEOUT -> JWKS_UNAVAILABLE', async () => {
      const token = await createSyntheticAccessJwt();
      const timeoutResolver = async () => {
        const err = new Error('JWKS timeout');
        (err as any).code = 'ERR_JWKS_TIMEOUT';
        throw err;
      };

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, timeoutResolver as any);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.JWKS_UNAVAILABLE);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.JWKS_UNAVAILABLE);
      }
    });

    it('throws ERR_JWKS_INVALID -> AUTH_INTERNAL_FAILURE', async () => {
      const token = await createSyntheticAccessJwt();
      const invalidJwksResolver = async () => {
        const err = new Error('JWKS invalid');
        (err as any).code = 'ERR_JWKS_INVALID';
        throw err;
      };

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, invalidJwksResolver as any);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.AUTH_INTERNAL_FAILURE);
      }
    });

    it('network fetch failure -> JWKS_UNAVAILABLE', async () => {
      const token = await createSyntheticAccessJwt();
      const networkErrorResolver = async () => {
        throw new TypeError('fetch failed: connect ECONNREFUSED');
      };

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, networkErrorResolver as any);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.JWKS_UNAVAILABLE);
      }
    });

    it('ERR_JOSE_GENERIC misclassification prevented (fails closed as AUTH_INTERNAL_FAILURE)', async () => {
      const token = await createSyntheticAccessJwt();
      const genericJoseResolver = async () => {
        const err = new Error('Generic JOSE failure');
        (err as any).code = 'ERR_JOSE_GENERIC';
        throw err;
      };

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, genericJoseResolver as any);
      expect(result.success).toBe(false);
      if (!result.success) {
        // Must NOT become ALGORITHM_NOT_ALLOWED
        expect((result as OperationalAuthFailure).code).not.toBe(OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED);
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.AUTH_INTERNAL_FAILURE);
      }
    });
  });

  // ==========================================================================
  // SECTION B: ENVIRONMENT CONFIGURATION VALIDATION
  // ==========================================================================
  describe('Group B: Cloudflare Access Environment Configuration Validation', () => {
    it('24. missing team domain fails closed', () => {
      const result = validateCloudflareAccessConfig({ CLOUDFLARE_ACCESS_AUD: TEST_AUD });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.CONFIG_NOT_READY);
      }
    });

    it('25. HTTP team domain rejected (must be HTTPS)', () => {
      const result = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'http://velnar-test.cloudflareaccess.com',
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.CONFIG_NOT_READY);
      }
    });

    it('26. deceptive hostname rejected (e.g. evilcloudflareaccess.com)', () => {
      const result = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://evilcloudflareaccess.com',
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.CONFIG_NOT_READY);
      }
    });

    it('27. subdomain confusion rejected', () => {
      const confusingDomains = [
        'https://velnar-test.cloudflareaccess.com.attacker.com',
        'https://velnar.cloudflareaccess.com.evil.io',
        'https://sub.sub.velnar-test.cloudflareaccess.com',
        'https://.cloudflareaccess.com',
      ];

      for (const domain of confusingDomains) {
        const result = validateCloudflareAccessConfig({
          CLOUDFLARE_ACCESS_TEAM_DOMAIN: domain,
          CLOUDFLARE_ACCESS_AUD: TEST_AUD,
        });
        expect(result.ok, `Domain should be rejected: ${domain}`).toBe(false);
      }
    });

    it('28. query/fragment/path rejected in team domain', () => {
      const badDomains = [
        'https://velnar-test.cloudflareaccess.com?query=1',
        'https://velnar-test.cloudflareaccess.com#fragment',
        'https://velnar-test.cloudflareaccess.com/path/to/resource',
        'https://user:pass@velnar-test.cloudflareaccess.com',
        'https://velnar-test.cloudflareaccess.com:8443',
      ];

      for (const domain of badDomains) {
        const result = validateCloudflareAccessConfig({
          CLOUDFLARE_ACCESS_TEAM_DOMAIN: domain,
          CLOUDFLARE_ACCESS_AUD: TEST_AUD,
        });
        expect(result.ok, `Should reject URI with query/fragment/path/port: ${domain}`).toBe(false);
      }
    });

    it('29. missing AUD rejected', () => {
      const result = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.CONFIG_NOT_READY);
      }
    });

    it('30. empty or whitespace AUD rejected', () => {
      const resEmpty = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: '',
      });
      expect(resEmpty.ok).toBe(false);

      const resWhitespace = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: '   ',
      });
      expect(resWhitespace.ok).toBe(false);
    });

    it('30b. valid configuration normalizes canonical origin and certs URL', () => {
      const result = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://velnar-test.cloudflareaccess.com/',
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.teamDomain).toBe(TEST_TEAM_DOMAIN);
        expect(result.config.expectedIssuer).toBe(TEST_TEAM_DOMAIN);
        expect(result.config.expectedAudience).toBe(TEST_AUD);
        expect(result.config.jwksUrl).toBe('https://velnar-test.cloudflareaccess.com/cdn-cgi/access/certs');
      }
    });
  });

  // ==========================================================================
  // SECTION C: OPERATIONAL SUPERADMIN AUTHORIZATION REGISTRY
  // ==========================================================================
  describe('Group C: Operational Superadmin Authorization Registry', () => {
    it('31. canonical registry initially empty and frozen', () => {
      expect(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY).toBeDefined();
      expect(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY).toHaveLength(0);
      expect(Object.isFrozen(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY)).toBe(true);
    });

    it('32. verified human identity + empty registry => denied (fail closed)', () => {
      const principal = { subject: 'sub-ops-admin-01', email: 'ops.admin@velnar.io' };
      const result = authorizeOperationalPrincipalAgainstRegistry(principal, []);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SUPERADMIN_REGISTRY_EMPTY);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.SUPERADMIN_REGISTRY_EMPTY);
      }
    });

    it('33. subject not present in synthetic registry => denied', () => {
      const syntheticRegistry: readonly OperationalSuperAdminEntry[] = [
        {
          accessSubject: 'other-enrolled-subject',
          expectedEmail: 'other@velnar.io',
          status: 'active',
        },
      ];
      const principal = { subject: 'unregistered-subject', email: 'ops.admin@velnar.io' };
      const result = authorizeOperationalPrincipalAgainstRegistry(principal, syntheticRegistry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED);
      }
    });

    it('34. matching email but wrong subject => denied', () => {
      const syntheticRegistry: readonly OperationalSuperAdminEntry[] = [
        {
          accessSubject: 'authorized-subject-uuid-1',
          expectedEmail: 'founder@velnar.io',
          status: 'active',
        },
      ];
      const principal = { subject: 'attacker-subject-uuid-2', email: 'founder@velnar.io' };
      const result = authorizeOperationalPrincipalAgainstRegistry(principal, syntheticRegistry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED);
      }
    });

    it('35. matching subject but wrong bound email => denied (IDENTITY_BINDING_MISMATCH)', () => {
      const syntheticRegistry: readonly OperationalSuperAdminEntry[] = [
        {
          accessSubject: 'authorized-subject-uuid-1',
          expectedEmail: 'founder@velnar.io',
          status: 'active',
        },
      ];
      const principal = { subject: 'authorized-subject-uuid-1', email: 'hijacked@other.com' };
      const result = authorizeOperationalPrincipalAgainstRegistry(principal, syntheticRegistry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.IDENTITY_BINDING_MISMATCH);
        expect((result as OperationalAuthFailure).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.IDENTITY_BINDING_MISMATCH);
      }
    });

    it('36. active exact registry match => synthetic authorization helper returns superadmin', () => {
      const syntheticRegistry: readonly OperationalSuperAdminEntry[] = [
        {
          accessSubject: 'authorized-subject-uuid-1',
          expectedEmail: 'ops.admin@velnar.io',
          status: 'active',
        },
      ];
      const principal = { subject: 'authorized-subject-uuid-1', email: 'ops.admin@velnar.io' };
      const result = authorizeOperationalPrincipalAgainstRegistry(principal, syntheticRegistry);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.principal.subject).toBe('authorized-subject-uuid-1');
        expect(result.principal.email).toBe('ops.admin@velnar.io');
        expect(result.principal.isSuperAdmin).toBe(true);
      }
    });

    it('37. inactive/suspended registry entry => denied', () => {
      const syntheticRegistry: readonly OperationalSuperAdminEntry[] = [
        {
          accessSubject: 'suspended-subject-uuid-1',
          expectedEmail: 'ops.admin@velnar.io',
          status: 'suspended',
        },
      ];
      const principal = { subject: 'suspended-subject-uuid-1', email: 'ops.admin@velnar.io' };
      const result = authorizeOperationalPrincipalAgainstRegistry(principal, syntheticRegistry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED);
      }
    });

    it('38. duplicate subject registry fails validation & reason is strictly redacted (Repair 7)', () => {
      const duplicateSubjectValue = 'sensitive-subject-identifier-007';
      const duplicateRegistry: readonly OperationalSuperAdminEntry[] = [
        {
          accessSubject: duplicateSubjectValue,
          expectedEmail: 'first@velnar.io',
          status: 'active',
        },
        {
          accessSubject: duplicateSubjectValue,
          expectedEmail: 'second@velnar.io',
          status: 'active',
        },
      ];

      const validation = validateSuperAdminRegistry(duplicateRegistry);
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        // Assert static reason
        expect((validation as any).reason).toBe('Duplicate accessSubject detected in registry');
        // Assert duplicate subject string is strictly redacted
        expect((validation as any).reason).not.toContain(duplicateSubjectValue);
      }

      const principal = { subject: duplicateSubjectValue, email: 'first@velnar.io' };
      const authResult = authorizeOperationalPrincipalAgainstRegistry(principal, duplicateRegistry);
      expect(authResult.success).toBe(false);
    });

    it('39a. canonical production wrapper API arity confirms ZERO resolver parameters (Repair 1)', () => {
      // Signature must be strictly (tokenOrRequest, env)
      expect(resolveCanonicalProductionOperationalPrincipal.length).toBe(2);
    });

    it('39b. canonical production wrapper: offline positive path with mocked JWKS (Repair 2)', async () => {
      const canonicalJwk = await exportJWK(primaryKeyPair.publicKey);
      canonicalJwk.alg = 'RS256';
      canonicalJwk.kid = 'canonical-key-01';

      // Mock global fetch strictly for synthetic JWKS endpoint
      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const urlStr = input.toString();
        if (urlStr === 'https://velnar-test.cloudflareaccess.com/cdn-cgi/access/certs') {
          return new Response(JSON.stringify({ keys: [canonicalJwk] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      });
      vi.stubGlobal('fetch', fetchSpy);

      const token = await createSyntheticAccessJwt({ kid: 'canonical-key-01' });
      const env = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      const result = await resolveCanonicalProductionOperationalPrincipal(token, env);

      // Cryptographic verification succeeded; authorization fails because canonical registry is empty
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SUPERADMIN_REGISTRY_EMPTY);
      }

      // Assert fetch was called only for the expected endpoint
      expect(fetchSpy).toHaveBeenCalled();
      expect(fetchSpy.mock.calls.length).toBe(1);
      expect(fetchSpy.mock.calls[0][0].toString()).toBe(
        'https://velnar-test.cloudflareaccess.com/cdn-cgi/access/certs'
      );
    });

    it('39c. attacker trust-root substitution regression: third argument strictly ignored (Repairs 1 & 2)', async () => {
      const canonicalJwk = await exportJWK(primaryKeyPair.publicKey);
      canonicalJwk.alg = 'RS256';
      canonicalJwk.kid = 'canonical-key-01';

      // Canonical mocked JWKS contains ONLY canonical public key
      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const urlStr = input.toString();
        if (urlStr === 'https://velnar-test.cloudflareaccess.com/cdn-cgi/access/certs') {
          return new Response(JSON.stringify({ keys: [canonicalJwk] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      });
      vi.stubGlobal('fetch', fetchSpy);

      // Forged token signed with attacker private key
      const attackerToken = await createSyntheticAccessJwt({
        key: attackerKeyPair.privateKey,
        kid: 'attacker-key-66',
      });

      const env = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      // Attacker attempts to inject custom resolver via untyped JavaScript call
      const attackerResolver = attackerKeyPair.publicKey;
      const result = await (resolveCanonicalProductionOperationalPrincipal as any)(
        attackerToken,
        env,
        attackerResolver
      );

      // Must fail closed because attacker resolver is ignored and token fails against canonical JWKS
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as OperationalAuthFailure).code).toBe(OperationalAuthErrorCode.SIGNATURE_INVALID);
      }
    });

    it('40. tenant OWNER role cannot influence operational superadmin result', async () => {
      const tenantUser = AuthContextService.resolveSessionUser('Bearer dev_owner_token', 'development');
      expect(tenantUser).not.toBeNull();
      expect(tenantUser?.memberships[0].role).toBe('OWNER');

      const syntheticRegistry: readonly OperationalSuperAdminEntry[] = [];
      const operationalAttempt = authorizeOperationalPrincipalAgainstRegistry(
        { subject: tenantUser!.userId, email: tenantUser!.email },
        syntheticRegistry
      );
      expect(operationalAttempt.success).toBe(false);
    });

    it('41. tenant ADMIN role cannot influence operational superadmin result', async () => {
      const tenantUser = AuthContextService.resolveSessionUser('Bearer test_user:admin_1:org_1:ADMIN', 'test');
      expect(tenantUser).not.toBeNull();
      expect(tenantUser?.memberships[0].role).toBe('ADMIN');

      const syntheticRegistry: readonly OperationalSuperAdminEntry[] = [];
      const operationalAttempt = authorizeOperationalPrincipalAgainstRegistry(
        { subject: tenantUser!.userId, email: tenantUser!.email },
        syntheticRegistry
      );
      expect(operationalAttempt.success).toBe(false);
    });
  });

  // ==========================================================================
  // SECTION D: ISOLATION & NON-REGRESSION (Repair 11: Instrumented Verification)
  // ==========================================================================
  describe('Group D: Isolation, Non-Regression & Instrumented Verification', () => {
    it('42. instrumented network isolation: pure low-level verifiers execute zero fetch calls', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const token = await createSyntheticAccessJwt();
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(true);
      // Instrumented check: low-level offline verification MUST perform 0 network fetches
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('43. source-inspected provider isolation: operational auth module has zero AI provider references', () => {
      const authModulePath = path.resolve(__dirname, '../../worker/auth/cloudflareAccessOperationalAuth.ts');
      const content = fs.readFileSync(authModulePath, 'utf8');

      expect(content).not.toContain('DEEPSEEK_API_KEY');
      expect(content).not.toContain('GEMINI_API_KEY');
      expect(content).not.toContain('KIMI_API_KEY');
      expect(content).not.toContain('api.deepseek.com');
      expect(content).not.toContain('generativelanguage.googleapis.com');
    });

    it('44. source-inspected D1 isolation: operational auth module has zero D1 database references', () => {
      const authModulePath = path.resolve(__dirname, '../../worker/auth/cloudflareAccessOperationalAuth.ts');
      const content = fs.readFileSync(authModulePath, 'utf8');

      expect(content).not.toContain('D1Database');
      expect(content).not.toContain('.prepare(');
      expect(content).not.toContain('d1AuthorizationReplayBackend');
    });

    it('45. worker/index.ts has zero integration with operational access auth in 5U.3.3B-R', () => {
      const workerIndexPath = path.resolve(__dirname, '../../worker/index.ts');
      const workerIndexContent = fs.readFileSync(workerIndexPath, 'utf8');

      expect(workerIndexContent).not.toContain('cloudflareAccessOperationalAuth');
      expect(workerIndexContent).not.toContain('resolveCanonicalProductionOperationalPrincipal');
      expect(workerIndexContent).not.toContain('verifyCloudflareAccessIdentity');
    });

    it('46. existing AuthContextService dev/test behavior remains completely unchanged', () => {
      const devUser = AuthContextService.resolveSessionUser('Bearer dev_owner_token', 'development');
      expect(devUser).not.toBeNull();
      expect(devUser?.userId).toBe('usr_dev_owner');
      expect(devUser?.memberships[0].role).toBe('OWNER');

      const testUser = AuthContextService.resolveSessionUser('Bearer test_user:test_u:test_o:MANAGER', 'test');
      expect(testUser).not.toBeNull();
      expect(testUser?.memberships[0].role).toBe('MANAGER');
    });

    it('47. existing production AuthContextService still rejects unverified external bearer tokens', () => {
      const prodUser = AuthContextService.resolveSessionUser('Bearer external_jwt_token_here', 'production');
      expect(prodUser).toBeNull();

      const prodTestUser = AuthContextService.resolveSessionUser('Bearer test_user:u:o:OWNER', 'production');
      expect(prodTestUser).toBeNull();
    });

    it('48. production operational registry contains exactly zero real identities', () => {
      expect(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY).toHaveLength(0);
    });

    it('49. all inspected relevant production/readiness/live conditions remain closed (Repair 10: 12 conditions)', () => {
      // 1. Operational Route Enabled
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
      // 2. Operational Ingress Auth Ready
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
      // 3. Canary Live Execution Enabled
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      // 4. Canary Live Execution State Blocked
      expect(CANARY_LIVE_EXECUTION_STATE as string).not.toBe('LIVE_EXECUTION_ALLOWED');
      // 5. Guarded Source Attestation Ready
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
      // 6. Guarded Human Auth Attestation Ready
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
      // 7. Production Authority Trust Anchor Provisioned
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
      // 8. Runtime Source Provenance Trust Anchor Provisioned
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
      // 9. D1 Replay Backend Production Bound
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(true);
      // 10. D1 Replay Backend Real Database Provisioned
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(true);
      // 11. D1 Replay Backend Real Concurrency Certified
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(false);
      // 12. Production Routing Enforcement Allowed
      expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.productionRoutingEnforcementAllowed).toBe(false);
    });
  });
});
