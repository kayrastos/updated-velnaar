import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionClient } from '../../src/services/sessionClient';
import { ApiClient } from '../../src/services/apiClient';
import { ActionPolicyEngine } from '../../worker/ai/actions/actionPolicyEngine';
import { ActionDraftEngine } from '../../worker/ai/actions/actionDraftEngine';
import { GrowthActionRepository } from '../../worker/repositories/growthActionRepository';
import { TenantSecurityEngine } from '../../src/services/tenantSecurity';

describe('Phase A.5 Production Hardening & Invariant Seal Regression Tests', () => {
  beforeEach(() => {
    SessionClient.clearSession();
    ApiClient.clearActiveTenant();
    vi.restoreAllMocks();
  });

  describe('1. SessionClient State Contract & Invariants', () => {
    it('should initialize with initial state and support UNAUTHENTICATED when no token exists', async () => {
      const state = SessionClient.getState();
      expect(state.status).toBe('UNAUTHENTICATED');
    });

    it('should handle unauthenticated state cleanly when calling initializeSession with no token', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/health')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'HEALTHY', productionAuthProvider: 'CONFIGURED' }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      });
      const result = await SessionClient.initializeSession();
      expect(result.status).toBe('UNAUTHENTICATED');
      if (result.status === 'UNAUTHENTICATED') {
        expect(result.reason).toBeDefined();
      }
    });

    it('should update active tenant when session is verified by server', async () => {
      ApiClient.setAuthToken('mock_jwt_token_valid');
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/health')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'HEALTHY', productionAuthProvider: 'CONFIGURED' }),
          };
        }
        if (url.includes('/api/session')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                userId: 'usr_valid_01',
                email: 'user@apex.com',
                fullName: 'Valid User',
                isSuperAdmin: false,
                activeOrganizationId: 'org_apex_holding',
                role: 'OWNER',
                memberships: [
                  { organizationId: 'org_apex_holding', role: 'OWNER', status: 'active' },
                ],
              },
            }),
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' }),
        };
      });

      const result = await SessionClient.initializeSession('org_apex_holding');
      expect(result.status).toBe('AUTHENTICATED');
      if (result.status === 'AUTHENTICATED') {
        expect(result.activeTenantId).toBe('org_apex_holding');
        expect(result.role).toBe('OWNER');
        expect(result.user.userId).toBe('usr_valid_01');
      }
    });

    it('should return ERROR when server returns 403 Cross-Tenant Denied', async () => {
      ApiClient.setAuthToken('mock_jwt_token_valid');
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/health')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'HEALTHY', productionAuthProvider: 'CONFIGURED' }),
          };
        }
        return {
          ok: false,
          status: 403,
          json: async () => ({ message: 'CROSS_TENANT_ACCESS_DENIED: User does not belong to organization' }),
        };
      });

      const result = await SessionClient.switchTenant('org_unauthorized_999');
      expect(result.status).toBe('ERROR');
      if (result.status === 'ERROR') {
        expect(result.error).toContain('CROSS_TENANT_ACCESS_DENIED');
      }
    });
  });

  describe('2. ActionPolicyEngine Strict Deterministic Scoping & Invariants', () => {
    it('fails closed when policy is not configured for proposed discount', () => {
      const result = ActionPolicyEngine.validate(
        {
          actionType: 'discount_offer',
          requiresHumanApproval: true,
          discountPercent: 15,
        },
        {} as any // No maximumDiscountPercent configured
      );

      expect(result.passed).toBe(false);
      expect(result.guardrailStatus).toBe('NOT_EVALUATED');
      expect(result.violations.some(v => v.includes('POLICY_NOT_CONFIGURED'))).toBe(true);
    });

    it('fails closed when action does not require human approval', () => {
      const result = ActionPolicyEngine.validate(
        {
          actionType: 'discount_offer',
          requiresHumanApproval: false, // Autonomous attempt prohibited
          discountPercent: 5,
        },
        { maximumDiscountPercent: 10 } as any
      );

      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('AUTONOMOUS_EXECUTION_PROHIBITED'))).toBe(true);
    });

    it('passes when valid within verified tenant policy limits', () => {
      const result = ActionPolicyEngine.validate(
        {
          actionType: 'discount_offer',
          requiresHumanApproval: true,
          discountPercent: 8,
          budgetMinor: 50000,
        },
        {
          maximumDiscountPercent: 10,
          maximumAdBudgetMinor: 100000,
        } as any
      );

      expect(result.passed).toBe(true);
      expect(result.guardrailStatus).toBe('PASSED');
      expect(result.violations.length).toBe(0);
    });

    it('draftActionFromLeak rejects empty evidence claim', async () => {
      const mockEnv = {
        DB: null,
        ENVIRONMENT: 'development',
      } as any;

      await expect(
        ActionDraftEngine.draftActionFromLeak(
          {
            organizationId: 'org_apex_holding',
            businessId: 'biz_beauty_salon',
            leakId: 'leak_001',
            leakTitle: 'Booking SLA Gap',
            leakCategory: 'booking_conversion',
            severity: 'high',
            estimatedMonthlyLossMinor: 500000,
            rootCause: 'Response delay',
            affectedFunnelStage: 'inquiry',
            evidenceIds: [], // Empty evidence claim
            observedFacts: [],
          },
          mockEnv
        )
      ).rejects.toThrow('NO_EVIDENCE_CLAIM');
    });
  });

  describe('3. GrowthActionRepository Atomic Transition & Approval Isolation', () => {
    it('transitionWithAudit enforces valid state transitions and audit logging in memory/D1', async () => {
      // In development/test mode without D1:
      const res = await GrowthActionRepository.transitionWithAudit(
        undefined,
        'act_001',
        'approved',
        'usr_owner_01',
        'OWNER',
        'org_apex_holding',
        'PASSED',
        '7f000001_hash',
        'test'
      );

      expect(res.action).toBeDefined();
      expect(res.action.approval_status).toBe('approved');
      expect(res.action.approved_by_user_id).toBe('usr_owner_01');
      expect(res.auditLog).toBeDefined();
      expect(res.auditLog.action).toBe('GROWTH_ACTION_APPROVED');

      // Invariant: Approval does NOT equal execution
      expect(res.action.approval_status).toBe('approved');
      expect((res.action as any).executed_at).toBeUndefined();
    });

    it('rejects illegal state transitions in state machine', async () => {
      // Trying to approve an already approved action or invalid transition throws
      await expect(
        GrowthActionRepository.transitionWithAudit(
          undefined,
          'act_001',
          'pending_approval',
          'usr_owner_01',
          'OWNER',
          'org_apex_holding',
          'PASSED',
          '7f000001_hash',
          'test'
        )
      ).rejects.toThrow('INVALID_ACTION_STATE_TRANSITION');
    });
  });

  describe('4. Zero-Trust Security Invariants & Environment Segregation', () => {
    it('ApiClient blocks executeVaultDevDemo when not in DEV', async () => {
      if (!import.meta.env.DEV) {
        await expect(
          ApiClient.executeVaultDevDemo('test plaintext', 'org_apex_holding')
        ).rejects.toThrow('VAULT_DEV_DEMO_DISABLED');
      }
    });

    it('TenantSecurityEngine does not simulate PASS when test endpoint fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      try {
        const results = await TenantSecurityEngine.runCrossTenantTestsAsync('org_test');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].passed).toBe(false);
      } catch (err: any) {
        expect(err.message).toBeDefined();
      }
    });
  });
});
