/**
 * @file worker/ai/providers/disabledProvider.ts
 * @description Safe Offline Mock Adapter when External AI Keys are Not Configured
 * 
 * ============================================================================
 * PRINCIPLE: All mock outputs are explicitly and programmatically marked `isMock: true`.
 * In production mode, this adapter fails-closed with AI_UNAVAILABLE.
 * ============================================================================
 */

import { WorkerEnv } from '../../env';
import { BaseAIProvider } from './provider';
import { 
  AIProviderId, 
  RoutingTier, 
  DataClassification, 
  AIRequestEnvelope, 
  AIProviderResponse 
} from '../types';

export class DisabledProvider implements BaseAIProvider {
  public readonly id: AIProviderId = 'disabled';

  public isConfigured(_env: WorkerEnv): boolean {
    return true;
  }

  public supportsTier(_tier: RoutingTier): boolean {
    return true;
  }

  public supportsDataClassification(_classification: DataClassification): boolean {
    return true;
  }

  public async generate(
    envelope: AIRequestEnvelope,
    _prompt: { system: string; user: string },
    env: WorkerEnv
  ): Promise<AIProviderResponse> {
    const isDev = env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test';

    // In production without valid external keys, fail-closed
    if (!isDev) {
      throw new Error('AI_UNAVAILABLE: No privacy-safe AI provider is configured in this production environment.');
    }

    // Explicit Development / Demo Fallback marked with isMock: true
    let mockContent = '{}';

    if (envelope.taskType === 'GROWTH_ACTION_DRAFT') {
      const hasEvidence = envelope.evidenceIds && envelope.evidenceIds.length > 0;
      const primaryEvidence = hasEvidence ? [envelope.evidenceIds![0]] : [];
      mockContent = JSON.stringify({
        title: 'Synthetic Placeholder: SLA Routing & High-Intent Action Draft',
        summary: 'Synthetic development placeholder action prepared from deterministic leak evidence.',
        evidenceReferences: primaryEvidence,
        recommendedSteps: [
          'Review deterministic evidence telemetry in operator console',
          'Verify notification channels and team assignments',
          'Submit for explicit human review and approval'
        ],
        expectedMechanism: 'Synthetic placeholder intervention based on deterministic input facts. No external AI inference executed.',
        riskLevel: 'LOW',
        requiresHumanApproval: true,
        hypothesis: 'Synthetic development hypothesis for evidence verification.',
        actionType: 'high_intent_sla_dispatch',
        suggestedPayload: {
          targetSlaMinutes: 15,
          alertChannel: 'ops_dashboard',
          evidenceId: primaryEvidence[0] || 'none',
          requiresHumanApproval: true
        }
      });
    } else if (envelope.taskType === 'LEAK_EXPLANATION') {
      const hasEvidence = envelope.evidenceIds && envelope.evidenceIds.length > 0;
      mockContent = JSON.stringify({
        explanation: 'Synthetic placeholder explanation derived deterministically from input telemetry.',
        primaryBottleneck: 'Deterministic bottleneck based on input evidence IDs.',
        evidenceCited: hasEvidence ? [envelope.evidenceIds![0]] : [],
        confidenceRationale: 'Synthetic development placeholder for deterministic inspection.',
        insufficientEvidence: !hasEvidence
      });
    } else if (envelope.taskType === 'LEAD_INTENT_CLASSIFICATION') {
      mockContent = JSON.stringify({
        intentScore: 50,
        intentStage: 'moderate',
        keyIndicators: ['Synthetic placeholder indicator based on observed lead attributes']
      });
    } else if (envelope.taskType === 'BUSINESS_TWIN_SUMMARY') {
      const factCount = envelope.observedFacts ? envelope.observedFacts.length : 0;
      mockContent = JSON.stringify({
        executiveSummary: 'Synthetic business twin operational summary.',
        verifiedFactCount: factCount,
        criticalConstraints: ['Deterministic business operational baseline'],
        unitEconomicsSummary: 'Stable deterministic margin metrics'
      });
    } else if (envelope.taskType === 'FUNNEL_DIAGNOSTIC_EXPLANATION') {
      mockContent = JSON.stringify({
        dropOffStage: 'Checkout Initiation',
        decayVelocity: 'MEDIUM',
        mitigationRecommendation: 'Implement automated SMS re-engagement sequence'
      });
    } else if (envelope.taskType === 'SEO_CONTENT_SUGGESTION') {
      mockContent = JSON.stringify({
        suggestedKeywords: ['local service provider', 'verified booking'],
        contentGaps: ['Missing pricing transparency page'],
        recommendedAction: 'Publish localized landing page with explicit service menu'
      });
    } else if (envelope.taskType === 'ANOMALY_TRIAGE') {
      mockContent = JSON.stringify({
        anomalySeverity: 'NOMINAL',
        probableCause: 'Deterministic statistical variance in inbound traffic telemetry',
        triageSteps: ['Monitor webhook delivery health', 'Verify conversion tracking telemetry']
      });
    } else {
      mockContent = JSON.stringify({
        status: 'completed',
        summary: 'Synthetic placeholder response for development/test environment. Not real business analysis.',
        isMock: true
      });
    }

    return {
      providerId: 'disabled',
      modelIdentifier: 'none',
      content: mockContent,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 15,
      isMock: true,
    };
  }
}
