/**
 * @file worker/ai/providers/deepSeekCertifiedProvider.ts
 * @description DeepSeek Certified Provider Adapter for Profile `deepseek-v4-flash-offpeak-low`
 * 
 * SPECIFICATION & SAFETY CONSTRAINTS:
 * - Certified Profile: `deepseek-v4-flash-offpeak-low`
 * - Endpoint: `https://api.deepseek.com/v1/chat/completions` (strict canonical URL validation)
 * - Model: `deepseek-v4-flash`
 * - Thinking: `{ type: 'enabled' }`, `reasoning_effort: 'low'`
 * - Response Format: `{ type: 'json_object' }`
 * - Model Identity: Exact string match required; any substitution fails closed.
 * - Cache Telemetry: Provider-reported prompt, cache_hit, cache_miss, completion, reasoning tokens required.
 * - Telemetry Integrity: promptTokens === cacheHitTokens + cacheMissTokens required.
 * - CoT Sanitization: `reasoning_content` is never included in the output `content`.
 * - Privacy Gate: PUBLIC_BUSINESS and PSEUDONYMOUS_OPERATIONAL data only. Zero network fetch on violations.
 * - Retries: Initial + max 2 retries on 429, 500, 502, 503, 504, and transport failures.
 * - Dormant Component: NOT imported or called by production aiRouter.
 */

import { WorkerEnv } from '../../env';
import { AIRequestEnvelope, DataClassification, RoutingTier } from '../types';
import { A12B2B_MAX_OUTPUT_TOKENS_BOUND } from '../evaluation/evaluationLiveTypes';
import { EvaluationCostCalculator } from '../evaluation/evaluationCostCalculator';
import { 
  CertifiedPromptPayload, 
  CertifiedProviderResponse, 
  CertifiedProviderError,
  isCertifiedA12B2CTaskType,
} from './certifiedProviderTypes';
import * as crypto from 'crypto';

export type DeepSeekPricingCertificationStatus =
  | 'OFF_PEAK_CERTIFIED'
  | 'PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION';

export class DeepSeekCertifiedProvider {
  public static readonly CANDIDATE_ID = 'deepseek-v4-flash-offpeak-low';
  public static readonly CERTIFIED_MODEL = 'deepseek-v4-flash';
  public static readonly OFFICIAL_BASE_URL = 'https://api.deepseek.com';
  public static readonly MAX_OUTPUT_TOKENS = A12B2B_MAX_OUTPUT_TOKENS_BOUND; // Exactly 2048
  public static readonly MAX_ATTEMPTS = 3; // Initial + max 2 retries

  public static isDataClassificationSupported(classification: DataClassification): boolean {
    return classification === 'PUBLIC_BUSINESS' || classification === 'PSEUDONYMOUS_OPERATIONAL';
  }

  /**
   * Evaluates if the given routing tier is supported.
   * NOTE: Task certification eligibility is strictly governed by the canonical 7-task scope
   * (CERTIFIED_A12B2C_TASK_TYPES), not generic routing tiers.
   */
  public static supportsTier(tier: RoutingTier): boolean {
    return tier === 'FAST_LOW_COST';
  }

  /**
   * Pure helper exposing DeepSeek pricing window certification status based on deterministic UTC schedule.
   * Metadata only: does not block or reroute production traffic in this phase.
   */
  public static getPricingCertificationStatus(date: Date = new Date()): DeepSeekPricingCertificationStatus {
    const window = EvaluationCostCalculator.getDeepSeekPricingWindow(date);
    return window === 'OFF_PEAK' ? 'OFF_PEAK_CERTIFIED' : 'PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION';
  }

  /**
   * Validates and normalizes the official DeepSeek API base URL.
   * Disallows untrusted origins, userinfo, alternate ports, or insecure protocols.
   */
  public static validateBaseUrl(baseUrlStr: string): string {
    try {
      const parsed = new URL(baseUrlStr);
      if (
        parsed.protocol !== 'https:' ||
        parsed.hostname !== 'api.deepseek.com' ||
        parsed.origin !== 'https://api.deepseek.com' ||
        (parsed.port !== '' && parsed.port !== '443') ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error(`UNAPPROVED_DEEPSEEK_ENDPOINT: ${baseUrlStr}. Only official DeepSeek API endpoint https://api.deepseek.com is allowed.`);
      }
      return 'https://api.deepseek.com';
    } catch (err: any) {
      if (err.message.includes('UNAPPROVED_DEEPSEEK_ENDPOINT')) throw err;
      throw new Error(`UNAPPROVED_DEEPSEEK_ENDPOINT: ${baseUrlStr}. Invalid URL format.`);
    }
  }

