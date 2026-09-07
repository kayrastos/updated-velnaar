/**
 * @file worker/auth/cloudflareAccessOperationalAuth.ts
 * @description Cloudflare Access Application-JWT Verification Foundation & Operational Superadmin Registry
 *
 * ============================================================================
 * ARCHITECTURAL MANDATES (Phase A.12B.2C-5U.3.3B-R):
 * 1. Cryptographic application-JWT verification for Cf-Access-Jwt-Assertion tokens.
 * 2. Algorithm allowlist: RS256 ONLY. Reject 'none', HS256, ES256, PS256, and unsigned tokens.
 * 3. Exact issuer (canonical team domain origin) and audience (AUD) enforcement.
 * 4. Expiration, not-before, and issued-at (no materially future iat) temporal verification.
 * 5. Bounded clock tolerance: <= 5 seconds.
 * 6. Hard token size ceiling: 16 KiB (16,384 bytes).
 * 7. Human operational identity required: non-empty subject, valid email, token type 'app'.
 * 8. Service token separation: reject machine/service-token identity shapes (documented & defensive).
 * 9. Separation of trust domains: Operational identity has ZERO tenant role or membership implications.
 * 10. Explicit operational-superadmin registry foundation.
 * 11. Canonical production registry MUST remain strictly EMPTY (0 entries) until explicit provisioning.
 * 12. Fail-closed error discipline: public-safe error classifications with ZERO crypto/token leakage.
 * 13. Canonical production wrapper has NO caller-selected key or keyResolver parameter.
 *     Remote JWKS resolver is constructed INTERNALLY ONLY from server-controlled configuration.
 * 14. Logging safety: NEVER log tokens, keys, signatures, or registry contents.
 * 15. Fully isolated: offline key injection for low-level tests, factory boundary for production JWKS.
 * ============================================================================
 */

import {
  jwtVerify,
  decodeProtectedHeader,
  createRemoteJWKSet,
  type KeyInput,
  type JWTVerifyGetKey,
  type JWTPayload,
} from 'jose';
import type { WorkerEnv } from '../env';

// ============================================================================
// CONSTANTS
// ============================================================================

export const CF_ACCESS_JWT_ASSERTION_HEADER = 'cf-access-jwt-assertion' as const;
export const CF_ACCESS_JWT_ASSERTION_HEADER_CANONICAL = 'Cf-Access-Jwt-Assertion' as const;

/**
 * Hard upper bound on Cloudflare Access JWT input size before parsing/verifying.
 * 16 KiB (16,384 bytes).
 */
export const MAX_ACCESS_JWT_LENGTH_BYTES = 16384 as const;

/**
 * Maximum clock skew tolerance in seconds for JWT verification.
 */
export const CLOCK_TOLERANCE_SECONDS = 5 as const;

/**
 * Allowed cryptographic signing algorithm. Strictly RS256.
 */
export const ALLOWED_JWT_ALGORITHM = 'RS256' as const;

/**
 * Expected token type claim for human Cloudflare Access application sessions.
 */
export const EXPECTED_TOKEN_TYPE = 'app' as const;

/**
 * Standard Cloudflare Access JWKS certs path.
 */
export const CLOUDFLARE_ACCESS_CERTS_PATH = '/cdn-cgi/access/certs' as const;

