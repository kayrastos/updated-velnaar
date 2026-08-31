/**
 * @file worker/ai/actions/actionPolicyEngine.ts
 * @description Server-Side Deterministic Action Policy & Guardrail Enforcement
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. AI PROPOSES. DETERMINISTIC POLICY VALIDATES. HUMANS APPROVE.
 * 2. AI never approves its own action.
 * 3. Never return PASS by default without running evaluation.
 * 4. Global immutable invariants (human approval required, security safety checks).
 * 5. Business constraints (discounts, budgets, channels) come ONLY from tenant policy.
 * 6. Missing policy constraints fail-closed with POLICY_NOT_CONFIGURED / NOT_EVALUATED.
 * ============================================================================
 */

import { ActionPolicyValidationResult } from '../types';
import { OrganizationActionPolicy } from './actionPolicyRepository';

export interface BusinessPolicyConfig {
  organizationId?: string;
  businessId?: string | null;
  maximumDiscountPercent?: number | null;
  maximumAdBudgetMinor?: number | null;
  allowedChannels?: string[] | null;
  prohibitedActions?: string[];
  requiresApprovalForOutboundMessaging?: boolean;
  requiresApprovalForPriceChanges?: boolean;
  humanApprovalRequired?: boolean;
  autoExecutionEnabled?: boolean;
}

export class ActionPolicyEngine {
  // Global immutable security safety patterns (Universal Security Invariants)
  private static readonly GLOBAL_PROHIBITED_PATTERNS = [
    'wipe_customer_data',
    'bypass_approval_gate',
    'arbitrary_refund_dispatch',
    'autonomous_price_dumping',
    'bulk_unsolicited_sms',
  ];

