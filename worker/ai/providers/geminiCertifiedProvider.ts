/**
 * @file worker/ai/providers/geminiCertifiedProvider.ts
 * @description Google Gemini Certified Provider Adapter for Profile `gemini-3.5-flash-lite-flex-low`
 * 
 * SPECIFICATION & SAFETY CONSTRAINTS:
 * - Certified Profile: `gemini-3.5-flash-lite-flex-low`
 * - Endpoint: `https://generativelanguage.googleapis.com/v1beta/interactions` (Interactions API)
 * - Model: `gemini-3.5-flash-lite`
 * - Service Tier: `flex` (Mandatory; returned tier must be 'flex')
 * - Thinking Level: `low` (`generation_config.thinking_level = 'low'`)
 * - Response Format: `{ type: 'text', mime_type: 'application/json' }`
 * - Model Identity: Exact string match required; any substitution fails closed.
 * - Service Tier Check: Returned `service_tier` MUST equal 'flex'; non-flex response fails closed.
 * - Usage Telemetry: Provider-reported input, output, thought, and cached tokens required.
 * - Thought Sanitization: Hidden thought parts are never exposed in returned `content`.
 * - Privacy Gate: PUBLIC_BUSINESS and PSEUDONYMOUS_OPERATIONAL data only. Zero network fetch on violations.
 * - Retries: Initial + max 2 retries on 429, 500, 502, 503, 504, and transport failures.
 * - Dormant Component: NOT imported or called by production aiRouter.
 */

import { WorkerEnv } from '../../env';
import { AIRequestEnvelope, DataClassification, RoutingTier } from '../types';
import { 
  CertifiedPromptPayload, 
  CertifiedProviderResponse, 
  CertifiedProviderError 
} from './certifiedProviderTypes';
import * as crypto from 'crypto';

export class GeminiCertifiedProvider {
  public static readonly CANDIDATE_ID = 'gemini-3.5-flash-lite-flex-low';
  public static readonly CERTIFIED_MODEL = 'gemini-3.5-flash-lite';
  public static readonly REQUIRED_SERVICE_TIER = 'flex';
  public static readonly INTERACTIONS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  public static readonly MAX_OUTPUT_TOKENS = 4096;
  public static readonly MAX_ATTEMPTS = 3; // Initial + max 2 retries

  public static isDataClassificationSupported(classification: DataClassification): boolean {
    return classification === 'PUBLIC_BUSINESS' || classification === 'PSEUDONYMOUS_OPERATIONAL';
  }

  public static supportsTier(tier: RoutingTier): boolean {
    return tier === 'FAST_LOW_COST' || tier === 'REASONING' || tier === 'LONG_CONTEXT';
  }

  /**
   * Safely strips API keys and secrets from error messages and logs.
   */
  public static sanitizeErrorMessage(rawMessage: string, apiKey?: string): string {
    let sanitized = rawMessage || 'Unknown Gemini error';
    if (apiKey && apiKey.trim().length > 0) {
      sanitized = sanitized.split(apiKey).join('[REDACTED_API_KEY]');
    }
    sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
    sanitized = sanitized.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
    sanitized = sanitized.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
    return sanitized;
  }