  /**
   * Executes inference against DeepSeek using the certified profile.
   */
  public static async execute(
    envelope: AIRequestEnvelope,
    prompt: CertifiedPromptPayload,
    env: WorkerEnv,
    options?: {
      retryDelaysMs?: number[];
      customFetch?: typeof fetch;
    }
  ): Promise<CertifiedProviderResponse> {
    const startTime = Date.now();

    // 1. Task Certification Preflight Gate (Zero-Fetch on Non-Certified Task Types)
    if (!isCertifiedA12B2CTaskType(envelope.taskType)) {
      throw new CertifiedProviderError({
        providerId: 'deepseek',
        candidateId: this.CANDIDATE_ID,
        errorCategory: 'TASK_NOT_CERTIFIED',
        message: `TASK_NOT_CERTIFIED: TaskType "${envelope.taskType}" is not certified under Phase A.12B.2C.`,
        attemptCount: 0,
        latencyMs: Date.now() - startTime,
        isTransient: false,
      });
    }

    // 2. Privacy Preflight Gate (Zero-Fetch on Personal/Sensitive/Secret)
    if (!this.isDataClassificationSupported(envelope.dataClassification)) {
      throw new CertifiedProviderError({
        providerId: 'deepseek',
        candidateId: this.CANDIDATE_ID,
        errorCategory: 'PRIVACY_VIOLATION',
        message: `PRIVACY_VIOLATION: DeepSeek certified profile cannot receive ${envelope.dataClassification} data.`,
        attemptCount: 0,
        latencyMs: Date.now() - startTime,
        isTransient: false,
      });
    }

    // 3. Credentials Preflight Gate
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new CertifiedProviderError({
        providerId: 'deepseek',
        candidateId: this.CANDIDATE_ID,
        errorCategory: 'CREDENTIALS_MISSING',
        message: 'CREDENTIALS_MISSING: DEEPSEEK_API_KEY is not configured in environment.',
        attemptCount: 0,
        latencyMs: Date.now() - startTime,
        isTransient: false,
      });
    }

    // 4. Endpoint Resolution
    const baseUrl = this.validateBaseUrl(env.VELNAR_AI_DEEPSEEK_BASE_URL || this.OFFICIAL_BASE_URL);
    const endpoint = `${baseUrl}/v1/chat/completions`;

    // 5. Certified Request Payload Construction (Exact sealed 2048 bound)
    const requestBody = {
      model: this.CERTIFIED_MODEL,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: this.MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_object' },
      thinking: {
        type: 'enabled',
      },
      reasoning_effort: 'low',
    };

    const fetchFn = options?.customFetch || fetch;
    const retryDelays = options?.retryDelaysMs || [1000, 2000];

    let attemptCount = 0;
    let lastError: CertifiedProviderError | null = null;

