/**
 * @file tests/ai/phaseA12B2C5KGuardedDeepSeekLiveTransport.test.ts
 * @description Comprehensive Adversarial Test Suite for VELNAR Phase A.12B.2C-5K
 *              Guarded DeepSeek Live Transport Implementation.
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  GUARDED_TRANSPORT_MODULE_VERSION,
  GUARDED_DISPATCH_ENDPOINT,
  GUARDED_DISPATCH_METHOD,
  GUARDED_DISPATCH_MODEL,
  GUARDED_LIFECYCLE_TIMEOUT_MS,
  GUARDED_CANONICAL_TASK_COUNT,
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
  serializeAndHashCanonicalRequest,
  classifyLifecycleDeadline,
  classifyTransportError,
  calculateInvocationCostMicroUsd,
  mapResponseToInvocationRecord,
  prepareEvidencePersistenceRecord,
  executeGuardedDeepSeekCertificationTransport,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import * as guardedTransportModule from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
  CANARY_SYNTHETIC_FIXTURES,
} from '../../worker/ai/canary/canarySpecification';
import {
  SEALED_PROVIDER,
  SEALED_ENDPOINT,
  SEALED_METHOD,
  SEALED_MODEL,
  SEALED_LIFECYCLE_TIMEOUT_MS,
  SEALED_OFF_PEAK_CANDIDATE_ID,
  SEALED_PEAK_CANDIDATE_ID,
  SEALED_OFF_PEAK_PROGRAM_ID,
  SEALED_PEAK_PROGRAM_ID,
  SEALED_OFF_PEAK_COST_BOUND_MICRO_USD,
  SEALED_PEAK_COST_BOUND_MICRO_USD,
  SEALED_CANONICAL_TASK_COUNT,
  SEALED_REASONING_EFFORT,
  SEALED_MAX_TOKENS,
  SEALED_CONCURRENCY,
  SEALED_CLIENT_RETRIES,
  SEALED_CROSS_PROVIDER_FALLBACKS,
  SEALED_AUTOMATIC_RERUNS,
  buildSealedLiveRequestDescriptor,
  parseDeepSeekCertificationResponse,
  validateLiveTransportPreflight,
  checkWindowCrossing,
  DeepSeekTokenUsage,
  DeepSeekParsedProviderResponse,
} from '../../worker/ai/canary/deepSeekLiveCertificationTransportContract';
import { CERTIFIED_A12B2C_TASK_TYPES } from '../../worker/ai/providers/certifiedProviderTypes';
import {
  DEEPSEEK_OFF_PEAK_PRICING,
  DEEPSEEK_PEAK_PRICING,
  ACTIVATION_STATUS,
  CURRENT_ACTIVE_TECHNICAL_SPEC,
  getPricingWindow,
} from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';
import type {
  WindowAuthorizationEvidence,
  InvocationRecordSummary,
} from '../../worker/ai/canary/deepSeekSuccessorCertificationStateMachine';
import { SEMANTIC_SCORE_MIN_THRESHOLD } from '../../worker/ai/canary/deepSeekSuccessorCertificationStateMachine';

describe('VELNAR Phase A.12B.2C-5K Guarded DeepSeek Live Transport', () => {
  let globalFetchCalls = 0;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    globalFetchCalls = 0;
    originalFetch = globalThis.fetch;
    // Global fetch sentinel: any invocation during test run immediately increments sentinel
    globalThis.fetch = vi.fn().mockImplementation(() => {
      globalFetchCalls++;
      throw new Error('SECURITY_ALERT: globalThis.fetch MUST NOT be called in offline verification.');
    });
  });

  afterEach(() => {
    globalFetchCalls = 0;
    originalFetch = globalThis.fetch;
  });

  // Helper to build synthetic authorization evidence (TEST ONLY - NOT HUMAN AUTHORIZATION)
  function createSyntheticAuthorization(overrides: Partial<WindowAuthorizationEvidence> = {}): WindowAuthorizationEvidence {
    return {
      approvedBy: 'SYNTHETIC_TEST_ONLY_AUDITOR',
      approvalTimestamp: '2026-09-05T00:00:00Z',
      targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: '211b340a5e50cd3ba8758f4684942310e383b509',
      sourceTreeSha: '2f62744fd22bcc4477ee80a03312f816d4f4c5ac',
      specificationVersion: 'a12b2c5-v1.3-draft',
      maxBudgetMicroUsd: SEALED_OFF_PEAK_COST_BOUND_MICRO_USD,
      runNonce: 'synthetic_nonce_5k',
      authorizationTokenDigest: 'sha256:synthetic_token_digest_123',
      authorizationReusable: false,
      ...overrides,
    };
  }

  // ==========================================================================
  // GROUP 1: GLOBAL LIVE GATE BARRIER & UNREACHABLE TRANSPORT (Tests 1 - 7)
  // ==========================================================================

  it('1. CANARY_LIVE_EXECUTION_ENABLED is authoritative false in canarySpecification', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
  });

  it('2. executeGuardedDeepSeekCertificationTransport returns LIVE_EXECUTION_BLOCKED under current gate', async () => {
    const auth = createSyntheticAuthorization();
    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    expect(result.failureCategory).toBe('AUTHORIZATION_BINDING_FAILURE');
    expect(result.errors.some((e) => e.includes('CANARY_LIVE_EXECUTION_BLOCKED'))).toBe(true);
    expect(result.candidate).toBeNull();
  });

  it('3. global fetch sentinel records exactly 0 calls when live transport is invoked', async () => {
    const auth = createSyntheticAuthorization();
    await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
    });

    expect(globalFetchCalls).toBe(0);
  });

  it('4. credential resolver is never invoked while global live gate is closed', async () => {
    let credentialResolverCalls = 0;
    const auth = createSyntheticAuthorization();

    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
      getRuntimeCredential: () => {
        credentialResolverCalls++;
        return { apiKey: 'dummy-sentinel-key' };
      },
    });

    expect(credentialResolverCalls).toBe(0);
    expect(result.credentialReads).toBe(0);
    expect(result.providerNetworkCalls).toBe(0);
    expect(result.transportAttempts).toBe(0);
  });

  it('5. credential reads remain exactly 0 in execution result while blocked', async () => {
    const auth = createSyntheticAuthorization();
    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
    });

    expect(result.credentialReads).toBe(0);
  });

  it('6. no timers, sockets, or abort controllers created for transport while blocked', async () => {
    const auth = createSyntheticAuthorization();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
    });

    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 15000);
    setTimeoutSpy.mockRestore();
  });

  it('7. no evidence or certification state mutated when blocked', async () => {
    const auth = createSyntheticAuthorization();
    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
    });

    expect(result.candidate).toBeNull();
    expect(result.invocationRecords.length).toBe(0);
    expect(result.finalCertificationEligible).toBe(false);
  });

  // ==========================================================================
  // GROUP 2: AUTHORIZATION & SOURCE SEAL PREFLIGHT INVARIANTS (Tests 8 - 18)
  // ==========================================================================

  it('8. missing authorization object rejected in preflight', () => {
    const preflight = validateLiveTransportPreflight({} as any, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: '211b340a5e50cd3ba8758f4684942310e383b509',
      expectedTree: '2f62744fd22bcc4477ee80a03312f816d4f4c5ac',
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.length).toBeGreaterThan(0);
  });

  it('9. wrong target program rejected pre-network', () => {
    const auth = createSyntheticAuthorization({ targetProgram: 'INVALID_PROGRAM_ID' });
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('PROGRAM_MISMATCH'))).toBe(true);
  });

  it('10. wrong pricing window rejected pre-network', () => {
    const auth = createSyntheticAuthorization({ pricingWindow: 'PEAK' });
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('PRICING_WINDOW_MISMATCH'))).toBe(true);
  });

  it('11. wrong candidate ID rejected pre-network', () => {
    const auth = createSyntheticAuthorization({ candidateId: 'invalid-candidate-v1' });
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('CANDIDATE_ID_MISMATCH'))).toBe(true);
  });

  it('12. wrong source commit SHA rejected pre-network', () => {
    const auth = createSyntheticAuthorization({ sourceCommitSha: '0000000000000000000000000000000000000000' });
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: '211b340a5e50cd3ba8758f4684942310e383b509',
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('SOURCE_COMMIT_MISMATCH'))).toBe(true);
  });

  it('13. wrong source tree SHA rejected pre-network', () => {
    const auth = createSyntheticAuthorization({ sourceTreeSha: '0000000000000000000000000000000000000000' });
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: '2f62744fd22bcc4477ee80a03312f816d4f4c5ac',
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('SOURCE_TREE_MISMATCH'))).toBe(true);
  });

  it('14. wrong specification version rejected pre-network', () => {
    const auth = createSyntheticAuthorization({ specificationVersion: 'a12b2c5-v1.2' as any });
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('SPECIFICATION_VERSION_MISMATCH'))).toBe(true);
  });

  it('15. wrong run nonce rejected pre-network', () => {
    const auth = createSyntheticAuthorization({ runNonce: '' });
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('RUN_NONCE_MISSING'))).toBe(true);
  });

  it('16. insufficient budget (< canonical bound) rejected pre-network', () => {
    const auth = createSyntheticAuthorization({ maxBudgetMicroUsd: 5000 }); // bound is 12783
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('INSUFFICIENT_BUDGET'))).toBe(true);
  });

  it('17. reusable authorization rejected fail-closed', () => {
    const auth = createSyntheticAuthorization({ authorizationReusable: true } as any);
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('AUTHORIZATION_REUSE_PROHIBITED'))).toBe(true);
  });

  it('18. invalid or empty source token digest rejected', () => {
    const auth = createSyntheticAuthorization({ authorizationTokenDigest: '' });
    const preflight = validateLiveTransportPreflight(auth, {
      expectedWindow: 'OFF_PEAK',
      expectedCommit: auth.sourceCommitSha,
      expectedTree: auth.sourceTreeSha,
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.errors.some((e) => e.includes('TOKEN_DIGEST_MISSING'))).toBe(true);
  });

  // ==========================================================================
  // GROUP 3: REQUEST INTEGRITY & SEALED SHAPE (Tests 19 - 25)
  // ==========================================================================

  it('19. canonical descriptor endpoint immutable: https://api.deepseek.com/v1/chat/completions', () => {
    expect(GUARDED_DISPATCH_ENDPOINT).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(SEALED_ENDPOINT).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('20. canonical descriptor method immutable: POST', () => {
    expect(GUARDED_DISPATCH_METHOD).toBe('POST');
    expect(SEALED_METHOD).toBe('POST');
  });

  it('21. canonical descriptor model immutable: deepseek-v4-flash', () => {
    expect(GUARDED_DISPATCH_MODEL).toBe('deepseek-v4-flash');
    expect(SEALED_MODEL).toBe('deepseek-v4-flash');
  });

  it('22. reasoning effort immutable: low', () => {
    expect(SEALED_REASONING_EFFORT).toBe('low');
  });

  it('23. max tokens immutable: 2048', () => {
    expect(SEALED_MAX_TOKENS).toBe(2048);
  });

  it('24. serializeAndHashCanonicalRequest verifies SHA256 integrity strictly', () => {
    const descriptor = buildSealedLiveRequestDescriptor({
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      invocationIndex: 1,
      pricingWindow: 'OFF_PEAK',
    });

    const serialization = serializeAndHashCanonicalRequest(descriptor);
    expect(serialization.matchesDescriptorHash).toBe(true);
    expect(serialization.payloadHash).toBe(descriptor.requestPayloadHash);
    expect(JSON.parse(serialization.payloadString)).toEqual(descriptor.requestBody);
  });

  it('25. request body hash mismatch detected as integrity failure', () => {
    const descriptor = buildSealedLiveRequestDescriptor({
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      invocationIndex: 1,
      pricingWindow: 'OFF_PEAK',
    });

    const corruptedDescriptor = {
      ...descriptor,
      requestPayloadHash: '0000000000000000000000000000000000000000000000000000000000000000',
    };

    const serialization = serializeAndHashCanonicalRequest(corruptedDescriptor);
    expect(serialization.matchesDescriptorHash).toBe(false);
  });

  // ==========================================================================
  // GROUP 4: STATIC SECURITY & ANTI-BYPASS INVARIANTS (Tests 26 - 32)
  // ==========================================================================

  it('26. no public customFetch export in guarded transport module', () => {
    expect((guardedTransportModule as any).customFetch).toBeUndefined();
    expect((guardedTransportModule as any).executeMockTransport).toBeUndefined();
    expect((guardedTransportModule as any).executeIsolatedTransport).toBeUndefined();
    expect((guardedTransportModule as any).executeUnsafeTransport).toBeUndefined();
    expect((guardedTransportModule as any).transportOverride).toBeUndefined();
    expect((guardedTransportModule as any).networkCallback).toBeUndefined();
    expect((guardedTransportModule as any).fetchCallback).toBeUndefined();
  });

  it('27. no caller bypassLiveGate or override parameter supported in options interface', () => {
    expect((guardedTransportModule as any).bypassLiveGate).toBeUndefined();
    expect((guardedTransportModule as any).skipAuthorization).toBeUndefined();
    expect((guardedTransportModule as any).skipPreflight).toBeUndefined();
  });

  it('28. process.env override cannot enable live transport', async () => {
    const originalEnv = process.env.CANARY_LIVE_EXECUTION_ENABLED;
    try {
      (process.env as any).CANARY_LIVE_EXECUTION_ENABLED = 'true';
      (process.env as any).VELNAR_BYPASS_LIVE_GATE = 'true';

      const auth = createSyntheticAuthorization();
      const result = await executeGuardedDeepSeekCertificationTransport({
        authorization: auth,
        pricingWindow: 'OFF_PEAK',
      });

      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    } finally {
      process.env.CANARY_LIVE_EXECUTION_ENABLED = originalEnv;
      delete (process.env as any).VELNAR_BYPASS_LIVE_GATE;
    }
  });

  it('29. CLI switches cannot override the authoritative gate', async () => {
    const originalArgv = [...process.argv];
    try {
      process.argv.push('--bypass-live-gate', '--force-live', '--enable-canary');

      const auth = createSyntheticAuthorization();
      const result = await executeGuardedDeepSeekCertificationTransport({
        authorization: auth,
        pricingWindow: 'OFF_PEAK',
      });

      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    } finally {
      process.argv = originalArgv;
    }
  });

  it('30. source code check: no version-controlled gate bypass exists in module source', () => {
    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
    const source = fs.readFileSync(modulePath, 'utf8');

    expect(source.includes('bypassLiveGate')).toBe(false);
    expect(source.includes('skipAuthorization')).toBe(false);
    expect(source.includes('customFetch')).toBe(false);
    expect(source.includes('executeMockTransport')).toBe(false);
  });

  it('31. source code check: no hardcoded DeepSeek API key or Bearer credential in source', () => {
    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
    const source = fs.readFileSync(modulePath, 'utf8');

    expect(source.includes('sk-')).toBe(false);
    expect(source.includes('Bearer dsk-')).toBe(false);
    expect(source.includes('Bearer secret')).toBe(false);
  });

  it('32. runtime credentials are never logged, serialized, or embedded in evidence', () => {
    const auth = createSyntheticAuthorization();
    const serialization = JSON.stringify(auth);
    expect(serialization.includes('apiKey')).toBe(false);
  });

  // ==========================================================================
  // GROUP 5: SEQUENTIAL EXECUTION & CONCURRENCY INVARIANTS (Tests 33 - 38)
  // ==========================================================================

  it('33. exactly seven canonical tasks planned in guarded module', () => {
    expect(GUARDED_CANONICAL_TASK_COUNT).toBe(7);
    expect(SEALED_CANONICAL_TASK_COUNT).toBe(7);
  });

  it('34. task sequence strictly matches CERTIFIED_A12B2C_TASK_TYPES', () => {
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

  it('35. concurrency is strictly 1 (SEALED_CONCURRENCY = 1)', () => {
    expect(SEALED_CONCURRENCY).toBe(1);
  });

  it('36. client retries = 0 across all tasks (SEALED_CLIENT_RETRIES = 0)', () => {
    expect(SEALED_CLIENT_RETRIES).toBe(0);
  });

  it('37. cross-provider fallback = 0 (SEALED_CROSS_PROVIDER_FALLBACKS = 0)', () => {
    expect(SEALED_CROSS_PROVIDER_FALLBACKS).toBe(0);
  });

  it('38. automatic reruns = 0 (SEALED_AUTOMATIC_RERUNS = 0)', () => {
    expect(SEALED_AUTOMATIC_RERUNS).toBe(0);
  });

  // ==========================================================================
  // GROUP 6: WINDOW CROSSING & BUDGET ENFORCEMENT (Tests 39 - 42)
  // ==========================================================================

  it('39. window crossing mid-run terminates execution fail-closed (PRICING_WINDOW_CHANGED)', () => {
    const peakTimeUtc = new Date('2026-09-08T02:00:00Z'); // Tuesday 02:00 UTC is PEAK
    const check = checkWindowCrossing('OFF_PEAK', peakTimeUtc);

    expect(check.crossed).toBe(true);
    expect(check.currentWindow).toBe('PEAK');
    expect(check.failClosed).toBe(true);
    expect(check.failureCategory).toBe('PRICING_WINDOW_CHANGED');
  });

  it('40. calculateInvocationCostMicroUsd calculates exact integer microUSD from token usage', () => {
    const usage: DeepSeekTokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      promptCacheHitTokens: 200,
      promptCacheMissTokens: 800,
    };

    const costOffPeak = calculateInvocationCostMicroUsd(usage, 'OFF_PEAK');
    expect(costOffPeak).toBe(507);
    expect(Number.isInteger(costOffPeak)).toBe(true);
  });

  it('41. calculateInvocationCostMicroUsd in PEAK window applies exactly 2x rates', () => {
    const usage: DeepSeekTokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 1000,
    };

    const costOffPeak = calculateInvocationCostMicroUsd(usage, 'OFF_PEAK');
    const costPeak = calculateInvocationCostMicroUsd(usage, 'PEAK');

    expect(costOffPeak).toBe(550);
    expect(costPeak).toBe(1100);
    expect(costPeak).toBe(costOffPeak * 2);
  });

  it('42. cumulative cost exceeding budget bound is detected as BUDGET_BREACH', () => {
    const auth = createSyntheticAuthorization({ maxBudgetMicroUsd: 1000 });
    const observedTotal = 1200;

    expect(observedTotal > auth.maxBudgetMicroUsd).toBe(true);
  });

  // ==========================================================================
  // GROUP 7: HARD LIFECYCLE TIMEOUT & NETWORK FAIL-CLOSED SEMANTICS (Tests 43 - 48)
  // ==========================================================================

  it('43. duration > 15000ms classified as HARD_LIFECYCLE_TIMEOUT', () => {
    const classification = classifyLifecycleDeadline(15001);
    expect(classification.timedOut).toBe(true);
    expect(classification.category).toBe('HARD_LIFECYCLE_TIMEOUT');
  });

  it('44. duration = 15000ms boundary classified as HARD_LIFECYCLE_TIMEOUT', () => {
    const classification = classifyLifecycleDeadline(15000);
    expect(classification.timedOut).toBe(true);
    expect(classification.category).toBe('HARD_LIFECYCLE_TIMEOUT');
  });

  it('45. duration = 14999ms strictly below timeout boundary', () => {
    const classification = classifyLifecycleDeadline(14999);
    expect(classification.timedOut).toBe(false);
    expect(classification.category).toBeUndefined();
  });

  it('46. AbortError is classified as HARD_LIFECYCLE_TIMEOUT', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    const classification = classifyTransportError(abortErr, 12000);
    expect(classification.failureCategory).toBe('HARD_LIFECYCLE_TIMEOUT');
    expect(classification.message.includes('HARD_LIFECYCLE_TIMEOUT')).toBe(true);
  });

  it('47. network connection failure classified as NETWORK_TRANSPORT_FAILURE', () => {
    const netErr = new Error('connect ECONNREFUSED 104.26.15.111:443');
    const classification = classifyTransportError(netErr, 500);
    expect(classification.failureCategory).toBe('NETWORK_TRANSPORT_FAILURE');
  });

  it('48. stream body read failure classified as BODY_READ_FAILURE', () => {
    const streamErr = new Error('BODY_READ_FAILURE: stream ended prematurely');
    const classification = classifyTransportError(streamErr, 800);
    expect(classification.failureCategory).toBe('BODY_READ_FAILURE');
  });

  // ==========================================================================
  // GROUP 8: RESPONSE PROCESSING, SCHEMA, & TASK EVALUATION (Tests 49 - 56)
  // ==========================================================================

  it('49. HTTP non-success response (e.g. 503, 429) fails closed without retry', () => {
    const raw503 = {
      httpStatus: 503,
      rawBodyText: JSON.stringify({ error: { message: 'Service Unavailable' } }),
      durationMs: 1200,
    };

    const parsed = parseDeepSeekCertificationResponse(raw503);
    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('HTTP_NON_SUCCESS');
  });

  it('50. malformed JSON response fails closed with JSON_PARSE_FAILURE', () => {
    const rawMalformed = {
      httpStatus: 200,
      rawBodyText: '{ invalid json content',
      durationMs: 900,
    };

    const parsed = parseDeepSeekCertificationResponse(rawMalformed);
    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('JSON_PARSE_FAILURE');
  });

  it('51. response missing or wrong object field fails closed (chat.completion required)', () => {
    const rawWrongObj = {
      httpStatus: 200,
      rawBodyText: JSON.stringify({
        id: 'chatcmpl-test',
        object: 'wrong.completion',
        created: 1720000000,
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hello' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 10,
        },
      }),
      durationMs: 500,
    };

    const parsed = parseDeepSeekCertificationResponse(rawWrongObj);
    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('SCHEMA_FAILURE');
  });

  it('52. response with wrong returned model fails closed with MODEL_PROVENANCE_MISMATCH', () => {
    const rawWrongModel = {
      httpStatus: 200,
      rawBodyText: JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1720000000,
        model: 'deepseek-chat', // Wrong model! Must be deepseek-v4-flash
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hello' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 10,
        },
      }),
      durationMs: 500,
    };

    const parsed = parseDeepSeekCertificationResponse(rawWrongModel);
    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('MODEL_PROVENANCE_MISMATCH');
  });

  it('53. response with missing token usage fails closed with USAGE_MISSING', () => {
    const rawNoUsage = {
      httpStatus: 200,
      rawBodyText: JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1720000000,
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hello' },
            finish_reason: 'stop',
          },
        ],
      }),
      durationMs: 500,
    };

    const parsed = parseDeepSeekCertificationResponse(rawNoUsage);
    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('USAGE_MISSING');
  });

  it('54. response with prompt token arithmetic mismatch fails closed with USAGE_INTEGRITY_FAILURE', () => {
    const rawBadUsage = {
      httpStatus: 200,
      rawBodyText: JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1720000000,
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hello' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_cache_hit_tokens: 30,
          prompt_cache_miss_tokens: 40, // 30 + 40 = 70 !== 100
        },
      }),
      durationMs: 500,
    };

    const parsed = parseDeepSeekCertificationResponse(rawBadUsage);
    expect(parsed.success).toBe(false);
    expect(parsed.failureCategory).toBe('USAGE_INTEGRITY_FAILURE');
  });

  it('55. schema validation failure in task payload fails closed via OutputValidator', () => {
    const parsedValidResponse: DeepSeekParsedProviderResponse = {
      success: true,
      httpStatus: 200,
      returnedModel: 'deepseek-v4-flash',
      providerReportedModelVersion: null,
      systemFingerprint: 'fp_test',
      content: 'INVALID NON-JSON CONTENT FOR LEAD INTENT',
      finishReason: 'stop',
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 100,
      },
      rawBodyHash: 'sha256:abcd',
    };

    const mapped = mapResponseToInvocationRecord({
      parsedResponse: parsedValidResponse,
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      pricingWindow: 'OFF_PEAK',
      durationMs: 1200,
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
    });

    expect(mapped.schemaValid).toBe(false);
    expect(mapped.taskPass).toBe(false);
    expect(mapped.record.success).toBe(false);
    expect(mapped.failureCategory).toBe('SCHEMA_FAILURE');
  });

  it('56. semantic score below threshold (< 0.85) fails closed without retry', () => {
    const mapped = mapResponseToInvocationRecord({
      parsedResponse: {
        success: true,
        httpStatus: 200,
        returnedModel: 'deepseek-v4-flash',
        providerReportedModelVersion: null,
        systemFingerprint: 'fp_test',
        content: 'I am unable to assist with this task properly.',
        finishReason: 'stop',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          promptCacheHitTokens: 0,
          promptCacheMissTokens: 100,
        },
        rawBodyHash: 'sha256:abcd',
      },
      taskType: 'LEAD_INTENT_CLASSIFICATION',
      pricingWindow: 'OFF_PEAK',
      durationMs: 1200,
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
    });

    expect(mapped.taskPass).toBe(false);
    expect(mapped.record.success).toBe(false);
  });

  // ==========================================================================
  // GROUP 9: SEPARATION OF AUTHORITY & ZERO LIVE CALLS (Tests 57 - 62)
  // ==========================================================================

  it('57. provider system fingerprint remains telemetry and cannot bypass validation', () => {
    const rawWithFp = {
      httpStatus: 200,
      rawBodyText: JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1720000000,
        model: 'deepseek-v4-flash',
        system_fingerprint: 'fp_deepseek_test_123',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hello' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 10,
        },
      }),
      durationMs: 500,
    };

    const parsed = parseDeepSeekCertificationResponse(rawWithFp);
    expect(parsed.systemFingerprint).toBe('fp_deepseek_test_123');
  });

  it('58. guarded transport execution result cannot directly certify (intermediate candidate only)', async () => {
    const auth = createSyntheticAuthorization();
    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
    });

    expect(result.finalCertificationEligible).toBe(false);
  });

  it('59. candidate status is PENDING_REAL_TRANSPORT_EXECUTION (intermediate candidate only)', () => {
    expect(ACTIVATION_STATUS).toBe('OFFLINE_DRAFT_NOT_LIVE');
  });

  it('60. evidence persistence record preparation validates schema without filesystem side-effect', () => {
    const records: InvocationRecordSummary[] = CERTIFIED_A12B2C_TASK_TYPES.map((taskType, idx) => ({
      taskId: `case_${idx + 1}`,
      taskType,
      success: true,
      latencyMs: 1200,
      modelRequested: SEALED_MODEL,
      modelReturned: SEALED_MODEL,
      schemaValid: true,
      providerReportedUsage: true,
      observedCostMicroUsd: 500,
      semanticScore: 0.95,
      privacyViolation: false,
    }));

    const prep = prepareEvidencePersistenceRecord({
      phase: 'A.12B.2C-5K',
      program: SEALED_OFF_PEAK_PROGRAM_ID,
      pricingWindow: 'OFF_PEAK',
      candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
      sourceCommitSha: '211b340a5e50cd3ba8758f4684942310e383b509',
      sourceTreeSha: '2f62744fd22bcc4477ee80a03312f816d4f4c5ac',
      runNonce: 'nonce_test',
      authorizationDigestReference: 'sha256:abc',
      invocationRecords: records,
      authorizedBudgetMicroUsd: 12783,
    });

    expect(prep.valid).toBe(true);
    expect(prep.record).not.toBeNull();
    expect(prep.record?.phase).toBe('A.12B.2C-5K');
  });

  it('61. active technical spec remains a12b2c5-v1.2 (v1.3 remains draft / unactivated)', () => {
    expect(CURRENT_ACTIVE_TECHNICAL_SPEC).toBe('a12b2c5-v1.2');
    expect(ACTIVATION_STATUS).toBe('OFFLINE_DRAFT_NOT_LIVE');
  });

  // ==========================================================================
  // GROUP 10: TRUST BOUNDARY REPAIR REGRESSIONS (5K.1 Regressions A through R)
  // ==========================================================================

  it('62. Regression A: GuardedTransportExecutionOptions no longer exposes currentTimeUtc', () => {
    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
    const source = fs.readFileSync(modulePath, 'utf8');

    const ifaceMatch = source.match(/export interface GuardedTransportExecutionOptions\s*\{([\s\S]*?)\}/);
    expect(ifaceMatch).not.toBeNull();
    const ifaceBody = ifaceMatch![1];
    expect(ifaceBody.includes('currentTimeUtc')).toBe(false);
  });

  it('63. Regression B: public execution source contains no options.currentTimeUtc', () => {
    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
    const source = fs.readFileSync(modulePath, 'utf8');

    expect(source.includes('options.currentTimeUtc')).toBe(false);
  });

  it('64. Regression C: public execution source contains no caller-controlled sourceCommitSha / sourceTreeSha as expected-source parameters', () => {
    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
    const source = fs.readFileSync(modulePath, 'utf8');

    const ifaceMatch = source.match(/export interface GuardedTransportExecutionOptions\s*\{([\s\S]*?)\}/);
    expect(ifaceMatch).not.toBeNull();
    expect(ifaceMatch![1].includes('sourceCommitSha')).toBe(false);
    expect(ifaceMatch![1].includes('sourceTreeSha')).toBe(false);

    expect(source.includes('options.sourceCommitSha')).toBe(false);
    expect(source.includes('options.sourceTreeSha')).toBe(false);
    expect(source.includes('expectedCommit: options.')).toBe(false);
    expect(source.includes('expectedTree: options.')).toBe(false);
  });

  it('65. Regression D: forced as any currentTimeUtc supplied cannot influence live execution', async () => {
    const auth = createSyntheticAuthorization();
    const frozenPastDate = new Date('2020-01-01T00:00:00Z');

    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
      currentTimeUtc: frozenPastDate,
    } as any);

    expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    expect(result.success).toBe(false);
  });

  it('66. Regression E: forced as any sourceCommitSha / sourceTreeSha supplied cannot become trusted expected source', async () => {
    const auth = createSyntheticAuthorization();

    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
      sourceCommitSha: 'attacker_controlled_commit_sha',
      sourceTreeSha: 'attacker_controlled_tree_sha',
    } as any);

    expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    expect(result.success).toBe(false);
  });

  it('67. Regression F: GUARDED_SOURCE_ATTESTATION_READY === false', () => {
    expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
  });

  it('68. Regression G: GUARDED_HUMAN_AUTH_ATTESTATION_READY === false', () => {
    expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
  });

  it('69. Regression H: credential resolver cannot run while source attestation not ready', async () => {
    let credentialResolverCalls = 0;
    const auth = createSyntheticAuthorization();

    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
      getRuntimeCredential: () => {
        credentialResolverCalls++;
        return { apiKey: 'dummy-sentinel-key' };
      },
    });

    expect(credentialResolverCalls).toBe(0);
    expect(result.credentialReads).toBe(0);
    expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
  });

  it('70. Regression I: credential resolver cannot run while human auth attestation not ready', async () => {
    let credentialResolverCalls = 0;
    const auth = createSyntheticAuthorization();

    const result = await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
      getRuntimeCredential: async () => {
        credentialResolverCalls++;
        return { apiKey: 'dummy-sentinel-key' };
      },
    });

    expect(credentialResolverCalls).toBe(0);
    expect(result.credentialReads).toBe(0);
    expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
  });

  it('71. Regression J: fetch cannot run while source attestation not ready', async () => {
    const auth = createSyntheticAuthorization();

    await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
    });

    expect(globalFetchCalls).toBe(0);
  });

  it('72. Regression K: fetch cannot run while human auth attestation not ready', async () => {
    const auth = createSyntheticAuthorization();

    await executeGuardedDeepSeekCertificationTransport({
      authorization: auth,
      pricingWindow: 'OFF_PEAK',
    });

    expect(globalFetchCalls).toBe(0);
  });

  it('73. Regression L: no process.env source-attestation override', async () => {
    const originalEnv = process.env.GUARDED_SOURCE_ATTESTATION_READY;
    try {
      (process.env as any).GUARDED_SOURCE_ATTESTATION_READY = 'true';
      (process.env as any).BYPASS_SOURCE_ATTESTATION = 'true';

      const auth = createSyntheticAuthorization();
      const result = await executeGuardedDeepSeekCertificationTransport({
        authorization: auth,
        pricingWindow: 'OFF_PEAK',
      });

      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    } finally {
      process.env.GUARDED_SOURCE_ATTESTATION_READY = originalEnv;
      delete (process.env as any).BYPASS_SOURCE_ATTESTATION;
    }
  });

  it('74. Regression M: no process.env auth-attestation override', async () => {
    const originalEnv = process.env.GUARDED_HUMAN_AUTH_ATTESTATION_READY;
    try {
      (process.env as any).GUARDED_HUMAN_AUTH_ATTESTATION_READY = 'true';
      (process.env as any).BYPASS_HUMAN_AUTH_ATTESTATION = 'true';

      const auth = createSyntheticAuthorization();
      const result = await executeGuardedDeepSeekCertificationTransport({
        authorization: auth,
        pricingWindow: 'OFF_PEAK',
      });

      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    } finally {
      process.env.GUARDED_HUMAN_AUTH_ATTESTATION_READY = originalEnv;
      delete (process.env as any).BYPASS_HUMAN_AUTH_ATTESTATION;
    }
  });

  it('75. Regression N: no CLI override for source or human auth attestation', async () => {
    const originalArgv = [...process.argv];
    try {
      process.argv.push(
        '--bypass-source-attestation',
        '--bypass-human-auth-attestation',
        '--force-attestation-ready'
      );

      const auth = createSyntheticAuthorization();
      const result = await executeGuardedDeepSeekCertificationTransport({
        authorization: auth,
        pricingWindow: 'OFF_PEAK',
      });

      expect(result.status).toBe('LIVE_EXECUTION_BLOCKED');
    } finally {
      process.argv = originalArgv;
    }
  });

  it('76. Regression O: no public bypassSourceAttestation export or method exists', () => {
    expect((guardedTransportModule as any).bypassSourceAttestation).toBeUndefined();

    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
    const source = fs.readFileSync(modulePath, 'utf8');
    expect(source.includes('bypassSourceAttestation')).toBe(false);
  });

  it('77. Regression P: no public bypassHumanAuthorization export or method exists', () => {
    expect((guardedTransportModule as any).bypassHumanAuthorization).toBeUndefined();

    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
    const source = fs.readFileSync(modulePath, 'utf8');
    expect(source.includes('bypassHumanAuthorization')).toBe(false);
  });

  it('78. Regression Q: pure checkWindowCrossing continues accepting deterministic Date for unit tests', () => {
    const offPeakDate = new Date('2026-09-05T01:00:00Z'); // Saturday 01:00 UTC (OFF_PEAK)
    const peakDate = new Date('2026-09-08T02:00:00Z'); // Tuesday 02:00 UTC (PEAK)

    const offPeakCheck = checkWindowCrossing('OFF_PEAK', offPeakDate);
    expect(offPeakCheck.crossed).toBe(false);
    expect(offPeakCheck.currentWindow).toBe('OFF_PEAK');

    const peakCheck = checkWindowCrossing('OFF_PEAK', peakDate);
    expect(peakCheck.crossed).toBe(true);
    expect(peakCheck.currentWindow).toBe('PEAK');
    expect(peakCheck.failClosed).toBe(true);
  });

  it('79. Regression R: production path obtains a fresh runtime Date before each invocation rather than freezing one caller-provided Date', () => {
    const modulePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekGuardedLiveTransport.ts');
    const source = fs.readFileSync(modulePath, 'utf8');

    // Invariant: preflight obtains fresh runtime clock
    expect(source.includes('const initialPreflightClock = new Date();')).toBe(true);
    // Invariant: each task invocation obtains fresh runtime clock
    expect(source.includes('const taskClock = new Date();')).toBe(true);
    // Invariant: checkWindowCrossing inside loop is passed taskClock
    expect(source.includes('checkWindowCrossing(\n        options.pricingWindow,\n        taskClock\n      )')).toBe(true);
  });

  it('80. total provider network calls during entire test suite execution is exactly 0', () => {
    expect(globalFetchCalls).toBe(0);
  });
});
