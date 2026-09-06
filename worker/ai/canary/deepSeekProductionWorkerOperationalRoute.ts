/**
 * @file worker/ai/canary/deepSeekProductionWorkerOperationalRoute.ts
 * @description Dedicated Cloudflare Worker Operational Canary Route Handler
 * 
 * STRICT ARCHITECTURAL & SECURITY INVARIANTS:
 * 1. DORMANT BY DEFAULT: Protected by dual route barriers:
 *    - PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED (false)
 *    - PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY (false)
 *    When disabled, returns 404 NOT_FOUND before ANY request body or capability access.
 * 2. EXACT RUNTIME SIGNATURE: arguments.length === 3 evaluated first.
 * 3. NO TENANT ROUTE COUPLING: Not under /api/ai, does not import aiRouter, AIRouter,
 *    or tenant business AI engines.
 * 4. STRICT SUPERADMIN REQUIREMENT: On future path, requires user.isSuperAdmin === true.
 *    Tenant roles (OWNER, ADMIN, MANAGER, etc.) are strictly insufficient (403 FORBIDDEN).
 * 5. HOST ENV IDENTITY: Passes exact `env` reference received from worker/index.ts
 *    to executeProductionWorkerCanaryCertification without cloning, spreading, or mutation.
 * 6. STRICT ENVELOPE: Top-level body must contain exactly `authorizationPackage` and
 *    `sourceProvenanceReceipt`. No caller capability injection permitted.
 * 7. RESPONSE MINIMIZATION: Strips candidate, invocationResponses, invocationRecords,
 *    and internal secrets/tokens. Returns only allowlisted execution summary fields.
 * 8. ZERO LOGGING: No logger imports, no console calls, no secret leakage in error responses.
 */

import type { WorkerEnv } from '../../env';
import type { AuthenticatedUser } from '../../auth/authContext';
import {
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH,
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED,
  PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY,
} from './deepSeekProductionOperationalRoutePolicy';
import {
  executeProductionWorkerCanaryCertification,
} from './deepSeekProductionWorkerCapabilityBoundary';

const MAX_REQUEST_BODY_BYTES = 65536;

export async function handleProductionCanaryOperationalRoute(
  request: Request,
  user: AuthenticatedUser,
  env: WorkerEnv
): Promise<Response> {
  // 1. EXACT RUNTIME ARGUMENT COUNT (MANDATORY FIRST OPERATION)
  if (arguments.length !== 3) {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // 2. DUAL ROUTE READINESS BARRIERS (MUST PRECEDE ANY BODY OR CAPABILITY ACCESS)
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

    // 5. SUPERADMIN OPERATIONAL PRIVILEGE VERIFICATION
    if (!user || user.isSuperAdmin !== true) {
      return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    // 6. CONTENT-TYPE ENFORCEMENT
    const contentTypeHeader = request.headers.get('Content-Type') || '';
    const mimeType = contentTypeHeader.split(';')[0].trim().toLowerCase();
    if (mimeType !== 'application/json') {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    // 7. CONTENT-LENGTH LIMIT ENFORCEMENT
    const contentLengthHeader = request.headers.get('Content-Length');
    if (contentLengthHeader !== null) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
        return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
      }
    }

    // 8. REQUEST BODY STREAMING & SIZE AUDIT
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_BODY_BYTES) {
      return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }

    // 9. STRICT TOP-LEVEL JSON ENVELOPE VERIFICATION
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
    const topLevelKeys = Object.keys(bodyRecord);

    // Exact two top-level keys required: authorizationPackage and sourceProvenanceReceipt
    if (
      topLevelKeys.length !== 2 ||
      !Object.prototype.hasOwnProperty.call(bodyRecord, 'authorizationPackage') ||
      !Object.prototype.hasOwnProperty.call(bodyRecord, 'sourceProvenanceReceipt')
    ) {
      return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    }

    // 10. INVOKE INTERNAL WORKER CAPABILITY BOUNDARY
    // Critical Invariant: Pass EXACT host-supplied `env` reference received by handler.
    const result = await executeProductionWorkerCanaryCertification(
      env,
      bodyRecord.authorizationPackage,
      bodyRecord.sourceProvenanceReceipt
    );

    // 11. RESPONSE MINIMIZATION
    // Redact internal artifacts, raw candidate records, session tokens, and provider payloads.
    const minimizedResponse: Record<string, unknown> = {
      success: result.success,
      status: result.status,
      errors: result.errors,
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

    if (result.failureCategory !== undefined) {
      minimizedResponse.failureCategory = result.failureCategory;
    }

    return Response.json(minimizedResponse, { status: 200 });
  } catch {
    // Fail closed with safe, generic 500 without leaking stack traces or internal state
    return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
