/**
 * @file worker/ai/providers/liveEvaluationClient.ts
 * @description Provider invocation clients for Live Shadow Evaluation (Strict Endpoints & Structured Sampling)
 */

import { WorkerEnv } from '../../env';
import { PromptRegistry } from '../promptRegistry';
import { TaskType, DataClassification, AIRequestEnvelope } from '../types';
import {
  LiveCandidateConfig,
  UsageSource,
  A12B2B_MAX_OUTPUT_TOKENS_BOUND,
  A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND,
} from '../evaluation/evaluationLiveTypes';
import { EvaluationCostCalculator } from '../evaluation/evaluationCostCalculator';
import * as crypto from 'crypto';

export interface GeminiSanitizedErrorDiagnostic {
  httpStatus: number;
  rpcStatus?: string;
  sanitizedMessage?: string;
  errorReason?: string;
  errorDomain?: string;
  quotaMetric?: string;
  quotaLimit?: string;
  quotaLocation?: string;
  retryDelay?: string;
  retryAfterHeader?: string;
  classifiedCategory:
    | 'GEMINI_RATE_LIMITED'
    | 'GEMINI_RESOURCE_EXHAUSTED'
    | 'GEMINI_QUOTA_PROVISIONING_ERROR'
    | 'GEMINI_FLEX_CAPACITY_UNAVAILABLE'
    | 'GEMINI_HTTP_ERROR_429_UNKNOWN'
    | string;
}

export class LiveProviderInvocationError extends Error {
  public readonly providerId: 'gemini' | 'deepseek';
  public readonly attemptCount: number;
  public readonly latencyMs: number;
  public readonly errorCategory: string;
  public readonly diagnosticDetails?: GeminiSanitizedErrorDiagnostic;

  constructor(params: {
    providerId: 'gemini' | 'deepseek';
    attemptCount: number;
    latencyMs: number;
    errorCategory: string;
    message: string;
    diagnosticDetails?: GeminiSanitizedErrorDiagnostic;
  }) {
    super(params.message);
    this.name = 'LiveProviderInvocationError';
    this.providerId = params.providerId;
    this.attemptCount = params.attemptCount;
    this.latencyMs = params.latencyMs;
    this.errorCategory = params.errorCategory;
    this.diagnosticDetails = params.diagnosticDetails;
  }
}

export interface LiveProviderInvocationResult {
  candidateId: string;
  providerId: 'gemini' | 'deepseek';
  requestedModelIdentifier: string;
  returnedModelIdentifier: string;
  providerModelVersion?: string;
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
  serviceTier?: string;
  cacheStatus?: 'NOT_VERIFIED' | 'VERIFIED';
  providerErrorCategory?: string;
}

export class EvaluationLiveClient {
  public static readonly OFFICIAL_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
  public static readonly OFFICIAL_GEMINI_ENDPOINT_PREFIX = 'https://generativelanguage.googleapis.com';

