/**
 * @file worker/ai/providers/provider.ts
 * @description Neutral AI Provider Interface & Capabilities Contract
 */

import { WorkerEnv } from '../../env';
import { 
  AIProviderId, 
  RoutingTier, 
  DataClassification, 
  AIRequestEnvelope, 
  AIProviderResponse 
} from '../types';

export interface BaseAIProvider {
  readonly id: AIProviderId;
  
  /**
   * Check if provider is configured with valid secrets and model bindings.
   */
  isConfigured(env: WorkerEnv): boolean;

  /**
   * Check if provider supports the requested routing tier.
   */
  supportsTier(tier: RoutingTier): boolean;

  /**
   * Check if provider is allowed to process the given data classification.
   */
  supportsDataClassification(classification: DataClassification): boolean;

  /**
   * Execute inference against the model provider.
   */
  generate(
    envelope: AIRequestEnvelope,
    prompt: { system: string; user: string },
    env: WorkerEnv
  ): Promise<AIProviderResponse>;
}
