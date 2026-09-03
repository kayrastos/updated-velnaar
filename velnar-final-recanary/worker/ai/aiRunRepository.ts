/**
 * @file worker/ai/aiRunRepository.ts
 * @description Cloudflare D1 Tenant-Scoped Persistence for AI Inference Telemetry
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. Strict Tenant & Business Isolation: Queries enforce organization_id and business_id.
 * 2. Zero PII / Zero API Key Storage.
 * 3. Never store full raw prompts.
 * 4. Costs tracked in integer microUSD.
 * 5. Full canonical validation before insertion and after retrieval.
 * 6. Never rethrow raw D1/SQL exceptions: map deterministically to stable codes.
 * ============================================================================
 */

import { AIRunRecord } from './types';
import { SafeLogger } from '../security/safeLogger';
import { 
  validateCanonicalAIRunRecord, 
  isValidAIRunStatus, 
  isValidAIRunTaskType, 
  isValidAIRunDataClassification 
} from './aiRunValidator';

export { 
  validateCanonicalAIRunRecord, 
  isValidAIRunStatus, 
  isValidAIRunTaskType, 
  isValidAIRunDataClassification 
};

export class AIRunRepository {
  private static memoryStore: AIRunRecord[] = [];

  /**
   * Save an AI run telemetry record.
   * Enforces strict canonical protocol validation before writing.
   * If protocol validation fails: throws AI_RUN_PROTOCOL_INVALID.
   * If D1 write fails: throws AI_RUN_WRITE_FAILED.
   */
  public static async saveRun(
    db: D1Database | undefined,
    run: AIRunRecord,
    environment: string = 'production'
  ): Promise<void> {
    let validated: AIRunRecord;
    try {
      validated = validateCanonicalAIRunRecord(run);
    } catch {
      throw new Error('AI_RUN_PROTOCOL_INVALID');
    }

    if (db) {
      try {
        const stmt = db.prepare(`
          INSERT INTO ai_runs (
            id,
            organization_id,
            business_id,
            task_type,
            gateway_provider_id,
            model_identifier,
            data_classification,
            prompt_version,
            prompt_tokens,
            completion_tokens,
            latency_ms,
            estimated_cost_microusd,
            redaction_count,
            status,
            error_code,
            input_fingerprint,
            purpose,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        await stmt.bind(
          validated.id,
          validated.organization_id,
          validated.business_id,
          validated.task_type,
          validated.gateway_provider_id,
          validated.model_identifier,
          validated.data_classification,
          validated.prompt_version,
          validated.prompt_tokens,
          validated.completion_tokens,
          validated.latency_ms,
          validated.estimated_cost_microusd,
          validated.redaction_count,
          validated.status,
          validated.error_code || null,
          validated.input_fingerprint || null,
          validated.purpose,
          validated.created_at
        ).run();

        SafeLogger.info('[AI_RUN_SAVED]', {
          runId: validated.id,
          organizationId: validated.organization_id,
          businessId: validated.business_id,
          costMicroUsd: validated.estimated_cost_microusd,
          latencyMs: validated.latency_ms,
        });
        return;
      } catch {
        SafeLogger.error('[AI_RUN_D1_WRITE_FAILED]', {
          runId: validated.id,
          organizationId: validated.organization_id,
          businessId: validated.business_id,
          errorCode: 'AI_RUN_D1_WRITE_FAILED',
        });
        throw new Error('AI_RUN_WRITE_FAILED');
      }
    }

    // In-memory fallback for test / development environments
    this.memoryStore.unshift({ ...validated });
    if (this.memoryStore.length > 500) {
      this.memoryStore.pop();
    }
  }

  /**
   * List AI runs strictly scoped by organization and business workspace.
   * If tenant params missing, D1 query fails, or row validation fails: throws AI_RUN_READ_FAILED.
   */
  public static async listRunsByBusiness(
    db: D1Database | undefined,
    organizationId: string,
    businessId: string,
    limit: number = 50,
    environment: string = 'production'
  ): Promise<AIRunRecord[]> {
    if (!organizationId || organizationId.trim().length === 0 || !businessId || businessId.trim().length === 0) {
      throw new Error('AI_RUN_READ_FAILED');
    }

    const cleanLimit = Math.max(1, Math.min(limit, 200));

    if (db) {
      try {
        const query = `
          SELECT 
            id,
            organization_id,
            business_id,
            task_type,
            gateway_provider_id,
            model_identifier,
            data_classification,
            prompt_version,
            prompt_tokens,
            completion_tokens,
            latency_ms,
            estimated_cost_microusd,
            redaction_count,
            status,
            error_code,
            input_fingerprint,
            purpose,
            created_at
          FROM ai_runs
          WHERE organization_id = ? AND business_id = ?
          ORDER BY created_at DESC LIMIT ?
        `;

        const stmt = db.prepare(query);
        const { results } = await stmt.bind(organizationId, businessId, cleanLimit).all<AIRunRecord>();
        const rawList = results || [];
        return rawList.map(r => {
          try {
            return validateCanonicalAIRunRecord(r, organizationId, businessId);
          } catch {
            throw new Error('AI_RUN_READ_FAILED');
          }
        });
      } catch {
        SafeLogger.error('[AI_RUN_D1_READ_FAILED]', {
          organizationId,
          businessId,
          errorCode: 'AI_RUN_D1_READ_FAILED',
        });
        throw new Error('AI_RUN_READ_FAILED');
      }
    }

    // Filter memory store strictly by organization_id and business_id
    try {
      return this.memoryStore
        .filter(r => r.organization_id === organizationId && r.business_id === businessId)
        .slice(0, cleanLimit)
        .map(r => {
          try {
            return validateCanonicalAIRunRecord(r, organizationId, businessId);
          } catch {
            throw new Error('AI_RUN_READ_FAILED');
          }
        });
    } catch {
      throw new Error('AI_RUN_READ_FAILED');
    }
  }

  /**
   * Clear in-memory store for testing.
   */
  public static clearMemoryStore(): void {
    this.memoryStore = [];
  }
}
