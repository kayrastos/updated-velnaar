/**
 * @file worker/env.ts
 * @description Cloudflare Worker Environment Interface & Runtime Type Definitions
 */

export interface WorkerEnv {
  DB?: D1Database;
  ENVIRONMENT: 'development' | 'test' | 'production' | string;
  VELNAR_MASTER_KMS_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}
