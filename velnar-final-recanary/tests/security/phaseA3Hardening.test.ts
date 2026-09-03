/**
 * @file phaseA3Hardening.test.ts
 * @description Test Matrix for Sprint 4 Final Seal - Phase A.3 Hardening
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessTenantGuard } from '../../worker/middleware/businessTenantGuard';
import { ActionPolicyRepository } from '../../worker/ai/actions/actionPolicyRepository';
import { GrowthActionRepository } from '../../worker/repositories/growthActionRepository';
import { AuditRepository } from '../../worker/repositories/auditRepository';
import { TenantSecurityEngine } from '../../src/services/tenantSecurity';
import { SessionClient } from '../../src/services/sessionClient';
import { ApiClient } from '../../src/services/apiClient';

describe('Sprint 4 Phase A.3 - Zero-Compromise Hardening & Tenant Boundary Verification', () => {
  beforeEach(() => {
    BusinessTenantGuard.resetTestBusinesses();
    ApiClient.clearAuthToken();
    ApiClient.clearActiveTenant();
  });

  describe('1. Business-to-Organization Tenant Integrity (BusinessTenantGuard)', () => {
    it('allows business that belongs to authorized organization', async () => {
      const res = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
        undefined,
        'org_apex_holding',
        'biz_beauty_salon',
        'development'
      );
      expect(res.valid).toBe(true);
      expect(res.organizationId).toBe('org_apex_holding');
      expect(res.businessId).toBe('biz_beauty_salon');
    });

    it('blocks business belonging to a different organization (Cross-Tenant Attack)', async () => {
      const res = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
        undefined,
        'org_istanbul_dining',
        'biz_beauty_salon', // belongs to org_apex_holding
        'development'
      );
      expect(res.valid).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.errorMessage).toContain('BUSINESS_CROSS_TENANT_FORBIDDEN');
    });

    it('assertBusinessBelongsToOrganization throws 403 error on mismatch', async () => {
      await expect(
        BusinessTenantGuard.assertBusinessBelongsToOrganization(
          undefined,
          'org_other_corp',
          'biz_beauty_salon',
          'development'
        )
      ).rejects.toThrow('BUSINESS_CROSS_TENANT_FORBIDDEN');
    });

    it('assertBusinessBelongsToOrganization fails closed in production when DB is missing', async () => {
      await expect(
        BusinessTenantGuard.assertBusinessBelongsToOrganization(
          undefined,
          'org_prod',
          'biz_prod_1',
          'production'
        )
      ).rejects.toThrow('DATABASE_ERROR');
    });

    it('queries D1 correctly with prepared statement when DB is provided', async () => {
      let executedSql = '';
      let boundParams: any[] = [];

      const mockDb = {
        prepare: (sql: string) => {
          executedSql = sql;
          return {
            bind: (...params: any[]) => {
              boundParams = params;
              return {
                first: async () => ({ id: 'biz_01' })
              };
            }
          };
        }
      } as any;

      const res = await BusinessTenantGuard.verifyBusinessBelongsToOrganization(
        mockDb,
        'org_target_99',
        'biz_01',
        'production'
      );

      expect(res.valid).toBe(true);
      expect(executedSql).toContain('SELECT id FROM businesses WHERE id = ? AND organization_id = ?');
      expect(boundParams).toEqual(['biz_01', 'org_target_99']);
    });
  });

  describe('2. Action Policy Hardening & Fail-Closed D1 Logic', () => {
    it('ActionPolicyRepository enforces business ownership before reading policy', async () => {
      await expect(
        ActionPolicyRepository.getPolicy(
          undefined,
          'org_istanbul_dining',
          'biz_beauty_salon', // cross-tenant mismatch
          'development'
        )
      ).rejects.toThrow('BUSINESS_CROSS_TENANT_FORBIDDEN');
    });

    it('ActionPolicyRepository throws on D1 database failure in production (no silent fallback)', async () => {
      const failingDb = {
        prepare: () => {
          throw new Error('D1 storage unavailable');
        }
      } as any;

      await expect(
        ActionPolicyRepository.getPolicy(
          failingDb,
          'org_prod_1',
          'biz_prod_1',
          'production'
        )
      ).rejects.toThrow('DATABASE_ERROR');
    });
  });

  describe('3. Atomic Action State Transition & Audit Trail (transitionWithAudit)', () => {
    it('executes batch transaction with action update and audit log', async () => {
      let batchStatements: any[] = [];

      const mockDb = {
        prepare: (sql: string) => ({
          bind: (...params: any[]) => ({
            sql,
            params,
            first: async () => ({
              id: 'act_101',
              organization_id: 'org_apex_holding',
              business_id: 'biz_beauty_salon',
              approval_status: 'pending_approval',
              guardrail_status: 'PASSED',
              requires_approval: 1,
            }),
          }),
        }),
        batch: async (statements: any[]) => {
          batchStatements = statements;
          return statements.map(() => ({ success: true }));
        }
      } as any;

      const result = await GrowthActionRepository.transitionWithAudit(
        mockDb,
        'act_101',
        'approved',
        'usr_approver_01',
        'OWNER',
        'org_apex_holding',
        'PASSED',
        'ip_hash_01',
        'production'
      );

      expect(result).toBeDefined();
      expect(result.action.id).toBe('act_101');
      expect(result.auditLog).toBeDefined();
      expect(result.auditLog.action).toBe('GROWTH_ACTION_APPROVED');
      expect(batchStatements.length).toBe(2);
      expect(batchStatements[0].sql).toContain('UPDATE growth_actions');
      expect(batchStatements[1].sql).toContain('INSERT INTO audit_logs');
    });

    it('rejects approval if action guardrail_status is NOT PASSED', async () => {
      const mockDb = {
        prepare: () => ({
          bind: () => ({}),
          first: async () => ({
            id: 'act_102',
            organization_id: 'org_apex_holding',
            approval_status: 'pending_approval',
            guardrail_status: 'FAILED',
            requires_approval: 1,
          })
        })
      } as any;

      await expect(
        GrowthActionRepository.transitionWithAudit(
          mockDb,
          'act_102',
          'approved',
          'usr_approver_01',
          'OWNER',
          'org_apex_holding',
          'FAILED',
          'ip_hash_01',
          'production'
        )
      ).rejects.toThrow('GUARDRAIL_NOT_PASSED');
    });
  });

  describe('4. Audit Repository Integrity', () => {
    it('does not invent fake business ID or IP hashes', async () => {
      let boundParams: any[] = [];
      const mockDb = {
        prepare: (sql: string) => ({
          bind: (...params: any[]) => {
            boundParams = params;
            return {
              run: async () => ({ success: true })
            };
          }
        })
      } as any;

      await AuditRepository.append(
        mockDb,
        {
          organization_id: 'org_target',
          business_id: null,
          actor_id: 'usr_01',
          actor_role: 'OWNER',
          action: 'ACTION_APPROVED',
          target_entity_type: 'growth_actions',
          target_entity_id: 'act_01',
          payload_diff_json: JSON.stringify({ status: 'approved' }),
          ip_hash: null,
        },
        'org_target',
        'production'
      );

      // business_id is param 2 (0=id, 1=orgId, 2=bizId, ...)
      expect(boundParams[2]).toBeNull();
    });
  });

  describe('5. Client-Side Security Services Cleanup', () => {
    it('TenantSecurityEngine.runCrossTenantTestsAsync throws if orgId is empty', async () => {
      await expect(
        TenantSecurityEngine.runCrossTenantTestsAsync('')
      ).rejects.toThrow('TENANT_ID_REQUIRED');
    });
  });
});
