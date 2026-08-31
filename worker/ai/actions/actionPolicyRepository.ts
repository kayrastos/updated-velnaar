/**
 * @file worker/ai/actions/actionPolicyRepository.ts
 * @description Cloudflare D1-Backed Repository for Tenant Action Governance & Guardrail Policies
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. AI PROPOSES. DETERMINISTIC POLICY VALIDATES. HUMANS APPROVE.
 * 2. Tenant constraints are loaded from organization_action_policies.
 * 3. Missing tenant policy means UNCONFIGURED (null limits), not invented defaults.
 * 4. Global immutable invariants (human approval required, auto execution disabled).
 * ============================================================================
 */

import { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { SafeLogger } from '../../security/safeLogger';
import { BusinessTenantGuard } from '../../middleware/businessTenantGuard';
import { AuditLogRow, UserRole } from '../../../src/types/database';
import { AuditRepository } from '../../repositories/auditRepository';

export interface OrganizationActionPolicy {
  id?: string;
  organizationId: string;
  businessId?: string | null;
  effectiveScope?: 'business' | 'organization' | 'unconfigured';
  maximumDiscountPercent: number | null;
  maximumAdBudgetMinor: number | null;
  allowedChannels: string[] | null;
  prohibitedActions: string[];
  requiresApprovalForOutboundMessaging: boolean;
  requiresApprovalForPriceChanges: boolean;
  humanApprovalRequired: boolean;
  autoExecutionEnabled: boolean;
  configured: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrganizationActionPolicyDbRow {
  id?: string;
  organization_id: string;
  business_id?: string | null;
  maximum_discount_percent: number | null;
  maximum_ad_budget_minor: number | null;
  allowed_channels_json: string | null;
  prohibited_actions_json: string | null;
  requires_approval_for_outbound_messaging: number;
  requires_approval_for_price_changes: number;
  human_approval_required: number;
  auto_execution_enabled: number;
  created_at?: string;
  updated_at?: string;
}

export class ActionPolicyRepository {
  private static inMemoryStore: Map<string, OrganizationActionPolicy> = new Map();

  /**
   * Return an explicit unconfigured policy representation.
   * Never inject hard-coded business defaults (such as 20% or 500000 minor units).
   */
  public static getUnconfiguredPolicy(organizationId: string, businessId?: string | null): OrganizationActionPolicy {
    return {
      organizationId,
      businessId: businessId || null,
      effectiveScope: 'unconfigured',
      maximumDiscountPercent: null,
      maximumAdBudgetMinor: null,
      allowedChannels: null,
      prohibitedActions: [],
      requiresApprovalForOutboundMessaging: true,
      requiresApprovalForPriceChanges: true,
      humanApprovalRequired: true,
      autoExecutionEnabled: false,
      configured: false,
    };
  }

  private static mapRowToPolicy(row: OrganizationActionPolicyDbRow, scope: 'business' | 'organization'): OrganizationActionPolicy {
    let allowedChannels: string[] | null = null;
    let prohibitedActions: string[] = [];
    try {
      if (row.allowed_channels_json) allowedChannels = JSON.parse(row.allowed_channels_json);
    } catch {
      allowedChannels = null;
    }
    try {
      if (row.prohibited_actions_json) prohibitedActions = JSON.parse(row.prohibited_actions_json);
    } catch {
      prohibitedActions = [];
    }

    const maxDiscount = row.maximum_discount_percent !== null && row.maximum_discount_percent !== undefined
      ? Number(row.maximum_discount_percent)
      : null;
    const maxBudget = row.maximum_ad_budget_minor !== null && row.maximum_ad_budget_minor !== undefined
      ? Number(row.maximum_ad_budget_minor)
      : null;

    return {
      id: row.id,
      organizationId: row.organization_id,
      businessId: row.business_id || null,
      effectiveScope: scope,
      maximumDiscountPercent: maxDiscount,
      maximumAdBudgetMinor: maxBudget,
      allowedChannels,
      prohibitedActions,
      requiresApprovalForOutboundMessaging: Boolean(row.requires_approval_for_outbound_messaging),
      requiresApprovalForPriceChanges: Boolean(row.requires_approval_for_price_changes),
      humanApprovalRequired: true, // Invariant in Sprint 4
      autoExecutionEnabled: false, // Invariant in Sprint 4
      configured: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Load tenant action policy from D1 or in-memory fallback in dev/test.
   * Lookup precedence:
   * 1. Exact match (organization_id, business_id)
   * 2. Organization-level fallback (organization_id, business_id IS NULL)
   * 3. Unconfigured (null limits)
   */
  public static async getPolicy(
    db: D1Database | undefined,
    organizationId: string,
    businessId?: string | null,
    environment: string = 'production'
  ): Promise<OrganizationActionPolicy> {
    if (!organizationId) {
      throw new Error('BAD_REQUEST: Missing organizationId for action policy retrieval.');
    }

    if (businessId && businessId.trim().length > 0) {
      await BusinessTenantGuard.assertBusinessBelongsToOrganization(
        db,
        organizationId,
        businessId.trim(),
        environment
      );
    }

    if (db) {
      try {
        // Step 1: Check exact match (organization_id, business_id) if businessId provided
        if (businessId && businessId.trim().length > 0) {
          const bizStmt = db.prepare(
            `SELECT 
              id,
              organization_id, 
              business_id,
              maximum_discount_percent, 
              maximum_ad_budget_minor, 
              allowed_channels_json,
              prohibited_actions_json,
              requires_approval_for_outbound_messaging,
              requires_approval_for_price_changes,
              human_approval_required, 
              auto_execution_enabled,
              created_at,
              updated_at
            FROM organization_action_policies 
            WHERE organization_id = ? AND business_id = ?`
          );
          const bizRow = await bizStmt.bind(organizationId, businessId.trim()).first<OrganizationActionPolicyDbRow>();
          if (bizRow) {
            return this.mapRowToPolicy(bizRow, 'business');
          }
        }

        // Step 2: Fallback to organization-level policy (business_id IS NULL)
        const orgStmt = db.prepare(
          `SELECT 
            id,
            organization_id, 
            business_id,
            maximum_discount_percent, 
            maximum_ad_budget_minor, 
            allowed_channels_json,
            prohibited_actions_json,
            requires_approval_for_outbound_messaging,
            requires_approval_for_price_changes,
            human_approval_required, 
            auto_execution_enabled,
            created_at,
            updated_at
          FROM organization_action_policies 
          WHERE organization_id = ? AND business_id IS NULL`
        );
        const orgRow = await orgStmt.bind(organizationId).first<OrganizationActionPolicyDbRow>();
        if (orgRow) {
          return this.mapRowToPolicy(orgRow, 'organization');
        }

        // Step 3: Unconfigured policy
        return this.getUnconfiguredPolicy(organizationId, businessId);
      } catch (err: any) {
        SafeLogger.error('[ACTION_POLICY_D1_READ_FAILED]', {
          organizationId,
          businessId,
          errorCode: 'ACTION_POLICY_D1_READ_FAILED',
        });
        throw new Error('DATABASE_ERROR: Failed to retrieve action policy from D1.');
      }
    }

    if (environment === 'production') {
      throw new Error('DATABASE_NOT_CONFIGURED: D1 binding required for action policy in production.');
    }

    // In-memory fallback for dev / test
    if (businessId && businessId.trim().length > 0) {
      const bizExisting = this.inMemoryStore.get(`${organizationId}:${businessId.trim()}`);
      if (bizExisting) {
        return { ...bizExisting, effectiveScope: 'business' };
      }
    }

    const orgExisting = this.inMemoryStore.get(organizationId);
    if (orgExisting) {
      return { ...orgExisting, effectiveScope: 'organization' };
    }

    return this.getUnconfiguredPolicy(organizationId, businessId);
  }

  /**
   * Strictly validate policy values against domain rules. Rejects invalid or out-of-range types.
   */
  public static validatePolicyValues(policy: Partial<OrganizationActionPolicy>): void {
    if (policy.maximumDiscountPercent !== undefined && policy.maximumDiscountPercent !== null) {
      const val = policy.maximumDiscountPercent;
      if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val) || val < 0 || val > 100) {
        throw new Error('INVALID_POLICY_VALUE: maximumDiscountPercent must be a finite number between 0 and 100 or null.');
      }
    }

    if (policy.maximumAdBudgetMinor !== undefined && policy.maximumAdBudgetMinor !== null) {
      const val = policy.maximumAdBudgetMinor;
      if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val) || !Number.isSafeInteger(val) || val < 0) {
        throw new Error('INVALID_POLICY_VALUE: maximumAdBudgetMinor must be a non-negative safe integer or null.');
      }
    }

    if (policy.allowedChannels !== undefined && policy.allowedChannels !== null) {
      const val = policy.allowedChannels;
      if (!Array.isArray(val) || !val.every(item => typeof item === 'string' && item.trim().length > 0 && item === item.trim())) {
        throw new Error('INVALID_POLICY_VALUE: allowedChannels must be null or an array of non-empty trimmed strings.');
      }
      if (new Set(val).size !== val.length) {
        throw new Error('INVALID_POLICY_VALUE: allowedChannels must not contain duplicate items.');
      }
    }

    if (policy.prohibitedActions !== undefined && policy.prohibitedActions !== null) {
      const val = policy.prohibitedActions;
      if (!Array.isArray(val) || !val.every(item => typeof item === 'string' && item.trim().length > 0 && item === item.trim())) {
        throw new Error('INVALID_POLICY_VALUE: prohibitedActions must be an array of non-empty trimmed strings.');
      }
      if (new Set(val).size !== val.length) {
        throw new Error('INVALID_POLICY_VALUE: prohibitedActions must not contain duplicate items.');
      }
    }

    if (policy.requiresApprovalForOutboundMessaging !== undefined && typeof policy.requiresApprovalForOutboundMessaging !== 'boolean') {
      throw new Error('INVALID_POLICY_VALUE: requiresApprovalForOutboundMessaging must be a boolean.');
    }

    if (policy.requiresApprovalForPriceChanges !== undefined && typeof policy.requiresApprovalForPriceChanges !== 'boolean') {
      throw new Error('INVALID_POLICY_VALUE: requiresApprovalForPriceChanges must be a boolean.');
    }
  }

  /**
   * Prepares statement and merged policy model for saving.
   */
  private static prepareSaveStatement(
    db: D1Database,
    merged: OrganizationActionPolicy
  ): D1PreparedStatement {
    if (merged.businessId) {
      const stmt = db.prepare(
        `INSERT INTO organization_action_policies (
          id,
          organization_id,
          business_id,
          maximum_discount_percent,
          maximum_ad_budget_minor,
          allowed_channels_json,
          prohibited_actions_json,
          requires_approval_for_outbound_messaging,
          requires_approval_for_price_changes,
          human_approval_required,
          auto_execution_enabled,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(organization_id, business_id) WHERE business_id IS NOT NULL DO UPDATE SET
          maximum_discount_percent = excluded.maximum_discount_percent,
          maximum_ad_budget_minor = excluded.maximum_ad_budget_minor,
          allowed_channels_json = excluded.allowed_channels_json,
          prohibited_actions_json = excluded.prohibited_actions_json,
          requires_approval_for_outbound_messaging = excluded.requires_approval_for_outbound_messaging,
          requires_approval_for_price_changes = excluded.requires_approval_for_price_changes,
          human_approval_required = 1,
          auto_execution_enabled = 0,
          updated_at = CURRENT_TIMESTAMP`
      );

      return stmt.bind(
        merged.id,
        merged.organizationId,
        merged.businessId,
        merged.maximumDiscountPercent,
        merged.maximumAdBudgetMinor,
        merged.allowedChannels ? JSON.stringify(merged.allowedChannels) : null,
        merged.prohibitedActions ? JSON.stringify(merged.prohibitedActions) : '[]',
        merged.requiresApprovalForOutboundMessaging ? 1 : 0,
        merged.requiresApprovalForPriceChanges ? 1 : 0
      );
    }

    const stmt = db.prepare(
      `INSERT INTO organization_action_policies (
        id,
        organization_id,
        business_id,
        maximum_discount_percent,
        maximum_ad_budget_minor,
        allowed_channels_json,
        prohibited_actions_json,
        requires_approval_for_outbound_messaging,
        requires_approval_for_price_changes,
        human_approval_required,
        auto_execution_enabled,
        updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id) WHERE business_id IS NULL DO UPDATE SET
        maximum_discount_percent = excluded.maximum_discount_percent,
        maximum_ad_budget_minor = excluded.maximum_ad_budget_minor,
        allowed_channels_json = excluded.allowed_channels_json,
        prohibited_actions_json = excluded.prohibited_actions_json,
        requires_approval_for_outbound_messaging = excluded.requires_approval_for_outbound_messaging,
        requires_approval_for_price_changes = excluded.requires_approval_for_price_changes,
        human_approval_required = 1,
        auto_execution_enabled = 0,
        updated_at = CURRENT_TIMESTAMP`
    );

    return stmt.bind(
      merged.id,
      merged.organizationId,
      merged.maximumDiscountPercent,
      merged.maximumAdBudgetMinor,
      merged.allowedChannels ? JSON.stringify(merged.allowedChannels) : null,
      merged.prohibitedActions ? JSON.stringify(merged.prohibitedActions) : '[]',
      merged.requiresApprovalForOutboundMessaging ? 1 : 0,
      merged.requiresApprovalForPriceChanges ? 1 : 0
    );
  }

  /**
   * Save or update tenant action policy in D1 atomically alongside audit log entry.
   */
  public static async savePolicyWithAudit(
    db: D1Database | undefined,
    policy: Partial<OrganizationActionPolicy> & { organizationId: string; businessId?: string | null },
    auditMeta: {
      actorUserId: string;
      actorRole: UserRole;
      action: string;
      ipHash?: string;
      diff: Record<string, any>;
    },
    environment: string = 'production'
  ): Promise<{ policy: OrganizationActionPolicy; auditLog: AuditLogRow }> {
    const organizationId = policy.organizationId;
    if (!organizationId) {
      throw new Error('BAD_REQUEST: Missing organizationId for action policy persistence.');
    }

    const businessId = policy.businessId ? policy.businessId.trim() : null;

    if (businessId) {
      await BusinessTenantGuard.assertBusinessBelongsToOrganization(
        db,
        organizationId,
        businessId,
        environment
      );
    }

    this.validatePolicyValues(policy);

    // Fail closed on read error
    const currentPolicy = await this.getPolicy(db, organizationId, businessId, environment);

    const maxDiscount: number | null = policy.maximumDiscountPercent !== undefined
      ? policy.maximumDiscountPercent
      : currentPolicy.maximumDiscountPercent;

    const maxBudget: number | null = policy.maximumAdBudgetMinor !== undefined
      ? policy.maximumAdBudgetMinor
      : currentPolicy.maximumAdBudgetMinor;

    const allowedChannels = policy.allowedChannels !== undefined ? policy.allowedChannels : currentPolicy.allowedChannels;
    const prohibitedActions = policy.prohibitedActions !== undefined ? policy.prohibitedActions : currentPolicy.prohibitedActions;

    const recordId = policy.id || (businessId ? `pol_${organizationId}_${businessId}` : `pol_${organizationId}_default`);

    const merged: OrganizationActionPolicy = {
      id: recordId,
      organizationId,
      businessId,
      effectiveScope: businessId ? 'business' : 'organization',
      maximumDiscountPercent: maxDiscount,
      maximumAdBudgetMinor: maxBudget,
      allowedChannels,
      prohibitedActions,
      requiresApprovalForOutboundMessaging: policy.requiresApprovalForOutboundMessaging ?? currentPolicy.requiresApprovalForOutboundMessaging,
      requiresApprovalForPriceChanges: policy.requiresApprovalForPriceChanges ?? currentPolicy.requiresApprovalForPriceChanges,
      humanApprovalRequired: true, // Global invariant: ALWAYS true in Sprint 4
      autoExecutionEnabled: false, // Global invariant: ALWAYS false in Sprint 4
      configured: true,
    };

    const auditId = `aud_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const safePayload = SafeLogger.redactData(auditMeta.diff);

    const auditLog: AuditLogRow = {
      id: auditId,
      organization_id: organizationId,
      business_id: businessId || undefined,
      actor_id: auditMeta.actorUserId,
      actor_role: auditMeta.actorRole,
      action: auditMeta.action,
      target_entity_type: 'organization_action_policies',
      target_entity_id: recordId,
      payload_diff_json: JSON.stringify(safePayload),
      ip_hash: auditMeta.ipHash || 'UNKNOWN',
      created_at: now,
    };

    if (db) {
      try {
        const policyStmt = this.prepareSaveStatement(db, merged);

        const auditStmt = db.prepare(
          `INSERT INTO audit_logs (
            id, organization_id, business_id, actor_id, actor_role, action,
            target_entity_type, target_entity_id, payload_diff_json, ip_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          auditId,
          organizationId,
          businessId || null,
          auditMeta.actorUserId,
          auditMeta.actorRole,
          auditMeta.action,
          'organization_action_policies',
          recordId,
          JSON.stringify(safePayload),
          auditMeta.ipHash || 'UNKNOWN',
          now
        );

        // Atomic D1 batch execution
        await db.batch([policyStmt, auditStmt]);

        const storeKey = businessId ? `${organizationId}:${businessId}` : organizationId;
        this.inMemoryStore.set(storeKey, merged);
        return { policy: merged, auditLog };
      } catch (err: any) {
        SafeLogger.error('[ACTION_POLICY_D1_WRITE_FAILED]', {
          organizationId,
          businessId,
          errorCode: 'ACTION_POLICY_D1_WRITE_FAILED',
        });
        throw new Error('DATABASE_ERROR: Failed to save action policy to D1.');
      }
    }

    if (environment === 'production') {
      throw new Error('DATABASE_NOT_CONFIGURED: D1 binding required for saving action policy in production.');
    }

    const storeKey = businessId ? `${organizationId}:${businessId}` : organizationId;
    this.inMemoryStore.set(storeKey, merged);
    return { policy: merged, auditLog };
  }

  /**
   * Save or update tenant action policy in D1.
   */
  public static async savePolicy(
    db: D1Database | undefined,
    policy: Partial<OrganizationActionPolicy> & { organizationId: string; businessId?: string | null },
    environment: string = 'production'
  ): Promise<OrganizationActionPolicy> {
    const result = await this.savePolicyWithAudit(
      db,
      policy,
      {
        actorUserId: 'usr_internal_system',
        actorRole: 'ADMIN',
        action: 'ACTION_POLICY_SAVED',
        ipHash: 'UNKNOWN',
        diff: { updatedFields: Object.keys(policy) },
      },
      environment
    );
    return result.policy;
  }

  public static clearMemoryStore(): void {
    this.inMemoryStore.clear();
  }
}
