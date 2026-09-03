/**
 * @file worker/ai/providers/deepSeekProvider.ts
 * @description Server-Side DeepSeek Provider Adapter (Strict Public/Pseudonymous Tier Only)
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

export class DeepSeekProvider implements BaseAIProvider {
  public readonly id: AIProviderId = 'deepseek';

  public isConfigured(env: WorkerEnv): boolean {
    const hasSecret = Boolean(env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY.trim().length > 0);
    const hasModel = Boolean(env.VELNAR_AI_DEEPSEEK_MODEL && env.VELNAR_AI_DEEPSEEK_MODEL.trim().length > 0);
    return hasSecret && hasModel;
  }

  public supportsTier(tier: RoutingTier): boolean {
    return tier === 'FAST_LOW_COST';
  }

  /**
   * STRICT PRIVACY RULE:
   * DeepSeek may receive ONLY PUBLIC_BUSINESS or PSEUDONYMOUS_OPERATIONAL data.
   * Any PERSONAL, SENSITIVE, or SECRET classification is strictly blocked.
   */
  public supportsDataClassification(classification: DataClassification): boolean {
    return classification === 'PUBLIC_BUSINESS' || classification === 'PSEUDONYMOUS_OPERATIONAL';
  }

  public async generate(
    envelope: AIRequestEnvelope,
    prompt: { system: string; user: string },
    env: WorkerEnv
  ): Promise<AIProviderResponse> {
    if (!this.supportsDataClassification(envelope.dataClassification)) {
      throw new Error(`PRIVACY_VIOLATION: DeepSeek cannot receive ${envelope.dataClassification} data.`);
    }

    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('PROVIDER_NOT_CONFIGURED: DEEPSEEK_API_KEY is not configured in Worker environment.');
    }

    const model = env.VELNAR_AI_DEEPSEEK_MODEL?.trim();
    if (!model || model.length === 0) {
      throw new Error('MODEL_NOT_CONFIGURED: VELNAR_AI_DEEPSEEK_MODEL is not configured.');
    }

    const baseUrl = env.VELNAR_AI_DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
    const endpoint = `${baseUrl}/chat/completions`;

    const startTime = Date.now();
    const requestBody = {
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: envelope.maxTokens || 2048,
      temperature: 0.1,
    };

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (fetchErr: any) {
      throw new Error('PROVIDER_UNREACHABLE: DeepSeek network request failed.');
    }

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      throw new Error(`DEEPSEEK_API_ERROR: HTTP ${res.status}`);
    }

    let json: any;
    try {
      json = await res.json();
    } catch (parseErr: any) {
      throw new Error('MALFORMED_AI_OUTPUT: DeepSeek returned invalid JSON body.');
    }

    const choice = json.choices?.[0];
    const rawText = choice?.message?.content || '{}';

    const usage = json.usage || {};
    const promptTokens = usage.prompt_tokens || Math.ceil(prompt.user.length / 4);
    const completionTokens = usage.completion_tokens || Math.ceil(rawText.length / 4);

    return {
      providerId: 'deepseek',
      modelIdentifier: model,
      content: rawText,
      promptTokens,
      completionTokens,
      latencyMs,
      isMock: false,
    };
  }
}
