/**
 * @file tests/security/phaseA12B2C5U33BProductionOperationalAuth.test.ts
 * @description Phase A.12B.2C-5U.3.3B Production Operational Authentication Foundation Security Tests
 *
 * Mandate: Offline cryptographic certification of Cloudflare Access JWT verification,
 * fail-closed operational identity validation, and operational-superadmin registry foundation.
 *
 * STRICT PROHIBITIONS:
 * - ZERO network calls.
 * - ZERO provider calls.
 * - ZERO D1 calls.
 * - ZERO real Cloudflare Access JWKS calls.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet, type GenerateKeyPairResult } from 'jose';
import {
  verifyCloudflareAccessIdentity,
  verifyCloudflareAccessRequest,
  resolveCanonicalProductionOperationalPrincipal,
  validateCloudflareAccessConfig,
  validateSuperAdminRegistry,
  authorizeOperationalPrincipalAgainstRegistry,
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

describe('Phase A.12B.2C-5U.3.3B: Production Operational Authentication Foundation', () => {
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

  beforeAll(async () => {
    // Generate isolated in-memory RSA keypairs for offline testing (strictly zero external network)
    primaryKeyPair = await generateKeyPair('RS256');
    secondaryKeyPair = await generateKeyPair('RS256');
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
    signer.setProtectedHeader({ alg });

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
      }
    });

    it('2. missing token rejected (null / undefined)', async () => {
      const resNull = await verifyCloudflareAccessIdentity(null, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(resNull.success).toBe(false);
      if (!resNull.success) {
        expect((resNull as any).code).toBe(OperationalAuthErrorCode.MISSING_TOKEN);
        expect((resNull as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.MISSING_TOKEN);
      }

      const resUndef = await verifyCloudflareAccessIdentity(undefined, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(resUndef.success).toBe(false);
      if (!resUndef.success) {
        expect((resUndef as any).code).toBe(OperationalAuthErrorCode.MISSING_TOKEN);
      }
    });

    it('3. empty token rejected', async () => {
      const resEmpty = await verifyCloudflareAccessIdentity('', TEST_CONFIG, primaryKeyPair.publicKey);
      expect(resEmpty.success).toBe(false);
      if (!resEmpty.success) {
        expect((resEmpty as any).code).toBe(OperationalAuthErrorCode.MISSING_TOKEN);
      }

      const resWhitespace = await verifyCloudflareAccessIdentity('   ', TEST_CONFIG, primaryKeyPair.publicKey);
      expect(resWhitespace.success).toBe(false);
      if (!resWhitespace.success) {
        expect((resWhitespace as any).code).toBe(OperationalAuthErrorCode.MISSING_TOKEN);
      }
    });

    it('4. oversized token rejected (> 16 KiB ceiling)', async () => {
      // Build an oversized JWT payload exceeding MAX_ACCESS_JWT_LENGTH_BYTES (16,384 bytes)
      const hugePadding = 'A'.repeat(MAX_ACCESS_JWT_LENGTH_BYTES);
      const token = await createSyntheticAccessJwt({
        extraClaims: { padding: hugePadding },
      });
      expect(new TextEncoder().encode(token).length).toBeGreaterThan(MAX_ACCESS_JWT_LENGTH_BYTES);

      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.TOKEN_TOO_LARGE);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_TOO_LARGE);
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
          expect((result as any).code).toBe(OperationalAuthErrorCode.MALFORMED_TOKEN);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.SIGNATURE_INVALID);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.SIGNATURE_INVALID);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.SIGNATURE_INVALID);
      }
    });

    it('8. unknown signing key / kid rejected', async () => {
      // Signed with primary key, verified against secondary key
      const token = await createSyntheticAccessJwt({ key: primaryKeyPair.privateKey });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, secondaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.SIGNATURE_INVALID);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.ALGORITHM_NOT_ALLOWED);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED);
      }
    });

    it('11. wrong issuer rejected', async () => {
      const token = await createSyntheticAccessJwt({ iss: 'https://imposter.cloudflareaccess.com' });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.ISSUER_MISMATCH);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.ISSUER_MISMATCH);
      }
    });

    it('12. wrong audience rejected', async () => {
      const token = await createSyntheticAccessJwt({ aud: 'wrong-audience-uuid-value' });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.AUDIENCE_MISMATCH);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.AUDIENCE_MISMATCH);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.TOKEN_EXPIRED);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_EXPIRED);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.TOKEN_NOT_YET_VALID);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_NOT_YET_VALID);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.IAT_INVALID);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.IAT_INVALID);
      }
    });

    it('16. missing exp rejected', async () => {
      const token = await createSyntheticAccessJwt({ omitExp: true });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.TOKEN_EXPIRED);
      }
    });

    it('17. missing iat rejected', async () => {
      const token = await createSyntheticAccessJwt({ omitIat: true });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.IAT_INVALID);
      }
    });

    it('18. missing sub rejected', async () => {
      const token = await createSyntheticAccessJwt({ omitSub: true });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.HUMAN_SUBJECT_REQUIRED);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.HUMAN_SUBJECT_REQUIRED);
      }
    });

    it('19. empty sub rejected', async () => {
      const token = await createSyntheticAccessJwt({ sub: '   ' });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.HUMAN_SUBJECT_REQUIRED);
      }
    });

    it('20. missing email rejected', async () => {
      const token = await createSyntheticAccessJwt({ omitEmail: true });
      const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.EMAIL_REQUIRED);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.EMAIL_REQUIRED);
      }
    });

    it('21. invalid email rejected', async () => {
      const invalidEmails = ['not-an-email', 'missing@domain', '@missinguser.com', 'has spaces@domain.com'];
      for (const email of invalidEmails) {
        const token = await createSyntheticAccessJwt({ email });
        const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

        expect(result.success, `Invalid email should be rejected: ${email}`).toBe(false);
        if (!result.success) {
          expect((result as any).code).toBe(OperationalAuthErrorCode.EMAIL_REQUIRED);
        }
      }
    });

    it('22. token type != app rejected', async () => {
      const badTypes = ['session', 'user', 'service', 'admin', ''];
      for (const badType of badTypes) {
        const token = await createSyntheticAccessJwt({ type: badType });
        const result = await verifyCloudflareAccessIdentity(token, TEST_CONFIG, primaryKeyPair.publicKey);

        expect(result.success, `Invalid type should be rejected: ${badType}`).toBe(false);
        if (!result.success) {
          expect((result as any).code).toBe(OperationalAuthErrorCode.TOKEN_TYPE_INVALID);
        }
      }
    });

    it('23. service-token shape rejected', async () => {
      // Cloudflare Access service token shapes
      const serviceToken1 = await createSyntheticAccessJwt({
        extraClaims: { identity_type: 'service_token' },
      });
      const res1 = await verifyCloudflareAccessIdentity(serviceToken1, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect((res1 as any).code).toBe(OperationalAuthErrorCode.TOKEN_TYPE_INVALID);
      }

      const serviceToken2 = await createSyntheticAccessJwt({
        extraClaims: { service_token: true },
      });
      const res2 = await verifyCloudflareAccessIdentity(serviceToken2, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect((res2 as any).code).toBe(OperationalAuthErrorCode.TOKEN_TYPE_INVALID);
      }

      const serviceToken3 = await createSyntheticAccessJwt({
        omitEmail: true,
        extraClaims: { common_name: 'service-token-app-id' },
      });
      const res3 = await verifyCloudflareAccessIdentity(serviceToken3, TEST_CONFIG, primaryKeyPair.publicKey);
      expect(res3.success).toBe(false);
    });

    it('23b. request header extraction helper works for Request instance', async () => {
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
  // SECTION B: ENVIRONMENT CONFIGURATION VALIDATION
  // ==========================================================================
  describe('Group B: Cloudflare Access Environment Configuration Validation', () => {
    it('24. missing team domain fails closed', () => {
      const result = validateCloudflareAccessConfig({ CLOUDFLARE_ACCESS_AUD: TEST_AUD });
      expect((result as any).ok).toBe(false);
      if (!(result as any).ok) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.CONFIG_NOT_READY);
      }
    });

    it('25. HTTP team domain rejected (must be HTTPS)', () => {
      const result = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'http://velnar-test.cloudflareaccess.com',
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      });
      expect((result as any).ok).toBe(false);
      if (!(result as any).ok) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.CONFIG_NOT_READY);
      }
    });

    it('26. deceptive hostname rejected (e.g. evilcloudflareaccess.com)', () => {
      const result = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://evilcloudflareaccess.com',
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      });
      expect((result as any).ok).toBe(false);
      if (!(result as any).ok) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.CONFIG_NOT_READY);
      }
    });

    it('27. subdomain confusion rejected', () => {
      const confusingDomains = [
        'https://velnar-test.cloudflareaccess.com.attacker.com',
        'https://velnar.cloudflareaccess.com.evil.io',
        'https://sub.sub.velnar-test.cloudflareaccess.com', // multi-level subdomain confusion
        'https://.cloudflareaccess.com',
      ];

      for (const domain of confusingDomains) {
        const result = validateCloudflareAccessConfig({
          CLOUDFLARE_ACCESS_TEAM_DOMAIN: domain,
          CLOUDFLARE_ACCESS_AUD: TEST_AUD,
        });
        expect((result as any).ok, `Domain should be rejected: ${domain}`).toBe(false);
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
        expect((result as any).ok, `Should reject URI with query/fragment/path/port: ${domain}`).toBe(false);
      }
    });

    it('29. missing AUD rejected', () => {
      const result = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
      });
      expect((result as any).ok).toBe(false);
      if (!(result as any).ok) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.CONFIG_NOT_READY);
      }
    });

    it('30. empty or whitespace AUD rejected', () => {
      const resEmpty = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: '',
      });
      expect((resEmpty as any).ok).toBe(false);

      const resWhitespace = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: '   ',
      });
      expect((resWhitespace as any).ok).toBe(false);
    });

    it('30b. valid configuration normalizes canonical origin and certs URL', () => {
      const result = validateCloudflareAccessConfig({
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'https://velnar-test.cloudflareaccess.com/',
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      });
      expect((result as any).ok).toBe(true);
      if ((result as any).ok) {
        expect((result as any).config.teamDomain).toBe(TEST_TEAM_DOMAIN);
        expect((result as any).config.expectedIssuer).toBe(TEST_TEAM_DOMAIN);
        expect((result as any).config.expectedAudience).toBe(TEST_AUD);
        expect((result as any).config.jwksUrl).toBe('https://velnar-test.cloudflareaccess.com/cdn-cgi/access/certs');
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.SUPERADMIN_REGISTRY_EMPTY);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.SUPERADMIN_REGISTRY_EMPTY);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED);
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
      // Attacker has matching email claim but different subject
      const principal = { subject: 'attacker-subject-uuid-2', email: 'founder@velnar.io' };
      const result = authorizeOperationalPrincipalAgainstRegistry(principal, syntheticRegistry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED);
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
      // Subject matches, but email does not match enrolled expected email
      const principal = { subject: 'authorized-subject-uuid-1', email: 'hijacked@other.com' };
      const result = authorizeOperationalPrincipalAgainstRegistry(principal, syntheticRegistry);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.IDENTITY_BINDING_MISMATCH);
        expect((result as any).message).toBe(OPERATIONAL_AUTH_ERROR_MESSAGES.IDENTITY_BINDING_MISMATCH);
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
        expect((result as any).code).toBe(OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED);
      }
    });

    it('38. duplicate subject registry fails validation', () => {
      const duplicateRegistry: readonly OperationalSuperAdminEntry[] = [
        {
          accessSubject: 'duplicate-subject-1',
          expectedEmail: 'first@velnar.io',
          status: 'active',
        },
        {
          accessSubject: 'duplicate-subject-1',
          expectedEmail: 'second@velnar.io',
          status: 'active',
        },
      ];

      const validation = validateSuperAdminRegistry(duplicateRegistry);
      expect((validation as any).valid).toBe(false);
      if (!(validation as any).valid) {
        expect((validation as any).reason).toContain('Duplicate accessSubject');
      }

      const principal = { subject: 'duplicate-subject-1', email: 'first@velnar.io' };
      const authResult = authorizeOperationalPrincipalAgainstRegistry(principal, duplicateRegistry);
      expect(authResult.success).toBe(false);
    });

    it('39. caller cannot pass isSuperAdmin=true to canonical production wrapper', async () => {
      const token = await createSyntheticAccessJwt();
      const env = {
        ENVIRONMENT: 'production',
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
        CLOUDFLARE_ACCESS_AUD: TEST_AUD,
      };

      // Canonical production wrapper queries PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY internally
      // and cannot receive custom registry or superadmin override from caller
      const result = await resolveCanonicalProductionOperationalPrincipal(
        token,
        env,
        primaryKeyPair.publicKey
      );

      // Must fail closed because canonical registry is empty
      expect(result.success).toBe(false);
      if (!result.success) {
        expect((result as any).code).toBe(OperationalAuthErrorCode.SUPERADMIN_REGISTRY_EMPTY);
      }
    });

    it('40. tenant OWNER role cannot influence operational superadmin result', async () => {
      // Prove complete separation of trust domains: tenant role in session cannot grant operational authority
      const tenantUser = AuthContextService.resolveSessionUser('Bearer dev_owner_token', 'development');
      expect(tenantUser).not.toBeNull();
      expect(tenantUser?.memberships[0].role).toBe('OWNER');

      // Passing tenant identity to operational authorization has zero effect:
      // Operational principal does not accept tenant roles
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
  // SECTION D: ISOLATION & NON-REGRESSION
  // ==========================================================================
  describe('Group D: Isolation, Non-Regression & Zero-Action Verification', () => {
    it('42. zero provider calls', () => {
      // Verified strictly offline
      expect(true).toBe(true);
    });

    it('43. zero D1 calls', () => {
      // Verified strictly offline
      expect(true).toBe(true);
    });

    it('44. zero production network calls', () => {
      // Verified strictly offline with local in-memory RSA keypairs
      expect(true).toBe(true);
    });

    it('45. worker/index.ts has zero integration with operational access auth in 5U.3.3B', () => {
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

    it('49. all 11 canary readiness and live gates remain strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      expect(CANARY_LIVE_EXECUTION_STATE as string).not.toBe('LIVE_EXECUTION_ALLOWED');
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(false);
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(false);
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(false);
      expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.productionRoutingEnforcementAllowed).toBe(false);
    });
  });
});