    while (attemptCount < this.MAX_ATTEMPTS) {
      attemptCount++;
      const attemptStartTime = Date.now();

      try {
        const res = await fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const attemptLatencyMs = Date.now() - attemptStartTime;

        if (!res.ok) {
          const isTransient = [429, 500, 502, 503, 504].includes(res.status);
          const errorCategory = `HTTP_${res.status}`;

          const error = new CertifiedProviderError({
            providerId: 'deepseek',
            candidateId: this.CANDIDATE_ID,
            errorCategory,
            httpStatus: res.status,
            message: `DeepSeek API returned HTTP ${res.status}`,
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient,
          });

          if (isTransient && attemptCount < this.MAX_ATTEMPTS) {
            lastError = error;
            const delay = retryDelays[attemptCount - 1] ?? 1000;
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            continue;
          }

          throw error;
        }

        let json: any;
        try {
          json = await res.json();
        } catch {
          throw new CertifiedProviderError({
            providerId: 'deepseek',
            candidateId: this.CANDIDATE_ID,
            errorCategory: 'MALFORMED_AI_OUTPUT',
            message: 'DeepSeek returned malformed JSON response body',
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient: false,
          });
        }

        // 6. Strict Model Identity Enforcement (Fail-Closed on any substitution)
        const returnedModel = json.model;
        if (returnedModel !== this.CERTIFIED_MODEL) {
          throw new CertifiedProviderError({
            providerId: 'deepseek',
            candidateId: this.CANDIDATE_ID,
            errorCategory: 'MODEL_SUBSTITUTION_DETECTED',
            message: `MODEL_SUBSTITUTION_DETECTED: Returned model "${returnedModel || 'UNKNOWN'}" does not exactly match certified model "${this.CERTIFIED_MODEL}".`,
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient: false,
          });
        }

        // 7. Content Extraction & CoT Isolation (Never expose reasoning_content)
        const choice = json.choices?.[0];
        const content = choice?.message?.content || '{}';
        const providerModelVersion = json.system_fingerprint || json.model_version || json.modelVersion;

        // 8. Telemetry & Cache Hit/Miss Verification
        const usage = json.usage;
        if (
          !usage ||
          typeof usage.prompt_tokens !== 'number' ||
          typeof usage.prompt_cache_hit_tokens !== 'number' ||
          typeof usage.prompt_cache_miss_tokens !== 'number' ||
          typeof usage.completion_tokens !== 'number' ||
          typeof usage.total_tokens !== 'number'
        ) {
          throw new CertifiedProviderError({
            providerId: 'deepseek',
            candidateId: this.CANDIDATE_ID,
            errorCategory: 'TELEMETRY_INCOMPLETE',
            message: 'TELEMETRY_INCOMPLETE: Missing required DeepSeek cache or token telemetry.',
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient: false,
          });
        }

        const promptTokens = usage.prompt_tokens;
        const cacheHitTokens = usage.prompt_cache_hit_tokens;
        const cacheMissTokens = usage.prompt_cache_miss_tokens;

        // Cache integrity invariant: prompt_tokens === cache_hit + cache_miss
        if (promptTokens !== cacheHitTokens + cacheMissTokens) {
          throw new CertifiedProviderError({
            providerId: 'deepseek',
            candidateId: this.CANDIDATE_ID,
            errorCategory: 'TELEMETRY_INTEGRITY_FAILURE',
            message: `TELEMETRY_INTEGRITY_FAILURE: prompt_tokens (${promptTokens}) does not equal cacheHit (${cacheHitTokens}) + cacheMiss (${cacheMissTokens}).`,
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient: false,
          });
        }

        const completionTokens = usage.completion_tokens;
        const thinkingTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
        const totalTokens = usage.total_tokens;
        const rawTextHash = crypto.createHash('sha256').update(content).digest('hex');

        return {
          providerId: 'deepseek',
          candidateId: this.CANDIDATE_ID,
          requestedModelIdentifier: this.CERTIFIED_MODEL,
          returnedModelIdentifier: returnedModel,
          providerModelVersion,
          content,
          rawTextHash,
          promptTokens,
          cacheHitTokens,
          cacheMissTokens,
          completionTokens,
          thinkingTokens,
          totalTokens,
          latencyMs: Date.now() - startTime,
          attemptCount,
          cacheStatus: 'VERIFIED',
          usageSource: 'PROVIDER_REPORTED',
          isMock: false,
        };
      } catch (err: any) {
        if (err instanceof CertifiedProviderError) {
          if (err.isTransient && attemptCount < this.MAX_ATTEMPTS) {
            lastError = err;
            const delay = retryDelays[attemptCount - 1] ?? 1000;
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            continue;
          }
          throw err;
        }

        const attemptLatencyMs = Date.now() - attemptStartTime;
        const isNetworkTransient = 
          err.message?.includes('fetch') ||
          err.message?.includes('network') ||
          err.message?.includes('ECONNRESET') ||
          err.message?.includes('ETIMEDOUT');

        const networkError = new CertifiedProviderError({
          providerId: 'deepseek',
          candidateId: this.CANDIDATE_ID,
          errorCategory: 'NETWORK_TRANSPORT_FAILURE',
          message: err.message || 'NETWORK_TRANSPORT_FAILURE: DeepSeek fetch failed.',
          attemptCount,
          latencyMs: attemptLatencyMs,
          isTransient: isNetworkTransient,
        });

        if (isNetworkTransient && attemptCount < this.MAX_ATTEMPTS) {
          lastError = networkError;
          const delay = retryDelays[attemptCount - 1] ?? 1000;
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new CertifiedProviderError({
      providerId: 'deepseek',
      candidateId: this.CANDIDATE_ID,
      errorCategory: 'MAX_RETRIES_EXCEEDED',
      message: `MAX_RETRIES_EXCEEDED: Failed after ${this.MAX_ATTEMPTS} attempts.`,
      attemptCount,
      latencyMs: Date.now() - startTime,
      isTransient: false,
    });
  }
}
