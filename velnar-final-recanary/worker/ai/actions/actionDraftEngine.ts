/**
 * @file worker/ai/actions/actionDraftEngine.ts
 * @description Action Preparation & Evidence Grounding Pipeline
 */

import { GrowthActionDraft, AIRequestEnvelope, AIRunRecord } from '../types';
import { ActionPolicyEngine } from './actionPolicyEngine';
import { AIRouter } from '../aiRouter';
import { WorkerEnv } from '../../env';
import { ActionPolicyRepository, OrganizationActionPolicy } from './actionPolicyRepository';
import { BusinessTenantGuard } from '../../middleware/businessTenantGuard';
import { SafeLogger } from '../../security/safeLogger';

export interface DraftActionInput {
  organizationId: string;
  businessId: string;
  leakId: string;
  leakTitle: string;
  leakCategory: string;
  severity: string;
  estimatedMonthlyLossMinor: number;
  rootCause: string;
  affectedFunnelStage: string;
  evidenceIds: string[];
  observedFacts: string[];
}

export class ActionDraftEngine {
  /**
   * Draft a growth action from a deterministic Revenue Leak.
   */
  public static async draftActionFromLeak(
    input: DraftActionInput,
    env: WorkerEnv
  ): Promise<{
    actionDraft: GrowthActionDraft;
    guardrailResult: ReturnType<typeof ActionPolicyEngine.validate>;
    runId: string;
    runRecord?: AIRunRecord;
    isMock?: boolean;
  }> {
    if (!input.evidenceIds || input.evidenceIds.length === 0) {
      throw new Error('NO_EVIDENCE_CLAIM: Cannot generate Growth Action without evidence IDs.');
    }

    if (!input.organizationId || !input.businessId) {
      throw new Error('ORGANIZATION_AND_BUSINESS_ID_REQUIRED: Missing organizationId or businessId for action draft.');
    }

    // Step 1: Assert business belongs to organization
    await BusinessTenantGuard.assertBusinessBelongsToOrganization(
      env.DB,
      input.organizationId,
      input.businessId,
      env.ENVIRONMENT
    );

    // Step 2: Resolve policy BEFORE calling AI provider (Fail closed on D1/repository failure)
    let tenantPolicy: OrganizationActionPolicy;
    try {
      tenantPolicy = await ActionPolicyRepository.getPolicy(
        env.DB,
        input.organizationId,
        input.businessId,
        env.ENVIRONMENT
      );
    } catch (err: any) {
      SafeLogger.error('[ACTION_DRAFT_POLICY_RESOLUTION_FAILED]', {
        organizationId: input.organizationId,
        businessId: input.businessId,
        errorCode: 'ACTION_POLICY_UNAVAILABLE',
      });
      const failClosedErr = new Error('ACTION_POLICY_UNAVAILABLE: Failed to resolve authoritative action policy prior to AI drafting.');
      (failClosedErr as any).statusCode = 503;
      (failClosedErr as any).errorCode = 'ACTION_POLICY_UNAVAILABLE';
      throw failClosedErr;
    }

    // Step 3: Build AI Envelope with resolved policy bounds
    const envelope: AIRequestEnvelope = {
      organizationId: input.organizationId,
      businessId: input.businessId,
      taskType: 'GROWTH_ACTION_DRAFT',
      dataClassification: 'PSEUDONYMOUS_OPERATIONAL',
      evidenceIds: input.evidenceIds,
      observedFacts: [
        `Revenue Leak: ${input.leakTitle} (${input.leakCategory})`,
        `Severity: ${input.severity}`,
        `Affected Stage: ${input.affectedFunnelStage}`,
        `Deterministic Root Cause: ${input.rootCause}`,
        ...input.observedFacts,
      ],
      calculatedMetrics: {
        estimatedMonthlyLossMinor: input.estimatedMonthlyLossMinor,
        estimatedImpactMinor: input.estimatedMonthlyLossMinor,
      },
      businessPolicyContext: {
        requiresHumanApproval: true,
        ...(tenantPolicy?.maximumDiscountPercent !== null && tenantPolicy?.maximumDiscountPercent !== undefined
          ? { maximumDiscountPercent: tenantPolicy.maximumDiscountPercent }
          : {}),
        ...(tenantPolicy?.maximumAdBudgetMinor !== null && tenantPolicy?.maximumAdBudgetMinor !== undefined
          ? { maximumAdBudgetMinor: tenantPolicy.maximumAdBudgetMinor }
          : {}),
        ...(tenantPolicy?.allowedChannels !== null && tenantPolicy?.allowedChannels !== undefined
          ? { allowedChannels: tenantPolicy.allowedChannels }
          : {}),
        ...(tenantPolicy?.prohibitedActions && tenantPolicy.prohibitedActions.length > 0
          ? { prohibitedActions: tenantPolicy.prohibitedActions }
          : {}),
      },
    };

    // Step 4: Invoke AIRouter
    const aiResult = await AIRouter.execute(envelope, env);

    const actionDraft = aiResult.result as GrowthActionDraft;
    actionDraft.revenueLeakId = input.leakId;
    actionDraft.estimatedImpactMinor = input.estimatedMonthlyLossMinor;
    if (aiResult.isMock) {
      actionDraft.isMock = true;
    }

    // Step 5: Run Deterministic Policy Validation against resolved tenant policy
    const guardrailResult = ActionPolicyEngine.validate(actionDraft, tenantPolicy);

    return {
      actionDraft,
      guardrailResult,
      runId: aiResult.runRecord.id,
      runRecord: aiResult.runRecord,
      isMock: aiResult.isMock,
    };
  }
}
