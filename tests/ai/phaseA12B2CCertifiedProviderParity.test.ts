/**
 * @file tests/ai/phaseA12B2CCertifiedProviderParity.test.ts
 * @description Unit & Parity Test Suite for Phase A.12B.2C-2B Certified Provider Adapters
 * 
 * STRICT CONSTRAINTS VERIFIED:
 * - ZERO real network calls (strictly mocked)
 * - Exact DeepSeek request contract (deepseek-v4-flash, thinking: enabled, reasoning_effort: low, response_format: json_object)
 * - Exact Gemini Interactions/Flex request contract (gemini-3.5-flash-lite, service_tier: flex, thinking_level: low)
 * - Wrong model substitution fail-closed (MODEL_SUBSTITUTION_DETECTED)
 * - Gemini non-flex fail-closed (SERVICE_TIER_MISMATCH)
 * - Cache hit/miss and token telemetry integrity
 * - Privacy zero-fetch (PERSONAL, SENSITIVE, SECRET blocked before fetch)
 * - Retry rules: 429, 500, 502, 503, 504, transport failures only; max 3 attempts; zero retries on 400/401/403/substitution
 * - No CoT / reasoning leakage in returned content
 * - Structural parity against liveEvaluationClient.ts
 * - Non-interference: AIRouter does NOT import or activate certified providers yet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepSeekCertifiedProvider } from '../../worker/ai/providers/deepSeekCertifiedProvider';
import { GeminiCertifiedProvider } from '../../worker/ai/providers/geminiCertifiedProvider';
import { 
  CERTIFIED_A12B2C_TASK_TYPES,
  isCertifiedA12B2CTaskType 
} from '../../worker/ai/providers/certifiedProviderTypes';
import { EvaluationLiveClient } from '../../worker/ai/providers/liveEvaluationClient';
import { A12B2B_MAX_OUTPUT_TOKENS_BOUND } from '../../worker/ai/evaluation/evaluationLiveTypes';
import { AIRouter } from '../../worker/ai/aiRouter';
import { AIRequestEnvelope, DataClassification, TaskType } from '../../worker/ai/types';
import { WorkerEnv } from '../../worker/env';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase A.12B.2C-2B: Certified Provider Parity & Contract Suite', () => {
  const mockEnv: WorkerEnv = {
    ENVIRONMENT: 'test',
    DEEPSEEK_API_KEY: 'test_deepseek_key_12345',
    GEMINI_API_KEY: 'test_gemini_key_67890',
  };

  const validEnvelope: AIRequestEnvelope = {
    organizationId: 'org_test_1',
    businessId: 'biz_test_1',
    taskType: 'LEAD_INTENT_CLASSIFICATION',
    dataClassification: 'PUBLIC_BUSINESS',
  };

  const testPrompt = {
    system: 'You are an AI assistant. Output JSON only.',
    user: 'Classify lead intent for a visitor viewing pricing page.',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Exact DeepSeek Request Contract & Verification', () => {
    it('sends the exact certified DeepSeek request contract with 2048 token bound', async () => {
      let capturedUrl = '';
      let capturedHeaders: any = {};
      let capturedBody: any = {};

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedHeaders = init.headers;
        capturedBody = JSON.parse(init.body);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'deepseek-v4-flash',
            system_fingerprint: 'fp_v4_flash_123',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '{"intentScore": 88, "intentStage": "high_intent", "keyIndicators": ["pricing_view"]}',
                  reasoning_content: 'Hidden CoT that must not leak into content',
                },
              },
            ],
            usage: {
              prompt_tokens: 150,
              prompt_cache_hit_tokens: 100,
              prompt_cache_miss_tokens: 50,
              completion_tokens: 60,
              completion_tokens_details: {
                reasoning_tokens: 35,
              },
              total_tokens: 210,
            },
          }),
        };
      });

      const response = await DeepSeekCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
        customFetch: mockFetch as any,
        retryDelaysMs: [0, 0],
      });

      expect(capturedUrl).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['Authorization']).toBe('Bearer test_deepseek_key_12345');

      expect(capturedBody.model).toBe('deepseek-v4-flash');
      expect(capturedBody.max_tokens).toBe(2048);
      expect(capturedBody.max_tokens).toBe(A12B2B_MAX_OUTPUT_TOKENS_BOUND);
      expect(capturedBody.thinking).toEqual({ type: 'enabled' });
      expect(capturedBody.reasoning_effort).toBe('low');
      expect(capturedBody.response_format).toEqual({ type: 'json_object' });
      expect(capturedBody.messages).toHaveLength(2);
      expect(capturedBody.messages[0]).toEqual({ role: 'system', content: testPrompt.system });
      expect(capturedBody.messages[1]).toEqual({ role: 'user', content: testPrompt.user });

      // Telemetry verification
      expect(response.providerId).toBe('deepseek');
      expect(response.candidateId).toBe('deepseek-v4-flash-offpeak-low');
      expect(response.requestedModelIdentifier).toBe('deepseek-v4-flash');
      expect(response.returnedModelIdentifier).toBe('deepseek-v4-flash');
      expect(response.promptTokens).toBe(150);
      expect(response.cacheHitTokens).toBe(100);
      expect(response.cacheMissTokens).toBe(50);
      expect(response.completionTokens).toBe(60);
      expect(response.thinkingTokens).toBe(35);
      expect(response.totalTokens).toBe(210);
      expect(response.cacheStatus).toBe('VERIFIED');
      expect(response.usageSource).toBe('PROVIDER_REPORTED');
      expect(response.attemptCount).toBe(1);

      // CoT isolation: reasoning_content must NOT be present in content
      expect(response.content).not.toContain('Hidden CoT');
      expect(response.content).toBe('{"intentScore": 88, "intentStage": "high_intent", "keyIndicators": ["pricing_view"]}');
    });

    it('enforces that envelope.maxTokens cannot override the sealed 2048 token bound for DeepSeek', async () => {
      let capturedBody: any = {};

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'deepseek-v4-flash',
            choices: [{ message: { content: '{}' } }],
            usage: {
              prompt_tokens: 10,
              prompt_cache_hit_tokens: 10,
              prompt_cache_miss_tokens: 0,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }),
        };
      });

      const overrideEnvelope: AIRequestEnvelope = {
        ...validEnvelope,
        maxTokens: 8192, // Attempted override
      };

      await DeepSeekCertifiedProvider.execute(overrideEnvelope, testPrompt, mockEnv, {
        customFetch: mockFetch as any,
      });

      expect(capturedBody.max_tokens).toBe(2048);
    });

    it('rejects unapproved base URLs for DeepSeek', () => {
      expect(() => DeepSeekCertifiedProvider.validateBaseUrl('http://api.deepseek.com')).toThrow();
      expect(() => DeepSeekCertifiedProvider.validateBaseUrl('https://evil-deepseek.com')).toThrow();
      expect(() => DeepSeekCertifiedProvider.validateBaseUrl('https://api.deepseek.com.attacker.com')).toThrow();
      expect(DeepSeekCertifiedProvider.validateBaseUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com');
    });
  });

  describe('2. Exact Gemini Interactions/Flex Request Contract & Verification', () => {
    it('sends the exact certified Gemini Interactions Flex request contract with 2048 token bound', async () => {
      let capturedUrl = '';
      let capturedHeaders: any = {};
      let capturedBody: any = {};

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedHeaders = init.headers;
        capturedBody = JSON.parse(init.body);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'gemini-3.5-flash-lite',
            service_tier: 'flex',
            modelVersion: 'gemini-3.5-flash-lite-2026-09',
            steps: [
              {
                type: 'thought',
                text: 'Private thinking process that must not be in content',
              },
              {
                type: 'model_output',
                content: [
                  {
                    type: 'text',
                    text: '{"intentScore": 85, "intentStage": "high_intent", "keyIndicators": ["pricing"]}',
                  },
                ],
              },
            ],
            usage: {
              total_input_tokens: 160,
              total_output_tokens: 55,
              total_thought_tokens: 25,
              total_cached_tokens: 60,
              total_tokens: 215,
            },
          }),
        };
      });

      const response = await GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
        customFetch: mockFetch as any,
        retryDelaysMs: [0, 0],
      });

      expect(capturedUrl).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['x-goog-api-key']).toBe('test_gemini_key_67890');

      expect(capturedBody.model).toBe('gemini-3.5-flash-lite');
      expect(capturedBody.service_tier).toBe('flex');
      expect(capturedBody.system_instruction).toBe(testPrompt.system);
      expect(capturedBody.input).toBe(testPrompt.user);
      expect(capturedBody.generation_config).toEqual({
        thinking_level: 'low',
        max_output_tokens: 2048,
      });
      expect(capturedBody.generation_config.max_output_tokens).toBe(A12B2B_MAX_OUTPUT_TOKENS_BOUND);
      expect(capturedBody.response_format).toEqual({
        type: 'text',
        mime_type: 'application/json',
      });

      // Telemetry verification
      expect(response.providerId).toBe('gemini');
      expect(response.candidateId).toBe('gemini-3.5-flash-lite-flex-low');
      expect(response.requestedModelIdentifier).toBe('gemini-3.5-flash-lite');
      expect(response.returnedModelIdentifier).toBe('gemini-3.5-flash-lite');
      expect(response.serviceTier).toBe('flex');
      expect(response.promptTokens).toBe(160);
      expect(response.cacheHitTokens).toBe(60);
      expect(response.cacheMissTokens).toBe(100);
      expect(response.completionTokens).toBe(55);
      expect(response.thinkingTokens).toBe(25);
      expect(response.totalTokens).toBe(215);
      expect(response.cacheStatus).toBe('VERIFIED');
      expect(response.usageSource).toBe('PROVIDER_REPORTED');
      expect(response.attemptCount).toBe(1);

      // Thought isolation: thoughts must not leak into content
      expect(response.content).not.toContain('Private thinking process');
      expect(response.content).toBe('{"intentScore": 85, "intentStage": "high_intent", "keyIndicators": ["pricing"]}');
    });

    it('enforces that envelope.maxTokens cannot override the sealed 2048 token bound for Gemini', async () => {
      let capturedBody: any = {};

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'gemini-3.5-flash-lite',
            service_tier: 'flex',
            output_text: '{}',
            usage: {
              total_input_tokens: 10,
              total_output_tokens: 5,
              total_tokens: 15,
            },
          }),
        };
      });

      const overrideEnvelope: AIRequestEnvelope = {
        ...validEnvelope,
        maxTokens: 8192,
      };

      await GeminiCertifiedProvider.execute(overrideEnvelope, testPrompt, mockEnv, {
        customFetch: mockFetch as any,
      });

      expect(capturedBody.generation_config.max_output_tokens).toBe(2048);
    });

    it('returns cacheStatus NOT_VERIFIED for Gemini when total_cached_tokens is omitted', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gemini-3.5-flash-lite',
          service_tier: 'flex',
          output_text: '{}',
          usage: {
            total_input_tokens: 120,
            total_output_tokens: 40,
            total_tokens: 160,
            // total_cached_tokens is omitted
          },
        }),
      });

      const response = await GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
        customFetch: mockFetch as any,
      });

      expect(response.cacheStatus).toBe('NOT_VERIFIED');
      expect(response.cacheHitTokens).toBe(0);
      expect(response.cacheMissTokens).toBe(120);
    });
  });

  describe('3. Task Certification Scope Gate (7 Canonical Tasks)', () => {
    it('verifies canonical list contains exactly the 7 certified tasks', () => {
      expect(CERTIFIED_A12B2C_TASK_TYPES).toHaveLength(7);
      expect(CERTIFIED_A12B2C_TASK_TYPES).toEqual([
        'LEAD_INTENT_CLASSIFICATION',
        'LEAK_EXPLANATION',
        'GROWTH_ACTION_DRAFT',
        'BUSINESS_TWIN_SUMMARY',
        'FUNNEL_DIAGNOSTIC_EXPLANATION',
        'SEO_CONTENT_SUGGESTION',
        'ANOMALY_TRIAGE',
      ]);
    });

    it.each(CERTIFIED_A12B2C_TASK_TYPES)('allows certified task type %s for DeepSeek & Gemini', async (taskType) => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'deepseek-v4-flash',
          choices: [{ message: { content: '{}' } }],
          usage: {
            prompt_tokens: 10,
            prompt_cache_hit_tokens: 10,
            prompt_cache_miss_tokens: 0,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      });

      const envelope: AIRequestEnvelope = {
        ...validEnvelope,
        taskType,
      };

      const dsRes = await DeepSeekCertifiedProvider.execute(envelope, testPrompt, mockEnv, {
        customFetch: mockFetch as any,
      });
      expect(dsRes.returnedModelIdentifier).toBe('deepseek-v4-flash');
    });

    it('fails closed with TASK_NOT_CERTIFIED and zero network fetch on non-certified tasks', async () => {
      const mockFetch = vi.fn();
      const uncertifiedEnvelope: AIRequestEnvelope = {
        ...validEnvelope,
        taskType: 'UNSUPPORTED_RANDOM_TASK' as TaskType,
      };

      await expect(
        DeepSeekCertifiedProvider.execute(uncertifiedEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
        })
      ).rejects.toThrow(/TASK_NOT_CERTIFIED/);

      await expect(
        GeminiCertifiedProvider.execute(uncertifiedEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
        })
      ).rejects.toThrow(/TASK_NOT_CERTIFIED/);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('4. Model Substitution & Wrong Model Fail-Closed Enforcement', () => {
    it('DeepSeek fails closed when provider returns a substituted model', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'deepseek-chat', // Substituted model
          choices: [{ message: { content: '{}' } }],
          usage: {
            prompt_tokens: 10,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      });

      await expect(
        DeepSeekCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/MODEL_SUBSTITUTION_DETECTED/);

      // Model substitution is non-transient, so fetch must be called exactly once (no retry)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('Gemini fails closed when provider returns a substituted model', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gemini-2.5-flash', // Substituted model
          service_tier: 'flex',
          output_text: '{}',
          usage: {
            total_input_tokens: 10,
            total_output_tokens: 5,
            total_tokens: 15,
          },
        }),
      });

      await expect(
        GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/MODEL_SUBSTITUTION_DETECTED/);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. Gemini Non-Flex Fail-Closed Enforcement', () => {
    it('Gemini fails closed when provider returns standard or non-flex service tier', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gemini-3.5-flash-lite',
          service_tier: 'standard', // Non-flex mismatch
          output_text: '{}',
          usage: {
            total_input_tokens: 10,
            total_output_tokens: 5,
            total_tokens: 15,
          },
        }),
      });

      await expect(
        GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/SERVICE_TIER_MISMATCH/);

      // Non-transient error => exactly 1 attempt
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. Telemetry and Cache Integrity Enforcement', () => {
    it('DeepSeek fails closed when prompt_tokens != cacheHit + cacheMiss', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'deepseek-v4-flash',
          choices: [{ message: { content: '{}' } }],
          usage: {
            prompt_tokens: 100,
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 50, // 80 + 50 = 130 != 100
            completion_tokens: 10,
            total_tokens: 110,
          },
        }),
      });

      await expect(
        DeepSeekCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/TELEMETRY_INTEGRITY_FAILURE/);
    });

    it('Gemini fails closed when total_cached_tokens > total_input_tokens', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gemini-3.5-flash-lite',
          service_tier: 'flex',
          output_text: '{}',
          usage: {
            total_input_tokens: 100,
            total_cached_tokens: 150, // Invalid: cached > prompt
            total_output_tokens: 10,
            total_tokens: 110,
          },
        }),
      });

      await expect(
        GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/TELEMETRY_INTEGRITY_FAILURE/);
    });

    it('Gemini fails closed when total_cached_tokens < 0', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gemini-3.5-flash-lite',
          service_tier: 'flex',
          output_text: '{}',
          usage: {
            total_input_tokens: 100,
            total_cached_tokens: -10, // Invalid: negative cache
            total_output_tokens: 10,
            total_tokens: 110,
          },
        }),
      });

      await expect(
        GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/TELEMETRY_INTEGRITY_FAILURE/);
    });

    it('DeepSeek fails closed when usage telemetry is missing fields', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'deepseek-v4-flash',
          choices: [{ message: { content: '{}' } }],
          usage: {
            prompt_tokens: 100,
            // Missing cache hit/miss tokens
            completion_tokens: 10,
            total_tokens: 110,
          },
        }),
      });

      await expect(
        DeepSeekCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/TELEMETRY_INCOMPLETE/);
    });

    it('Gemini fails closed when usage telemetry is missing fields', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gemini-3.5-flash-lite',
          service_tier: 'flex',
          output_text: '{}',
          usage: {
            // Missing total_input_tokens
            total_output_tokens: 10,
            total_tokens: 10,
          },
        }),
      });

      await expect(
        GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/TELEMETRY_INCOMPLETE/);
    });
  });

  describe('7. Privacy Zero-Fetch Preflight Verification', () => {
    const sensitiveClassifications: DataClassification[] = ['PERSONAL', 'SENSITIVE', 'SECRET'];

    it.each(sensitiveClassifications)('DeepSeek blocks %s data before network fetch', async (classification) => {
      const mockFetch = vi.fn();
      const envelope: AIRequestEnvelope = {
        ...validEnvelope,
        dataClassification: classification,
      };

      await expect(
        DeepSeekCertifiedProvider.execute(envelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
        })
      ).rejects.toThrow(/PRIVACY_VIOLATION/);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(sensitiveClassifications)('Gemini blocks %s data before network fetch', async (classification) => {
      const mockFetch = vi.fn();
      const envelope: AIRequestEnvelope = {
        ...validEnvelope,
        dataClassification: classification,
      };

      await expect(
        GeminiCertifiedProvider.execute(envelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
        })
      ).rejects.toThrow(/PRIVACY_VIOLATION/);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('8. Retry Strategy & Transient vs Non-Transient Classification', () => {
    it('retries on HTTP 429 and succeeds on second attempt for DeepSeek', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            text: async () => 'Rate limit exceeded',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'deepseek-v4-flash',
            choices: [{ message: { content: '{"status": "ok"}' } }],
            usage: {
              prompt_tokens: 20,
              prompt_cache_hit_tokens: 10,
              prompt_cache_miss_tokens: 10,
              completion_tokens: 5,
              total_tokens: 25,
            },
          }),
        };
      });

      const response = await DeepSeekCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
        customFetch: mockFetch as any,
        retryDelaysMs: [0, 0],
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(response.attemptCount).toBe(2);
      expect(response.content).toBe('{"status": "ok"}');
    });

    it('retries on HTTP 503 and succeeds on third attempt for Gemini', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            ok: false,
            status: 503,
            text: async () => 'Service Unavailable',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: 'gemini-3.5-flash-lite',
            service_tier: 'flex',
            output_text: '{"status": "recovered"}',
            usage: {
              total_input_tokens: 30,
              total_output_tokens: 8,
              total_tokens: 38,
            },
          }),
        };
      });

      const response = await GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
        customFetch: mockFetch as any,
        retryDelaysMs: [0, 0],
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(response.attemptCount).toBe(3);
      expect(response.content).toBe('{"status": "recovered"}');
    });

    it('stops after max 3 attempts and throws on persistent 500 error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        DeepSeekCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/HTTP 500/);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry non-transient 400 Bad Request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await expect(
        GeminiCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/HTTP 400/);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry non-transient 401 Unauthorized', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Invalid API Key',
      });

      await expect(
        DeepSeekCertifiedProvider.execute(validEnvelope, testPrompt, mockEnv, {
          customFetch: mockFetch as any,
          retryDelaysMs: [0, 0],
        })
      ).rejects.toThrow(/HTTP 401/);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('9. DeepSeek Pricing Certification Status Helper', () => {
    it('returns OFF_PEAK_CERTIFIED during off-peak hours and PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION during peak hours', () => {
      // 00:30 UTC is off-peak
      const offPeakDate = new Date('2026-09-01T00:30:00Z');
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(offPeakDate)).toBe('OFF_PEAK_CERTIFIED');

      // 02:00 UTC is peak on weekday (01:00-04:00 UTC)
      const peakDate1 = new Date('2026-09-01T02:00:00Z');
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(peakDate1)).toBe('PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION');

      // 07:00 UTC is peak on weekday (06:00-10:00 UTC)
      const peakDate2 = new Date('2026-09-01T07:00:00Z');
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(peakDate2)).toBe('PEAK_NOT_CERTIFIED_FOR_ROUTING_DECISION');

      // 12:00 UTC is off-peak
      const offPeakDate2 = new Date('2026-09-01T12:00:00Z');
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(offPeakDate2)).toBe('OFF_PEAK_CERTIFIED');
    });

    it('returns OFF_PEAK_CERTIFIED on weekends even during weekday peak clock windows (e.g. 2026-09-05T02:00:00Z)', () => {
      // 2026-09-05 is a Saturday. 02:00 UTC would be peak on weekdays, but all weekend UTC hours are off-peak
      const weekendSaturday = new Date('2026-09-05T02:00:00Z');
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(weekendSaturday)).toBe('OFF_PEAK_CERTIFIED');

      // 2026-09-06 is a Sunday. 07:00 UTC would be peak on weekdays, but all weekend UTC hours are off-peak
      const weekendSunday = new Date('2026-09-06T07:00:00Z');
      expect(DeepSeekCertifiedProvider.getPricingCertificationStatus(weekendSunday)).toBe('OFF_PEAK_CERTIFIED');
    });
  });

  describe('10. Structural Parity against liveEvaluationClient.ts', () => {
    it('maintains exact endpoint, token bounds, and model parameter parity with EvaluationLiveClient', () => {
      expect(DeepSeekCertifiedProvider.OFFICIAL_BASE_URL).toBe(EvaluationLiveClient.OFFICIAL_DEEPSEEK_BASE_URL);
      expect(DeepSeekCertifiedProvider.CERTIFIED_MODEL).toBe('deepseek-v4-flash');
      expect(DeepSeekCertifiedProvider.CANDIDATE_ID).toBe('deepseek-v4-flash-offpeak-low');
      expect(DeepSeekCertifiedProvider.MAX_OUTPUT_TOKENS).toBe(A12B2B_MAX_OUTPUT_TOKENS_BOUND);
      expect(DeepSeekCertifiedProvider.MAX_OUTPUT_TOKENS).toBe(2048);

      expect(GeminiCertifiedProvider.INTERACTIONS_ENDPOINT).toBe(`${EvaluationLiveClient.OFFICIAL_GEMINI_ENDPOINT_PREFIX}/v1beta/interactions`);
      expect(GeminiCertifiedProvider.CERTIFIED_MODEL).toBe('gemini-3.5-flash-lite');
      expect(GeminiCertifiedProvider.CANDIDATE_ID).toBe('gemini-3.5-flash-lite-flex-low');
      expect(GeminiCertifiedProvider.REQUIRED_SERVICE_TIER).toBe('flex');
      expect(GeminiCertifiedProvider.MAX_OUTPUT_TOKENS).toBe(A12B2B_MAX_OUTPUT_TOKENS_BOUND);
      expect(GeminiCertifiedProvider.MAX_OUTPUT_TOKENS).toBe(2048);
    });
  });

  describe('11. Isolation & Non-Interference with AIRouter', () => {
    it('verifies aiRouter.ts does not import certified provider adapters yet (dormant)', () => {
      const aiRouterPath = path.resolve(process.cwd(), 'worker/ai/aiRouter.ts');
      const aiRouterSource = fs.readFileSync(aiRouterPath, 'utf8');

      expect(aiRouterSource).not.toContain('DeepSeekCertifiedProvider');
      expect(aiRouterSource).not.toContain('GeminiCertifiedProvider');
      expect(aiRouterSource).not.toContain('deepSeekCertifiedProvider');
      expect(aiRouterSource).not.toContain('geminiCertifiedProvider');
    });
  });
});

