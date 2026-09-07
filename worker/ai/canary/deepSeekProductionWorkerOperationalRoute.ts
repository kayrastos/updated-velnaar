/**
 * @file worker/ai/canary/deepSeekProductionWorkerOperationalRoute.ts
 * @description Dedicated Cloudflare Worker Operational Canary Route Handler
 * 
 * STRICT ARCHITECTURAL & SECURITY INVARIANTS:
 * 1. DORMANT BY DEFAULT: Protected by dual route barriers:
 *    - PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED (false)
 *    - PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY (false)
 *    When disabled, returns 404 NOT_FOUND before ANY request body or capability access.
 * 2. EXACT RUNTIME SIGNATURE: arguments.length === 2 evaluated first.
 * 3. NO TENANT ROUTE COUPLING: Not under /api/ai, does not import aiRouter, AIRouter,
 *    or tenant business AI engines.
 * 4. STRICT OPERATIONAL SUPERADMIN REQUIREMENT: On future path, requires canonical
 *    Cloudflare Access authentication and principal.isSuperAdmin === true.
 *    Tenant roles and AuthenticatedUser are completely decoupled.
 * 5. HOST ENV IDENTITY: Passes exact `env` reference received from worker/index.ts
 *    to executeProductionWorkerCanaryCertification without cloning, spreading, or mutation.
 * 6. TRUE 65,536-BYTE STREAMING LIMIT: Reads request.body incrementally via reader.read(),
 *    counting Uint8Array byteLength. Aborts/cancels immediately when bytes > 65536.
 *    Content-Length validated strictly with unsigned decimal syntax as early check.
 *    Uses fatal UTF-8 decoding.
 * 7. STRICT TOP-LEVEL JSON ENVELOPE: Tokenizes/scans top-level members to reject duplicate
 *    keys, extra keys, or non-exact member names before JSON.parse value construction.
 * 8. PUBLIC-SAFE ERROR BOUNDARY: Downstream result.errors are NEVER exposed.
 *    All errors map deterministically to a fixed public allowlist based on status/category.
 * 9. RESPONSE MINIMIZATION: Strips candidate, invocationResponses, invocationRecords,
 *    and internal secrets/tokens. Returns only allowlisted execution summary fields.
 * 10. ZERO LOGGING: No logger imports, no console calls, no secret leakage in error responses.
 */

import type { WorkerEnv } from '../../env';
import {
  resolveCanonicalProductionOperationalPrincipal,
  OperationalAuthErrorCode,
  type OperationalAuthFailure,
  type ProductionOperationalPrincipal,
} from '../../auth/cloudflareAccessOperationalAuth';
import {
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH,
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED,
  PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY,
} from './deepSeekProductionOperationalRoutePolicy';
import {
  executeProductionWorkerCanaryCertification,
} from './deepSeekProductionWorkerCapabilityBoundary';

export const MAX_REQUEST_BODY_BYTES = 65536;

export const PUBLIC_OPERATIONAL_ERROR_CODES = [
  'CANARY_LIVE_EXECUTION_BLOCKED',
  'CANARY_AUTHORIZATION_REJECTED',
  'CANARY_SOURCE_BINDING_REJECTED',
  'CANARY_REPLAY_REJECTED',
  'CANARY_PROVIDER_EXECUTION_FAILED',
  'CANARY_VALIDATION_FAILED',
  'CANARY_BUDGET_REJECTED',
  'CANARY_INTERNAL_FAILURE',
] as const;

export type PublicOperationalErrorCode = (typeof PUBLIC_OPERATIONAL_ERROR_CODES)[number];

const ALLOWED_FAILURE_CATEGORIES = new Set<string>([
  'HARD_LIFECYCLE_TIMEOUT',
  'HTTP_NON_SUCCESS',
  'NETWORK_TRANSPORT_FAILURE',
  'BODY_READ_FAILURE',
  'JSON_PARSE_FAILURE',
  'MODEL_PROVENANCE_MISMATCH',
  'USAGE_MISSING',
  'USAGE_INTEGRITY_FAILURE',
  'SCHEMA_FAILURE',
  'TASK_FAILURE',
  'SEMANTIC_GATE_FAILURE',
  'BUDGET_BREACH',
  'PRICING_WINDOW_CHANGED',
  'AUTHORIZATION_BINDING_FAILURE',
  'SOURCE_BINDING_FAILURE',
  'EVIDENCE_PERSISTENCE_FAILURE',
]);

