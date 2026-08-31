/**
 * @file worker/ai/taskClassifier.ts
 * @description Task to Routing Tier & Governance Mapping
 */

import { TaskType, RoutingTier, DataClassification } from './types';

export class TaskClassifier {
  /**
   * Determine the appropriate execution tier for a task.
   */
  public static getRoutingTier(taskType: TaskType): RoutingTier {
    switch (taskType) {
      case 'LEAD_INTENT_CLASSIFICATION':
      case 'LEAK_EXPLANATION':
      case 'FUNNEL_DIAGNOSTIC_EXPLANATION':
      case 'SEO_CONTENT_SUGGESTION':
      case 'ANOMALY_TRIAGE':
        return 'FAST_LOW_COST';

      case 'GROWTH_ACTION_DRAFT':
        return 'REASONING';

      case 'BUSINESS_TWIN_SUMMARY':
        return 'LONG_CONTEXT';

      default:
        return 'DETERMINISTIC_ONLY';
    }
  }

  /**
   * Prohibited task keywords that MUST NEVER be processed by external AI.
   * AI does not do authentication, authorization, payment execution, money arithmetic, or encryption.
   */
  public static isProhibitedAIOperation(actionName: string): boolean {
    const lower = actionName.toLowerCase();
    const prohibitedKeywords = [
      'auth',
      'authenticate',
      'authorize',
      'token_generate',
      'payment_process',
      'charge_card',
      'money_calc',
      'revenue_formula',
      'encrypt',
      'decrypt',
      'kms_derive',
      'security_enforce',
      'tenant_bypass',
    ];
    return prohibitedKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Check if a task type allows external AI processing based on classification.
   */
  public static isEligibleForExternalAI(
    classification: DataClassification,
    tier: RoutingTier
  ): { eligible: boolean; reason?: string } {
    if (tier === 'DETERMINISTIC_ONLY') {
      return { eligible: false, reason: 'Task requires deterministic code execution only.' };
    }

    if (classification === 'SECRET') {
      return { eligible: false, reason: 'Data classified as SECRET. External AI execution strictly prohibited.' };
    }

    if (classification === 'SENSITIVE') {
      return { eligible: false, reason: 'Data classified as SENSITIVE. External AI execution strictly prohibited.' };
    }

    if (classification === 'PERSONAL') {
      return { eligible: false, reason: 'Data classified as PERSONAL. External AI execution blocked by default.' };
    }

    return { eligible: true };
  }
}
