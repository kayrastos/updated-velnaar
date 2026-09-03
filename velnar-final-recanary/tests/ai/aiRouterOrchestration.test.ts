import { describe, it, expect, beforeEach } from 'vitest';
import { AIRouter } from '../../worker/ai/aiRouter';
import { ActionDraftEngine } from '../../worker/ai/actions/actionDraftEngine';
import { WorkerEnv } from '../../worker/env';
import { AIRunRepository } from '../../worker/ai/aiRunRepository';
import { AIPolicyRepository } from '../../worker/ai/aiPolicyRepository';

describe('Sprint 4 - AI Router Orchestration & Telemetry', () => {
  const mockEnv: WorkerEnv = {
    ENVIRONMENT: 'development',
  };

  beforeEach(async () => {
    AIRunRepository.clearMemoryStore();
    await AIPolicyRepository.savePolicy(
      undefined,
      {
        organizationId: 'org_apex_holding',
        externalAiEnabled: true,
        allowedProviders: ['gemini', 'deepseek'],
        allowPseudonymousOperationalData: true,
        allowPublicBusinessData: true,
      },
      'development'
    );
  });

  it('provides safe public status without exposing API keys or internals', async () => {
    const status = await AIRouter.getStatus('org_apex_holding', mockEnv);

    expect(status.serviceName).toBe('VELNAR AI');
    expect(status.privacyGateway).toBe('CONFIGURED');
    expect(status.policy.humanApprovalRequired).toBe(true);
    expect(status.policy.allowPersonalData).toBe(false);
    expect(status.tiers.DETERMINISTIC_ONLY.status).toBe('CONFIGURED');
    expect(status.tiers.FAST_LOW_COST).toBeDefined();
    expect(status.tiers.REASONING).toBeDefined();
    expect(status.tiers.LONG_CONTEXT).toBeDefined();
    expect((status as any).providers).toBeUndefined();
  });

  it('blocks prohibited operations (e.g. auth, payments, crypto) from AI routing', async () => {
    const prohibitedEnvelope: any = {
      organizationId: 'org_apex_holding',
      businessId: 'biz_01',
      taskType: 'authenticate_user',
      dataClassification: 'PUBLIC_BUSINESS',
    };

    await expect(AIRouter.execute(prohibitedEnvelope, mockEnv)).rejects.toThrow('PROHIBITED_AI_OPERATION');
  });

  it('fails-closed on Growth Action drafting if no evidence IDs are provided', async () => {
    const inputWithoutEvidence: any = {
      organizationId: 'org_apex_holding',
      businessId: 'biz_01',
      leakId: 'leak_speed_to_lead_01',
      leakTitle: 'SLA Decay',
      leakCategory: 'SPEED_TO_LEAD',
      severity: 'HIGH',
      estimatedMonthlyLossMinor: 500000,
      rootCause: 'Response delay',
      affectedFunnelStage: 'lead_to_appointment',
      evidenceIds: [], // Empty evidence
      observedFacts: [],
    };

    await expect(ActionDraftEngine.draftActionFromLeak(inputWithoutEvidence, mockEnv)).rejects.toThrow('NO_EVIDENCE_CLAIM');
  });

  it('executes development fallback with explicit isMock: true flag and logs telemetry', async () => {
    const validEnvelope = {
      organizationId: 'org_apex_holding',
      businessId: 'biz_01',
      taskType: 'GROWTH_ACTION_DRAFT' as const,
      dataClassification: 'PSEUDONYMOUS_OPERATIONAL' as const,
      evidenceIds: ['evidence_decay_83'],
      observedFacts: ['High intent lead response latency exceeded 35 minutes'],
      calculatedMetrics: {
        estimatedMonthlyLossMinor: 4500000,
      },
    };

    const execution = await AIRouter.execute(validEnvelope, mockEnv);

    expect(execution.result).toBeDefined();
    expect(execution.result.requiresHumanApproval).toBe(true);
    expect(execution.result.evidenceReferences).toContain('evidence_decay_83');
    expect(execution.isMock).toBe(true);

    const savedRuns = await AIRunRepository.listRunsByBusiness(undefined, 'org_apex_holding', 'biz_01', 10, 'development');
    expect(savedRuns.length).toBeGreaterThan(0);
    expect(savedRuns[0].task_type).toBe('GROWTH_ACTION_DRAFT');
    expect(savedRuns[0].estimated_cost_microusd).toBeGreaterThanOrEqual(0);
  });
});