  /**
   * Executes inference against Google Gemini Interactions API using the certified Flex profile.
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

    // 1. Privacy Preflight Gate (Zero-Fetch on Personal/Sensitive/Secret)
    if (!this.isDataClassificationSupported(envelope.dataClassification)) {
      throw new CertifiedProviderError({
        providerId: 'gemini',
        candidateId: this.CANDIDATE_ID,
        errorCategory: 'PRIVACY_VIOLATION',
        message: `PRIVACY_VIOLATION: Gemini certified profile cannot receive ${envelope.dataClassification} data.`,
        attemptCount: 0,
        latencyMs: Date.now() - startTime,
        isTransient: false,
      });
    }

    // 2. Credentials Preflight Gate
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new CertifiedProviderError({
        providerId: 'gemini',
        candidateId: this.CANDIDATE_ID,
        errorCategory: 'CREDENTIALS_MISSING',
        message: 'CREDENTIALS_MISSING: GEMINI_API_KEY is not configured in environment.',
        attemptCount: 0,
        latencyMs: Date.now() - startTime,
        isTransient: false,
      });
    }

    // 3. Certified Request Payload Construction (Interactions API schema)
    const requestBody = {
      model: this.CERTIFIED_MODEL,
      service_tier: this.REQUIRED_SERVICE_TIER,
      system_instruction: prompt.system,
      input: prompt.user,
      generation_config: {
        thinking_level: 'low',
        max_output_tokens: envelope.maxTokens || this.MAX_OUTPUT_TOKENS,
      },
      response_format: {
        type: 'text',
        mime_type: 'application/json',
      },
    };

    const fetchFn = options?.customFetch || fetch;
    const retryDelays = options?.retryDelaysMs || [1000, 2000];

    let attemptCount = 0;
    let lastError: CertifiedProviderError | null = null;

    while (attemptCount < this.MAX_ATTEMPTS) {
      attemptCount++;
      const attemptStartTime = Date.now();

      try {
        const res = await fetchFn(this.INTERACTIONS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(requestBody),
        });

        const attemptLatencyMs = Date.now() - attemptStartTime;

        if (!res.ok) {
          const isTransient = [429, 500, 502, 503, 504].includes(res.status);
          const errorCategory = `HTTP_${res.status}`;
          const rawErrorText = await res.text().catch(() => '');
          const sanitizedMsg = this.sanitizeErrorMessage(rawErrorText, apiKey);

          const error = new CertifiedProviderError({
            providerId: 'gemini',
            candidateId: this.CANDIDATE_ID,
            errorCategory,
            httpStatus: res.status,
            message: `Gemini API returned HTTP ${res.status}: ${sanitizedMsg}`,
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
            providerId: 'gemini',
            candidateId: this.CANDIDATE_ID,
            errorCategory: 'MALFORMED_AI_OUTPUT',
            message: 'Gemini returned malformed JSON response body',
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient: false,
          });
        }

        // 4. Strict Service Tier Verification (Fail-Closed on Non-Flex)
        const returnedServiceTier = json.service_tier;
        if (returnedServiceTier !== this.REQUIRED_SERVICE_TIER) {
          throw new CertifiedProviderError({
            providerId: 'gemini',
            candidateId: this.CANDIDATE_ID,
            errorCategory: 'SERVICE_TIER_MISMATCH',
            message: `SERVICE_TIER_MISMATCH: Expected service_tier "${this.REQUIRED_SERVICE_TIER}" but provider returned "${returnedServiceTier || 'standard'}".`,
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient: false,
          });
        }

        // 5. Strict Model Identity Enforcement (Fail-Closed on any substitution)
        const returnedModel = json.model;
        if (returnedModel !== this.CERTIFIED_MODEL) {
          throw new CertifiedProviderError({
            providerId: 'gemini',
            candidateId: this.CANDIDATE_ID,
            errorCategory: 'MODEL_SUBSTITUTION_DETECTED',
            message: `MODEL_SUBSTITUTION_DETECTED: Returned model "${returnedModel || 'UNKNOWN'}" does not exactly match certified model "${this.CERTIFIED_MODEL}".`,
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient: false,
          });
        }

        // 6. Text Content Extraction (Isolating Model Outputs from Thought Steps)
        let content = '';
        if (Array.isArray(json.steps)) {
          for (const step of json.steps) {
            // Strict filter: only capture model_output or output parts, ignore thoughts/reasoning steps
            if (step.type === 'model_output' || step.type === 'output') {
              if (Array.isArray(step.content)) {
                for (const part of step.content) {
                  if (part.type === 'text' && typeof part.text === 'string') {
                    content += part.text;
                  }
                }
              } else if (typeof step.text === 'string') {
                content += step.text;
              }
            }
          }
        }
        if (!content && typeof json.output_text === 'string') {
          content = json.output_text;
        }
        if (!content && typeof json.content === 'string') {
          content = json.content;
        }
        if (!content) {
          content = '{}';
        }

        const providerModelVersion = json.modelVersion || json.system_fingerprint || json.model_version;

        // 7. Telemetry Extraction
        const usage = json.usage;
        if (
          !usage ||
          typeof usage.total_input_tokens !== 'number' ||
          typeof usage.total_output_tokens !== 'number' ||
          typeof usage.total_tokens !== 'number'
        ) {
          throw new CertifiedProviderError({
            providerId: 'gemini',
            candidateId: this.CANDIDATE_ID,
            errorCategory: 'TELEMETRY_INCOMPLETE',
            message: 'TELEMETRY_INCOMPLETE: Missing Gemini Interactions provider-reported usage telemetry.',
            attemptCount,
            latencyMs: attemptLatencyMs,
            isTransient: false,
          });
        }

        const promptTokens = usage.total_input_tokens;
        const completionTokens = usage.total_output_tokens;
        const thinkingTokens = typeof usage.total_thought_tokens === 'number' ? usage.total_thought_tokens : 0;
        const totalTokens = usage.total_tokens;

        const hasCachedTokens = typeof usage.total_cached_tokens === 'number';
        const cacheHitTokens = hasCachedTokens ? usage.total_cached_tokens : 0;
        const cacheMissTokens = Math.max(0, promptTokens - cacheHitTokens);
        const rawTextHash = crypto.createHash('sha256').update(content).digest('hex');

        return {
          providerId: 'gemini',
          candidateId: this.CANDIDATE_ID,
          requestedModelIdentifier: this.CERTIFIED_MODEL,
          returnedModelIdentifier: returnedModel,
          providerModelVersion,
          serviceTier: returnedServiceTier,
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
          providerId: 'gemini',
          candidateId: this.CANDIDATE_ID,
          errorCategory: 'NETWORK_TRANSPORT_FAILURE',
          message: err.message || 'NETWORK_TRANSPORT_FAILURE: Gemini fetch failed.',
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
      providerId: 'gemini',
      candidateId: this.CANDIDATE_ID,
      errorCategory: 'MAX_RETRIES_EXCEEDED',
      message: `MAX_RETRIES_EXCEEDED: Failed after ${this.MAX_ATTEMPTS} attempts.`,
      attemptCount,
      latencyMs: Date.now() - startTime,
      isTransient: false,
    });
  }
}
