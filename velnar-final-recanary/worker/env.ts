/**
 * @file worker/env.ts
 * @description Cloudflare Worker Environment Interface & Runtime Type Definitions
 */

export interface WorkerEnv {
  DB?: D1Database;
  ENVIRONMENT: 'development' | 'test' | 'production' | string;
  VELNAR_MASTER_KMS_SECRET?: string;
  AUDIT_IP_HASH_SECRET?: string;
  ALLOWED_ORIGINS?: string;

  // Server-Side AI Provider Secrets (Never exposed to frontend)
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  KIMI_API_KEY?: string;

  // Model & Endpoint Configurations
  VELNAR_AI_GEMINI_FAST_MODEL?: string;
  VELNAR_AI_GEMINI_REASONING_MODEL?: string;
  VELNAR_AI_DEEPSEEK_MODEL?: string;
  VELNAR_AI_DEEPSEEK_BASE_URL?: string;
  VELNAR_AI_KIMI_MODEL?: string;
  VELNAR_AI_KIMI_BASE_URL?: string;

  // AI Routing Policy Mode Configuration (Optional; defaults to 'legacy')
  VELNAR_AI_ROUTING_POLICY_MODE?: 'legacy' | 'shadow' | string;
}