/**
 * Conservative bounded operational email syntax validation (<= 320 chars).
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`\{\|\}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// ============================================================================
// ERROR CLASSIFICATION & PUBLIC-SAFE MESSAGES
// ============================================================================

export const OperationalAuthErrorCode = {
  MISSING_TOKEN: 'MISSING_TOKEN',
  TOKEN_TOO_LARGE: 'TOKEN_TOO_LARGE',
  MALFORMED_TOKEN: 'MALFORMED_TOKEN',
  CONFIG_NOT_READY: 'CONFIG_NOT_READY',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  ALGORITHM_NOT_ALLOWED: 'ALGORITHM_NOT_ALLOWED',
  ISSUER_MISMATCH: 'ISSUER_MISMATCH',
  AUDIENCE_MISMATCH: 'AUDIENCE_MISMATCH',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_NOT_YET_VALID: 'TOKEN_NOT_YET_VALID',
  IAT_INVALID: 'IAT_INVALID',
  TOKEN_TYPE_INVALID: 'TOKEN_TYPE_INVALID',
  HUMAN_SUBJECT_REQUIRED: 'HUMAN_SUBJECT_REQUIRED',
  EMAIL_REQUIRED: 'EMAIL_REQUIRED',
  SUPERADMIN_REGISTRY_EMPTY: 'SUPERADMIN_REGISTRY_EMPTY',
  SUPERADMIN_NOT_AUTHORIZED: 'SUPERADMIN_NOT_AUTHORIZED',
  IDENTITY_BINDING_MISMATCH: 'IDENTITY_BINDING_MISMATCH',
  JWKS_UNAVAILABLE: 'JWKS_UNAVAILABLE',
  AUTH_INTERNAL_FAILURE: 'AUTH_INTERNAL_FAILURE',
} as const;

export type OperationalAuthErrorCode =
  (typeof OperationalAuthErrorCode)[keyof typeof OperationalAuthErrorCode];

/**
 * Public-safe, sanitized error messages.
 * NEVER leaks raw tokens, keys, signatures, stack traces, or registry data.
 */
export const OPERATIONAL_AUTH_ERROR_MESSAGES: Readonly<Record<OperationalAuthErrorCode, string>> =
  Object.freeze({
    MISSING_TOKEN: 'Cloudflare Access assertion token is missing.',
    TOKEN_TOO_LARGE: 'Authentication token exceeds maximum allowed size.',
    MALFORMED_TOKEN: 'Authentication token structure is invalid.',
    CONFIG_NOT_READY: 'Operational authentication configuration is invalid or not configured.',
    SIGNATURE_INVALID: 'Cryptographic signature verification failed.',
    ALGORITHM_NOT_ALLOWED: 'Authentication token algorithm is not permitted.',
    ISSUER_MISMATCH: 'Authentication token issuer does not match trusted operational authority.',
    AUDIENCE_MISMATCH:
      'Authentication token audience does not match configured operational application.',
    TOKEN_EXPIRED: 'Authentication token has expired.',
    TOKEN_NOT_YET_VALID: 'Authentication token is not yet valid.',
    IAT_INVALID: 'Authentication token issuance timestamp is invalid.',
    TOKEN_TYPE_INVALID:
      'Authentication token type is not authorized for human operational access.',
    HUMAN_SUBJECT_REQUIRED: 'Authentication token lacks a valid human subject identity.',
    EMAIL_REQUIRED: 'Authentication token lacks a valid authenticated email address.',
    SUPERADMIN_REGISTRY_EMPTY: 'Operational superadmin authorization registry is empty.',
    SUPERADMIN_NOT_AUTHORIZED: 'Identity is not authorized as an operational superadmin.',
    IDENTITY_BINDING_MISMATCH: 'Subject identity does not match authorized registry binding.',
    JWKS_UNAVAILABLE: 'Operational public key service is temporarily unavailable.',
    AUTH_INTERNAL_FAILURE:
      'An internal error occurred during operational authentication evaluation.',
  });

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Validated production operational principal.
 * STRICTLY SEPARATE from tenant AuthenticatedUser.
 * Has NO tenant roles (OWNER, ADMIN, etc.) and NO organization memberships.
 */
export interface ProductionOperationalPrincipal {
  readonly subject: string;
  readonly email: string;
  readonly authSource: 'CLOUDFLARE_ACCESS';
  readonly isSuperAdmin: boolean;
}

/**
 * Operational Superadmin Registry Entry.
 */
export interface OperationalSuperAdminEntry {
  readonly accessSubject: string;
  readonly expectedEmail: string;
  readonly status: 'active' | 'suspended';
  readonly registryVersion?: string;
}

/**
 * Validated Cloudflare Access Configuration.
 */
export interface ValidatedCloudflareAccessConfig {
  readonly teamDomain: string; // e.g. "https://velnar.cloudflareaccess.com"
  readonly expectedIssuer: string; // Exact canonical issuer origin
  readonly expectedAudience: string; // Exact application AUD
  readonly jwksUrl: string; // Exact remote JWKS endpoint
}

