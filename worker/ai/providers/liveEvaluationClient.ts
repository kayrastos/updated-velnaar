/**
 * @file worker/ai/providers/liveEvaluationClient.ts
 * @description Provider invocation clients for Live Shadow Evaluation (Strict Endpoints & Structured Sampling)
 */

import { WorkerEnv } from '../../env';
import { PromptRegistry } from '../promptRegistry';
import { TaskType, DataClassification, AIRequestEnvelope } from '../types';
import { LiveCandidateConfig, UsageSource } from '../evaluation/evaluationLiveTypes';
import { EvaluationCostCalculator } from '../evaluation/evaluationCostCalculator';
import * as crypto from 'crypto';

export interface LiveProviderInvocationResult {
  candidateId: string;
  providerId: 'gemini' | 'deepseek';
  requestedModelIdentifier: string;
  returnedModelIdentifier: string;
  content: string;
  rawTextHash: string;
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  latencyMs: number;
  attemptCount: number;
  usageSource: UsageSource;
  providerErrorCategory?: string;
}

export class EvaluationLiveClient {
  public static readonly OFFICIAL_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
  public static readonly OFFICIAL_GEMINI_ENDPOINT_PREFIX = 'https://generativelanguage.googleapis.com';

  /**
   * Invokes a candidate with deterministic retry backoff (initial + up to 2 retries).
   * Only retries transient errors (429, 500, 502, 503, 504, transport failure).
   */
  public static async invokeCandidate(
    config: LiveCandidateConfig,
    envelope: AIRequestEnvelope,
    env: WorkerEnv
  ): Promise<LiveProviderInvocationResult> {
    const promptDef = PromptRegistry.getPrompt(envelope.taskType);
    const systemPrompt = promptDef.systemPrompt;
    const userPrompt = promptDef.buildUserPrompt(envelope);

    if (config.providerId === 'deepseek') {
      return this.invokeDeepSeekWithRetry(config, { system: systemPrompt, user: userPrompt }, env);
    } else if (config.providerId === 'gemini') {
      return this.invokeGeminiWithRetry(config, { system: systemPrompt, user: userPrompt }, env);
    } else {
      throw new Error(`UNSUPPORTED_LIVE_PROVIDER: ${config.providerId}`);
    }
  }

  /**
   * DeepSeek Invocation with Retry
   */
  private static async invokeDeepSeekWithRetry(
    config: LiveCandidateConfig,
    prompt: { system: string; user: string },
    env: WorkerEnv
  ): Promise<LiveProviderInvocationResult> {
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('MISSING_LIVE_CREDENTIALS: DEEPSEEK_API_KEY is not available');
    }

    const baseUrl = env.VELNAR_AI_DEEPSEEK_BASE_URL || this.OFFICIAL_DEEPSEEK_BASE_URL;
    if (!baseUrl.startsWith(this.OFFICIAL_DEEPSEEK_BASE_URL)) {
      throw new Error(`UNAPPROVED_DEEPSEEK_ENDPOINT: ${baseUrl}. Only official DeepSeek API endpoints allowed.`);
    }

    const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    const requestBody = {
      model: config.requestedModelIdentifier,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      response_format: { type: 'json_object' },
      thinking: {
        type: 'enabled',
      },
      reasoning_effort: 'low',
    };

    let attemptCount = 0;
    const maxAttempts = 3;
    const backoffMs = [2000, 5000];

