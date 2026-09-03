import { describe, it, expect, beforeEach } from 'vitest';
import { ActionPolicyEngine } from '../../worker/ai/actions/actionPolicyEngine';
import { ActionPolicyRepository, OrganizationActionPolicy } from '../../worker/ai/actions/actionPolicyRepository';
import { GrowthActionRepository } from '../../worker/repositories/growthActionRepository';

const standardTestPolicy: OrganizationActionPolicy = {
  id: 'pol_test_01',
  organizationId: 'org_test',
  maximumDiscountPercent: 25,
  maximumAdBudgetMinor: 100000,
  allowedChannels: ['ops_dashboard', 'email'],
  prohibitedActions: [],
  requiresApprovalForOutboundMessaging: true,
  requiresApprovalForPriceChanges: true,
  humanApprovalRequired: true,
  autoExecutionEnabled: false,
  configured: true,
};

describe('Sprint 4 - Deterministic Action Policy Engine & Business Scoping', () => {
  beforeEach(() => {
    ActionPolicyRepository.clearMemoryStore();
  });

  it('passes safe growth actions requiring human approval within policy limits', () => {
    const validAction = {
      title: 'Automated 15-Minute SLA Dispatch',
      actionType: 'high_intent_sla_dispatch',
      requiresHumanApproval: true,
      discountPercent: 10,
      adBudgetMinor: 50000,
      targetChannel: 'ops_dashboard',
    };

    const result = ActionPolicyEngine.validate(validAction, standardTestPolicy);
    expect(result.passed).toBe(true);
    expect(result.guardrailStatus).toBe('PASSED');
    expect(result.violations).toHaveLength(0);
    expect(result.riskScore).toBeLessThan(0.5);
  });

  it('fails actions attempting autonomous execution (requiresHumanApproval: false)', () => {
    const autonomousAction = {
      title: 'Auto Run Campaign',
      actionType: 'workflow_automation',
      requiresHumanApproval: false, // Forbidden in Sprint 4
      discountPercent: 5,
    };

    const result = ActionPolicyEngine.validate(autonomousAction, standardTestPolicy);
    expect(result.passed).toBe(false);
    expect(result.guardrailStatus).toBe('FAILED');
    expect(result.violations[0]).toContain('Autonomous execution is prohibited');
  });

  it('fails actions exceeding organization discount caps', () => {
    const excessiveDiscountAction = {
      title: 'Mega Flash Sale',
      actionType: 'pricing_adjustment',
      requiresHumanApproval: true,
      discountPercent: 45, // Cap is 25%
    };

    const result = ActionPolicyEngine.validate(excessiveDiscountAction, standardTestPolicy);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('exceeds organization maximum allowable cap');
  });

  it('fails closed with NOT_EVALUATED and POLICY_NOT_CONFIGURED when policy is unconfigured', () => {
    const actionWithDiscount = {
      title: 'Mega Flash Sale',
      actionType: 'pricing_adjustment',
      requiresHumanApproval: true,
      discountPercent: 15,
    };

    const result = ActionPolicyEngine.validate(actionWithDiscount); // No policy supplied
    expect(result.passed).toBe(false);
    expect(result.guardrailStatus).toBe('NOT_EVALUATED');
    expect(result.violations[0]).toContain('POLICY_NOT_CONFIGURED');
  });

  it('fails prohibited actions (such as arbitrary price dumping or data wipe)', () => {
    const prohibitedAction = {
      title: 'Autonomous Price Dumping Routine',
      actionType: 'autonomous_price_dumping',
      requiresHumanApproval: true,
    };

    const result = ActionPolicyEngine.validate(prohibitedAction, standardTestPolicy);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('prohibited operation pattern');
  });

  it('enforces tenant-specific strict discount limits lower than global cap', () => {
    const action = {
      title: 'Small Seasonal Discount',
      actionType: 'pricing_adjustment',
      requiresHumanApproval: true,
      discountPercent: 15,
    };

    const strictTenantPolicy: OrganizationActionPolicy = {
      organizationId: 'org_strict_tenant',
      maximumDiscountPercent: 10, // Tenant sets strict 10%
      maximumAdBudgetMinor: 500000,
      allowedChannels: ['ops_dashboard'],
      prohibitedActions: [],
      requiresApprovalForOutboundMessaging: true,
      requiresApprovalForPriceChanges: true,
      humanApprovalRequired: true,
      autoExecutionEnabled: false,
      configured: true,
    };

    const result = ActionPolicyEngine.validate(action, strictTenantPolicy);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('exceeds organization maximum allowable cap (10%)');
  });

  it('respects explicitly configured high discount cap without inventing a global 50% limit', () => {
    const action = {
      title: 'Giant 60% Clearance',
      actionType: 'pricing_adjustment',
      requiresHumanApproval: true,
      discountPercent: 60,
    };

    // Explicitly configured tenant policy allows 70%
    const permissiveTenantPolicy: OrganizationActionPolicy = {
      organizationId: 'org_permissive',
      maximumDiscountPercent: 70,
      maximumAdBudgetMinor: 5000000,
      allowedChannels: ['ops_dashboard'],
      prohibitedActions: [],
      requiresApprovalForOutboundMessaging: true,
      requiresApprovalForPriceChanges: true,
      humanApprovalRequired: true,
      autoExecutionEnabled: false,
      configured: true,
    };

    // 60% is within the 70% limit
    const result = ActionPolicyEngine.validate(action, permissiveTenantPolicy);
    expect(result.passed).toBe(true);
    expect(result.guardrailStatus).toBe('PASSED');

    // 80% exceeds the 70% limit
    const excessiveAction = { ...action, discountPercent: 80 };
    const excessiveResult = ActionPolicyEngine.validate(excessiveAction, permissiveTenantPolicy);
    expect(excessiveResult.passed).toBe(false);
    expect(excessiveResult.violations[0]).toContain('exceeds organization maximum allowable cap (70%)');
  });

  it('enforces requiresApprovalForPriceChanges invariant', () => {
    const priceChangeAction = {
      title: 'Update Menu Pricing',
      actionType: 'pricing_adjustment',
      requiresHumanApproval: false,
      discountPercent: 5,
    };

    const policy: OrganizationActionPolicy = {
      ...standardTestPolicy,
      requiresApprovalForPriceChanges: true,
    };

    const result = ActionPolicyEngine.validate(priceChangeAction, policy);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.includes('Price change actions strictly require human approval'))).toBe(true);
  });

  it('enforces requiresApprovalForOutboundMessaging invariant', () => {
    const messagingAction = {
      title: 'Send Bulk SMS blast',
      actionType: 'outbound_messaging',
      targetChannel: 'sms',
      requiresHumanApproval: false,
    };

    const policy: OrganizationActionPolicy = {
      ...standardTestPolicy,
      allowedChannels: ['sms'],
      requiresApprovalForOutboundMessaging: true,
    };

    const result = ActionPolicyEngine.validate(messagingAction, policy);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.includes('Outbound messaging actions strictly require human approval'))).toBe(true);
  });

  it('rejects targetChannel not in allowedChannels', () => {
    const action = {
      title: 'WhatsApp Blast',
      actionType: 'notification',
      targetChannel: 'whatsapp',
      requiresHumanApproval: true,
    };

    const policy: OrganizationActionPolicy = {
      ...standardTestPolicy,
      allowedChannels: ['email', 'ops_dashboard'],
    };

    const result = ActionPolicyEngine.validate(action, policy);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('Outbound channel "whatsapp" is not in approved channel whitelist');
  });

  describe('ActionPolicyRepository business-scoped precedence', () => {
    it('returns business-specific policy when configured', async () => {
      const orgPolicy: Partial<OrganizationActionPolicy> & { organizationId: string } = {
        organizationId: 'org_apex',
        maximumDiscountPercent: 20,
      };
      const bizPolicy: Partial<OrganizationActionPolicy> & { organizationId: string; businessId: string } = {
        organizationId: 'org_apex',
        businessId: 'biz_salon',
        maximumDiscountPercent: 40,
      };

      await ActionPolicyRepository.savePolicy(undefined, orgPolicy, 'development');
      await ActionPolicyRepository.savePolicy(undefined, bizPolicy, 'development');

      // Org-level fetch gets 20%
      const fetchedOrg = await ActionPolicyRepository.getPolicy(undefined, 'org_apex', undefined, 'development');
      expect(fetchedOrg.maximumDiscountPercent).toBe(20);

      // Business-level fetch gets 40%
      const fetchedBiz = await ActionPolicyRepository.getPolicy(undefined, 'org_apex', 'biz_salon', 'development');
      expect(fetchedBiz.maximumDiscountPercent).toBe(40);
      expect(fetchedBiz.businessId).toBe('biz_salon');
    });

    it('falls back to organization policy when business policy is not configured', async () => {
      const orgPolicy: Partial<OrganizationActionPolicy> & { organizationId: string } = {
        organizationId: 'org_apex',
        maximumDiscountPercent: 30,
      };

      await ActionPolicyRepository.savePolicy(undefined, orgPolicy, 'development');

      // Requesting unconfigured biz_restaurant falls back to org policy (30%)
      const fetchedBiz = await ActionPolicyRepository.getPolicy(undefined, 'org_apex', 'biz_restaurant', 'development');
      expect(fetchedBiz.maximumDiscountPercent).toBe(30);
      expect(fetchedBiz.configured).toBe(true);
    });

    it('fails closed when neither org nor biz policy is configured', async () => {
      const unconfigured = await ActionPolicyRepository.getPolicy(undefined, 'org_unconfigured', 'biz_none', 'development');
      expect(unconfigured.configured).toBe(false);
      expect(unconfigured.humanApprovalRequired).toBe(true);
      expect(unconfigured.autoExecutionEnabled).toBe(false);
    });

    it('fails closed and throws on D1 read error in production', async () => {
      const brokenDb = {
        prepare: () => {
          throw new Error('D1 connection reset');
        }
      } as any;

      await expect(
        ActionPolicyRepository.getPolicy(brokenDb, 'org_prod', 'biz_prod', 'production')
      ).rejects.toThrow('DATABASE_ERROR');
    });
  });

  describe('GrowthActionRepository transitionWithAudit hardening', () => {
    beforeEach(() => {
      GrowthActionRepository.resetMemoryStore();
    });

    it('refuses to approve an action unless guardrailStatus is PASSED', async () => {
      await expect(
        GrowthActionRepository.transitionWithAudit(
          undefined,
          'act_001',
          'approved',
          'usr_approver',
          'OWNER',
          'org_apex_holding',
          'FAILED',
          'UNKNOWN',
          'development'
        )
      ).rejects.toThrow('GUARDRAIL_NOT_PASSED');

      await expect(
        GrowthActionRepository.transitionWithAudit(
          undefined,
          'act_001',
          'approved',
          'usr_approver',
          'OWNER',
          'org_apex_holding',
          'NOT_EVALUATED',
          'UNKNOWN',
          'development'
        )
      ).rejects.toThrow('GUARDRAIL_NOT_PASSED');
    });

    it('approves an action when guardrailStatus is PASSED and records metadata', async () => {
      const result = await GrowthActionRepository.transitionWithAudit(
        undefined,
        'act_001',
        'approved',
        'usr_approver',
        'OWNER',
        'org_apex_holding',
        'PASSED',
        'UNKNOWN',
        'development'
      );

      expect(result).not.toBeNull();
      expect(result.action).toBeDefined();
      expect(result.action.approval_status).toBe('approved');
      expect(result.action.approved_by_user_id).toBe('usr_approver');
      expect(result.action.approved_at).toBeDefined();
      expect(result.action.guardrail_status).toBe('PASSED');
    });

    it('nullifies approver fields when action is rejected or deferred', async () => {
      const rejectedResult = await GrowthActionRepository.transitionWithAudit(
        undefined,
        'act_001',
        'rejected',
        'usr_rejecter',
        'OWNER',
        'org_apex_holding',
        'NOT_EVALUATED',
        'UNKNOWN',
        'development'
      );

      expect(rejectedResult.action.approval_status).toBe('rejected');
      expect(rejectedResult.action.approved_by_user_id).toBeUndefined();
      expect(rejectedResult.action.approved_at).toBeUndefined();
    });
  });
});