export interface OperationalAuthFailure {
  readonly success: false;
  readonly code: OperationalAuthErrorCode;
  readonly message: string;
}

export interface OperationalAuthSuccess {
  readonly success: true;
  readonly principal: ProductionOperationalPrincipal;
}

export type OperationalAuthResult = OperationalAuthSuccess | OperationalAuthFailure;

// ============================================================================
// CANONICAL PRODUCTION REGISTRY (SEALED EMPTY)
// ============================================================================

/**
 * Canonical Operational Superadmin Registry.
 *
 * MANDATE: Must remain strictly EMPTY (0 entries) in 5U.3.3B / 5U.3.3B-R.
 * No real or synthetic identities may be enrolled in canonical production registry
 * until separate future provisioning and audit.
 */
export const PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY: readonly OperationalSuperAdminEntry[] =
  Object.freeze([]);

// ============================================================================
// UTILITIES & CONFIG VALIDATION
// ============================================================================

/**
 * Conservative bounded operational email syntax validation (<= 320 chars).
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string' || email.length === 0 || email.length > 320) {
    return false;
  }
  return EMAIL_REGEX.test(email);
}

/**
 * Validate Cloudflare Access Configuration from environment.
 * Enforces:
 * - HTTPS protocol only
 * - Hostname ending strictly in .cloudflareaccess.com
 * - Subdomain validation (no deceptive domains, no subdomain confusion)
 * - No credentials, query parameters, hash fragments, or unexpected paths
 * - Bounded, non-empty AUD
 */
export function validateCloudflareAccessConfig(
  env:
    | Partial<WorkerEnv>
    | { CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string; CLOUDFLARE_ACCESS_AUD?: string }
    | undefined
    | null
):
  | { ok: true; config: ValidatedCloudflareAccessConfig }
  | { ok: false; code: typeof OperationalAuthErrorCode.CONFIG_NOT_READY; error: string } {
  if (!env || typeof env !== 'object') {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'Environment configuration missing or invalid',
    };
  }

  const rawDomain = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
  if (typeof rawDomain !== 'string' || rawDomain.trim().length === 0) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN is required',
    };
  }

  const trimmedDomain = rawDomain.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedDomain);
  } catch {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN is not a valid URL',
    };
  }

  if (parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN must use HTTPS',
    };
  }

  if (parsedUrl.username || parsedUrl.password) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN cannot contain user credentials',
    };
  }

  if (parsedUrl.search && parsedUrl.search.length > 0) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN cannot contain query parameters',
    };
  }

  if (parsedUrl.hash && parsedUrl.hash.length > 0) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN cannot contain fragment',
    };
  }

  if (parsedUrl.pathname && parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN cannot contain a path component',
    };
  }

  if (parsedUrl.port && parsedUrl.port !== '443' && parsedUrl.port !== '') {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN must use standard HTTPS port (443)',
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const cfSuffix = '.cloudflareaccess.com';
  if (!hostname.endsWith(cfSuffix)) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN must end with .cloudflareaccess.com',
    };
  }

  const subdomain = hostname.slice(0, -cfSuffix.length);
  // Team domain subdomain must be non-empty, alphanumeric with hyphens, strictly no dots
  if (!subdomain || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_TEAM_DOMAIN contains invalid subdomain',
    };
  }

  const rawAud = env.CLOUDFLARE_ACCESS_AUD;
  if (typeof rawAud !== 'string' || rawAud.trim().length === 0) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_AUD is required',
    };
  }

  if (rawAud.trim() !== rawAud) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_AUD must not contain leading or trailing whitespace',
    };
  }

  if (rawAud.length > 256) {
    return {
      ok: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      error: 'CLOUDFLARE_ACCESS_AUD exceeds maximum allowed length (256 characters)',
    };
  }

  const normalizedOrigin = 'https://' + hostname;
  return {
    ok: true,
    config: {
      teamDomain: normalizedOrigin,
      expectedIssuer: normalizedOrigin,
      expectedAudience: rawAud,
      jwksUrl: normalizedOrigin + CLOUDFLARE_ACCESS_CERTS_PATH,
    },
  };
}

/**
 * Factory for production remote JWKS resolver.
 * Separates endpoint construction from verification logic.
 */
