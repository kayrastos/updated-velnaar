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

  it('LeadRepository should isolate records by organization_id', async () => {
    const alphaLeads = await LeadRepository.listByOrg(undefined, orgAlpha);
    const betaLeads = await LeadRepository.listByOrg(undefined, orgBeta);

    expect(alphaLeads.every(l => l.organization_id === orgAlpha)).toBe(true);
    expect(betaLeads.every(l => l.organization_id === orgBeta)).toBe(true);
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
    }, orgAlpha);

    expect(newApt.organizationId).toBe(orgAlpha);
    expect(newApt.expectedValueMinor).toBe(35000);

    // Cross-tenant update attempt should fail (return null)
    const crossUpdate = await AppointmentRepository.updateStatus(undefined, newApt.id, 'cancelled', orgBeta, 'Malicious cancel');
    expect(crossUpdate).toBeNull();

    // Valid same-tenant update should succeed
    const validUpdate = await AppointmentRepository.updateStatus(undefined, newApt.id, 'cancelled', orgAlpha, 'Customer requested');
    expect(validUpdate).not.toBeNull();
    expect(validUpdate?.status).toBe('cancelled');
  });

  it('GrowthActionRepository should track human approval with user ID and timestamp', async () => {
    const actions = await GrowthActionRepository.listActionsByOrg(undefined, orgAlpha);
    expect(actions.length).toBeGreaterThan(0);

    const actionId = actions[0].id;
    const updated = await GrowthActionRepository.updateActionApproval(
      undefined,
      actionId,
      'approved',
      'usr_owner_01',
      orgAlpha
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
    }, orgAlpha);

    expect(stored.pseudonymId).toBeDefined();
    expect(stored.keyVersion).toBe(1);

    const decrypted = await IdentityVaultRepository.getDecryptedIdentity(undefined, stored.pseudonymId, orgAlpha);
    expect(decrypted).not.toBeNull();
    expect(decrypted?.fullName).toBe('Dr. John Doe');
    expect(decrypted?.email).toBe('john.doe@clinic.com');

    // Attempting cross-tenant decrypt should return null
    const crossDecrypted = await IdentityVaultRepository.getDecryptedIdentity(undefined, stored.pseudonymId, orgBeta);
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
        token: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret',
        apiKey: 'sec_prod_live_9999',
        reason: 'Customer requested data export',
      }),
      ip_hash: '127.0.0.1_hash',
    }, orgAlpha);

    expect(log.organization_id).toBe(orgAlpha);
    expect(log.payload_diff_json).toContain('[REDACTED_SECRET]');
    expect(log.payload_diff_json).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });
});
