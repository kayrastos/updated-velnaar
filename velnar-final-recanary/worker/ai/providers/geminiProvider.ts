/**
 * @file worker/ai/providers/geminiProvider.ts
 * @description Server-Side Google Gemini AI Provider Adapter (Gemini 3.x Adapter Compatibility)
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

export class GeminiProvider implements BaseAIProvider {
  public readonly id: AIProviderId = 'gemini';

  public isConfigured(env: WorkerEnv): boolean {
    const hasSecret = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
    // Configured if secret exists AND at least one model is configured
    const hasAnyModel = Boolean(
      (env.VELNAR_AI_GEMINI_FAST_MODEL && env.VELNAR_AI_GEMINI_FAST_MODEL.trim().length > 0) ||
      (env.VELNAR_AI_GEMINI_REASONING_MODEL && env.VELNAR_AI_GEMINI_REASONING_MODEL.trim().length > 0)
    );
    return hasSecret && hasAnyModel;
  }

  public isTierConfigured(tier: RoutingTier, env: WorkerEnv): boolean {
    const hasSecret = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
    if (!hasSecret) return false;

    if (tier === 'FAST_LOW_COST') {
      return Boolean(env.VELNAR_AI_GEMINI_FAST_MODEL && env.VELNAR_AI_GEMINI_FAST_MODEL.trim().length > 0);
    }
    if (tier === 'REASONING') {
      return Boolean(env.VELNAR_AI_GEMINI_REASONING_MODEL && env.VELNAR_AI_GEMINI_REASONING_MODEL.trim().length > 0);
    }
    if (tier === 'LONG_CONTEXT') {
      return Boolean(
        (env.VELNAR_AI_GEMINI_REASONING_MODEL && env.VELNAR_AI_GEMINI_REASONING_MODEL.trim().length > 0) ||
        (env.VELNAR_AI_GEMINI_FAST_MODEL && env.VELNAR_AI_GEMINI_FAST_MODEL.trim().length > 0)
      );
    }
    return false;
  }

  public supportsTier(tier: RoutingTier): boolean {
    return tier === 'FAST_LOW_COST' || tier === 'REASONING' || tier === 'LONG_CONTEXT';
  }

  public supportsDataClassification(classification: DataClassification): boolean {
    return classification === 'PUBLIC_BUSINESS' || classification === 'PSEUDONYMOUS_OPERATIONAL';
  }

  public async generate(
    envelope: AIRequestEnvelope,
    prompt: { system: string; user: string },
    env: WorkerEnv
  ): Promise<AIProviderResponse> {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('PROVIDER_NOT_CONFIGURED: GEMINI_API_KEY is not configured in Worker environment.');
    }

    const isReasoning = envelope.taskType === 'GROWTH_ACTION_DRAFT';
    const model = isReasoning
      ? env.VELNAR_AI_GEMINI_REASONING_MODEL?.trim()
      : env.VELNAR_AI_GEMINI_FAST_MODEL?.trim();

    if (!model || model.length === 0) {
      throw new Error(`MODEL_NOT_CONFIGURED: No Gemini model explicitly configured for tier ${isReasoning ? 'REASONING' : 'FAST_LOW_COST'}.`);
    }

    const startTime = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const requestBody = {
      systemInstruction: {
        parts: [{ text: prompt.system }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt.user }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: envelope.maxTokens || 2048,
      },
    };

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (fetchErr: any) {
      throw new Error(`PROVIDER_UNREACHABLE: Gemini network request failed.`);
    }

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      throw new Error(`GEMINI_API_ERROR: HTTP ${res.status}`);
    }

    let json: any;
    try {
      json = await res.json();
    } catch (parseErr: any) {
      throw new Error('MALFORMED_AI_OUTPUT: Gemini returned invalid JSON body.');
    }

    const candidate = json.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text || '{}';

    const usage = json.usageMetadata || {};
    const promptTokens = usage.promptTokenCount || Math.ceil(prompt.user.length / 4);
    const completionTokens = usage.candidatesTokenCount || Math.ceil(rawText.length / 4);

    return {
      providerId: 'gemini',
      modelIdentifier: model,
      content: rawText,
      promptTokens,
      completionTokens,
      latencyMs,
      isMock: false,
    };
  }
}