export function createCloudflareAccessRemoteJWKSet(
  config: ValidatedCloudflareAccessConfig
): ReturnType<typeof createRemoteJWKSet> {
  return createRemoteJWKSet(new URL(config.jwksUrl));
}

/**
 * Extract Cf-Access-Jwt-Assertion token string from HTTP request headers.
 */
export function extractAccessJwtFromRequest(request: Request): string | null {
  if (!request || !request.headers || typeof request.headers.get !== 'function') {
    return null;
  }
  const token = request.headers.get(CF_ACCESS_JWT_ASSERTION_HEADER);
  if (!token || typeof token !== 'string') {
    return null;
  }
  return token.trim() || null;
}

// ============================================================================
// REGISTRY VALIDATION & PURE AUTHORIZATION HELPER
// ============================================================================

/**
 * Validate the integrity of an operational superadmin registry.
 * Detects malformed entries, invalid emails, and duplicate subjects.
 * Reason strings are strictly static and redacted to avoid leaking subject values.
 */
export function validateSuperAdminRegistry(
  registry: readonly OperationalSuperAdminEntry[]
): { valid: true } | { valid: false; reason: string } {
  if (!Array.isArray(registry)) {
    return { valid: false, reason: 'Registry must be an array' };
  }

  const seenSubjects = new Set<string>();
  for (const entry of registry) {
    if (!entry || typeof entry !== 'object') {
      return { valid: false, reason: 'Registry entry must be an object' };
    }
    if (typeof entry.accessSubject !== 'string' || entry.accessSubject.trim().length === 0) {
      return { valid: false, reason: 'Registry entry accessSubject must be a non-empty string' };
    }
    if (typeof entry.expectedEmail !== 'string' || !isValidEmail(entry.expectedEmail.trim())) {
      return { valid: false, reason: 'Registry entry expectedEmail must be a valid email' };
    }
    if (entry.status !== 'active' && entry.status !== 'suspended') {
      return { valid: false, reason: 'Registry entry status must be active or suspended' };
    }

    const normalizedSubject = entry.accessSubject.trim();
    if (seenSubjects.has(normalizedSubject)) {
      // Diagnostic reason is strictly static: NEVER leak actual subject values
      return { valid: false, reason: 'Duplicate accessSubject detected in registry' };
    }
    seenSubjects.add(normalizedSubject);
  }

  return { valid: true };
}

/**
 * Pure authorization helper to evaluate a verified identity against an operational registry.
 * Used for synthetic unit testing and lower-level verification.
 *
 * Rules:
 * - Registry must pass integrity validation (no duplicates).
 * - Empty registry fails closed (SUPERADMIN_REGISTRY_EMPTY).
 * - Non-enrolled subject fails closed (SUPERADMIN_NOT_AUTHORIZED).
 * - Suspended entry fails closed (SUPERADMIN_NOT_AUTHORIZED).
 * - Email cross-binding mismatch fails closed (IDENTITY_BINDING_MISMATCH).
 * - Only exact active match yields isSuperAdmin: true.
 */
export function authorizeOperationalPrincipalAgainstRegistry(
  principal: { subject: string; email: string },
  registry: readonly OperationalSuperAdminEntry[]
): OperationalAuthResult {
  const regValidation = validateSuperAdminRegistry(registry);
  if (!regValidation.valid) {
    return {
      success: false,
      code: OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.SUPERADMIN_NOT_AUTHORIZED,
    };
  }

  if (registry.length === 0) {
    return {
      success: false,
      code: OperationalAuthErrorCode.SUPERADMIN_REGISTRY_EMPTY,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.SUPERADMIN_REGISTRY_EMPTY,
    };
  }

  const entry = registry.find((e) => e.accessSubject === principal.subject);
  if (!entry) {
    return {
      success: false,
      code: OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.SUPERADMIN_NOT_AUTHORIZED,
    };
  }

  if (entry.status !== 'active') {
    return {
      success: false,
      code: OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.SUPERADMIN_NOT_AUTHORIZED,
    };
  }

  // Cross-binding verification: verified token email must match registered expectedEmail
  if (entry.expectedEmail.trim().toLowerCase() !== principal.email.trim().toLowerCase()) {
    return {
      success: false,
      code: OperationalAuthErrorCode.IDENTITY_BINDING_MISMATCH,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.IDENTITY_BINDING_MISMATCH,
    };
  }

  return {
    success: true,
    principal: {
      subject: principal.subject,
      email: principal.email,
      authSource: 'CLOUDFLARE_ACCESS',
      isSuperAdmin: true,
    },
  };
}

