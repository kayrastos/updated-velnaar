/**
 * @file worker/canaryOpsWorker.ts
 * @description Dedicated Isolated Cloudflare Worker Entrypoint for Operational Canary Certification
 * 
 * ARCHITECTURAL MANDATES:
 * 1. STRICT SURFACE ISOLATION: Serves exclusively PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH
 *    (/api/ops/canary/deepseek-certification).
 * 2. REJECT ALL OTHER PATHS: All other requests (e.g. /api/ai/*, /api/leads, /api/health, generic OPTIONS, etc.)
 *    return 404 NOT_FOUND immediately.
 * 3. ZERO TENANT IMPORTS: Does NOT import aiRouter, tenant business routers, or tenant auth context.
 * 4. STRICT DORMANT PROTECTION: Delegates directly to handleProductionCanaryOperationalRoute,
 *    which fails closed (404) when PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED is false.
 */

import type { WorkerEnv } from './env';
import { PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH } from './ai/canary/deepSeekProductionOperationalRoutePolicy';
import { handleProductionCanaryOperationalRoute } from './ai/canary/deepSeekProductionWorkerOperationalRoute';

export type { WorkerEnv };

export default {
  async fetch(request: Request, env: WorkerEnv, ctx?: any): Promise<Response> {
    const url = new URL(request.url);

    // Only allow the dedicated operational canary route
    if (url.pathname === PRODUCTION_CANARY_OPERATIONAL_ROUTE_PATH) {
      return handleProductionCanaryOperationalRoute(request, env);
    }

    // Fail closed: Any other route or method returns 404 NOT_FOUND immediately
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};