function mapToPublicOperationalErrors(
  status: string,
  failureCategory?: string
): readonly PublicOperationalErrorCode[] {
  if (status === 'LIVE_EXECUTION_BLOCKED') {
    return ['CANARY_LIVE_EXECUTION_BLOCKED'];
  }

  if (
    failureCategory === 'AUTHORIZATION_BINDING_FAILURE' ||
    failureCategory === 'PREFLIGHT_HUMAN_AUTH_INVALID'
  ) {
    return ['CANARY_AUTHORIZATION_REJECTED'];
  }

  if (
    failureCategory === 'SOURCE_BINDING_FAILURE' ||
    failureCategory === 'RUNTIME_SOURCE_PROVENANCE_FAILURE' ||
    failureCategory === 'PREFLIGHT_SOURCE_PROVENANCE_INVALID'
  ) {
    return ['CANARY_SOURCE_BINDING_REJECTED'];
  }

  if (
    status === 'REQUEST_INTEGRITY_FAILED' ||
    failureCategory === 'REPLAY_RESERVATION_CONFLICT'
  ) {
    return ['CANARY_REPLAY_REJECTED'];
  }

  if (
    status === 'BUDGET_BREACH_TERMINATED' ||
    status === 'WINDOW_CROSSING_TERMINATED' ||
    failureCategory === 'BUDGET_EXCEEDED' ||
    failureCategory === 'BUDGET_BREACH' ||
    failureCategory === 'PRICING_WINDOW_CHANGED' ||
    failureCategory === 'WINDOW_CROSSING_DETECTED'
  ) {
    return ['CANARY_BUDGET_REJECTED'];
  }

  if (
    status === 'PREFLIGHT_VALIDATION_FAILED' ||
    status === 'QUALITY_GATE_FAILED' ||
    failureCategory === 'QUALITY_GATE_REJECTED' ||
    failureCategory === 'SCHEMA_FAILURE' ||
    failureCategory === 'SEMANTIC_GATE_FAILURE'
  ) {
    return ['CANARY_VALIDATION_FAILED'];
  }

  if (
    status === 'TRANSPORT_EXECUTION_FAILED' ||
    failureCategory === 'NETWORK_TRANSPORT_FAILURE' ||
    failureCategory === 'HARD_LIFECYCLE_TIMEOUT' ||
    failureCategory === 'HTTP_NON_SUCCESS' ||
    failureCategory === 'BODY_READ_FAILURE' ||
    failureCategory === 'JSON_PARSE_FAILURE' ||
    failureCategory === 'MODEL_PROVENANCE_MISMATCH' ||
    failureCategory === 'USAGE_MISSING' ||
    failureCategory === 'USAGE_INTEGRITY_FAILURE' ||
    failureCategory === 'TASK_FAILURE' ||
    failureCategory === 'TRANSPORT_NETWORK_ERROR' ||
    failureCategory === 'TRANSPORT_TIMEOUT' ||
    failureCategory === 'PROVIDER_MALFORMED_RESPONSE'
  ) {
    return ['CANARY_PROVIDER_EXECUTION_FAILED'];
  }

  return ['CANARY_INTERNAL_FAILURE'];
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Deterministic top-level JSON member scanner.
 * Verifies that the JSON payload has EXACTLY two top-level keys:
 * 'authorizationPackage' and 'sourceProvenanceReceipt', without any duplicates,
 * extra keys, or prototype pollution attempts.
 */
export function scanTopLevelJsonEnvelope(text: string): boolean {
  let pos = 0;
  while (pos < text.length && isWhitespace(text[pos])) pos++;
  if (pos >= text.length || text[pos] !== '{') return false;
  pos++; // skip '{'

  const seenKeys = new Set<string>();

  while (pos < text.length) {
    while (pos < text.length && isWhitespace(text[pos])) pos++;
    if (pos >= text.length) return false;

    if (text[pos] === '}') {
      pos++;
      while (pos < text.length && isWhitespace(text[pos])) pos++;
      if (pos !== text.length) return false;
      break;
    }

    if (text[pos] !== '"') return false;
    const keyStart = pos;
    pos++;
    let escaped = false;
    while (pos < text.length) {
      const ch = text[pos];
      if (escaped) {
        escaped = false;
        pos++;
      } else if (ch === '\\') {
        escaped = true;
        pos++;
      } else if (ch === '"') {
        pos++;
        break;
      } else if (ch < ' ') {
        return false;
      } else {
        pos++;
      }
    }
    const keyEnd = pos;
    if (text[keyEnd - 1] !== '"' || keyEnd - 1 === keyStart) return false;

    let key: string;
    try {
      key = JSON.parse(text.slice(keyStart, keyEnd));
    } catch {
      return false;
    }

    if (key !== 'authorizationPackage' && key !== 'sourceProvenanceReceipt') {
      return false;
    }
    if (seenKeys.has(key)) {
      return false; // DUPLICATE MEMBER DETECTED
    }
    seenKeys.add(key);

    while (pos < text.length && isWhitespace(text[pos])) pos++;
    if (pos >= text.length || text[pos] !== ':') return false;
    pos++; // skip ':'
    while (pos < text.length && isWhitespace(text[pos])) pos++;
    if (pos >= text.length) return false;

    // Skip JSON value safely without recursing or materializing attacker objects
    if (text[pos] === '"') {
      pos++;
      let esc = false;
      while (pos < text.length) {
        const c = text[pos];
        if (esc) {
          esc = false;
          pos++;
        } else if (c === '\\') {
          esc = true;
          pos++;
        } else if (c === '"') {
          pos++;
          break;
        } else {
          pos++;
        }
      }
    } else if (text[pos] === '{' || text[pos] === '[') {
      const stack = [text[pos]];
      pos++;
      let inStr = false;
      let esc = false;
      while (pos < text.length && stack.length > 0) {
        const c = text[pos];
        if (inStr) {
          if (esc) {
            esc = false;
          } else if (c === '\\') {
            esc = true;
          } else if (c === '"') {
            inStr = false;
          }
          pos++;
        } else {
          if (c === '"') {
            inStr = true;
            pos++;
          } else if (c === '{' || c === '[') {
            stack.push(c);
            pos++;
          } else if (c === '}') {
            if (stack[stack.length - 1] !== '{') return false;
            stack.pop();
            pos++;
          } else if (c === ']') {
            if (stack[stack.length - 1] !== '[') return false;
            stack.pop();
            pos++;
          } else {
            pos++;
          }
        }
      }
      if (stack.length > 0) return false;
    } else {
      while (pos < text.length && text[pos] !== ',' && text[pos] !== '}' && !isWhitespace(text[pos])) {
        pos++;
      }
    }

    while (pos < text.length && isWhitespace(text[pos])) pos++;
    if (pos >= text.length) return false;

    if (text[pos] === ',') {
      pos++;
    } else if (text[pos] === '}') {
      pos++;
      while (pos < text.length && isWhitespace(text[pos])) pos++;
      if (pos !== text.length) return false;
      break;
    } else {
      return false;
    }
  }

  return seenKeys.size === 2 && seenKeys.has('authorizationPackage') && seenKeys.has('sourceProvenanceReceipt');
}

export async function handleProductionCanaryOperationalRoute(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  // 1. EXACT RUNTIME ARGUMENT COUNT (MANDATORY FIRST OPERATION)
  if (arguments.length !== 2) {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // 2. DUAL ROUTE READINESS BARRIERS (MUST PRECEDE ANY AUTH, BODY OR CAPABILITY ACCESS)
  if (
    !PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED ||
    !PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY
  ) {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // FUTURE-PATH EVALUATION (Active only if BOTH readiness barriers are approved)
  try {
    // 3. HTTP METHOD VERIFICATION
    if (request.method !== 'POST') {
      return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    }

    // 4. EXACT PATH VERIFICATION
    const url = new URL(request.url);
    if (url.pathname !== PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH) {
      return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // 5. CANONICAL CLOUDFLARE ACCESS OPERATIONAL AUTHENTICATION
    const authResult = await resolveCanonicalProductionOperationalPrincipal(request, env);
    if (!authResult.success) {
      const failure = authResult as OperationalAuthFailure;
      const code = failure.code;
      if (
        code === OperationalAuthErrorCode.SUPERADMIN_REGISTRY_EMPTY ||
        code === OperationalAuthErrorCode.SUPERADMIN_NOT_AUTHORIZED ||
        code === OperationalAuthErrorCode.IDENTITY_BINDING_MISMATCH
      ) {
        return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
      }

      if (
        code === OperationalAuthErrorCode.CONFIG_NOT_READY ||
        code === OperationalAuthErrorCode.JWKS_UNAVAILABLE ||
        code === OperationalAuthErrorCode.AUTH_INTERNAL_FAILURE
      ) {
        return Response.json({ error: 'AUTH_SERVICE_UNAVAILABLE' }, { status: 503 });
      }

      // All authentication / token failures map to 401 UNAUTHORIZED
      return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    // 5b. DEFENSE-IN-DEPTH OPERATIONAL SUPERADMIN REQUIREMENT
    const principal: ProductionOperationalPrincipal = authResult.principal;
    if (!principal || principal.isSuperAdmin !== true) {
      return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    // 6. CONTENT-TYPE ENFORCEMENT
    const contentTypeHeader = request.headers.get('Content-Type') || '';
    const mimeType = contentTypeHeader.split(';')[0].trim().toLowerCase();
    if (mimeType !== 'application/json') {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    // 7. CONTENT-LENGTH SYNTAX & LIMIT AUDIT (EARLY REJECTION OPTIMIZATION ONLY)
    const contentLengthHeader = request.headers.get('Content-Length');
    if (contentLengthHeader !== null) {
      // Must be strictly unsigned decimal digits
      if (!/^[0-9]+$/.test(contentLengthHeader)) {
        return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
      }
      const declaredLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
        return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
      }
      if (declaredLength > MAX_REQUEST_BODY_BYTES) {
        return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
      }
    }

    // 8. INCREMENTAL BOUNDED STREAM CONSUMPTION
    if (!request.body) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = request.body.getReader();
    } catch {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    const chunks: Uint8Array[] = [];
    let accumulatedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.byteLength > 0) {
          accumulatedBytes += value.byteLength;
          if (accumulatedBytes > MAX_REQUEST_BODY_BYTES) {
            try {
              await reader.cancel();
            } catch {
              // Ignore cancellation failure
            }
            return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
          }
          chunks.push(value);
        }
      }
    } catch {
      try {
        await reader.cancel();
      } catch {
        // Ignore
      }
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    if (accumulatedBytes === 0) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    // Combine chunks into single contiguous buffer
    const combinedBytes = new Uint8Array(accumulatedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combinedBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // Fatal UTF-8 decoding
    let rawBody: string;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      rawBody = decoder.decode(combinedBytes);
    } catch {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    // 9. TOP-LEVEL JSON DUPLICATE MEMBER & KEY SCANNER
    if (!scanTopLevelJsonEnvelope(rawBody)) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    // 10. VALUE PARSING & PROPERTY VALIDATION
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    if (
      !parsedBody ||
      typeof parsedBody !== 'object' ||
      Array.isArray(parsedBody)
    ) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    const bodyRecord = parsedBody as Record<string, unknown>;

    if (
      !Object.prototype.hasOwnProperty.call(bodyRecord, 'authorizationPackage') ||
      !Object.prototype.hasOwnProperty.call(bodyRecord, 'sourceProvenanceReceipt')
    ) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    // 11. INVOKE INTERNAL WORKER CAPABILITY BOUNDARY
    // Critical Invariant: Pass EXACT host-supplied `env` reference received by handler.
    const result = await executeProductionWorkerCanaryCertification(
      env,
      bodyRecord.authorizationPackage,
      bodyRecord.sourceProvenanceReceipt
    );

    // 12. PUBLIC-SAFE RESPONSE ERROR SANITIZATION & MINIMIZATION
    const publicErrors = result.success
      ? []
      : mapToPublicOperationalErrors(result.status, result.failureCategory);

    const minimizedResponse: Record<string, unknown> = {
      success: result.success,
      status: result.status,
      errors: publicErrors,
      providerNetworkCalls: result.providerNetworkCalls,
      credentialReads: result.credentialReads,
      transportAttempts: result.transportAttempts,
      completedTasks: result.completedTasks,
      observedTotalCostMicroUsd: result.observedTotalCostMicroUsd,
      authorizedBudgetMicroUsd: result.authorizedBudgetMicroUsd,
      aggregateSemanticScore: result.aggregateSemanticScore,
      allTasksPassed: result.allTasksPassed,
      allSchemasValid: result.allSchemasValid,
      finalCertificationEligible: result.finalCertificationEligible,
    };

    if (
      result.failureCategory !== undefined &&
      ALLOWED_FAILURE_CATEGORIES.has(result.failureCategory)
    ) {
      minimizedResponse.failureCategory = result.failureCategory;
    }

    return Response.json(minimizedResponse, { status: 200 });
  } catch {
    // Fail closed with safe, generic 500 without leaking stack traces or internal state
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