// ============================================================================
// TOKEN VERIFICATION LOGIC (LOW-LEVEL PRIMITIVE)
// ============================================================================

/**
 * Verify Cloudflare Access JWT Identity (Low-level cryptographic primitive).
 *
 * Verifies cryptographic signature, algorithm (RS256 only), issuer, audience,
 * temporal validity (exp, nbf, iat), token type ('app'), human subject, and email.
 *
 * Accepts an injected keyResolver for offline cryptographic testing.
 * Does NOT grant superadmin privileges: isSuperAdmin defaults to false.
 */
export async function verifyCloudflareAccessIdentity(
  token: string | null | undefined,
  config: ValidatedCloudflareAccessConfig,
  keyResolver: KeyInput | JWTVerifyGetKey
): Promise<OperationalAuthResult> {
  // 1. Missing or empty token check
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return {
      success: false,
      code: OperationalAuthErrorCode.MISSING_TOKEN,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.MISSING_TOKEN,
    };
  }

  const trimmedToken = token.trim();

  // 2. Token size ceiling check (16 KiB bound)
  const tokenBytes = new TextEncoder().encode(trimmedToken).length;
  if (tokenBytes > MAX_ACCESS_JWT_LENGTH_BYTES) {
    return {
      success: false,
      code: OperationalAuthErrorCode.TOKEN_TOO_LARGE,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_TOO_LARGE,
    };
  }

  // 3. Exact 3-segment dot-delimited structure check
  const segments = trimmedToken.split('.');
  if (segments.length !== 3) {
    return {
      success: false,
      code: OperationalAuthErrorCode.MALFORMED_TOKEN,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.MALFORMED_TOKEN,
    };
  }

  // 4. Header inspection (before verification)
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(trimmedToken);
  } catch {
    return {
      success: false,
      code: OperationalAuthErrorCode.MALFORMED_TOKEN,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.MALFORMED_TOKEN,
    };
  }

  if (!header || typeof header !== 'object' || header.alg !== ALLOWED_JWT_ALGORITHM) {
    return {
      success: false,
      code: OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.ALGORITHM_NOT_ALLOWED,
    };
  }

  if (segments[0].length === 0 || segments[1].length === 0 || segments[2].length === 0) {
    return {
      success: false,
      code: OperationalAuthErrorCode.MALFORMED_TOKEN,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.MALFORMED_TOKEN,
    };
  }

  // 5. Cryptographic signature and standard claims verification
  let verificationResult: { payload: JWTPayload };
  try {
    verificationResult = await jwtVerify(trimmedToken, keyResolver, {
      issuer: config.expectedIssuer,
      audience: config.expectedAudience,
      algorithms: [ALLOWED_JWT_ALGORITHM],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['exp', 'iat', 'sub'],
    });
  } catch (err: any) {
    const errCode = err?.code;
    const claim = err?.claim;

    if (errCode === 'ERR_JWT_EXPIRED' || claim === 'exp') {
      return {
        success: false,
        code: OperationalAuthErrorCode.TOKEN_EXPIRED,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_EXPIRED,
      };
    }

    if (claim === 'nbf') {
      return {
        success: false,
        code: OperationalAuthErrorCode.TOKEN_NOT_YET_VALID,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_NOT_YET_VALID,
      };
    }

    if (claim === 'iat') {
      return {
        success: false,
        code: OperationalAuthErrorCode.IAT_INVALID,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.IAT_INVALID,
      };
    }

    if (claim === 'iss') {
      return {
        success: false,
        code: OperationalAuthErrorCode.ISSUER_MISMATCH,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.ISSUER_MISMATCH,
      };
    }

    if (claim === 'aud') {
      return {
        success: false,
        code: OperationalAuthErrorCode.AUDIENCE_MISMATCH,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.AUDIENCE_MISMATCH,
      };
    }

    if (claim === 'sub') {
      return {
        success: false,
        code: OperationalAuthErrorCode.HUMAN_SUBJECT_REQUIRED,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.HUMAN_SUBJECT_REQUIRED,
      };
    }

    if (
      errCode === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
      errCode === 'ERR_JWKS_NO_MATCHING_KEY' ||
      errCode === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS'
    ) {
      return {
        success: false,
        code: OperationalAuthErrorCode.SIGNATURE_INVALID,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.SIGNATURE_INVALID,
      };
    }

    if (
      errCode === 'ERR_JWS_INVALID' ||
      errCode === 'ERR_JWT_INVALID'
    ) {
      return {
        success: false,
        code: OperationalAuthErrorCode.MALFORMED_TOKEN,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.MALFORMED_TOKEN,
      };
    }

    if (errCode === 'ERR_JOSE_ALG_NOT_ALLOWED') {
      return {
        success: false,
        code: OperationalAuthErrorCode.ALGORITHM_NOT_ALLOWED,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.ALGORITHM_NOT_ALLOWED,
      };
    }

    if (errCode === 'ERR_JWKS_TIMEOUT') {
      return {
        success: false,
        code: OperationalAuthErrorCode.JWKS_UNAVAILABLE,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.JWKS_UNAVAILABLE,
      };
    }

    if (errCode === 'ERR_JWKS_INVALID') {
      return {
        success: false,
        code: OperationalAuthErrorCode.AUTH_INTERNAL_FAILURE,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.AUTH_INTERNAL_FAILURE,
      };
    }

    // Network / fetch errors from JWKS resolution
    if (
      err instanceof TypeError ||
      (typeof err?.message === 'string' &&
        (err.message.toLowerCase().includes('fetch') || err.message.toLowerCase().includes('network')))
    ) {
      return {
        success: false,
        code: OperationalAuthErrorCode.JWKS_UNAVAILABLE,
        message: OPERATIONAL_AUTH_ERROR_MESSAGES.JWKS_UNAVAILABLE,
      };
    }

    // Default fail-closed response for unexpected/generic internal errors
    return {
      success: false,
      code: OperationalAuthErrorCode.AUTH_INTERNAL_FAILURE,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.AUTH_INTERNAL_FAILURE,
    };
  }

  const payload = verificationResult.payload;

  // 6. Explicit claim validations on verified payload
  // 6a. Expiration validation
  if (typeof payload.exp !== 'number') {
    return {
      success: false,
      code: OperationalAuthErrorCode.TOKEN_EXPIRED,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_EXPIRED,
    };
  }

  // 6b. Issued-at temporal validation (reject materially future iat beyond clock tolerance)
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
    return {
      success: false,
      code: OperationalAuthErrorCode.IAT_INVALID,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.IAT_INVALID,
    };
  }

  // 6c. Temporal relationship validation
  if (payload.exp <= payload.iat) {
    return {
      success: false,
      code: OperationalAuthErrorCode.IAT_INVALID,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.IAT_INVALID,
    };
  }

  if (typeof payload.nbf === 'number' && payload.nbf > payload.exp) {
    return {
      success: false,
      code: OperationalAuthErrorCode.TOKEN_NOT_YET_VALID,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_NOT_YET_VALID,
    };
  }

  // 6d. Token type validation (must be 'app')
  if (payload.type !== EXPECTED_TOKEN_TYPE) {
    return {
      success: false,
      code: OperationalAuthErrorCode.TOKEN_TYPE_INVALID,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_TYPE_INVALID,
    };
  }

  // 6e. Service token shape separation:
  // Documented Cloudflare service-token shape (type=app, empty sub, common_name, no email)
  // is rejected by human sub & email requirements below.
  // Additional claim checks below are defensive heuristics.
  const rawPayload = payload as Record<string, unknown>;
  if (
    rawPayload.identity_type === 'service_token' ||
    rawPayload.service_token === true ||
    rawPayload.type === 'service' ||
    (typeof rawPayload.common_name === 'string' && !rawPayload.email)
  ) {
    return {
      success: false,
      code: OperationalAuthErrorCode.TOKEN_TYPE_INVALID,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.TOKEN_TYPE_INVALID,
    };
  }

  // 6f. Human subject (sub) validation
  if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
    return {
      success: false,
      code: OperationalAuthErrorCode.HUMAN_SUBJECT_REQUIRED,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.HUMAN_SUBJECT_REQUIRED,
    };
  }

  // 6g. Authenticated email validation
  const rawEmail = rawPayload.email;
  if (typeof rawEmail !== 'string' || rawEmail.trim().length === 0) {
    return {
      success: false,
      code: OperationalAuthErrorCode.EMAIL_REQUIRED,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.EMAIL_REQUIRED,
    };
  }

  const trimmedEmail = rawEmail.trim();
  if (!isValidEmail(trimmedEmail)) {
    return {
      success: false,
      code: OperationalAuthErrorCode.EMAIL_REQUIRED,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.EMAIL_REQUIRED,
    };
  }

  // Cryptographic identity successfully verified
  // Note: full JWT claims are kept local and NEVER returned through public auth result
  return {
    success: true,
    principal: {
      subject: payload.sub.trim(),
      email: trimmedEmail,
      authSource: 'CLOUDFLARE_ACCESS',
      isSuperAdmin: false,
    },
  };
}

