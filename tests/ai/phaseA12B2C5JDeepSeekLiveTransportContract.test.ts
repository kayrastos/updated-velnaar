/**
 * @file tests/ai/phaseA12B2C5JDeepSeekLiveTransportContract.test.ts
 * @description Test suite for A.12B.2C-5J DeepSeek Live Transport Contract & Source Seal.
 * 
 * STRICT ARCHITECTURAL CONSTRAINTS:
 * - ZERO DeepSeek network calls.
 * - ZERO Gemini network calls.
 * - ZERO external network calls.
 * - ZERO live credentials accessed.
 * - DO NOT generate human authorization.
 * - DO NOT activate v1.3.
 * - DO NOT enable production routing.
 * - CANARY_LIVE_EXECUTION_ENABLED MUST remain false.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  TRANSPORT_CONTRACT_VERSION,
  SEALED_PROVIDER,
  SEALED_BASE_URL,
  SEALED_ENDPOINT,
  SEALED_METHOD,
  SEALED_MODEL,
  SEALED_DOCUMENTED_VERSION_TARGET,
  SEALED_REASONING_EFFORT,
  SEALED_MAX_TOKENS,
  SEALED_CONCURRENCY,
  SEALED_CLIENT_RETRIES,
  SEALED_CROSS_PROVIDER_FALLBACKS,
  SEALED_AUTOMATIC_RERUNS,
  SEALED_LIFECYCLE_TIMEOUT_MS,
  SEALED_OFF_PEAK_PROGRAM_ID,
  SEALED_PEAK_PROGRAM_ID,
  SEALED_OFF_PEAK_CANDIDATE_ID,
  SEALED_PEAK_CANDIDATE_ID,
  SEALED_OFF_PEAK_COST_BOUND_MICRO_USD,
  SEALED_PEAK_COST_BOUND_MICRO_USD,
  SEALED_CANONICAL_TASK_COUNT,
  NETWORK_TRANSPORT_IMPLEMENTED,
  LIVE_DISPATCH_CALLABLE,
  PROVIDER_NETWORK_CALLS,
  HUMAN_AUTHORIZATION_GENERATED,
  TRANSPORT_FAILURE_CATEGORIES,
  LIFECYCLE_TIMEOUT_CONTRACT,
  buildSealedLiveRequestDescriptor,
  parseDeepSeekCertificationResponse,
  buildLiveCertificationEvidenceCandidate,
  validateEvidenceConversionPreconditions,
  computeCanonicalTaskSetHash,
  computeFixtureSetHash,
  buildSourceSeal,
  validateLiveTransportPreflight,
  checkWindowCrossing,
  validateEvidencePersistenceContract,
} from '../../worker/ai/canary/deepSeekLiveCertificationTransportContract';
import * as contractModule from '../../worker/ai/canary/deepSeekLiveCertificationTransportContract';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
} from '../../worker/ai/providers/certifiedProviderTypes';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_SYNTHETIC_FIXTURES,
  computeFixtureHash,
} from '../../worker/ai/canary/canarySpecification';
import {
  SUCCESSOR_SPECIFICATION_VERSION,
  ACTIVATION_STATUS,
  CURRENT_ACTIVE_TECHNICAL_SPEC,
  DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION,
  getPricingWindow,
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';
import type {
  WindowAuthorizationEvidence,
  InvocationRecordSummary,
} from '../../worker/ai/canary/deepSeekSuccessorCertificationStateMachine';

describe('A.12B.2C-5J DeepSeek Live Transport Contract & Source Seal', () => {

  // Test 1: provider exact
  it('1. provider exact: deepseek', () => {
    expect(SEALED_PROVIDER).toBe('deepseek');
  });

  // Test 2: endpoint exact
  it('2. endpoint exact: https://api.deepseek.com/v1/chat/completions', () => {
    expect(SEALED_ENDPOINT).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(SEALED_BASE_URL).toBe('https://api.deepseek.com');
    expect(SEALED_METHOD).toBe('POST');
  });

  // Test 3: model exact
  it('3. model exact: deepseek-v4-flash', () => {
    expect(SEALED_MODEL).toBe('deepseek-v4-flash');
  });

  // Test 4: version target exact
  it('4. version target exact: DeepSeek-V4-Flash-0731', () => {
    expect(SEALED_DOCUMENTED_VERSION_TARGET).toBe('DeepSeek-V4-Flash-0731');
  });

  // Test 5: reasoning low
  it('5. reasoning effort exact: low', () => {
    expect(SEALED_REASONING_EFFORT).toBe('low');
  });

  // Test 6: max tokens 2048
  it('6. max tokens exact: 2048', () => {
    expect(SEALED_MAX_TOKENS).toBe(2048);
  });

  // Test 7: timeout 15000
  it('7. lifecycle timeout exact: 15000 ms with complete coverage', () => {
    expect(SEALED_LIFECYCLE_TIMEOUT_MS).toBe(15000);
    expect(LIFECYCLE_TIMEOUT_CONTRACT.totalTimeoutMs).toBe(15000);
    expect(LIFECYCLE_TIMEOUT_CONTRACT.coversRequestDispatch).toBe(true);
    expect(LIFECYCLE_TIMEOUT_CONTRACT.coversServerProcessing).toBe(true);
    expect(LIFECYCLE_TIMEOUT_CONTRACT.coversResponseHeaders).toBe(true);
    expect(LIFECYCLE_TIMEOUT_CONTRACT.coversResponseBodyAcquisition).toBe(true);
    expect(LIFECYCLE_TIMEOUT_CONTRACT.coversBodyParsing).toBe(true);
    expect(LIFECYCLE_TIMEOUT_CONTRACT.noBodyReadTimeoutGap).toBe(true);
  });

  // Test 8: retry 0
  it('8. client retries exact: 0', () => {
    expect(SEALED_CLIENT_RETRIES).toBe(0);
  });

  // Test 9: fallback 0
  it('9. cross provider fallbacks exact: 0', () => {
    expect(SEALED_CROSS_PROVIDER_FALLBACKS).toBe(0);
  });

  // Test 10: rerun 0
  it('10. automatic reruns exact: 0', () => {
    expect(SEALED_AUTOMATIC_RERUNS).toBe(0);
  });

  // Test 11: concurrency 1
  it('11. client concurrency exact: 1', () => {
    expect(SEALED_CONCURRENCY).toBe(1);
  });

  // Test 12: OFF_PEAK program exact
  it('12. OFF_PEAK program exact: DEEPSEEK_OFF_PEAK_SINGLE_PROVIDER_RESEAL', () => {
    expect(SEALED_OFF_PEAK_PROGRAM_ID).toBe('DEEPSEEK_OFF_PEAK_SINGLE_PROVIDER_RESEAL');
  });

  // Test 13: PEAK program exact
  it('13. PEAK program exact: DEEPSEEK_PEAK_SINGLE_PROVIDER_CERTIFICATION', () => {
    expect(SEALED_PEAK_PROGRAM_ID).toBe('DEEPSEEK_PEAK_SINGLE_PROVIDER_CERTIFICATION');
  });

  // Test 14: candidate IDs exact
  it('14. candidate IDs exact', () => {
    expect(SEALED_OFF_PEAK_CANDIDATE_ID).toBe('deepseek-v4-flash-offpeak-low');
    expect(SEALED_PEAK_CANDIDATE_ID).toBe('deepseek-v4-flash-peak-low');
  });

  // Test 15: sealed costs exact
  it('15. sealed worst-case budget basis exact', () => {
    expect(SEALED_OFF_PEAK_COST_BOUND_MICRO_USD).toBe(12783);
    expect(SEALED_PEAK_COST_BOUND_MICRO_USD).toBe(25566);
  });

  // Test 16: PEAK = 2x OFF_PEAK
  it('16. PEAK = exactly 2x OFF_PEAK', () => {
    expect(SEALED_PEAK_COST_BOUND_MICRO_USD).toBe(2 * SEALED_OFF_PEAK_COST_BOUND_MICRO_USD);
  });

  // Test 17: canonical seven task binding
  it('17. canonical seven task binding', () => {
    expect(CERTIFIED_A12B2C_TASK_TYPES.length).toBe(7);
    expect(SEALED_CANONICAL_TASK_COUNT).toBe(7);
    const expectedTasks = [
      'LEAD_INTENT_CLASSIFICATION',
      'LEAK_EXPLANATION',
      'GROWTH_ACTION_DRAFT',
      'BUSINESS_TWIN_SUMMARY',
      'FUNNEL_DIAGNOSTIC_EXPLANATION',
      'SEO_CONTENT_SUGGESTION',
      'ANOMALY_TRIAGE',
    ];
    expect(Array.from(CERTIFIED_A12B2C_TASK_TYPES)).toEqual(expectedTasks);
  });

  // Test 18: fixture hashes present
  it('18. fixture hashes present and deterministic for all canonical tasks', () => {
    for (const taskType of CERTIFIED_A12B2C_TASK_TYPES) {
      const fixture = CANARY_SYNTHETIC_FIXTURES[taskType];
      expect(fixture).toBeDefined();
      const hash = computeFixtureHash(fixture);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    }
  });

  // Test 19: descriptors contain no credentials
  it('19. request descriptors contain no credentials, keys, or auth headers', () => {
    for (let i = 0; i < CERTIFIED_A12B2C_TASK_TYPES.length; i++) {
      const taskType = CERTIFIED_A12B2C_TASK_TYPES[i];
      const descriptor = buildSealedLiveRequestDescriptor({
        taskType,
        invocationIndex: i + 1,
        pricingWindow: 'OFF_PEAK',
      });
      const serialized = JSON.stringify(descriptor);
      expect(serialized).not.toContain('authorization');
      expect(serialized).not.toContain('Bearer');
      expect(serialized).not.toContain('apiKey');
      expect(serialized).not.toContain('api_key');
      expect(serialized).not.toContain('secret');
      expect(descriptor.messages.length).toBe(2);
      expect(descriptor.requestedModel).toBe('deepseek-v4-flash');
      expect(descriptor.requestPayloadHash.length).toBe(64);
    }
  });

  // Test 20: parser preserves returned model
  it('20. parser preserves returned model', () => {
    const rawResponse = JSON.stringify({
      id: 'chatcmpl-12345',
      object: 'chat.completion',
      created: 1720000000,
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '{"score": 85}' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 45,
        total_tokens: 165,
        prompt_cache_hit_tokens: 50,
        prompt_cache_miss_tokens: 70,
      },
      system_fingerprint: 'fp_deepseek_backend_cfg_987',
    });

    const parsed = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: rawResponse,
      durationMs: 420,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.returnedModel).toBe('deepseek-v4-flash');
    expect(parsed.content).toBe('{"score": 85}');
    expect(parsed.finishReason).toBe('stop');
  });

  // Test 21: parser preserves fingerprint as opaque telemetry
  it('21. parser preserves fingerprint as opaque telemetry', () => {
    const rawResponse = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
      system_fingerprint: 'fp_opaque_telemetry_123',
    });

    const parsed = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: rawResponse,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.systemFingerprint).toBe('fp_opaque_telemetry_123');
  });

  // Test 22: fingerprint is not version
  it('22. fingerprint is not version and providerReportedModelVersion remains null', () => {
    const rawResponse = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
      system_fingerprint: 'fp_opaque_telemetry_123',
    });

    const parsed = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: rawResponse,
    });

    expect(parsed.providerReportedModelVersion).toBeNull();
    expect(parsed.systemFingerprint).not.toBe(SEALED_DOCUMENTED_VERSION_TARGET);
    expect(parsed.systemFingerprint).not.toBe(parsed.providerReportedModelVersion);
  });

  // Test 23: missing usage rejected
  it('23. missing usage rejected with USAGE_MISSING failure category', () => {
    const rawResponse = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' } }],
    });

    const parsed = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: rawResponse,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('USAGE_MISSING');
  });

  // Test 24: malformed JSON rejected
  it('24. malformed JSON rejected with JSON_PARSE_FAILURE', () => {
    const parsed = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: '{"incomplete_json: true',
    });

    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('JSON_PARSE_FAILURE');
  });

  // Test 25: wrong returned model rejected
  it('25. wrong returned model rejected with MODEL_PROVENANCE_MISMATCH', () => {
    const rawResponse = JSON.stringify({
      model: 'deepseek-chat',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const parsed = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: rawResponse,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('MODEL_PROVENANCE_MISMATCH');
    expect(parsed.returnedModel).toBe('deepseek-chat');
  });

  // Test 26: offline fixture cannot produce certificationEligible=true
  it('26. offline fixture cannot produce certificationEligible=true', () => {
    const candidate = buildLiveCertificationEvidenceCandidate({
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      runNonce: 'nonce_test_123',
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 1000,
      authorizedBudgetMicroUsd: 12783,
    });

    expect(candidate.candidateStatus).toBe('PENDING_REAL_TRANSPORT_EXECUTION');
    expect((candidate as any).certificationEligible).toBeUndefined();
    expect((candidate as any).evidenceOrigin).toBeUndefined();
  });

  // Test 27: parser cannot directly emit WindowCertificationEvidence
  it('27. parser cannot directly emit WindowCertificationEvidence', () => {
    const rawResponse = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const parsed = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: rawResponse,
    });

    expect((parsed as any).evidenceOrigin).toBeUndefined();
    expect((parsed as any).certificationEligible).toBeUndefined();
    expect((parsed as any).completedRequiredMatrixCases).toBeUndefined();
  });

  // Test 28: auth source mismatch rejected
  it('28. auth source commit mismatch rejected', () => {
    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'mismatched_commit_sha',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 12783,
      runNonce: 'nonce_test_abc',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('SOURCE_COMMIT_MISMATCH'))).toBe(true);
    expect(res.failureCategory).toBe('SOURCE_BINDING_FAILURE');
  });

  // Test 29: auth tree mismatch rejected
  it('29. auth tree mismatch rejected', () => {
    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'mismatched_tree_sha',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 12783,
      runNonce: 'nonce_test_abc',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('SOURCE_TREE_MISMATCH'))).toBe(true);
    expect(res.failureCategory).toBe('SOURCE_BINDING_FAILURE');
  });

  // Test 30: auth window mismatch rejected
  it('30. auth window mismatch rejected', () => {
    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_PEAK_PROGRAM_ID,
      pricingWindow: 'PEAK',
      candidateId: SEALED_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 25566,
      runNonce: 'nonce_test_abc',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('PRICING_WINDOW_MISMATCH'))).toBe(true);
  });

  // Test 31: auth program mismatch rejected
  it('31. auth program mismatch rejected', () => {
    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: 'INVALID_PROGRAM_NAME',
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 12783,
      runNonce: 'nonce_test_abc',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('PROGRAM_MISMATCH'))).toBe(true);
  });

  // Test 32: auth candidate mismatch rejected
  it('32. auth candidate mismatch rejected', () => {
    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: 'wrong-candidate-id',
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 12783,
      runNonce: 'nonce_test_abc',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('CANDIDATE_ID_MISMATCH'))).toBe(true);
  });

  // Test 33: auth nonce mismatch rejected
  it('33. auth nonce mismatch rejected', () => {
    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 12783,
      runNonce: '', // empty nonce
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('RUN_NONCE_MISSING'))).toBe(true);
  });

  // Test 34: insufficient budget rejected
  it('34. insufficient budget rejected', () => {
    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 10000, // less than 12783
      runNonce: 'nonce_123',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('INSUFFICIENT_BUDGET'))).toBe(true);
    expect(res.failureCategory).toBe('BUDGET_BREACH');
  });

  // Test 35: OFF_PEAK timestamp in PEAK rejected
  it('35. OFF_PEAK preflight with timestamp falling into PEAK window is rejected', () => {
    // Tuesday at 02:30 UTC is PEAK (01:00 <= UTC < 04:00 on weekdays)
    const peakTimeUtc = new Date('2026-09-08T02:30:00Z');
    expect(getPricingWindow(peakTimeUtc)).toBe('PEAK');

    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 12783,
      runNonce: 'nonce_123',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      currentTimeUtc: peakTimeUtc,
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('WINDOW_TIME_PREFLIGHT_MISMATCH'))).toBe(true);
    expect(res.failureCategory).toBe('PRICING_WINDOW_CHANGED');
  });

  // Test 36: PEAK timestamp in OFF_PEAK rejected
  it('36. PEAK preflight with timestamp falling into OFF_PEAK window is rejected', () => {
    // Saturday at 02:30 UTC is OFF_PEAK (weekends are always OFF_PEAK)
    const offPeakTimeUtc = new Date('2026-09-05T02:30:00Z');
    expect(getPricingWindow(offPeakTimeUtc)).toBe('OFF_PEAK');

    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_PEAK_PROGRAM_ID,
      pricingWindow: 'PEAK',
      candidateId: SEALED_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 25566,
      runNonce: 'nonce_123',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const res = validateLiveTransportPreflight(auth, {
      expectedWindow: 'PEAK',
      expectedCommit: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      expectedTree: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      currentTimeUtc: offPeakTimeUtc,
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('WINDOW_TIME_PREFLIGHT_MISMATCH'))).toBe(true);
    expect(res.failureCategory).toBe('PRICING_WINDOW_CHANGED');
  });

  // Test 37: window crossing requires fail-close
  it('37. window crossing requires fail-close and stops execution without retry', () => {
    // Starting in OFF_PEAK, then checking at Tuesday 02:00 UTC (PEAK)
    const midRunTimeUtc = new Date('2026-09-08T02:00:00Z');
    const crossingCheck = checkWindowCrossing('OFF_PEAK', midRunTimeUtc);

    expect(crossingCheck.crossed).toBe(true);
    expect(crossingCheck.currentWindow).toBe('PEAK');
    expect(crossingCheck.failClosed).toBe(true);
    expect(crossingCheck.failureCategory).toBe('PRICING_WINDOW_CHANGED');
  });

  // Test 38: persistence failure prevents certification
  it('38. persistence failure prevents certification transition (fails closed)', () => {
    const candidate = buildLiveCertificationEvidenceCandidate({
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      runNonce: 'nonce_test_123',
      invocationResponses: [],
      invocationRecords: [],
      observedTotalCostMicroUsd: 1000,
      authorizedBudgetMicroUsd: 12783,
    });

    const auth: WindowAuthorizationEvidence = {
      approvedBy: 'security_auditor',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: 12783,
      runNonce: 'nonce_test_123',
      authorizationTokenDigest: 'sha256:abcd1234',
    };

    const authKey = `${auth.targetProgram}:${auth.pricingWindow}:${auth.sourceCommitSha}:${auth.runNonce}`;

    const res = validateEvidenceConversionPreconditions({
      candidate,
      boundAuthorization: auth,
      consumedAuthorizations: [authKey, 'sha256:abcd1234'],
      persistenceSucceeded: false, // PERSISTENCE FAILED
      realTransportExecuted: true,
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('EVIDENCE_PERSISTENCE_FAILURE'))).toBe(true);
    expect(res.failureCategory).toBe('EVIDENCE_PERSISTENCE_FAILURE');
  });

  // Test 39: no public customFetch
  it('39. contract module does not export customFetch or transport hooks', () => {
    expect((contractModule as any).customFetch).toBeUndefined();
    expect((contractModule as any).createTransport).toBeUndefined();
    expect((contractModule as any).executeHttpCall).toBeUndefined();
    expect((contractModule as any).dispatchRequest).toBeUndefined();
  });

  // Test 40: no live dispatch API
  it('40. no live dispatch API and flags indicate not implemented', () => {
    expect(NETWORK_TRANSPORT_IMPLEMENTED).toBe(false);
    expect(LIVE_DISPATCH_CALLABLE).toBe(false);
  });

  // Test 41: no provider key read
  it('41. no provider key or credentials read by module', () => {
    const modulePath = path.resolve(process.cwd(), 'worker/ai/canary/deepSeekLiveCertificationTransportContract.ts');
    const sourceCode = fs.readFileSync(modulePath, 'utf8');

    expect(sourceCode).not.toContain('DEEPSEEK_API_KEY');
    expect(sourceCode).not.toContain('process.env');
    expect(sourceCode).not.toContain('fetch(');
    expect(sourceCode).not.toContain('globalThis.fetch');
    expect(sourceCode).not.toContain('axios');
    expect(sourceCode).not.toContain('undici');
  });

  // Test 42: CANARY_LIVE_EXECUTION_ENABLED false
  it('42. CANARY_LIVE_EXECUTION_ENABLED is strictly false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
  });

  // Test 43: productionRoutingEnforcementAllowed false
  it('43. productionRoutingEnforcementAllowed is strictly false', () => {
    expect(
      DEEPSEEK_SUCCESSOR_CERTIFICATION_SPECIFICATION.securityInvariants
        .productionRoutingEnforcementAllowed
    ).toBe(false);
  });

  // Test 44: v1.3 remains draft
  it('44. successor specification version remains draft', () => {
    expect(SUCCESSOR_SPECIFICATION_VERSION).toBe('a12b2c5-v1.3-draft');
    expect(ACTIVATION_STATUS).toBe('OFFLINE_DRAFT_NOT_LIVE');
    expect(CURRENT_ACTIVE_TECHNICAL_SPEC).toBe('a12b2c5-v1.2');
  });

  // Test 45: providerNetworkCalls = 0
  it('45. providerNetworkCalls is 0', () => {
    expect(PROVIDER_NETWORK_CALLS).toBe(0);
    expect(HUMAN_AUTHORIZATION_GENERATED).toBe(false);
  });

  // Test 46: source seal binding
  it('46. source seal binds canonical task set hash and fixture set hash', () => {
    const taskHash = computeCanonicalTaskSetHash();
    const fixtureHash = computeFixtureSetHash();
    expect(typeof taskHash).toBe('string');
    expect(taskHash.length).toBe(64);
    expect(typeof fixtureHash).toBe('string');
    expect(fixtureHash.length).toBe(64);

    const offPeakSeal = buildSourceSeal({
      pricingWindow: 'OFF_PEAK',
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
    });

    expect(offPeakSeal.provider).toBe('deepseek');
    expect(offPeakSeal.model).toBe('deepseek-v4-flash');
    expect(offPeakSeal.pricingWindow).toBe('OFF_PEAK');
    expect(offPeakSeal.sealedCostBoundMicroUsd).toBe(12783);
    expect(offPeakSeal.canonicalTaskSetHash).toBe(taskHash);
    expect(offPeakSeal.fixtureSetHash).toBe(fixtureHash);
  });

  // Test 47: all 16 transport failure categories defined
  it('47. all 16 transport failure categories defined and fail closed', () => {
    expect(TRANSPORT_FAILURE_CATEGORIES.length).toBe(16);
    const requiredCategories = [
      'HARD_LIFECYCLE_TIMEOUT',
      'HTTP_NON_SUCCESS',
      'NETWORK_TRANSPORT_FAILURE',
      'BODY_READ_FAILURE',
      'JSON_PARSE_FAILURE',
      'MODEL_PROVENANCE_MISMATCH',
      'USAGE_MISSING',
      'USAGE_INTEGRITY_FAILURE',
      'SCHEMA_FAILURE',
      'TASK_FAILURE',
      'SEMANTIC_GATE_FAILURE',
      'BUDGET_BREACH',
      'PRICING_WINDOW_CHANGED',
      'AUTHORIZATION_BINDING_FAILURE',
      'SOURCE_BINDING_FAILURE',
      'EVIDENCE_PERSISTENCE_FAILURE',
    ];
    for (const cat of requiredCategories) {
      expect(TRANSPORT_FAILURE_CATEGORIES).toContain(cat);
    }
  });

  // Test 48: evidence persistence validation schema
  it('48. evidence persistence contract requires all metadata and exactly 7 invocations', () => {
    const dummyRecord: InvocationRecordSummary = {
      taskId: 'task_1',
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      success: true,
      latencyMs: 120,
      modelRequested: 'deepseek-v4-flash',
      modelReturned: 'deepseek-v4-flash',
      schemaValid: true,
      providerReportedUsage: true,
      observedCostMicroUsd: 1500,
      semanticScore: 0.95,
      privacyViolation: false,
    };

    const validRecord = {
      phase: 'A.12B.2C-5J',
      program: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK' as const,
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      runNonce: 'nonce_123',
      authorizationDigestReference: 'sha256:abcd',
      invocationRecords: Array(7).fill(dummyRecord),
      costTotals: {
        observedTotalCostMicroUsd: 10500,
        authorizedBudgetMicroUsd: 12783,
      },
      latencies: {
        maxLatencyMs: 250,
        latenciesMs: Array(7).fill(120),
      },
      semanticAggregate: {
        aggregateSemanticScore: 0.95,
        threshold: 0.85,
      },
      modelProvenance: {
        requestedModel: 'deepseek-v4-flash',
        returnedModel: 'deepseek-v4-flash',
        systemFingerprint: 'fp_123',
      },
      usage: {
        totalPromptTokens: 840,
        totalCompletionTokens: 315,
      },
      artifactSha256: crypto.createHash('sha256').update('test_artifact').digest('hex'),
    };

    const validRes = validateEvidencePersistenceContract(validRecord);
    expect(validRes.valid).toBe(true);

    const invalidRecord = {
      ...validRecord,
      invocationRecords: Array(6).fill(dummyRecord), // only 6 instead of 7
    };
    const invalidRes = validateEvidencePersistenceContract(invalidRecord);
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.failureCategory).toBe('EVIDENCE_PERSISTENCE_FAILURE');
  });

  // Test 49: execution artifact strictly complies with 5J specification
  it('49. execution artifact strictly matches 5J requirements', () => {
    const artifactPath = path.resolve(
      process.cwd(),
      'execution/a12b2c5j_deepseek_live_transport_contract_source_seal.json'
    );
    expect(fs.existsSync(artifactPath)).toBe(true);

    const raw = fs.readFileSync(artifactPath, 'utf8');
    const artifact = JSON.parse(raw);

    expect(artifact.phase).toBe('A.12B.2C-5J');
    expect(artifact.artifactType).toBe('DEEPSEEK_LIVE_TRANSPORT_CONTRACT_SOURCE_SEAL');
    expect(artifact.baseCommit).toBe('da6c86932b6817a7294a84d4a380d2cc6fac15b7');
    expect(artifact.baseTree).toBe('e533483c009e221a81b1da5286ac5c27b68ca05f');
    expect(artifact.provider).toBe('deepseek');
    expect(artifact.model).toBe('deepseek-v4-flash');
    expect(artifact.documentedVersionTarget).toBe('DeepSeek-V4-Flash-0731');
    expect(artifact.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(artifact.lifecycleTimeoutMs).toBe(15000);
    expect(artifact.offPeakProgram).toBe('DEEPSEEK_OFF_PEAK_SINGLE_PROVIDER_RESEAL');
    expect(artifact.peakProgram).toBe('DEEPSEEK_PEAK_SINGLE_PROVIDER_CERTIFICATION');
    expect(artifact.offPeakCostBoundMicroUsd).toBe(12783);
    expect(artifact.peakCostBoundMicroUsd).toBe(25566);
    expect(artifact.networkTransportImplemented).toBe(false);
    expect(artifact.liveDispatchCallable).toBe(false);
    expect(artifact.humanAuthorizationGenerated).toBe(false);
    expect(artifact.providerNetworkCalls).toBe(0);
    expect(artifact.liveExecutionEnabled).toBe(false);
    expect(artifact.productionRoutingEnforcementAllowed).toBe(false);
    expect(artifact.successorActivated).toBe(false);
    expect(artifact.finalStatus).toBe(
      'A12B2C5J_LIVE_TRANSPORT_CONTRACT_PASS_IMPLEMENTATION_NOT_AUTHORIZED'
    );
  });

  // ==========================================================================
  // PHASE A.12B.2C-5J.1 CONTRACT REPAIR ADVERSARIAL REGRESSIONS (Tests 50 - 75)
  // ==========================================================================

  // DEFECT A: Request Body Shape & Top-Level reasoning_effort
  it('50. requestBody.thinking contains strictly { type: "enabled" } and NO reasoning_effort', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      invocationIndex: 1,
      pricingWindow: 'OFF_PEAK',
    });

    expect(desc.requestBody.thinking).toEqual({ type: 'enabled' });
    expect((desc.requestBody.thinking as any).reasoning_effort).toBeUndefined();
  });

  it('51. requestBody.reasoning_effort is strictly placed at top level with value "low"', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'GROWTH_ACTION_DRAFT',
      invocationIndex: 2,
      pricingWindow: 'PEAK',
    });

    expect(desc.requestBody.reasoning_effort).toBe('low');
    expect(Object.prototype.hasOwnProperty.call(desc.requestBody, 'reasoning_effort')).toBe(true);
  });

  it('52. requestBody.model is strictly "deepseek-v4-flash"', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'ANOMALY_TRIAGE',
      invocationIndex: 7,
      pricingWindow: 'OFF_PEAK',
    });

    expect(desc.requestBody.model).toBe('deepseek-v4-flash');
  });

  it('53. requestBody.max_tokens is strictly 2048', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'LEAK_EXPLANATION',
      invocationIndex: 3,
      pricingWindow: 'OFF_PEAK',
    });

    expect(desc.requestBody.max_tokens).toBe(2048);
  });

  it('54. requestBody.stream is strictly false', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'BUSINESS_TWIN_SUMMARY',
      invocationIndex: 4,
      pricingWindow: 'PEAK',
    });

    expect(desc.requestBody.stream).toBe(false);
  });

  it('55. requestBody.messages contains valid system and user messages', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'SEO_CONTENT_SUGGESTION',
      invocationIndex: 5,
      pricingWindow: 'OFF_PEAK',
    });

    expect(desc.requestBody.messages.length).toBe(2);
    expect(desc.requestBody.messages[0].role).toBe('system');
    expect(desc.requestBody.messages[1].role).toBe('user');
    expect(desc.requestBody.messages[0].content.length).toBeGreaterThan(0);
    expect(desc.requestBody.messages[1].content.length).toBeGreaterThan(0);
  });

  it('56. requestPayloadHash is exactly sha256 of JSON-serialized requestBody', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'FUNNEL_DIAGNOSTIC_EXPLANATION',
      invocationIndex: 6,
      pricingWindow: 'PEAK',
    });

    const expectedHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(desc.requestBody))
      .digest('hex');

    expect(desc.requestPayloadHash).toBe(expectedHash);
  });

  it('57. buildSealedLiveRequestDescriptor is strictly deterministic across all 7 canonical tasks', () => {
    for (let i = 0; i < CERTIFIED_A12B2C_TASK_TYPES.length; i++) {
      const taskType = CERTIFIED_A12B2C_TASK_TYPES[i];
      const desc1 = buildSealedLiveRequestDescriptor({
        taskType,
        invocationIndex: i + 1,
        pricingWindow: 'OFF_PEAK',
      });
      const desc2 = buildSealedLiveRequestDescriptor({
        taskType,
        invocationIndex: i + 1,
        pricingWindow: 'OFF_PEAK',
      });

      expect(desc1.requestPayloadHash).toBe(desc2.requestPayloadHash);
      expect(JSON.stringify(desc1)).toBe(JSON.stringify(desc2));
    }
  });

  // DEFECT B: 15000ms Hard Lifecycle Timeout Boundary
  it('58. parser rejects durationMs === 15000 exactly with HARD_LIFECYCLE_TIMEOUT', () => {
    const validBody = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: validBody,
      durationMs: 15000,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('HARD_LIFECYCLE_TIMEOUT');
    expect(res.failureReason).toContain('LIFECYCLE_TIMEOUT_EXCEEDED');
  });

  it('59. parser rejects durationMs > 15000 (e.g. 15001ms) with HARD_LIFECYCLE_TIMEOUT', () => {
    const validBody = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: validBody,
      durationMs: 15001,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('HARD_LIFECYCLE_TIMEOUT');
  });

  it('60. parser accepts durationMs === 14999 strictly below boundary', () => {
    const validBody = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: validBody,
      durationMs: 14999,
    });

    expect(res.success).toBe(true);
    expect(res.failureCategory).toBeUndefined();
  });

  it('61. parser accepts durationMs === 0 and typical positive latencies', () => {
    const validBody = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res0 = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: validBody,
      durationMs: 0,
    });
    expect(res0.success).toBe(true);

    const res350 = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: validBody,
      durationMs: 350,
    });
    expect(res350.success).toBe(true);
  });

  // DEFECT C: Candidate Identity & Window Enforcing
  it('62. buildSealedLiveRequestDescriptor rejects invalid pricingWindow runtime values', () => {
    expect(() =>
      buildSealedLiveRequestDescriptor({
        taskType: 'LEAD_INTENT_CLASSIFICATION',
        invocationIndex: 1,
        pricingWindow: 'MID_PEAK' as any,
      })
    ).toThrow('INVALID_PRICING_WINDOW');
  });

  it('63. buildSealedLiveRequestDescriptor derives candidate strictly from pricingWindow for OFF_PEAK', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      invocationIndex: 1,
      pricingWindow: 'OFF_PEAK',
      ...({ candidateId: 'malicious-override-candidate' } as any),
    });

    expect(desc.candidateId).toBe(SEALED_OFF_PEAK_CANDIDATE_ID);
    expect(desc.candidateId).not.toBe('malicious-override-candidate');
  });

  it('64. buildSealedLiveRequestDescriptor derives candidate strictly from pricingWindow for PEAK', () => {
    const desc = buildSealedLiveRequestDescriptor({
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      invocationIndex: 1,
      pricingWindow: 'PEAK',
      ...({ candidateId: 'malicious-override-candidate' } as any),
    });

    expect(desc.candidateId).toBe(SEALED_PEAK_CANDIDATE_ID);
    expect(desc.candidateId).not.toBe('malicious-override-candidate');
  });

  it('65. buildSourceSeal rejects invalid pricingWindow runtime values', () => {
    expect(() =>
      buildSourceSeal({
        pricingWindow: 'WEEKEND' as any,
        sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
        sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      })
    ).toThrow('INVALID_PRICING_WINDOW');
  });

  it('66. buildSourceSeal candidateId cannot be overridden and derives strictly from pricingWindow', () => {
    const offPeakSeal = buildSourceSeal({
      pricingWindow: 'OFF_PEAK',
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      ...({ candidateId: 'override-attempt' } as any),
    });
    expect(offPeakSeal.candidateId).toBe(SEALED_OFF_PEAK_CANDIDATE_ID);

    const peakSeal = buildSourceSeal({
      pricingWindow: 'PEAK',
      sourceCommitSha: 'da6c86932b6817a7294a84d4a380d2cc6fac15b7',
      sourceTreeSha: 'e533483c009e221a81b1da5286ac5c27b68ca05f',
      ...({ candidateId: 'override-attempt' } as any),
    });
    expect(peakSeal.candidateId).toBe(SEALED_PEAK_CANDIDATE_ID);
  });

  // DEFECT D: Provider Usage & Schema Integrity
  it('67. parser rejects response when usage is completely missing with USAGE_MISSING', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: body,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('USAGE_MISSING');
  });

  it('68. parser rejects response when usage.prompt_tokens is missing with USAGE_MISSING', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: body,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('USAGE_MISSING');
  });

  it('69. parser rejects response when usage.completion_tokens is missing with USAGE_MISSING', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: body,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('USAGE_MISSING');
  });

  it('70. parser rejects response when usage.total_tokens is missing with USAGE_MISSING', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: body,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('USAGE_MISSING');
  });

  it('71. parser rejects response when usage.prompt_cache_hit_tokens is missing with USAGE_MISSING', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: body,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('USAGE_MISSING');
  });

  it('72. parser rejects response when usage.prompt_cache_miss_tokens is missing with USAGE_MISSING', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 4,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: body,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('USAGE_MISSING');
  });

  it('73. parser rejects negative token values with USAGE_INTEGRITY_FAILURE', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: -10,
        completion_tokens: 5,
        total_tokens: -5,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: -10,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: body,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('USAGE_INTEGRITY_FAILURE');
  });

  it('74. parser rejects non-integer/fractional token values with USAGE_INTEGRITY_FAILURE', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10.5,
        completion_tokens: 5,
        total_tokens: 15.5,
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6.5,
      },
    });

    const res = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: body,
    });

    expect(res.success).toBe(false);
    expect(res.failureCategory).toBe('USAGE_INTEGRITY_FAILURE');
  });

  it('75. parser rejects usage arithmetic mismatches with USAGE_INTEGRITY_FAILURE', () => {
    // Arithmetic mismatch 1: prompt_tokens !== prompt_cache_hit_tokens + prompt_cache_miss_tokens
    const bodyMismatch1 = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 2,
        prompt_cache_miss_tokens: 2, // 2 + 2 = 4 !== 10
      },
    });

    const res1 = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: bodyMismatch1,
    });

    expect(res1.success).toBe(false);
    expect(res1.failureCategory).toBe('USAGE_INTEGRITY_FAILURE');

    // Arithmetic mismatch 2: total_tokens !== prompt_tokens + completion_tokens
    const bodyMismatch2 = JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 999, // 10 + 5 = 15 !== 999
        prompt_cache_hit_tokens: 4,
        prompt_cache_miss_tokens: 6,
      },
    });

    const res2 = parseDeepSeekCertificationResponse({
      httpStatus: 200,
      rawBodyText: bodyMismatch2,
    });

    expect(res2.success).toBe(false);
    expect(res2.failureCategory).toBe('USAGE_INTEGRITY_FAILURE');
  });
});
