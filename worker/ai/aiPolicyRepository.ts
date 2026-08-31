/**
 * @file worker/ai/aiPolicyRepository.ts
 * @description Cloudflare D1-Backed Repository for Tenant AI Governance Policies
 * 
 * ============================================================================
 * INVARIANTS:
 * 1. allowPersonalData is ALWAYS false (0 in D1).
 * 2. allowSensitiveData is ALWAYS false (0 in D1).
 * 3. humanApprovalRequired is ALWAYS true (1 in D1).
 * 4. Production missing D1 -> fail closed.
 * ============================================================================
 */

import { D1Database } from '@cloudflare/workers-types';
import { AIOrganizationPolicy, AIProviderId } from './types';
import { SafeLogger } from '../security/safeLogger';

export interface AIPolicyRow {
  organization_id: string;
  external_ai_enabled: number;
  allowed_providers_json: string;
  max_daily_requests: number;
  max_monthly_cost_microusd: number;
  allow_public_business_data: number;
  allow_pseudonymous_operational_data: number;
  allow_personal_data: number;
  allow_sensitive_data: number;
  human_approval_required: number;
  updated_at?: string;
}

export class AIPolicyRepository {
  private static inMemoryStore: Map<string, AIOrganizationPolicy> = new Map();

  public static getDefaultPolicy(organizationId: string, _environment: string = 'production'): AIOrganizationPolicy {
    // Fail-closed defaults for ALL environments (production, development, test)
    return {
      organizationId,
      externalAiEnabled: false,
      allowedProviders: [],
      maxDailyRequests: 500,
      maxMonthlyCostMicroUsd: 50000000,
      allowPublicBusinessData: false,
      allowPseudonymousOperationalData: false,
      allowPersonalData: false,
      allowSensitiveData: false,
      humanApprovalRequired: true,
    };
  }

  /**
   * Load tenant policy from D1 or in-memory fallback in dev.
   */
  public static async getPolicy(
    db: D1Database | undefined,
    organizationId: string,
    environment: string = 'production'
  ): Promise<AIOrganizationPolicy> {
    if (!organizationId) {
      throw new Error('BAD_REQUEST: Missing organizationId for AI policy retrieval.');
    }

    if (db) {
      try {
        const stmt = db.prepare(
          `SELECT 
            organization_id, 
            external_ai_enabled, 
            allowed_providers_json, 
            max_daily_requests, 
            max_monthly_cost_microusd, 
            allow_public_business_data, 
            allow_pseudonymous_operational_data, 
            allow_personal_data, 
            allow_sensitive_data, 
            human_approval_required
          FROM organization_ai_policies 
          WHERE organization_id = ?`
        );
        const row = await stmt.bind(organizationId).first<AIPolicyRow>();

        if (row) {
          let allowedProviders: AIProviderId[] = [];
          try {
            allowedProviders = JSON.parse(row.allowed_providers_json);
          } catch {
            allowedProviders = [];
          }

          return {
            organizationId: row.organization_id,
            externalAiEnabled: Boolean(row.external_ai_enabled),
            allowedProviders,
            maxDailyRequests: row.max_daily_requests,
            maxMonthlyCostMicroUsd: row.max_monthly_cost_microusd,
            allowPublicBusinessData: Boolean(row.allow_public_business_data),
            allowPseudonymousOperationalData: Boolean(row.allow_pseudonymous_operational_data),
            allowPersonalData: false, // Strict invariant
            allowSensitiveData: false, // Strict invariant
            humanApprovalRequired: true, // Strict invariant
          };
        }

        // Row not found in D1 -> Insert default policy and return
        const defaultPolicy = this.getDefaultPolicy(organizationId, environment);
        await this.savePolicy(db, defaultPolicy, environment);
        return defaultPolicy;
      } catch (err: any) {
        SafeLogger.error('[AI_POLICY_D1_READ_FAILED]', {
          organizationId,
          errorCode: 'AI_POLICY_D1_READ_FAILED',
        });
        if (environment === 'production') {
          throw new Error('DATABASE_ERROR: Failed to retrieve AI policy from D1.');
        }
      }
    }

    if (environment === 'production') {
      throw new Error('DATABASE_NOT_CONFIGURED: D1 binding required for AI policy in production.');
    }

    // In-memory fallback for dev / test
    const existing = this.inMemoryStore.get(organizationId);
    if (existing) {
      return existing;
    }

    const defaultPolicy = this.getDefaultPolicy(organizationId, environment);
    this.inMemoryStore.set(organizationId, defaultPolicy);
    return defaultPolicy;
  }