/**
 * Verify Cloudflare Access Request helper (Low-level cryptographic primitive).
 */
export async function verifyCloudflareAccessRequest(
  request: Request,
  config: ValidatedCloudflareAccessConfig,
  keyResolver: KeyInput | JWTVerifyGetKey
): Promise<OperationalAuthResult> {
  const token = extractAccessJwtFromRequest(request);
  return verifyCloudflareAccessIdentity(token, config, keyResolver);
}

// ============================================================================
// CALLER-INDEPENDENT CANONICAL PRODUCTION WRAPPER
// ============================================================================

/**
 * Canonical Production Operational Principal Resolver.
 *
 * STRICT INTEGRITY & TRUST-ROOT MANDATES:
 * - Accepts exactly TWO parameters: (tokenOrRequest, env).
 * - Accepts ZERO caller-selected key, keyResolver, or JWKS parameters.
 * - Constructs remote JWKS resolver INTERNALLY ONLY from server-controlled configuration.
 * - Any extra runtime arguments (e.g. arguments[2]) are completely ignored.
 * - Does NOT accept roles, isSuperAdmin, or tenant memberships from caller input.
 * - Evaluates identity strictly against the internal PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY.
 * - Because the canonical registry is currently empty, this resolver fails closed
 *   with SUPERADMIN_REGISTRY_EMPTY in this phase.
 */