    while (attemptCount < maxAttempts) {
      attemptCount++;
      const startTime = Date.now();

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const latencyMs = Date.now() - startTime;

        if (!res.ok) {
          const isTransient = [429, 500, 502, 503, 504].includes(res.status);
          if (isTransient && attemptCount < maxAttempts) {
            await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
            continue;
          }
          throw new Error(`DEEPSEEK_HTTP_ERROR_${res.status}`);
        }

        const json: any = await res.json();
        const choice = json.choices?.[0];
        const content = choice?.message?.content || '{}';

        // Compute hash of raw text
        const rawTextHash = crypto.createHash('sha256').update(content).digest('hex');

        // Extract provider-reported usage
        const usage = json.usage;
        if (!usage || typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') {
          throw new Error('TELEMETRY_INCOMPLETE: Missing DeepSeek provider-reported usage');
        }

        const promptTokens = usage.prompt_tokens;
        const cacheHitTokens = usage.prompt_cache_hit_tokens || 0;
        const cacheMissTokens =
          typeof usage.prompt_cache_miss_tokens === 'number'
            ? usage.prompt_cache_miss_tokens
            : promptTokens - cacheHitTokens;

        if (!EvaluationCostCalculator.validateDeepSeekTokenIntegrity(promptTokens, cacheHitTokens, cacheMissTokens)) {
          throw new Error('TELEMETRY_INTEGRITY_FAILURE: DeepSeek prompt tokens != cacheHit + cacheMiss');
        }

        const completionTokens = usage.completion_tokens;
        const thinkingTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
        const totalTokens = usage.total_tokens || promptTokens + completionTokens;

        return {
          candidateId: config.candidateId,
          providerId: 'deepseek',
          requestedModelIdentifier: config.requestedModelIdentifier,
          returnedModelIdentifier: json.model || config.requestedModelIdentifier,
          content,
          rawTextHash,
          promptTokens,
          cacheHitTokens,
          cacheMissTokens,
          completionTokens,
          thinkingTokens,
          totalTokens,
          latencyMs,
          attemptCount,
          usageSource: 'PROVIDER_REPORTED',
        };
      } catch (err: any) {
        if (attemptCount < maxAttempts && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('429'))) {
          await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
          continue;
        }
        throw err;
      }
    }

    throw new Error('DEEPSEEK_MAX_RETRIES_EXCEEDED');
  }

  /**
   * Gemini Invocation with Retry
   */
  private static async invokeGeminiWithRetry(
    config: LiveCandidateConfig,
    prompt: { system: string; user: string },
    env: WorkerEnv
  ): Promise<LiveProviderInvocationResult> {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('MISSING_LIVE_CREDENTIALS: GEMINI_API_KEY is not available');
    }

    const model = encodeURIComponent(config.requestedModelIdentifier);
    const endpoint = `${this.OFFICIAL_GEMINI_ENDPOINT_PREFIX}/v1beta/models/${model}:generateContent`;

    const requestBody: any = {
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
        thinkingConfig: {
          thinkingLevel: 'low',
        },
      },
    };

    let attemptCount = 0;
    const maxAttempts = 3;
    const backoffMs = [2000, 5000];

    while (attemptCount < maxAttempts) {
      attemptCount++;
      const startTime = Date.now();

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(requestBody),
        });

        const latencyMs = Date.now() - startTime;

        if (!res.ok) {
          const isTransient = [429, 500, 502, 503, 504].includes(res.status);
          if (isTransient && attemptCount < maxAttempts) {
            await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
            continue;
          }
          throw new Error(`GEMINI_HTTP_ERROR_${res.status}`);
        }

        const json: any = await res.json();
        const candidate = json.candidates?.[0];
        const content = candidate?.content?.parts?.[0]?.text || '{}';

        // Compute hash of raw text
        const rawTextHash = crypto.createHash('sha256').update(content).digest('hex');

        // Extract provider-reported usageMetadata
        const usage = json.usageMetadata;
        if (!usage || typeof usage.promptTokenCount !== 'number' || typeof usage.candidatesTokenCount !== 'number') {
          throw new Error('TELEMETRY_INCOMPLETE: Missing Gemini provider-reported usage');
        }

        const promptTokens = usage.promptTokenCount;
        const completionTokens = usage.candidatesTokenCount;
        const thinkingTokens = usage.thoughtsTokenCount || 0;
        const totalTokens = usage.totalTokenCount || promptTokens + completionTokens + thinkingTokens;

        return {
          candidateId: config.candidateId,
          providerId: 'gemini',
          requestedModelIdentifier: config.requestedModelIdentifier,
          returnedModelIdentifier: json.modelVersion || config.requestedModelIdentifier,
          content,
          rawTextHash,
          promptTokens,
          cacheHitTokens: 0,
          cacheMissTokens: promptTokens,
          completionTokens,
          thinkingTokens,
          totalTokens,
          latencyMs,
          attemptCount,
          usageSource: 'PROVIDER_REPORTED',
        };
      } catch (err: any) {
        if (attemptCount < maxAttempts && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('429'))) {
          await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
          continue;
        }
        throw err;
      }
    }

    throw new Error('GEMINI_MAX_RETRIES_EXCEEDED');
  }
}