  /**
   * Save or update tenant policy in D1 with strict PATCH semantics.
   * Merges only explicitly supplied fields and preserves all unspecified fields.
   */
  public static async savePolicy(
    db: D1Database | undefined,
    policy: Partial<AIOrganizationPolicy> & { organizationId: string },
    environment: string = 'production'
  ): Promise<AIOrganizationPolicy> {
    const organizationId = policy.organizationId;
    if (!organizationId) {
      throw new Error('BAD_REQUEST: Missing organizationId for AI policy persistence.');
    }

    // 1. Load current tenant policy or defaults
    let currentPolicy: AIOrganizationPolicy;
    if (db) {
      try {
        const stmt = db.prepare(
          `SELECT 
            organization_id, 
            external_ai_enabled, 
            allowed_providers_json, 
            max_daily_requests, 
            max_monthly_cost_microusd, 
            allow_public_business_data, 
            allow_pseudonymous_operational_data, 
            allow_personal_data, 
            allow_sensitive_data, 
            human_approval_required
          FROM organization_ai_policies 
          WHERE organization_id = ?`
        );
        const row = await stmt.bind(organizationId).first<AIPolicyRow>();
        if (row) {
          let allowedProviders: AIProviderId[] = [];
          try {
            allowedProviders = JSON.parse(row.allowed_providers_json);
          } catch {
            allowedProviders = [];
          }
          currentPolicy = {
            organizationId: row.organization_id,
            externalAiEnabled: Boolean(row.external_ai_enabled),
            allowedProviders,
            maxDailyRequests: row.max_daily_requests,
            maxMonthlyCostMicroUsd: row.max_monthly_cost_microusd,
            allowPublicBusinessData: Boolean(row.allow_public_business_data),
            allowPseudonymousOperationalData: Boolean(row.allow_pseudonymous_operational_data),
            allowPersonalData: false,
            allowSensitiveData: false,
            humanApprovalRequired: true,
          };
        } else {
          currentPolicy = this.getDefaultPolicy(organizationId, environment);
        }
      } catch {
        currentPolicy = this.inMemoryStore.get(organizationId) || this.getDefaultPolicy(organizationId, environment);
      }
    } else {
      currentPolicy = this.inMemoryStore.get(organizationId) || this.getDefaultPolicy(organizationId, environment);
    }

    // 2. Merge only explicitly provided fields
    const merged: AIOrganizationPolicy = {
      organizationId,
      externalAiEnabled: policy.externalAiEnabled !== undefined ? Boolean(policy.externalAiEnabled) : currentPolicy.externalAiEnabled,
      allowedProviders: policy.allowedProviders !== undefined ? policy.allowedProviders : currentPolicy.allowedProviders,
      maxDailyRequests: policy.maxDailyRequests !== undefined ? policy.maxDailyRequests : currentPolicy.maxDailyRequests,
      maxMonthlyCostMicroUsd: policy.maxMonthlyCostMicroUsd !== undefined ? policy.maxMonthlyCostMicroUsd : currentPolicy.maxMonthlyCostMicroUsd,
      allowPublicBusinessData: policy.allowPublicBusinessData !== undefined ? Boolean(policy.allowPublicBusinessData) : currentPolicy.allowPublicBusinessData,
      allowPseudonymousOperationalData: policy.allowPseudonymousOperationalData !== undefined ? Boolean(policy.allowPseudonymousOperationalData) : currentPolicy.allowPseudonymousOperationalData,
      // 3. Enforce immutable Sprint 4 invariants
      allowPersonalData: false,
      allowSensitiveData: false,
      humanApprovalRequired: true,
    };

    if (db) {
      try {
        const stmt = db.prepare(
          `INSERT INTO organization_ai_policies (
            organization_id,
            external_ai_enabled,
            allowed_providers_json,
            max_daily_requests,
            max_monthly_cost_microusd,
            allow_public_business_data,
            allow_pseudonymous_operational_data,
            allow_personal_data,
            allow_sensitive_data,
            human_approval_required,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1, CURRENT_TIMESTAMP)
          ON CONFLICT(organization_id) DO UPDATE SET
            external_ai_enabled = excluded.external_ai_enabled,
            allowed_providers_json = excluded.allowed_providers_json,
            max_daily_requests = excluded.max_daily_requests,
            max_monthly_cost_microusd = excluded.max_monthly_cost_microusd,
            allow_public_business_data = excluded.allow_public_business_data,
            allow_pseudonymous_operational_data = excluded.allow_pseudonymous_operational_data,
            allow_personal_data = 0,
            allow_sensitive_data = 0,
            human_approval_required = 1,
            updated_at = CURRENT_TIMESTAMP`
        );

        await stmt.bind(
          merged.organizationId,
          merged.externalAiEnabled ? 1 : 0,
          JSON.stringify(merged.allowedProviders),
          merged.maxDailyRequests,
          merged.maxMonthlyCostMicroUsd,
          merged.allowPublicBusinessData ? 1 : 0,
          merged.allowPseudonymousOperationalData ? 1 : 0
        ).run();

        this.inMemoryStore.set(organizationId, merged);
        return merged;
      } catch (err: any) {
        SafeLogger.error('[AI_POLICY_D1_WRITE_FAILED]', {
          organizationId,
          errorCode: 'AI_POLICY_D1_WRITE_FAILED',
        });
        if (environment === 'production') {
          throw new Error('DATABASE_ERROR: Failed to save AI policy to D1.');
        }
      }
    }

    if (environment === 'production') {
      throw new Error('DATABASE_NOT_CONFIGURED: D1 binding required for saving AI policy in production.');
    }

    // In-memory update
    this.inMemoryStore.set(organizationId, merged);
    return merged;
  }

  public static clearMemoryStore(): void {
    this.inMemoryStore.clear();
  }
}