export async function resolveCanonicalProductionOperationalPrincipal(
  tokenOrRequest: string | Request | null | undefined,
  env: WorkerEnv | Partial<WorkerEnv>
): Promise<OperationalAuthResult> {
  // 1. Strict configuration validation
  const configResult = validateCloudflareAccessConfig(env);
  if (!configResult.ok) {
    return {
      success: false,
      code: OperationalAuthErrorCode.CONFIG_NOT_READY,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.CONFIG_NOT_READY,
    };
  }
  const config = configResult.config;

  // 2. Extract token string
  let token: string | null = null;
  if (typeof tokenOrRequest === 'string') {
    token = tokenOrRequest;
  } else if (tokenOrRequest && typeof tokenOrRequest === 'object' && 'headers' in tokenOrRequest) {
    token = extractAccessJwtFromRequest(tokenOrRequest as Request);
  }

  if (!token) {
    return {
      success: false,
      code: OperationalAuthErrorCode.MISSING_TOKEN,
      message: OPERATIONAL_AUTH_ERROR_MESSAGES.MISSING_TOKEN,
    };
  }

  // 3. Construct canonical remote JWKS resolver internally ONLY
  // Caller-selected trust roots are strictly rejected; no third argument is read.
  const canonicalResolver = createCloudflareAccessRemoteJWKSet(config);

  // 4. Verify cryptographic identity using internal canonical resolver
  const identityResult = await verifyCloudflareAccessIdentity(token, config, canonicalResolver);
  if (!identityResult.success) {
    return identityResult;
  }

  // 5. Authorize strictly against internal canonical production registry
  return authorizeOperationalPrincipalAgainstRegistry(
    identityResult.principal,
    PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY
  );
}
