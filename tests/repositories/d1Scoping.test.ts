import { describe, it, expect } from 'vitest';
import { LeadRepository } from '../../worker/repositories/leadRepository';
import { AppointmentRepository } from '../../worker/repositories/appointmentRepository';
import { GrowthActionRepository } from '../../worker/repositories/growthActionRepository';
import { RevenueLeakRepository } from '../../worker/repositories/revenueLeakRepository';
import { IdentityVaultRepository } from '../../worker/repositories/identityVaultRepository';
import { AuditRepository } from '../../worker/repositories/auditRepository';

describe('Tenant Scoping in Repositories (Cloudflare D1 Prepared SQL / In-Memory Fallback)', () => {
  const orgAlpha = 'org_apex_holding';
  const orgBeta = 'org_istanbul_dining';

  it('LeadRepository should isolate records by organization_id using D1 parameterized queries', async () => {
    // Mock D1 Database to verify query parameter binding
    const executedQueries: { query: string; params: any[] }[] = [];
    const mockDb: D1Database = {
      prepare(query: string) {
        return {
          bind(...params: any[]) {
            executedQueries.push({ query, params });
            return {
              async all() {
                const orgParam = params[0];
                return {
                  results: [
                    {
                      id: `lead_${orgParam}_01`,
                      business_id: 'biz_01',
                      organization_id: orgParam,
                      market: 'GLOBAL',
                      pseudonymous_customer_id: 'cus_01',
                      company_name: 'Test Co',
                      intent_score: 80,
                      estimated_deal_value_minor: 500000,
                      funnel_stage: 'captured',
                      leak_risk_factor: 'normal',
                      status: 'open',
                      response_latency_minutes: 10,
                      created_at: new Date().toISOString(),
                    }
                  ]
                };
              },
              async first() { return null; },
              async run() { return { success: true }; },
            } as any;
          }
        } as any;
      }
    } as any;

    const repo = new LeadRepository(mockDb);
    const alphaLeads = await repo.listByOrg(orgAlpha);
    const betaLeads = await repo.listByOrg(orgBeta);

    expect(alphaLeads.every(l => l.organization_id === orgAlpha)).toBe(true);
    expect(betaLeads.every(l => l.organization_id === orgBeta)).toBe(true);
    expect(executedQueries.some(q => q.params.includes(orgAlpha))).toBe(true);
    expect(executedQueries.some(q => q.params.includes(orgBeta))).toBe(true);
  });

  it('AppointmentRepository should enforce tenant boundary during status updates', async () => {
    const newApt = await AppointmentRepository.create(undefined, {
      businessId: 'biz_beauty_salon',
      customerName: 'Test Customer',
      customerPseudonymId: 'cus_ps_test_01',
      serviceName: 'Aesthetic Treatment',
      serviceCategory: 'Facial',
      resourceStaffId: 'stf_01',
      resourceStaffName: 'Elena',
      scheduledStart: '2026-08-24T10:00:00Z',
      scheduledEnd: '2026-08-24T10:45:00Z',
      durationMinutes: 45,
      expectedValueMinor: 35000,
      currency: 'USD',
      status: 'confirmed',
      source: 'velnar_manual',
    }, orgAlpha, 'test');

    expect(newApt.organizationId).toBe(orgAlpha);
    expect(newApt.expectedValueMinor).toBe(35000);

    // Cross-tenant update attempt should fail (return null)
    const crossUpdate = await AppointmentRepository.updateStatus(undefined, newApt.id, 'cancelled', orgBeta, 'Malicious cancel', 'test');
    expect(crossUpdate).toBeNull();

    // Valid same-tenant update should succeed
    const validUpdate = await AppointmentRepository.updateStatus(undefined, newApt.id, 'cancelled', orgAlpha, 'Customer requested', 'test');
    expect(validUpdate).not.toBeNull();
    expect(validUpdate?.status).toBe('cancelled');
  });

  it('GrowthActionRepository should track human approval with user ID and timestamp', async () => {
    const actions = await GrowthActionRepository.listActionsByOrg(undefined, orgAlpha, undefined, 'test');
    expect(actions.length).toBeGreaterThan(0);

    const actionId = actions[0].id;
    const updated = await GrowthActionRepository.updateActionApproval(
      undefined,
      actionId,
      'approved',
      'usr_owner_01',
      orgAlpha,
      'test'
    );

    expect(updated).not.toBeNull();
    expect(updated?.approval_status).toBe('approved');
    expect(updated?.approved_by_user_id).toBe('usr_owner_01');
    expect(updated?.approved_at).toBeDefined();
  });

  it('IdentityVaultRepository should encrypt PII into ciphertext before storage and decrypt on demand', async () => {
    const stored = await IdentityVaultRepository.storeIdentity(undefined, {
      fullName: 'Dr. John Doe',
      email: 'john.doe@clinic.com',
      phone: '+1 415 555 2671',
    }, orgAlpha, 'test');

    expect(stored.pseudonymId).toBeDefined();
    expect(stored.keyVersion).toBe(1);

    const decrypted = await IdentityVaultRepository.getDecryptedIdentity(undefined, stored.pseudonymId, orgAlpha, 'test');
    expect(decrypted).not.toBeNull();
    expect(decrypted?.fullName).toBe('Dr. John Doe');
    expect(decrypted?.email).toBe('john.doe@clinic.com');

    // Attempting cross-tenant decrypt should return null
    const crossDecrypted = await IdentityVaultRepository.getDecryptedIdentity(undefined, stored.pseudonymId, orgBeta, 'test');
    expect(crossDecrypted).toBeNull();
  });

  it('AuditRepository should append immutable logs with redacted payloads and enforced orgId', async () => {
    const log = await AuditRepository.append(undefined, {
      organization_id: 'org_fake_will_be_overridden',
      business_id: 'biz_beauty_salon',
      actor_id: 'usr_owner_01',
      actor_role: 'OWNER',
      action: 'SECURITY_VAULT_DECRYPT',
      target_entity_type: 'identity_vault',
      target_entity_id: 'cus_ps_99',
      payload_diff_json: JSON.stringify({
        apiKey: 'secret_key_12345',
        email: 'ceo@enterprise.com'
      }),
      ip_hash: '127.0.0.1'
    }, orgAlpha, 'test');

    expect(log.organization_id).toBe(orgAlpha);
    expect(log.payload_diff_json).not.toContain('secret_key_12345');
  });

  it('All repositories must fail-closed in production if D1 Database binding is missing', async () => {
    const leadRepo = new LeadRepository(undefined, 'production');
    await expect(leadRepo.listByOrg(orgAlpha)).rejects.toThrow(/DATABASE_NOT_CONFIGURED/);

    await expect(
      AppointmentRepository.listByOrg(undefined, orgAlpha, undefined, 'production')
    ).rejects.toThrow(/DATABASE_NOT_CONFIGURED/);

    await expect(
      RevenueLeakRepository.listByOrg(undefined, orgAlpha, undefined, 'production')
    ).rejects.toThrow(/DATABASE_NOT_CONFIGURED/);

    await expect(
      GrowthActionRepository.listActionsByOrg(undefined, orgAlpha, undefined, 'production')
    ).rejects.toThrow(/DATABASE_NOT_CONFIGURED/);

    await expect(
      IdentityVaultRepository.listCiphertextRecords(undefined, orgAlpha, 'production')
    ).rejects.toThrow(/DATABASE_NOT_CONFIGURED/);

    await expect(
      AuditRepository.listByOrg(undefined, orgAlpha, 100, 'production')
    ).rejects.toThrow(/DATABASE_NOT_CONFIGURED/);
  });
});