  /**
   * Deterministically validate a growth action against business constraints and global invariants.
   */
  public static validate(
    actionPayload: Record<string, any>,
    tenantPolicy?: OrganizationActionPolicy | BusinessPolicyConfig
  ): ActionPolicyValidationResult {
    if (!actionPayload || typeof actionPayload !== 'object') {
      return {
        passed: false,
        violations: ['INVALID_PAYLOAD: Action payload must be a non-null object.'],
        riskScore: 1.0,
        guardrailStatus: 'FAILED',
        evaluatedPolicies: ['POLICY_PAYLOAD_INTEGRITY'],
      };
    }

    const violations: string[] = [];
    const evaluatedPolicies: string[] = [];
    let hasUnconfiguredPolicy = false;
    let riskScore = 0.05;

    // Policy 1: Mandatory Human Approval Verification (Global Immutable Invariant)
    evaluatedPolicies.push('POLICY_MANDATORY_HUMAN_APPROVAL');
    const hasHumanApproval = actionPayload.requiresHumanApproval === true;
    if (!hasHumanApproval) {
      violations.push('VIOLATION_AUTONOMOUS_EXECUTION_PROHIBITED: Autonomous execution is prohibited. All growth actions must explicitly require human approval (requiresHumanApproval: true).');
      riskScore = 1.0;
    }

    // Policy 2: Global Prohibited Security Operations Check
    evaluatedPolicies.push('POLICY_PROHIBITED_SECURITY_OPERATIONS');
    const actionName = `${actionPayload.actionType || ''} ${actionPayload.title || ''}`.toLowerCase();
    for (const prohibited of this.GLOBAL_PROHIBITED_PATTERNS) {
      if (actionName.includes(prohibited)) {
        violations.push(`GLOBAL_POLICY_VIOLATION: Action involves prohibited operation pattern: "${prohibited}".`);
        riskScore = 1.0;
      }
    }

    // Extract tenant constraints strictly from canonical policy fields
    const maxDiscount = tenantPolicy?.maximumDiscountPercent ?? null;
    const maxBudget = tenantPolicy?.maximumAdBudgetMinor ?? null;
    const allowedChannels = tenantPolicy?.allowedChannels ?? null;
    const tenantProhibited = tenantPolicy?.prohibitedActions ?? [];

    // Tenant Prohibited Actions Check
    if (tenantProhibited.length > 0) {
      evaluatedPolicies.push('POLICY_TENANT_PROHIBITED_ACTIONS');
      for (const prohibited of tenantProhibited) {
        if (actionName.includes(prohibited.toLowerCase())) {
          violations.push(`TENANT_POLICY_VIOLATION: Action involves tenant-prohibited operation: "${prohibited}".`);
          riskScore = 1.0;
        }
      }
    }

    // Policy 3: Maximum Discount Cap (Tenant-Configured Business Rule - No Invented Global Cap)
    const discount = actionPayload.discountPercent ?? actionPayload.discount_percent ?? actionPayload.discountPercentage;
    if (typeof discount === 'number') {
      evaluatedPolicies.push('POLICY_MAX_DISCOUNT_CAP');
      if (maxDiscount === null || maxDiscount === undefined) {
        violations.push(`POLICY_NOT_CONFIGURED: Organization discount policy is not configured (maximum_discount_percent is null). Cannot evaluate proposed discount of ${discount}%.`);
        hasUnconfiguredPolicy = true;
        riskScore = Math.max(riskScore, 0.90);
      } else if (discount > maxDiscount) {
        violations.push(`TENANT_POLICY_VIOLATION: Proposed discount (${discount}%) exceeds organization maximum allowable cap (${maxDiscount}%).`);
        riskScore = Math.max(riskScore, 0.85);
      }
    }

    // Policy 4: Maximum Budget Minor Cap (Tenant-Configured Business Rule)
    const budgetMinor = actionPayload.adBudgetMinor ?? actionPayload.budget_minor ?? actionPayload.budgetMinor;
    if (typeof budgetMinor === 'number') {
      evaluatedPolicies.push('POLICY_MAX_BUDGET_CAP');
      if (maxBudget === null || maxBudget === undefined) {
        violations.push(`POLICY_NOT_CONFIGURED: Organization ad budget policy is not configured (maximum_ad_budget_minor is null). Cannot evaluate proposed budget of ${budgetMinor} minor units.`);
        hasUnconfiguredPolicy = true;
        riskScore = Math.max(riskScore, 0.90);
      } else if (budgetMinor > maxBudget) {
        violations.push(`TENANT_POLICY_VIOLATION: Proposed budget allocation (${budgetMinor} minor units) exceeds policy cap of ${maxBudget} minor units.`);
        riskScore = Math.max(riskScore, 0.90);
      }
    }

    // Policy 5: Outbound Channel Validation (Tenant-Configured Business Rule)
    const channel = actionPayload.targetChannel || actionPayload.channel;
    if (channel) {
      evaluatedPolicies.push('POLICY_ALLOWED_CHANNELS');
      if (allowedChannels === null || allowedChannels === undefined) {
        violations.push(`POLICY_NOT_CONFIGURED: Organization channel policy is not configured (allowed_channels is null). Cannot evaluate proposed channel "${channel}".`);
        hasUnconfiguredPolicy = true;
        riskScore = Math.max(riskScore, 0.75);
      } else if (!allowedChannels.includes(channel)) {
        violations.push(`POLICY_VIOLATION: Outbound channel "${channel}" is not in approved channel whitelist.`);
        riskScore = Math.max(riskScore, 0.70);
      }
    }

    // Policy 6: Price Change Specific Policy Enforcement
    const isPriceChangeAction = actionPayload.actionType === 'pricing_adjustment' || typeof discount === 'number';
    if (isPriceChangeAction && tenantPolicy?.requiresApprovalForPriceChanges) {
      evaluatedPolicies.push('POLICY_PRICE_CHANGE_APPROVAL');
      if (!hasHumanApproval) {
        violations.push('POLICY_VIOLATION: Price change actions strictly require human approval.');
        riskScore = 1.0;
      }
    }

    // Policy 7: Outbound Messaging Specific Policy Enforcement
    const isOutboundMessagingAction = actionPayload.actionType === 'outbound_messaging' || channel !== undefined;
    if (isOutboundMessagingAction && tenantPolicy?.requiresApprovalForOutboundMessaging) {
      evaluatedPolicies.push('POLICY_OUTBOUND_MESSAGING_APPROVAL');
      if (!hasHumanApproval) {
        violations.push('POLICY_VIOLATION: Outbound messaging actions strictly require human approval.');
        riskScore = 1.0;
      }
    }

    const passed = violations.length === 0;
    const guardrailStatus: 'PASSED' | 'FAILED' | 'NOT_EVALUATED' = passed
      ? 'PASSED'
      : (hasUnconfiguredPolicy ? 'NOT_EVALUATED' : 'FAILED');

    return {
      passed,
      violations,
      riskScore: passed ? riskScore : Math.min(1.0, riskScore + 0.3),
      guardrailStatus,
      evaluatedPolicies,
    };
  }
}
