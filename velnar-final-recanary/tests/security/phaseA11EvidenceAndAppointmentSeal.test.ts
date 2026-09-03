import { describe, it, expect } from 'vitest';
import worker from '../../worker/index';
import { RevenueLeakEngine } from '../../src/services/revenueLeakEngine';
import { LeadRow } from '../../src/types/database';
import { Appointment } from '../../src/types/appointment';
import { CallMetadataEvent } from '../../src/types/telephony';
import { AppointmentRepository } from '../../worker/repositories/appointmentRepository';

describe('PHASE A.11 SEAL: Evidence Completeness & Appointment Mutation Seal', () => {
  describe('1. Evidence Coverage & Completeness Engine Verification', () => {
    const mockProposalLead: LeadRow = {
      id: 'lead_test_01',
      organization_id: 'org_apex_holding',
      business_id: 'biz_beauty_salon',
      market: 'TR',
      pseudonymous_customer_id: 'cus_test_99',
      company_name: 'Alpha Dental',
      intent_score: 90,
      estimated_deal_value_minor: 500000,
      funnel_stage: 'proposal_sent',
      leak_risk_factor: 'high_decay',
      status: 'open',
      response_latency_minutes: 120,
      created_at: '2026-08-20T10:00:00Z',
    };

    const pastDate = new Date(Date.now() - 100 * 3600 * 1000).toISOString();

    it('RULE C: suppresses follow-up gap when leadActivityEvidence is missing or incomplete', () => {
      // Missing leadActivityEvidence entirely
      const res1 = RevenueLeakEngine.evaluateAll({
        leads: [mockProposalLead],
        appointments: [],
        calls: [],
        leadActivityEvidence: [],
        currency: 'TRY',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleC1 = res1.find(f => f.ruleId === 'RULE_FOLLOW_UP_GAP');
      expect(ruleC1).toBeUndefined();

      // Incomplete leadActivityEvidence (isComplete = false)
      const res2 = RevenueLeakEngine.evaluateAll({
        leads: [mockProposalLead],
        appointments: [],
        calls: [],
        leadActivityEvidence: [
          {
            businessId: 'biz_test_01',
            leadId: 'lead_test_01',
            proposalSentAt: pastDate,
            lastFollowUpAt: null,
            lastActivityAt: null,
            isComplete: false,
            coverageStart: new Date(Date.now() - 120 * 3600 * 1000).toISOString(),
            coverageEnd: new Date().toISOString(),
            source: 'crm_sync',
          }
        ],
        currency: 'TRY',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleC2 = res2.find(f => f.ruleId === 'RULE_FOLLOW_UP_GAP');
      expect(ruleC2).toBeUndefined();
    });

    it('RULE C: detects follow-up gap when leadActivityEvidence is verified and complete', () => {
      const res = RevenueLeakEngine.evaluateAll({
        leads: [mockProposalLead],
        appointments: [],
        calls: [],
        leadActivityEvidence: [
          {
            businessId: 'biz_test_01',
            leadId: 'lead_test_01',
            proposalSentAt: pastDate,
            lastFollowUpAt: null,
            lastActivityAt: null,
            isComplete: true,
            coverageStart: new Date(Date.now() - 120 * 3600 * 1000).toISOString(),
            coverageEnd: new Date().toISOString(),
            source: 'crm_sync',
          }
        ],
        currency: 'TRY',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleC = res.find(f => f.ruleId === 'RULE_FOLLOW_UP_GAP');
      expect(ruleC).toBeDefined();
      expect(ruleC?.severity).toBe('high');
    });

    it('RULE D: suppresses missed call leaks when callHistoryCoverage is missing or incomplete', () => {
      const pastCallDate = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
      const mockCalls: CallMetadataEvent[] = [
        {
          id: 'call_01',
          organizationId: 'org_apex_holding',
          businessId: 'biz_beauty_salon',
          pseudonymousCallerId: 'cus_caller_01',
          source: 'website_header',
          status: 'missed',
          direction: 'inbound',
          startedAt: pastCallDate,
          endedAt: pastCallDate,
          waitDurationSeconds: 15,
          callDurationSeconds: 0,
        }
      ];

      // Missing callHistoryCoverage
      const res1 = RevenueLeakEngine.evaluateAll({
        leads: [],
        appointments: [],
        calls: mockCalls,
        callHistoryCoverage: undefined,
        currency: 'TRY',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleD1 = res1.find(f => f.ruleId === 'RULE_MISSED_INBOUND_CALL');
      expect(ruleD1).toBeUndefined();

      // Incomplete callHistoryCoverage (isComplete = false)
      const res2 = RevenueLeakEngine.evaluateAll({
        leads: [],
        appointments: [],
        calls: mockCalls,
        callHistoryCoverage: {
          businessId: 'biz_beauty_salon',
          coveredFrom: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
          coveredTo: new Date().toISOString(),
          isComplete: false,
        },
        currency: 'TRY',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleD2 = res2.find(f => f.ruleId === 'RULE_MISSED_INBOUND_CALL');
      expect(ruleD2).toBeUndefined();

      // Verified complete coverage
      const res3 = RevenueLeakEngine.evaluateAll({
        leads: [],
        appointments: [],
        calls: mockCalls,
        callHistoryCoverage: {
          businessId: 'biz_beauty_salon',
          coveredFrom: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
          coveredTo: new Date().toISOString(),
          isComplete: true,
        },
        currency: 'TRY',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleD3 = res3.find(f => f.ruleId === 'RULE_MISSED_INBOUND_CALL');
      expect(ruleD3).toBeDefined();
    });

    it('RULE E: suppresses no-show leaks when appointmentHistoryCoverage is missing or incomplete', () => {
      const pastAptStart = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const pastAptEnd = new Date(Date.now() - 47 * 3600 * 1000).toISOString();
      const mockAppointments: Appointment[] = [
        {
          id: 'apt_noshow_01',
          organizationId: 'org_apex_holding',
          businessId: 'biz_beauty_salon',
          customerPseudonymId: 'cus_noshow_01',
          serviceName: 'Aesthetic Treatment',
          serviceCategory: 'Aesthetics',
          resourceStaffId: 'staff_01',
          resourceStaffName: 'Dr. Jane Doe',
          scheduledStart: pastAptStart,
          scheduledEnd: pastAptEnd,
          durationMinutes: 60,
          expectedValueMinor: 40000,
          currency: 'USD',
          status: 'no_show',
          source: 'velnar_manual',
          rowVersion: 0,
          createdAt: pastAptStart,
          updatedAt: pastAptStart,
        }
      ];

      // Missing appointmentHistoryCoverage
      const res1 = RevenueLeakEngine.evaluateAll({
        leads: [],
        appointments: mockAppointments,
        calls: [],
        appointmentHistoryCoverage: undefined,
        currency: 'USD',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleE1 = res1.find(f => f.ruleId === 'RULE_APPOINTMENT_NO_SHOW_GAP');
      expect(ruleE1).toBeUndefined();

      // Incomplete appointmentHistoryCoverage
      const res2 = RevenueLeakEngine.evaluateAll({
        leads: [],
        appointments: mockAppointments,
        calls: [],
        appointmentHistoryCoverage: {
          businessId: 'biz_beauty_salon',
          coveredFrom: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
          coveredTo: new Date().toISOString(),
          isComplete: false,
        },
        currency: 'USD',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleE2 = res2.find(f => f.ruleId === 'RULE_APPOINTMENT_NO_SHOW_GAP');
      expect(ruleE2).toBeUndefined();

      // Verified complete coverage
      const res3 = RevenueLeakEngine.evaluateAll({
        leads: [],
        appointments: mockAppointments,
        calls: [],
        appointmentHistoryCoverage: {
          businessId: 'biz_beauty_salon',
          coveredFrom: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
          coveredTo: new Date().toISOString(),
          isComplete: true,
        },
        currency: 'USD',
        evaluationTimestamp: new Date().toISOString(),
      });
      const ruleE3 = res3.find(f => f.ruleId === 'RULE_APPOINTMENT_NO_SHOW_GAP');
      expect(ruleE3).toBeDefined();
    });

    it('enforces strict mathematical rate (0-1) and non-negative money boundaries on assumptions', () => {
      const mockHighIntentLead: LeadRow = {
        id: 'lead_test_high_01',
        organization_id: 'org_apex_holding',
        business_id: 'biz_beauty_salon',
        market: 'TR',
        pseudonymous_customer_id: 'cus_test_99',
        company_name: 'Alpha Dental',
        intent_score: 90,
        estimated_deal_value_minor: 500000,
        funnel_stage: 'captured',
        leak_risk_factor: 'high_decay',
        status: 'open',
        response_latency_minutes: 120,
        created_at: '2026-08-20T10:00:00Z',
      };

      // Invalid rate > 1
      const resInvalidRate = RevenueLeakEngine.evaluateAll({
        leads: [mockHighIntentLead],
        appointments: [],
        calls: [],
        conversionRateAssumption: {
          value: 1.5, // Invalid > 1
          provenance: { source: 'BUSINESS_CONFIGURED', confidence: 'HIGH' }
        },
        currency: 'TRY',
        evaluationTimestamp: new Date().toISOString(),
      });
      const rule = resInvalidRate.find(f => f.ruleId === 'RULE_MISSED_HIGH_INTENT_LEAD');
      expect(rule).toBeDefined();
      expect(rule?.isDataInsufficient).toBe(true);
      expect(rule?.impactStatus).toBe('INSUFFICIENT_DATA');
      expect(rule?.estimatedImpactMinor).toBeNull();
    });
  });

  describe('2. Phase A.12A: Appointment Mutation Zero-Compromise Seal', () => {
    const validHeaders = {
      'Authorization': 'Bearer test_user:usr_dev_owner:org_apex_holding:OWNER',
      'Content-Type': 'application/json',
    };

    it('POST /api/appointments without query businessId -> 400 BUSINESS_ID_REQUIRED', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_123',
            serviceName: 'Dental Cleaning',
            serviceCategory: 'Hygiene',
            resourceStaffName: 'Dr. Smith',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            expectedValueMinor: 10000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_ID_REQUIRED');
    });

    it('POST /api/appointments rejects body.businessId with 400 BAD_REQUEST', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            businessId: 'biz_beauty_salon',
            customerPseudonymId: 'cus_123',
            serviceName: 'Dental Cleaning',
            serviceCategory: 'Hygiene',
            resourceStaffName: 'Dr. Smith',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            expectedValueMinor: 10000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
    });

    it('POST /api/appointments rejects body.currency with 400 BAD_REQUEST', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            currency: 'USD',
            customerPseudonymId: 'cus_123',
            serviceName: 'Dental Cleaning',
            serviceCategory: 'Hygiene',
            resourceStaffName: 'Dr. Smith',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            expectedValueMinor: 10000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
    });

    it('POST /api/appointments rejects body.customerName with 400 BAD_REQUEST', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerName: 'John Doe',
            customerPseudonymId: 'cus_123',
            serviceName: 'Dental Cleaning',
            serviceCategory: 'Hygiene',
            resourceStaffName: 'Dr. Smith',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            expectedValueMinor: 10000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
    });

    it('POST /api/appointments rejects body.status and body.source with 400 BAD_REQUEST', async () => {
      const res1 = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            status: 'confirmed',
            customerPseudonymId: 'cus_123',
            serviceName: 'Dental Cleaning',
            serviceCategory: 'Hygiene',
            resourceStaffName: 'Dr. Smith',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            expectedValueMinor: 10000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res1.status).toBe(400);
      expect((await res1.json() as any).error).toBe('BAD_REQUEST');

      const res2 = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            source: 'velnar_manual',
            customerPseudonymId: 'cus_123',
            serviceName: 'Dental Cleaning',
            serviceCategory: 'Hygiene',
            resourceStaffName: 'Dr. Smith',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            expectedValueMinor: 10000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res2.status).toBe(400);
      expect((await res2.json() as any).error).toBe('BAD_REQUEST');
    });

    it('POST /api/appointments rejects cross-tenant query businessId with 404', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_bosphorus_grill', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_123',
            serviceName: 'Dental Cleaning',
            serviceCategory: 'Hygiene',
            resourceStaffId: 'stf_01',
            scheduledStart: '2026-08-25T10:00:00Z',
            scheduledEnd: '2026-08-25T11:00:00Z',
            expectedValueMinor: 10000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_NOT_FOUND');
    });

    it('POST /api/appointments creates appointment and returns 201 with server-owned currency, status scheduled, source velnar_manual, and auditLogId', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_a12',
            serviceName: 'Comprehensive Facial Protocol',
            serviceCategory: 'Facial Aesthetics',
            resourceStaffId: 'stf_01',
            scheduledStart: '2026-08-26T14:00:00Z',
            scheduledEnd: '2026-08-26T15:00:00Z',
            expectedValueMinor: 45000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.id).toMatch(/^apt_/);
      expect(json.data.businessId).toBe('biz_beauty_salon');
      expect(json.data.organizationId).toBe('org_apex_holding');
      expect(json.data.currency).toBe('USD'); // Server owned from biz_beauty_salon
      expect(json.data.status).toBe('scheduled');
      expect(json.data.source).toBe('velnar_manual');
      expect(json.data.resourceStaffId).toBe('stf_01');
      expect(json.data.resourceStaffName).toBe('Elena Rostova (Master Esthetician)');
      expect(json.data.durationMinutes).toBe(60);
      expect(json.auditLogId).toMatch(/^aud_/);
      expect(json.data.expectedValueMinor).toBe(45000);
    });

    it('PATCH /api/appointments without query businessId -> 400 BUSINESS_ID_REQUIRED', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: 'apt_01',
            status: 'confirmed',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_ID_REQUIRED');
    });

    it('PATCH /api/appointments rejects body.businessId with 400 BAD_REQUEST', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            businessId: 'biz_beauty_salon',
            appointmentId: 'apt_01',
            status: 'in_progress',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BAD_REQUEST');
    });

    it('PATCH /api/appointments with appointment belonging to different business in same org -> 404 APPOINTMENT_NOT_FOUND', async () => {
      // apt_01 belongs to biz_beauty_salon; calling with biz_dental_clinic should return 404
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_dental_clinic', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: 'apt_01',
            status: 'in_progress',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error).toBe('APPOINTMENT_NOT_FOUND');
    });

    it('PATCH /api/appointments valid transition scheduled -> confirmed -> 200 + auditLogId', async () => {
      // Create fresh appointment
      const createRes = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_a12',
            serviceName: 'Aesthetic Treatment',
            serviceCategory: 'Facial Aesthetics',
            resourceStaffId: 'stf_01',
            scheduledStart: '2026-08-28T10:00:00Z',
            scheduledEnd: '2026-08-28T11:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      const apt = (await createRes.json() as any).data;

      const patchRes = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt.id,
            status: 'confirmed',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(patchRes.status).toBe(200);
      const json = await patchRes.json() as any;
      expect(json.data.status).toBe('confirmed');
      expect(json.auditLogId).toMatch(/^aud_/);
    });

    it('PATCH /api/appointments same status scheduled -> scheduled -> 400 INVALID_APPOINTMENT_STATE_TRANSITION', async () => {
      // Create fresh appointment in 'scheduled' status
      const createRes = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_a12',
            serviceName: 'Aesthetic Treatment',
            serviceCategory: 'Facial Aesthetics',
            resourceStaffId: 'stf_01',
            scheduledStart: '2026-08-28T10:00:00Z',
            scheduledEnd: '2026-08-28T11:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      const apt = (await createRes.json() as any).data;

      const patchRes = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt.id,
            status: 'scheduled',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(patchRes.status).toBe(400);
      const json = await patchRes.json() as any;
      expect(json.error).toBe('INVALID_APPOINTMENT_STATE_TRANSITION');
    });

    it('PATCH /api/appointments invalid terminal transition completed -> scheduled -> 400 INVALID_APPOINTMENT_STATE_TRANSITION', async () => {
      // Create fresh appointment
      const createRes = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_a12',
            serviceName: 'Aesthetic Treatment',
            serviceCategory: 'Facial Aesthetics',
            resourceStaffId: 'stf_01',
            scheduledStart: '2026-08-28T10:00:00Z',
            scheduledEnd: '2026-08-28T11:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      const apt = (await createRes.json() as any).data;

      // Transition scheduled -> confirmed
      await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt.id,
            status: 'confirmed',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      // Transition confirmed -> completed
      await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt.id,
            status: 'completed',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      // Attempt terminal transition completed -> scheduled
      const termRes = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt.id,
            status: 'scheduled',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(termRes.status).toBe(400);
      const json = await termRes.json() as any;
      expect(json.error).toBe('INVALID_APPOINTMENT_STATE_TRANSITION');
    });

    it('Direct call: secondary write wrappers AppointmentRepository.create and updateStatus do not exist', () => {
      expect((AppointmentRepository as any).create).toBeUndefined();
      expect((AppointmentRepository as any).updateStatus).toBeUndefined();
    });

    it('removes fake /api/appointment-events route', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointment-events?orgId=org_apex_holding', {
          headers: validHeaders,
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(404);
    });

    it('GET /api/appointments requires query businessId', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding', {
          headers: validHeaders,
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_ID_REQUIRED');
    });

    it('GET /api/appointments rejects cross-tenant businessId with 404', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_bosphorus_grill', {
          headers: validHeaders,
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.error).toBe('BUSINESS_NOT_FOUND');
    });

    it('GET /api/appointments returns business-scoped appointments', async () => {
      const res = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          headers: validHeaders,
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.every((a: any) => a.businessId === 'biz_beauty_salon')).toBe(true);
    });

    it('PATCH /api/appointments rejects reasonCode for confirmed and completed transitions', async () => {
      // Create fresh appointment
      const createRes = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_a12',
            serviceName: 'Aesthetic Treatment',
            serviceCategory: 'Facial Aesthetics',
            resourceStaffId: 'stf_01',
            scheduledStart: '2026-08-28T10:00:00Z',
            scheduledEnd: '2026-08-28T11:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      const apt = (await createRes.json() as any).data;

      // Transition to confirmed with reasonCode -> 400
      const patchRes1 = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt.id,
            status: 'confirmed',
            reasonCode: 'CUSTOMER_CANCELLED',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(patchRes1.status).toBe(400);
      expect((await patchRes1.json() as any).error).toBe('BAD_REQUEST');

      // Valid confirmed transition without reasonCode
      await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt.id,
            status: 'confirmed',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );

      // Transition to completed with reasonCode -> 400
      const patchRes2 = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt.id,
            status: 'completed',
            reasonCode: 'PROVIDER_UNAVAILABLE',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(patchRes2.status).toBe(400);
      expect((await patchRes2.json() as any).error).toBe('BAD_REQUEST');
    });

    it('PATCH /api/appointments allows reasonCode for cancelled and no_show, and rejects invalid reason code', async () => {
      // Create appointment 1 for cancellation
      const createRes1 = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_a12',
            serviceName: 'Aesthetic Treatment',
            serviceCategory: 'Facial Aesthetics',
            resourceStaffId: 'stf_01',
            scheduledStart: '2026-08-28T10:00:00Z',
            scheduledEnd: '2026-08-28T11:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      const apt1 = (await createRes1.json() as any).data;

      // Invalid reasonCode
      const patchResInvalid = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt1.id,
            status: 'cancelled',
            reasonCode: 'NON_EXISTENT_REASON_CODE',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(patchResInvalid.status).toBe(400);
      expect((await patchResInvalid.json() as any).error).toBe('BAD_REQUEST');

      // Valid cancellation with reasonCode
      const patchResCancel = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt1.id,
            status: 'cancelled',
            reasonCode: 'CUSTOMER_CANCELLED',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(patchResCancel.status).toBe(200);
      const cancelData = (await patchResCancel.json() as any).data;
      expect(cancelData.status).toBe('cancelled');
      expect(cancelData.cancellationReasonCode).toBe('CUSTOMER_CANCELLED');

      // Create appointment 2 for no_show
      const createRes2 = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'POST',
          headers: validHeaders,
          body: JSON.stringify({
            customerPseudonymId: 'cus_seal_test_a12',
            serviceName: 'Aesthetic Treatment',
            serviceCategory: 'Facial Aesthetics',
            resourceStaffId: 'stf_01',
            scheduledStart: '2026-08-28T10:00:00Z',
            scheduledEnd: '2026-08-28T11:00:00Z',
            expectedValueMinor: 25000,
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      const apt2 = (await createRes2.json() as any).data;

      const patchResNoShow = await worker.fetch(
        new Request('https://app.velnar.studio/api/appointments?orgId=org_apex_holding&businessId=biz_beauty_salon', {
          method: 'PATCH',
          headers: validHeaders,
          body: JSON.stringify({
            appointmentId: apt2.id,
            status: 'no_show',
            reasonCode: 'NO_SHOW_CONFIRMED',
          }),
        }),
        { DB: undefined as any, ENVIRONMENT: 'test', AUDIT_IP_HASH_SECRET: 'test_secret' }
      );
      expect(patchResNoShow.status).toBe(200);
      const noShowData = (await patchResNoShow.json() as any).data;
      expect(noShowData.status).toBe('no_show');
      expect(noShowData.cancellationReasonCode).toBe('NO_SHOW_CONFIRMED');
    });

    it('Direct repository call: createWithAudit enforces strict second-boundary invariants', async () => {
      const validScope = {
        organizationId: 'org_apex_holding',
        businessId: 'biz_beauty_salon',
        currency: 'USD' as const,
        actorId: 'usr_owner_01',
        actorRole: 'OWNER' as const,
        ipHash: 'ip_hash_123',
      };

      const validCommand = {
        customerPseudonymId: 'cus_direct_01',
        serviceName: 'Hair Protocol',
        serviceCategory: 'Styling',
        resourceStaffId: 'res_master_01',
        resourceStaffName: 'Master Stylist',
        scheduledStart: '2026-08-28T10:00:00Z',
        scheduledEnd: '2026-08-28T11:00:00Z',
        durationMinutes: 60,
        expectedValueMinor: 10000,
      };

      // 1. Invalid Actor Role
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          validCommand,
          { ...validScope, actorRole: 'SUPER_ADMIN' as any },
          'test'
        )
      ).rejects.toThrow(/AUTHORIZATION_CONTEXT_INVALID/);

      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          validCommand,
          { ...validScope, actorRole: 'HACKER' as any },
          'test'
        )
      ).rejects.toThrow(/AUTHORIZATION_CONTEXT_INVALID/);

      // 2. Invalid Currency
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          validCommand,
          { ...validScope, currency: 'GBP' as any },
          'test'
        )
      ).rejects.toThrow(/APPOINTMENT_WRITE_FAILED/);

      // 3. Invalid Timestamps
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          { ...validCommand, scheduledStart: 'invalid-date' },
          validScope,
          'test'
        )
      ).rejects.toThrow(/APPOINTMENT_WRITE_FAILED/);

      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          { ...validCommand, scheduledStart: '2026-08-28T10:00:00' }, // Missing timezone
          validScope,
          'test'
        )
      ).rejects.toThrow(/APPOINTMENT_WRITE_FAILED/);

      // 4. Duration Mismatch
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          { ...validCommand, durationMinutes: 45 }, // Start to end is 60 min
          validScope,
          'test'
        )
      ).rejects.toThrow(/APPOINTMENT_WRITE_FAILED/);

      // 5. Invalid Resource Staff ID (empty)
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          { ...validCommand, resourceStaffId: '' },
          validScope,
          'test'
        )
      ).rejects.toThrow(/APPOINTMENT_WRITE_FAILED/);

      // 6. Negative or non-integer Money
      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          { ...validCommand, expectedValueMinor: -100 },
          validScope,
          'test'
        )
      ).rejects.toThrow(/APPOINTMENT_WRITE_FAILED/);

      await expect(
        AppointmentRepository.createWithAudit(
          undefined,
          { ...validCommand, expectedValueMinor: 10.5 },
          validScope,
          'test'
        )
      ).rejects.toThrow(/APPOINTMENT_WRITE_FAILED/);
    });

    it('Direct repository call: updateStatusWithAudit enforces optimistic concurrency and zero orphan audits on stale race', async () => {
      // Create initial appointment
      const created = await AppointmentRepository.createWithAudit(
        undefined,
        {
          customerPseudonymId: 'cus_race_01',
          serviceName: 'Facial Protocol',
          serviceCategory: 'Aesthetics',
          resourceStaffId: 'res_elena_01',
          scheduledStart: '2026-08-28T14:00:00Z',
          scheduledEnd: '2026-08-28T15:00:00Z',
          durationMinutes: 60,
          expectedValueMinor: 30000,
        },
        {
          organizationId: 'org_apex_holding',
          businessId: 'biz_beauty_salon',
          currency: 'USD',
          actorId: 'usr_owner_01',
          actorRole: 'OWNER',
          ipHash: 'ip_hash_race',
        },
        'test'
      );

      const aptId = created.appointment.id;
      expect(created.appointment.rowVersion).toBe(0);

      // 1. Competing actor 1 transitions scheduled -> confirmed (rowVersion 0 -> 1)
      const update1 = await AppointmentRepository.updateStatusWithAudit(
        undefined,
        aptId,
        'scheduled',
        'confirmed',
        'org_apex_holding',
        'biz_beauty_salon',
        'usr_actor_1',
        'MANAGER',
        'ip_actor_1',
        undefined,
        'test'
      );
      expect(update1).not.toBeNull();
      expect(update1?.appointment.status).toBe('confirmed');
      expect(update1?.appointment.rowVersion).toBe(1);

      // 2. Competing actor 2 attempts stale transition scheduled -> cancelled based on pre-read state
      const update2 = await AppointmentRepository.updateStatusWithAudit(
        undefined,
        aptId,
        'scheduled', // Stale expected status
        'cancelled',
        'org_apex_holding',
        'biz_beauty_salon',
        'usr_actor_2',
        'STAFF',
        'ip_actor_2',
        'NO_SHOW_CONFIRMED',
        'test'
      );
      // Fails optimistic concurrency token precondition
      expect(update2).toBeNull();

      // Verify canonical appointment remains confirmed at rowVersion 1
      const current = await AppointmentRepository.getByIdForBusiness(
        undefined,
        aptId,
        'org_apex_holding',
        'biz_beauty_salon',
        'test'
      );
      expect(current?.status).toBe('confirmed');
      expect(current?.rowVersion).toBe(1);
    });

    it('Deterministic D1 batch test: conditional audit INSERT fails if row_version predicate does not match', async () => {
      let batchQueries: string[] = [];

      // Mock D1 Database simulating concurrency conflict
      const mockD1: any = {
        prepare: (query: string) => ({
          bind: (...args: any[]) => ({
            query,
            args,
            first: async () => ({
              id: 'apt_mock_01',
              organization_id: 'org_apex_holding',
              business_id: 'biz_beauty_salon',
              pseudonymous_customer_id: 'cus_mock_01',
              service_name: 'Mock Service',
              service_category: 'Mock Category',
              resource_staff_name: 'Mock Staff',
              scheduled_start: '2026-08-28T10:00:00Z',
              scheduled_end: '2026-08-28T11:00:00Z',
              duration_minutes: 60,
              expected_value_minor: 10000,
              currency: 'USD',
              status: 'scheduled',
              source: 'velnar_manual',
              row_version: 0,
              created_at: '2026-08-28T09:00:00Z',
              updated_at: '2026-08-28T09:00:00Z',
            }),
          }),
        }),
        batch: async (statements: any[]) => {
          batchQueries = statements.map(s => s.query);
          // Simulate update matching 0 rows due to concurrent modification
          return [
            { meta: { changes: 0 } },
            { meta: { changes: 0 } },
          ];
        },
      };

      const result = await AppointmentRepository.updateStatusWithAudit(
        mockD1,
        'apt_mock_01',
        'scheduled',
        'confirmed',
        'org_apex_holding',
        'biz_beauty_salon',
        'usr_actor',
        'OWNER',
        'ip_mock',
        undefined,
        'production'
      );

      expect(result).toBeNull();
      // Verify both UPDATE and conditional INSERT were submitted to batch
      expect(batchQueries.length).toBe(2);
      expect(batchQueries[0]).toContain('UPDATE appointments');
      expect(batchQueries[0]).toContain('row_version = row_version + 1');
      expect(batchQueries[1]).toContain('INSERT INTO audit_logs');
      expect(batchQueries[1]).toContain('WHERE EXISTS');
    });

    it('Static Zero-Tolerance Gate verification', () => {
      // Organization-only getById must be deleted
      expect((AppointmentRepository as any).getById).toBeUndefined();
      // Optional-business listByOrg must be deleted
      expect((AppointmentRepository as any).listByOrg).toBeUndefined();
      // Secondary write wrappers must be deleted
      expect((AppointmentRepository as any).create).toBeUndefined();
      expect((AppointmentRepository as any).updateStatus).toBeUndefined();
    });
  });
});