  /**
   * Validates and returns the strict canonical DeepSeek base URL.
   * Rejects lookalikes, subdomains, userinfo, alternate ports, etc.
   */
  public static validateDeepSeekBaseUrl(baseUrlStr: string): string {
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
   * Safely parses Google Gemini API error responses, extracting non-secret diagnostic telemetry.
   * Strips all secrets, API keys, and authorization material.
   */
  public static parseAndSanitizeGeminiErrorResponse(
    status: number,
    headers: Headers,
    rawBody: string,
    apiKey?: string
  ): GeminiSanitizedErrorDiagnostic {
    let rpcStatus: string | undefined;
    let rawMessage: string | undefined;
    let errorReason: string | undefined;
    let errorDomain: string | undefined;
    let quotaMetric: string | undefined;
    let quotaLimit: string | undefined;
    let quotaLocation: string | undefined;
    let retryDelay: string | undefined;
    const retryAfterHeader = headers.get('retry-after') || undefined;

    try {
      const errJson = JSON.parse(rawBody);
      const errObj = errJson.error || errJson;
      rpcStatus = errObj.status;
      rawMessage = errObj.message;

      if (Array.isArray(errObj.details)) {
        for (const detail of errObj.details) {
          const type = detail['@type'] || '';
          if (type.includes('ErrorInfo')) {
            errorReason = detail.reason;
            errorDomain = detail.domain;
            if (detail.metadata) {
              quotaMetric = detail.metadata.quota_metric || detail.metadata.metric;
              quotaLimit = detail.metadata.quota_limit || detail.metadata.limit;
              quotaLocation = detail.metadata.quota_location || detail.metadata.location;
            }
          } else if (type.includes('RetryInfo')) {
            retryDelay = detail.retryDelay;
          } else if (type.includes('QuotaFailure')) {
            if (Array.isArray(detail.violations) && detail.violations.length > 0) {
              quotaMetric = quotaMetric || detail.violations[0].subject;
            }
          }
        }
      }
    } catch {
      rawMessage = rawBody.slice(0, 500);
    }

    // Sanitize message - strip any secret keys or query params
    let sanitizedMessage = rawMessage || `HTTP ${status}`;
    if (apiKey) {
      sanitizedMessage = sanitizedMessage.split(apiKey).join('[REDACTED_API_KEY]');
    }
    sanitizedMessage = sanitizedMessage.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
    sanitizedMessage = sanitizedMessage.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
    sanitizedMessage = sanitizedMessage.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');

    // Classify error category deterministically without guessing
    let classifiedCategory = `GEMINI_HTTP_ERROR_${status}`;
    if (status === 429) {
      const msgLower = (sanitizedMessage || '').toLowerCase();
      const reasonUpper = (errorReason || '').toUpperCase();

      if (
        msgLower.includes('flex') &&
        (msgLower.includes('capacity') || msgLower.includes('unavailable'))
      ) {
        classifiedCategory = 'GEMINI_FLEX_CAPACITY_UNAVAILABLE';
      } else if (
        reasonUpper.includes('QUOTA') ||
        quotaLimit === '0' ||
        msgLower.includes('check your plan') ||
        msgLower.includes('billing') ||
        msgLower.includes('quota exceeded') ||
        msgLower.includes('quota has been exhausted')
      ) {
        classifiedCategory = 'GEMINI_QUOTA_PROVISIONING_ERROR';
      } else if (
        reasonUpper.includes('RATE_LIMIT') ||
        msgLower.includes('rate limit') ||
        msgLower.includes('per minute') ||
        msgLower.includes('per second') ||
        msgLower.includes('too many requests')
      ) {
        classifiedCategory = 'GEMINI_RATE_LIMITED';
      } else if (rpcStatus === 'RESOURCE_EXHAUSTED') {
        classifiedCategory = 'GEMINI_RESOURCE_EXHAUSTED';
      } else {
        classifiedCategory = 'GEMINI_HTTP_ERROR_429_UNKNOWN';
      }
    }

    return {
      httpStatus: status,
      rpcStatus,
      sanitizedMessage,
      errorReason,
      errorDomain,
      quotaMetric,
      quotaLimit,
      quotaLocation,
      retryDelay,
      retryAfterHeader,
      classifiedCategory,
    };
  }

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

    const conservativeInputTokens = EvaluationCostCalculator.calculateConservativeInputTokenUpperBound(
      systemPrompt,
      userPrompt
    );

    if (conservativeInputTokens > A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND) {
      throw new LiveProviderInvocationError({
        providerId: config.providerId as any,
        attemptCount: 0,
        latencyMs: 0,
        errorCategory: 'A12B2B_INPUT_BOUND_EXCEEDED',
        message: `A12B2B_INPUT_BOUND_EXCEEDED: Prompt size (${conservativeInputTokens} bytes) exceeds supported certification bound (${A12B2B_CERTIFICATION_MAX_INPUT_TOKENS_BOUND} tokens)`,
      });
    }

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

    const baseUrl = this.validateDeepSeekBaseUrl(env.VELNAR_AI_DEEPSEEK_BASE_URL || this.OFFICIAL_DEEPSEEK_BASE_URL);
    const endpoint = `${baseUrl}/v1/chat/completions`;

    const requestBody = {
      model: config.requestedModelIdentifier,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: A12B2B_MAX_OUTPUT_TOKENS_BOUND,
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
          throw new LiveProviderInvocationError({
            providerId: 'deepseek',
            attemptCount,
            latencyMs,
            errorCategory: `DEEPSEEK_HTTP_ERROR_${res.status}`,
            message: `DEEPSEEK_HTTP_ERROR_${res.status}`,
          });
        }

        const json: any = await res.json();

        // Model identity check - strictly exact match to config.requestedModelIdentifier ("deepseek-v4-flash")
        const returnedModel = json.model;
        const providerModelVersion = json.system_fingerprint || json.model_version || json.modelVersion;
        if (returnedModel !== config.requestedModelIdentifier) {
          throw new LiveProviderInvocationError({
            providerId: 'deepseek',
            attemptCount,
            latencyMs,
            errorCategory: 'A12B2B_MODEL_SUBSTITUTION_DETECTED',
            message: `A12B2B_MODEL_SUBSTITUTION_DETECTED: Returned model "${returnedModel || 'UNKNOWN'}" does not exactly match requested "${config.requestedModelIdentifier}"`,
          });
        }

        const choice = json.choices?.[0];
        const content = choice?.message?.content || '{}';

        // Compute hash of raw text
        const rawTextHash = crypto.createHash('sha256').update(content).digest('hex');

        // Extract provider-reported usage
        const usage = json.usage;
        if (
          !usage ||
          typeof usage.prompt_tokens !== 'number' ||
          typeof usage.prompt_cache_hit_tokens !== 'number' ||
          typeof usage.prompt_cache_miss_tokens !== 'number' ||
          typeof usage.completion_tokens !== 'number' ||
          typeof usage.total_tokens !== 'number'
        ) {
          throw new LiveProviderInvocationError({
            providerId: 'deepseek',
            attemptCount,
            latencyMs,
            errorCategory: 'TELEMETRY_INCOMPLETE',
            message: 'TELEMETRY_INCOMPLETE: Missing required DeepSeek provider-reported usage telemetry',
          });
        }

        const promptTokens = usage.prompt_tokens;
        const cacheHitTokens = usage.prompt_cache_hit_tokens;
        const cacheMissTokens = usage.prompt_cache_miss_tokens;

        if (!EvaluationCostCalculator.validateDeepSeekTokenIntegrity(promptTokens, cacheHitTokens, cacheMissTokens)) {
          throw new LiveProviderInvocationError({
            providerId: 'deepseek',
            attemptCount,
            latencyMs,
            errorCategory: 'TELEMETRY_INTEGRITY_FAILURE',
            message: 'TELEMETRY_INTEGRITY_FAILURE: DeepSeek prompt tokens != cacheHit + cacheMiss',
          });
        }

        const completionTokens = usage.completion_tokens;
        const thinkingTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
        const totalTokens = usage.total_tokens;

        return {
          candidateId: config.candidateId,
          providerId: 'deepseek',
          requestedModelIdentifier: config.requestedModelIdentifier,
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
          latencyMs,
          attemptCount,
          usageSource: 'PROVIDER_REPORTED',
        };
      } catch (err: any) {
        if (err instanceof LiveProviderInvocationError) {
          if (
            attemptCount < maxAttempts &&
            (err.errorCategory.includes('429') ||
              err.errorCategory.includes('500') ||
              err.errorCategory.includes('502') ||
              err.errorCategory.includes('503') ||
              err.errorCategory.includes('504'))
          ) {
            await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
            continue;
          }
          throw err;
        }

        const latencyMs = Date.now() - startTime;
        if (
          attemptCount < maxAttempts &&
          (err.message.includes('fetch') ||
            err.message.includes('network') ||
            err.message.includes('429') ||
            err.message.includes('500') ||
            err.message.includes('502') ||
            err.message.includes('503') ||
            err.message.includes('504'))
        ) {
          await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
          continue;
        }

        throw new LiveProviderInvocationError({
          providerId: 'deepseek',
          attemptCount,
          latencyMs,
          errorCategory: err.message?.split(':')[0] || 'DEEPSEEK_NETWORK_ERROR',
          message: err.message || 'DEEPSEEK_NETWORK_ERROR',
        });
      }
    }

    throw new LiveProviderInvocationError({
      providerId: 'deepseek',
      attemptCount,
      latencyMs: 0,
      errorCategory: 'DEEPSEEK_MAX_RETRIES_EXCEEDED',
      message: 'DEEPSEEK_MAX_RETRIES_EXCEEDED',
    });
  }

  /**
   * Gemini Interactions API Invocation with Retry and Flex Service Tier
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

    const endpoint = `${this.OFFICIAL_GEMINI_ENDPOINT_PREFIX}/v1beta/interactions`;

    const requestBody: any = {
      model: config.requestedModelIdentifier,
      service_tier: config.serviceTier || 'flex',
      system_instruction: prompt.system,
      input: prompt.user,
      generation_config: {
        thinking_level: 'low',
        max_output_tokens: A12B2B_MAX_OUTPUT_TOKENS_BOUND,
      },
      response_format: {
        type: 'text',
        mime_type: 'application/json',
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
          const rawErrorBody = await res.text().catch(() => '');
          const diagnostic = EvaluationLiveClient.parseAndSanitizeGeminiErrorResponse(
            res.status,
            res.headers,
            rawErrorBody,
            apiKey
          );

          const isTransient = [429, 500, 502, 503, 504].includes(res.status);
          if (isTransient && attemptCount < maxAttempts) {
            await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
            continue;
          }
          throw new LiveProviderInvocationError({
            providerId: 'gemini',
            attemptCount,
            latencyMs,
            errorCategory: diagnostic.classifiedCategory,
            message: `${diagnostic.classifiedCategory}: ${diagnostic.sanitizedMessage || `HTTP ${res.status}`}`,
            diagnosticDetails: diagnostic,
          });
        }

        const json: any = await res.json();

        // 1. Service tier confirmation
        const returnedTier = json.service_tier;
        if (config.serviceTier === 'flex' && returnedTier !== 'flex') {
          throw new LiveProviderInvocationError({
            providerId: 'gemini',
            attemptCount,
            latencyMs,
            errorCategory: 'A12B2B_GEMINI_TIER_MISMATCH',
            message: `A12B2B_GEMINI_TIER_MISMATCH: Expected service_tier "flex" but provider returned "${returnedTier || 'standard'}"`,
          });
        }

        // 2. Model identity check - strictly exact match to config.requestedModelIdentifier ("gemini-3.5-flash-lite")
        const returnedModel = json.model;
        const providerModelVersion = json.modelVersion || json.system_fingerprint || json.model_version;
        if (returnedModel !== config.requestedModelIdentifier) {
          throw new LiveProviderInvocationError({
            providerId: 'gemini',
            attemptCount,
            latencyMs,
            errorCategory: 'A12B2B_MODEL_SUBSTITUTION_DETECTED',
            message: `A12B2B_MODEL_SUBSTITUTION_DETECTED: Returned model "${returnedModel || 'UNKNOWN'}" does not exactly match requested "${config.requestedModelIdentifier}"`,
          });
        }

        // 3. Extract text from Interactions steps
        let content = '';
        if (Array.isArray(json.steps)) {
          for (const step of json.steps) {
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

        // Compute hash of raw text
        const rawTextHash = crypto.createHash('sha256').update(content).digest('hex');

        // 4. Extract provider-reported usage telemetry
        const usage = json.usage;
        if (
          !usage ||
          typeof usage.total_input_tokens !== 'number' ||
          typeof usage.total_output_tokens !== 'number' ||
          typeof usage.total_tokens !== 'number'
        ) {
          throw new LiveProviderInvocationError({
            providerId: 'gemini',
            attemptCount,
            latencyMs,
            errorCategory: 'TELEMETRY_INCOMPLETE',
            message: 'TELEMETRY_INCOMPLETE: Missing Gemini Interactions provider-reported usage telemetry',
          });
        }

        const promptTokens = usage.total_input_tokens;
        const completionTokens = usage.total_output_tokens;
        const thinkingTokens = typeof usage.total_thought_tokens === 'number' ? usage.total_thought_tokens : 0;
        const totalTokens = usage.total_tokens;

        const hasCachedTokens = typeof usage.total_cached_tokens === 'number';
        const cacheHitTokens = hasCachedTokens ? usage.total_cached_tokens : 0;
        const cacheMissTokens = promptTokens - cacheHitTokens;
        const cacheStatus: 'VERIFIED' | 'NOT_VERIFIED' = hasCachedTokens ? 'VERIFIED' : 'NOT_VERIFIED';

        return {
          candidateId: config.candidateId,
          providerId: 'gemini',
          requestedModelIdentifier: config.requestedModelIdentifier,
          returnedModelIdentifier: returnedModel,
          providerModelVersion,
          serviceTier: returnedTier,
          cacheStatus,
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
        if (err instanceof LiveProviderInvocationError) {
          if (
            attemptCount < maxAttempts &&
            (err.errorCategory.includes('429') ||
              err.errorCategory.includes('500') ||
              err.errorCategory.includes('502') ||
              err.errorCategory.includes('503') ||
              err.errorCategory.includes('504'))
          ) {
            await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
            continue;
          }
          throw err;
        }

        const latencyMs = Date.now() - startTime;
        if (
          attemptCount < maxAttempts &&
          (err.message.includes('fetch') ||
            err.message.includes('network') ||
            err.message.includes('429') ||
            err.message.includes('500') ||
            err.message.includes('502') ||
            err.message.includes('503') ||
            err.message.includes('504'))
        ) {
          await new Promise((r) => setTimeout(r, backoffMs[attemptCount - 1] || 2000));
          continue;
        }

        throw new LiveProviderInvocationError({
          providerId: 'gemini',
          attemptCount,
          latencyMs,
          errorCategory: err.message?.split(':')[0] || 'GEMINI_NETWORK_ERROR',
          message: err.message || 'GEMINI_NETWORK_ERROR',
        });
      }
    }

    throw new LiveProviderInvocationError({
      providerId: 'gemini',
      attemptCount,
      latencyMs: 0,
      errorCategory: 'GEMINI_MAX_RETRIES_EXCEEDED',
      message: 'GEMINI_MAX_RETRIES_EXCEEDED',
    });
  }
}
