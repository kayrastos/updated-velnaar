/**
 * @file tests/ai/helpers/historicalCanaryMockTransportHarness.ts
 * @description Test-Only Mock Transport Harness for Historical Canary Transport Certification.
 * 
 * STRICT INVARIANTS:
 * - Test-only file; never imported by worker or production runtime code.
 * - Explicit injected mock transport (customFetch) ONLY.
 * - Throws immediately if customFetch is absent or undefined (no fallback to globalThis.fetch).
 * - Deterministic placeholder environment only; never reads real provider credentials.
 * - Preserves deterministic coverage for retry mechanics, redirects, provenance parsing,
 *   timeout behavior, service-tier validation, cost accounting, and evidence handling.
 * - No production export.
 */

import * as crypto from 'crypto';
import { TaskType } from '../../../worker/ai/types';
import {
  CERTIFIED_A12B2C_TASK_TYPES,
  CertifiedProviderId,
} from '../../../worker/ai/providers/certifiedProviderTypes';
import {
  CANARY_SPECIFICATION_VERSION,
  CERTIFIED_CANARY_CANDIDATES,
  CANARY_INVOCATION_LIMITS,
  CANARY_COST_LIMITS,
  CANARY_SUCCESS_CRITERIA,
  isCanaryNetworkEndpointAllowed,
  validateHumanApprovalToken,
  isValidCapabilitySecret,
  CANARY_SYNTHETIC_FIXTURES,
  computeFixtureHash,
  CanaryHumanApprovalEnvelope,
  CanaryKillSwitchEvent,
  CanaryInvocationEvidenceRecord,
  CanaryExecutionEvidencePackage,
  CanaryTransportAttemptRecord,
} from '../../../worker/ai/canary/canarySpecification';
import { EvaluationCostCalculator, LiveCandidateConfig } from '../../../worker/ai/evaluation/evaluationCostCalculator';
import { EvaluationScorer } from '../../../worker/ai/evaluation/evaluationScorer';
import { OutputValidator } from '../../../worker/ai/outputValidator';
import { PromptRegistry } from '../../../worker/ai/promptRegistry';
import { CanaryLiveRunnerOptions } from '../../../worker/ai/canary/boundedCanaryRunner';

export class HistoricalCanaryMockTransportHarness {
  /**
   * Executes the historical canary transport pipeline strictly with injected mock transport.
   * Throws if options.customFetch is missing.
   * Never falls back to globalThis.fetch.
   * Never reads real provider credentials from process.env.
   */
  public static async executeHistoricalMockTransport(
    options: CanaryLiveRunnerOptions
  ): Promise<CanaryExecutionEvidencePackage> {
    if (!options.customFetch) {
      throw new Error(
        'HistoricalCanaryMockTransportHarness requires explicit mock transport customFetch (no fallback to globalThis.fetch is permitted).'
      );
    }

    const fetchFn = options.customFetch;
    const now = options.now ?? (() => new Date());
    const abortSignal = options.abortSignal;

    // Strictly deterministic offline placeholder environment; never read real process.env provider credentials
    const env = options.env
      ? options.env
      : {
          DEEPSEEK_API_KEY: 'offline-test-deepseek-placeholder',
          GEMINI_API_KEY: 'offline-test-gemini-placeholder',
          VELNAR_CANARY_CAPABILITY_SECRET:
            options.capabilitySecret ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        };

    const killSwitchEvents: CanaryKillSwitchEvent[] = [];
    const invocations: CanaryInvocationEvidenceRecord[] = [];
    const attemptRecords: CanaryTransportAttemptRecord[] = [];

    // Redacted human approval envelope for evidence (zero secret leakage)
    const sanitizedApproval: CanaryHumanApprovalEnvelope | null = options.humanApproval
      ? {
          approvedBy: options.humanApproval.approvedBy,
          approvalTimestamp: options.humanApproval.approvalTimestamp,
          targetPhase: options.humanApproval.targetPhase,
          approvalToken: options.humanApproval.approvalToken,
          maxBudgetMicroUsd: options.humanApproval.maxBudgetMicroUsd,
          maxBudgetUsd: options.humanApproval.maxBudgetUsd,
          environmentTarget: options.humanApproval.environmentTarget,
          specificationVersion: options.humanApproval.specificationVersion,
          sourceCommitSha: options.humanApproval.sourceCommitSha,
          runNonce: options.humanApproval.runNonce,
          executionLane: options.humanApproval.executionLane ?? options.executionLane,
          capabilitySecret: undefined,
        }
      : null;

    const buildFailClosedPackage = (): CanaryExecutionEvidencePackage => ({
      phase: (options.phase as any) ?? 'A.12B.2C-5D',
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      executionMode: 'LIVE_CONTROLLED_CANARY',
      timestamp: now().toISOString(),
      humanApproval: sanitizedApproval,
      overallStatus: 'CANARY_KILL_SWITCH_TERMINATED',
      logicalCaseCount: 0,
      transportAttemptCount: 0,
      completedRequiredMatrixCases: 0,
      summaryCounts: {
        totalPlannedInvocations: 14,
        executedInvocations: 0,
        passedInvocations: 0,
        failedInvocations: 0,
        killSwitchEventsCount: killSwitchEvents.length,
        totalObservedCostMicroUsd: 0,
        totalEstimatedCostMicroUsd: 0,
        totalPreflightWorstCaseCostMicroUsd: 0,
        aggregateSemanticScore: 0,
      },
      attemptRecords: [],
      invocations: [],
      killSwitchEvents,
      productionRoutingEnforcementAllowed: false,
    });

    // Gate 1: Phase check
    if (!options.phase || (options.phase !== 'A.12B.2C-5B' && (options.phase as string) !== 'A.12B.2C-5D')) {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'UNAUTHORIZED_ENVIRONMENT',
        message: `Live canary execution requires explicit phase ('A.12B.2C-5B' or 'A.12B.2C-5D'), received '${options.phase || 'none'}'. Zero calls permitted.`,
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }

    // Gate 2: Validate 256-bit Entropy Capability Secret
    const secret = options.capabilitySecret || options.humanApproval?.capabilitySecret || env.VELNAR_CANARY_CAPABILITY_SECRET;
    if (!isValidCapabilitySecret(secret)) {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'HUMAN_APPROVAL_INVALID',
        message: 'Capability secret is invalid or missing: must be exactly 64 hexadecimal characters representing 256 bits of entropy (fail-closed).',
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }

    // Gate 3: Validate Human Approval Token
    const approvalValidation = validateHumanApprovalToken(options.humanApproval, {
      capabilitySecret: secret,
      require64HexSecret: true,
      now,
      allowSimulatedExpiryForTest: false,
    });

    if (!approvalValidation.valid) {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'HUMAN_APPROVAL_INVALID',
        message: `Human approval token rejected: ${approvalValidation.reason}`,
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }

    // Gate 4: Source Commit SHA & Clean Working Tree Verification
    let sourceCommitMatch = false;
    let workingTreeClean = false;

    if (options.sourceRevisionResolver) {
      try {
        const rev = options.sourceRevisionResolver();
        sourceCommitMatch = Boolean(
          rev?.commitSha &&
          rev.commitSha.trim().toLowerCase() === options.humanApproval!.sourceCommitSha.trim().toLowerCase()
        );
        workingTreeClean = Boolean(rev?.isClean);
      } catch (err: any) {
        killSwitchEvents.push({
          timestamp: now().toISOString(),
          reason: 'HUMAN_APPROVAL_INVALID',
          message: `Source revision resolver error: ${err.message}`,
          terminatedFailClosed: true,
        });
        return buildFailClosedPackage();
      }
    } else if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
      try {
        const { execSync } = await import('child_process');
        const headSha = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().toLowerCase();
        const statusOutput = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        sourceCommitMatch = headSha === options.humanApproval!.sourceCommitSha.trim().toLowerCase();
        workingTreeClean = statusOutput === '';
      } catch (gitErr: any) {
        killSwitchEvents.push({
          timestamp: now().toISOString(),
          reason: 'HUMAN_APPROVAL_INVALID',
          message: `Git verification failed (git command failed or repository unreadable): ${gitErr?.message || gitErr}. Fail-closed with 0 calls.`,
          terminatedFailClosed: true,
        });
        return buildFailClosedPackage();
      }
    } else {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'HUMAN_APPROVAL_INVALID',
        message: 'Git verification failed: runtime environment lacks git capability. Fail-closed with 0 calls.',
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }

    if (!sourceCommitMatch) {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'HUMAN_APPROVAL_INVALID',
        message: `Source commit SHA mismatch: approval approved '${options.humanApproval!.sourceCommitSha}', but runtime git HEAD differs.`,
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }

    if (!workingTreeClean) {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'HUMAN_APPROVAL_INVALID',
        message: 'Working tree is dirty; live execution requires a pristine, uncommitted-change-free git state.',
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }

    // Gate 5: Signal Abortion Check
    if (abortSignal?.aborted) {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'UNEXPECTED_EXCEPTION',
        message: 'Live execution aborted prior to provider calls by termination signal.',
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }

    // Gate 6: Provider Credential Preflight
    const deepSeekKey = env.DEEPSEEK_API_KEY;
    const geminiKey = env.GEMINI_API_KEY;
    if (!deepSeekKey || typeof deepSeekKey !== 'string' || deepSeekKey.trim() === '') {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'UNAUTHORIZED_ENVIRONMENT',
        message: 'DeepSeek provider credentials (DEEPSEEK_API_KEY) missing or empty in environment. Fail-closed with 0 provider calls.',
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }
    if (!geminiKey || typeof geminiKey !== 'string' || geminiKey.trim() === '') {
      killSwitchEvents.push({
        timestamp: now().toISOString(),
        reason: 'UNAUTHORIZED_ENVIRONMENT',
        message: 'Gemini provider credentials (GEMINI_API_KEY) missing or empty in environment. Fail-closed with 0 provider calls.',
        terminatedFailClosed: true,
      });
      return buildFailClosedPackage();
    }

    // Budget Ceiling Bound
    const approvedBudgetMicroUsd =
      options.humanApproval!.maxBudgetMicroUsd ??
      Math.round((options.humanApproval!.maxBudgetUsd ?? 0.05) * 1_000_000);
    const effectiveCeilingMicroUsd = Math.min(approvedBudgetMicroUsd, CANARY_COST_LIMITS.hardCeilingMicroUsd);

    let totalTransportAttempts = 0;
    const providerTransportAttempts: Record<CertifiedProviderId, number> = {
      deepseek: 0,
      gemini: 0,
    };
    let sameProviderRetriesCount = 0;
    let crossProviderFallbacksCount = 0;
    let totalObservedCostMicroUsd = 0;
    let totalEstimatedCostMicroUsd = 0;
    let totalPreflightWorstCaseCostMicroUsd = 0;
    let scoreSum = 0;

    /**
     * Hardened Outbound Transport Wrapper
     */
    const executeHardenedCall = async (params: {
      candidate: typeof CERTIFIED_CANARY_CANDIDATES[0];
      taskType: TaskType;
      attemptCount: number;
      isRetry: boolean;
      isFallback: boolean;
    }): Promise<{
      success: boolean;
      status: number;
      evidence?: CanaryInvocationEvidenceRecord;
      killSwitch?: CanaryKillSwitchEvent;
      retryable?: boolean;
    }> => {
      if (abortSignal?.aborted) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'UNEXPECTED_EXCEPTION',
          message: 'Execution aborted mid-flight by termination signal.',
          terminatedFailClosed: true,
        };
        return { success: false, status: 499, killSwitch };
      }

      const maxAllowedTotalCalls = CANARY_INVOCATION_LIMITS.maxTotalInvocations;
      const maxAllowedProviderCalls = CANARY_INVOCATION_LIMITS.maxInvocationsPerProvider;

      if (totalTransportAttempts + 1 > maxAllowedTotalCalls) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'INVOCATION_LIMIT_BREACH',
          message: `Total invocation quota ${maxAllowedTotalCalls} exceeded (attempted call #${totalTransportAttempts + 1}).`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 429, killSwitch };
      }

      if (providerTransportAttempts[params.candidate.providerId] + 1 > maxAllowedProviderCalls) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'INVOCATION_LIMIT_BREACH',
          message: `Provider invocation quota ${maxAllowedProviderCalls} exceeded for ${params.candidate.providerId}.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 429, killSwitch };
      }

      if (params.isRetry && sameProviderRetriesCount + 1 > CANARY_INVOCATION_LIMITS.maxSameProviderRetries) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'INVOCATION_LIMIT_BREACH',
          message: `Same-provider retry quota ${CANARY_INVOCATION_LIMITS.maxSameProviderRetries} exceeded.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 429, killSwitch };
      }

      if (params.isFallback && crossProviderFallbacksCount + 1 > CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'INVOCATION_LIMIT_BREACH',
          message: `Cross-provider fallback quota ${CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks} exceeded.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 429, killSwitch };
      }

      const endpointUrl =
        params.candidate.providerId === 'deepseek'
          ? 'https://api.deepseek.com/v1/chat/completions'
          : 'https://generativelanguage.googleapis.com/v1beta/interactions';

      if (!isCanaryNetworkEndpointAllowed(endpointUrl)) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'NETWORK_DESTINATION_MISMATCH',
          message: `Target endpoint '${endpointUrl}' violates certified network allowlist.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 403, killSwitch };
      }

      const currentPricingWindow =
        params.candidate.providerId === 'deepseek'
          ? EvaluationCostCalculator.getDeepSeekPricingWindow(now())
          : 'OFF_PEAK';

      if (
        params.candidate.providerId === 'deepseek' &&
        params.candidate.pricingTier === 'offpeak' &&
        currentPricingWindow === 'PEAK'
      ) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'COST_CEILING_BREACH',
          message: `DeepSeek live call blocked fail-closed prior to network issuance: current UTC time (${now().toISOString()}) falls within PEAK pricing window, violating candidate offpeak requirement.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 403, killSwitch };
      }

      const fixture = CANARY_SYNTHETIC_FIXTURES[params.taskType];
      const fixtureHash = computeFixtureHash(fixture);
      const promptDef = PromptRegistry.getPrompt(params.taskType);
      const systemPrompt = promptDef.systemPrompt;
      const userPrompt = promptDef.buildUserPrompt(fixture.requestEnvelope);

      const estimatedInputTokens = EvaluationCostCalculator.calculateConservativeInputTokenUpperBound(
        systemPrompt,
        userPrompt
      );
      const liveCandidateConfig: LiveCandidateConfig = {
        candidateId: params.candidate.candidateId as any,
        providerId: params.candidate.providerId,
        requestedModelIdentifier: params.candidate.requestedModelIdentifier,
        serviceProfile:
          params.candidate.candidateId === 'gemini-3.5-flash-lite-flex-low'
            ? 'FLEX_COST_OPTIMIZED'
            : 'OFF_PEAK_COST_OPTIMIZED',
        thinkingEffort: 'low',
        serviceTier: params.candidate.pricingTier === 'flex' ? 'flex' : 'standard',
      };
      const worstCaseInvocationCostMicroUsd = EvaluationCostCalculator.calculateWorstCaseInvocationCostMicroUsd(
        liveCandidateConfig,
        currentPricingWindow,
        estimatedInputTokens,
        2048
      );

      if (worstCaseInvocationCostMicroUsd > CANARY_COST_LIMITS.maxSingleInvocationMicroUsd) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'COST_CEILING_BREACH',
          message: `Worst-case invocation cost ${worstCaseInvocationCostMicroUsd} microUSD exceeds single call limit ${CANARY_COST_LIMITS.maxSingleInvocationMicroUsd} microUSD.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 402, killSwitch };
      }

      const remainingHumanBudgetMicroUsd = approvedBudgetMicroUsd - totalObservedCostMicroUsd;
      const remainingSystemBudgetMicroUsd = CANARY_COST_LIMITS.hardCeilingMicroUsd - totalObservedCostMicroUsd;
      const allowableRemainingBudget = Math.min(remainingHumanBudgetMicroUsd, remainingSystemBudgetMicroUsd);

      if (worstCaseInvocationCostMicroUsd > allowableRemainingBudget) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'COST_CEILING_BREACH',
          message: `Worst-case invocation cost ${worstCaseInvocationCostMicroUsd} microUSD exceeds allowable remaining budget of ${allowableRemainingBudget} microUSD (human remaining: ${remainingHumanBudgetMicroUsd}, system hard ceiling remaining: ${remainingSystemBudgetMicroUsd}).`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 402, killSwitch };
      }

      totalTransportAttempts++;
      providerTransportAttempts[params.candidate.providerId]++;
      if (params.isRetry) sameProviderRetriesCount++;
      if (params.isFallback) crossProviderFallbacksCount++;

      const apiKey = params.candidate.providerId === 'deepseek' ? deepSeekKey! : geminiKey!;

      let requestPayloadStr = '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (params.candidate.providerId === 'deepseek') {
        headers['Authorization'] = `Bearer ${apiKey}`;
        const body = {
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 2048,
          response_format: { type: 'json_object' },
          thinking: { type: 'enabled' },
          reasoning_effort: 'low',
        };
        requestPayloadStr = JSON.stringify(body);
      } else {
        headers['x-goog-api-key'] = apiKey;
        const body = {
          model: 'gemini-3.5-flash-lite',
          service_tier: 'flex',
          system_instruction: systemPrompt,
          input: userPrompt,
          generation_config: {
            thinking_level: 'low',
            max_output_tokens: 2048,
          },
          response_format: {
            type: 'text',
            mime_type: 'application/json',
          },
        };
        requestPayloadStr = JSON.stringify(body);
      }

      const requestPayloadHash = crypto.createHash('sha256').update(requestPayloadStr).digest('hex');

      const startTime = Date.now();
      const timeoutController = new AbortController();
      let timeoutTriggered = false;
      const timeoutId = setTimeout(() => {
        timeoutTriggered = true;
        timeoutController.abort();
      }, CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation);

      let response: Response | undefined;
      let rawResponseText = '';
      let latencyMs = 0;

      try {
        const combinedSignal = abortSignal
          ? AbortSignal.any([abortSignal, timeoutController.signal])
          : timeoutController.signal;

        response = await fetchFn(endpointUrl, {
          method: 'POST',
          headers,
          body: requestPayloadStr,
          redirect: 'error',
          signal: combinedSignal,
        });

        if (
          response.status === 301 ||
          response.status === 302 ||
          response.status === 307 ||
          response.status === 308 ||
          response.redirected
        ) {
          clearTimeout(timeoutId);
          latencyMs = Date.now() - startTime;
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: response.status,
            statusClass: '3xx',
            latencyMs,
            requestPayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'NETWORK_DESTINATION_MISMATCH',
            message: `Target endpoint returned redirect status ${response.status}. Prohibited fail-closed.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: response.status, killSwitch };
        }

        if (response.status === 503) {
          clearTimeout(timeoutId);
          latencyMs = Date.now() - startTime;
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 503,
            statusClass: '5xx',
            latencyMs,
            requestPayloadHash,
          });

          return {
            success: false,
            status: 503,
            retryable: true,
          };
        }

        if (!response.ok) {
          clearTimeout(timeoutId);
          latencyMs = Date.now() - startTime;
          const statusClass = response.status >= 400 && response.status < 500 ? '4xx' : '5xx';
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: response.status,
            statusClass,
            latencyMs,
            requestPayloadHash,
          });

          return {
            success: false,
            status: response.status,
            retryable: false,
          };
        }

        rawResponseText = await new Promise<string>((resolve, reject) => {
          if (timeoutTriggered || timeoutController.signal.aborted) {
            return reject(
              new Error(`Lifecycle timeout of ${CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation}ms exceeded before body read.`)
            );
          }
          const onAbort = () => {
            reject(
              new Error(`Lifecycle timeout of ${CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation}ms exceeded during body read.`)
            );
          };
          timeoutController.signal.addEventListener('abort', onAbort, { once: true });
          response!.text()
            .then((text) => {
              timeoutController.signal.removeEventListener('abort', onAbort);
              resolve(text);
            })
            .catch((err) => {
              timeoutController.signal.removeEventListener('abort', onAbort);
              reject(err);
            });
        });

        clearTimeout(timeoutId);
        latencyMs = Date.now() - startTime;

        if (
          latencyMs >= CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation ||
          timeoutTriggered ||
          timeoutController.signal.aborted
        ) {
          throw new Error(
            `Lifecycle timeout of ${CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation}ms exceeded after body read (elapsed: ${latencyMs}ms).`
          );
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        latencyMs = Date.now() - startTime;

        if (
          err?.message?.toLowerCase().includes('redirect') ||
          (err?.name === 'FetchError' && err?.message?.includes('redirect'))
        ) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 301,
            statusClass: '3xx',
            latencyMs,
            requestPayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'NETWORK_DESTINATION_MISMATCH',
            message: `Outbound request encountered prohibited HTTP redirect: ${err.message}`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 301, killSwitch };
        }

        if (abortSignal?.aborted) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 0,
            statusClass: 'TRANSPORT_ERROR',
            latencyMs,
            requestPayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'UNEXPECTED_EXCEPTION',
            message: 'Outbound request interrupted by termination signal.',
            terminatedFailClosed: true,
          };
          return { success: false, status: 499, killSwitch };
        }

        const isTimeout =
          timeoutTriggered ||
          timeoutController.signal.aborted ||
          err?.message?.includes('Lifecycle timeout') ||
          (err?.name === 'AbortError' && !abortSignal?.aborted) ||
          latencyMs >= CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation;

        if (isTimeout) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 0,
            statusClass: 'TRANSPORT_ERROR',
            latencyMs,
            requestPayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'UNEXPECTED_EXCEPTION',
            message: `Hard lifecycle timeout bound of ${CANARY_INVOCATION_LIMITS.timeoutMsPerInvocation}ms exceeded (elapsed: ${latencyMs}ms). Terminated fail-closed.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 408, killSwitch };
        }

        attemptRecords.push({
          attemptIndex: totalTransportAttempts,
          logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
          fixtureId: fixture.id,
          fixtureHash,
          providerId: params.candidate.providerId,
          candidateId: params.candidate.candidateId,
          taskType: params.taskType,
          retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
          fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
          timestamp: now().toISOString(),
          endpointUrl,
          httpStatus: 0,
          statusClass: 'TRANSPORT_ERROR',
          latencyMs,
          requestPayloadHash,
        });

        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'UNEXPECTED_EXCEPTION',
          message: `Outbound transport error or aborted body read: ${err?.message || err}. Fail-closed.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 500, killSwitch };
      }

      let responseJson: any;
      try {
        responseJson = JSON.parse(rawResponseText);
      } catch (parseErr: any) {
        attemptRecords.push({
          attemptIndex: totalTransportAttempts,
          logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
          fixtureId: fixture.id,
          fixtureHash,
          providerId: params.candidate.providerId,
          candidateId: params.candidate.candidateId,
          taskType: params.taskType,
          retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
          fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
          timestamp: now().toISOString(),
          endpointUrl,
          httpStatus: response.status,
          statusClass: '2xx',
          latencyMs,
          requestPayloadHash,
        });

        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'MALFORMED_USAGE_TELEMETRY',
          message: `Failed to parse response body JSON: ${parseErr.message}`,
          terminatedFailClosed: true,
        };
        return { success: false, status: response.status, killSwitch };
      }

      const responsePayloadHash = crypto.createHash('sha256').update(rawResponseText).digest('hex');

      let returnedModelIdentifier = '';
      if (params.candidate.providerId === 'deepseek') {
        returnedModelIdentifier = typeof responseJson.model === 'string' ? responseJson.model : '';
      } else {
        returnedModelIdentifier =
          typeof responseJson.model === 'string'
            ? responseJson.model
            : typeof responseJson.modelVersion === 'string'
            ? responseJson.modelVersion
            : '';
      }

      if (
        !returnedModelIdentifier ||
        (returnedModelIdentifier !== params.candidate.expectedReturnedModelIdentifier &&
          returnedModelIdentifier !== params.candidate.requestedModelIdentifier)
      ) {
        attemptRecords.push({
          attemptIndex: totalTransportAttempts,
          logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
          fixtureId: fixture.id,
          fixtureHash,
          providerId: params.candidate.providerId,
          candidateId: params.candidate.candidateId,
          taskType: params.taskType,
          retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
          fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
          timestamp: now().toISOString(),
          endpointUrl,
          httpStatus: 200,
          statusClass: '2xx',
          latencyMs,
          requestPayloadHash,
          responsePayloadHash,
        });

        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'MODEL_SUBSTITUTION_DETECTED',
          message: `Provider returned invalid or substituted model '${returnedModelIdentifier}', expected '${params.candidate.expectedReturnedModelIdentifier}'.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 200, killSwitch };
      }

      const documentedVersionTarget =
        params.candidate.providerId === 'deepseek'
          ? 'DeepSeek-V4-Flash-0731'
          : 'gemini-3.5-flash-lite';
      const certificationBaselineModelVersion = documentedVersionTarget;

      const providerReportedBackendFingerprint =
        params.candidate.providerId === 'deepseek'
          ? typeof responseJson.system_fingerprint === 'string'
            ? responseJson.system_fingerprint
            : null
          : null;

      let providerReportedModelVersion: string | null = null;
      if (params.candidate.providerId === 'deepseek') {
        if (typeof responseJson.modelVersion === 'string') {
          providerReportedModelVersion = responseJson.modelVersion;
        } else if (typeof responseJson.model_version === 'string') {
          providerReportedModelVersion = responseJson.model_version;
        } else {
          providerReportedModelVersion = null;
        }
      } else {
        providerReportedModelVersion =
          typeof responseJson.modelVersion === 'string'
            ? responseJson.modelVersion
            : typeof responseJson.model === 'string'
            ? responseJson.model
            : null;
      }

      if (providerReportedModelVersion !== null) {
        if (params.candidate.providerId === 'deepseek' && providerReportedModelVersion !== documentedVersionTarget) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'UNEXPECTED_MODEL_VERSION',
            message: `DeepSeek explicit runtime model version '${providerReportedModelVersion}' does not match certified baseline '${documentedVersionTarget}'.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }
      }

      let providerReportedServiceTier: string | null = null;
      if (params.candidate.providerId === 'gemini') {
        if (typeof responseJson.service_tier === 'string') {
          providerReportedServiceTier = responseJson.service_tier;
        } else {
          providerReportedServiceTier = null;
        }

        if (responseJson.service_tier !== 'flex') {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'PROVENANCE_MISMATCH',
            message: `Gemini response service_tier is invalid, absent, or does not match required certified tier 'flex' (got: ${JSON.stringify(responseJson.service_tier)}).`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }
      }

      let content = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let thinkingTokens = 0;
      let cacheHitTokens = 0;
      let cacheMissTokens = 0;
      let cacheStatus: 'VERIFIED' | 'NOT_VERIFIED' = 'NOT_VERIFIED';

      if (params.candidate.providerId === 'deepseek') {
        content = responseJson.choices?.[0]?.message?.content || '';
        if (!content || content.trim().length === 0) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `DeepSeek response choices[0].message.content is empty or missing.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        const usage = responseJson.usage;
        if (!usage || typeof usage !== 'object') {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `DeepSeek response missing usage telemetry object.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        promptTokens = usage.prompt_tokens;
        completionTokens = usage.completion_tokens;
        cacheHitTokens = usage.prompt_cache_hit_tokens;
        cacheMissTokens = usage.prompt_cache_miss_tokens;
        const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;

        if (
          typeof promptTokens !== 'number' ||
          !Number.isInteger(promptTokens) ||
          promptTokens <= 0 ||
          typeof completionTokens !== 'number' ||
          !Number.isInteger(completionTokens) ||
          completionTokens <= 0
        ) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `DeepSeek response missing or invalid token counts: prompt_tokens=${promptTokens}, completion_tokens=${completionTokens}.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        if (
          typeof cacheHitTokens !== 'number' ||
          !Number.isInteger(cacheHitTokens) ||
          cacheHitTokens < 0 ||
          typeof cacheMissTokens !== 'number' ||
          !Number.isInteger(cacheMissTokens) ||
          cacheMissTokens < 0
        ) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `DeepSeek response missing or invalid cache token telemetry: hit=${cacheHitTokens}, miss=${cacheMissTokens}.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        if (typeof reasoningTokens !== 'number' || !Number.isInteger(reasoningTokens) || reasoningTokens < 0) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'REASONING_TOKEN_INCONSISTENCY',
            message: `DeepSeek missing or invalid reasoning_tokens telemetry: ${reasoningTokens}.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        if (reasoningTokens > (params.candidate.reasoningBudgetTokens ?? 2048)) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'REASONING_TOKEN_INCONSISTENCY',
            message: `DeepSeek reasoning_tokens (${reasoningTokens}) exceeds certified reasoningBudgetTokens bound (${params.candidate.reasoningBudgetTokens ?? 2048}).`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }
        thinkingTokens = reasoningTokens;

        const isCacheIntegrityValid = EvaluationCostCalculator.validateDeepSeekTokenIntegrity(
          promptTokens,
          cacheHitTokens,
          cacheMissTokens
        );
        if (!isCacheIntegrityValid) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'CACHE_ARITHMETIC_INCONSISTENCY',
            message: `DeepSeek cache telemetry arithmetic inconsistency: prompt_tokens (${promptTokens}) !== prompt_cache_hit_tokens (${cacheHitTokens}) + prompt_cache_miss_tokens (${cacheMissTokens}).`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }
        cacheStatus = 'VERIFIED';
      } else {
        if (!Array.isArray(responseJson.steps) || responseJson.steps.length === 0) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `Gemini raw REST response missing required 'steps' array.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        const modelOutputSteps = responseJson.steps.filter((s: any) => s && s.type === 'model_output');
        if (modelOutputSteps.length === 0) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `Gemini raw REST response missing step with type 'model_output'.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        const textBlocks: string[] = [];
        for (const step of modelOutputSteps) {
          if (Array.isArray(step.content)) {
            for (const item of step.content) {
              if (item && item.type === 'text' && typeof item.text === 'string') {
                textBlocks.push(item.text);
              }
            }
          } else if (typeof step.output === 'string') {
            textBlocks.push(step.output);
          }
        }

        content = textBlocks.join('');
        if (!content || content.trim().length === 0) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `Gemini raw REST response content is empty or malformed.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        const usage = responseJson.usage;
        if (!usage || typeof usage !== 'object') {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `Gemini raw REST response missing usage telemetry object.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        promptTokens = usage.total_input_tokens;
        completionTokens = usage.total_output_tokens;
        thinkingTokens = usage.total_thought_tokens;
        const cachedTokens = usage.total_cached_tokens;

        if (
          typeof promptTokens !== 'number' ||
          !Number.isInteger(promptTokens) ||
          promptTokens <= 0 ||
          typeof completionTokens !== 'number' ||
          !Number.isInteger(completionTokens) ||
          completionTokens <= 0
        ) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'MALFORMED_USAGE_TELEMETRY',
            message: `Gemini raw REST response missing or invalid token counts: total_input_tokens=${promptTokens}, total_output_tokens=${completionTokens}.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        if (typeof thinkingTokens !== 'number' || !Number.isInteger(thinkingTokens) || thinkingTokens < 0) {
          attemptRecords.push({
            attemptIndex: totalTransportAttempts,
            logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
            fixtureId: fixture.id,
            fixtureHash,
            providerId: params.candidate.providerId,
            candidateId: params.candidate.candidateId,
            taskType: params.taskType,
            retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
            fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
            timestamp: now().toISOString(),
            endpointUrl,
            httpStatus: 200,
            statusClass: '2xx',
            latencyMs,
            requestPayloadHash,
            responsePayloadHash,
          });

          const killSwitch: CanaryKillSwitchEvent = {
            timestamp: now().toISOString(),
            reason: 'REASONING_TOKEN_INCONSISTENCY',
            message: `Gemini raw REST response missing or invalid total_thought_tokens: ${thinkingTokens}.`,
            terminatedFailClosed: true,
          };
          return { success: false, status: 200, killSwitch };
        }

        cacheHitTokens = typeof cachedTokens === 'number' && Number.isInteger(cachedTokens) && cachedTokens >= 0 ? cachedTokens : 0;
        cacheMissTokens = promptTokens - cacheHitTokens;

        const nonCachedTokens = usage.non_cached_input_tokens ?? usage.cache_miss_tokens;
        if (typeof cachedTokens === 'number' && typeof nonCachedTokens === 'number' && promptTokens === cachedTokens + nonCachedTokens) {
          cacheStatus = 'VERIFIED';
        } else {
          cacheStatus = 'NOT_VERIFIED';
        }
      }

      if (promptTokens <= 0 || completionTokens <= 0) {
        attemptRecords.push({
          attemptIndex: totalTransportAttempts,
          logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
          fixtureId: fixture.id,
          fixtureHash,
          providerId: params.candidate.providerId,
          candidateId: params.candidate.candidateId,
          taskType: params.taskType,
          retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
          fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
          timestamp: now().toISOString(),
          endpointUrl,
          httpStatus: 200,
          statusClass: '2xx',
          latencyMs,
          requestPayloadHash,
          responsePayloadHash,
        });

        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'MALFORMED_USAGE_TELEMETRY',
          message: `Provider returned empty or non-positive token telemetry: promptTokens=${promptTokens}, completionTokens=${completionTokens}.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 200, killSwitch };
      }

      let observedCostMicroUsd = 0;
      try {
        if (params.candidate.providerId === 'deepseek') {
          const costResult = EvaluationCostCalculator.calculateDeepSeekCost({
            cacheHitTokens,
            cacheMissTokens,
            completionTokens,
            pricingWindow: currentPricingWindow,
            usageSource: 'PROVIDER_REPORTED',
          });
          observedCostMicroUsd = costResult.actualCostMicroUsd;
        } else {
          const costResult = EvaluationCostCalculator.calculateGeminiCost({
            promptTokens,
            completionTokens,
            thinkingTokens,
            serviceTier: 'flex',
            usageSource: 'PROVIDER_REPORTED',
          });
          observedCostMicroUsd = costResult.actualCostMicroUsd;
        }
      } catch (costErr: any) {
        attemptRecords.push({
          attemptIndex: totalTransportAttempts,
          logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
          fixtureId: fixture.id,
          fixtureHash,
          providerId: params.candidate.providerId,
          candidateId: params.candidate.candidateId,
          taskType: params.taskType,
          retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
          fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
          timestamp: now().toISOString(),
          endpointUrl,
          httpStatus: 200,
          statusClass: '2xx',
          latencyMs,
          requestPayloadHash,
          responsePayloadHash,
        });

        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'MALFORMED_USAGE_TELEMETRY',
          message: `EvaluationCostCalculator error: ${costErr.message}`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 200, killSwitch };
      }

      if (!Number.isFinite(observedCostMicroUsd) || observedCostMicroUsd < 0) {
        attemptRecords.push({
          attemptIndex: totalTransportAttempts,
          logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
          fixtureId: fixture.id,
          fixtureHash,
          providerId: params.candidate.providerId,
          candidateId: params.candidate.candidateId,
          taskType: params.taskType,
          retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
          fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
          timestamp: now().toISOString(),
          endpointUrl,
          httpStatus: 200,
          statusClass: '2xx',
          latencyMs,
          requestPayloadHash,
          responsePayloadHash,
        });

        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'COST_CEILING_BREACH',
          message: `Calculated cost is invalid: ${observedCostMicroUsd} microUSD.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 200, killSwitch };
      }

      totalObservedCostMicroUsd += observedCostMicroUsd;
      totalEstimatedCostMicroUsd += worstCaseInvocationCostMicroUsd;
      totalPreflightWorstCaseCostMicroUsd += worstCaseInvocationCostMicroUsd;

      attemptRecords.push({
        attemptIndex: totalTransportAttempts,
        logicalCaseId: `${params.candidate.candidateId}_${params.taskType}`,
        fixtureId: fixture.id,
        fixtureHash,
        providerId: params.candidate.providerId,
        candidateId: params.candidate.candidateId,
        taskType: params.taskType,
        retryState: params.isRetry ? 'SAME_PROVIDER_503_RETRY' : 'NONE',
        fallbackState: params.isFallback ? 'DEEPSEEK_TO_GEMINI_FALLBACK' : 'NONE',
        timestamp: now().toISOString(),
        endpointUrl,
        httpStatus: 200,
        statusClass: '2xx',
        latencyMs,
        requestPayloadHash,
        responsePayloadHash,
        incurredCostMicroUsd: observedCostMicroUsd,
      });

      if (totalObservedCostMicroUsd > effectiveCeilingMicroUsd) {
        const killSwitch: CanaryKillSwitchEvent = {
          timestamp: now().toISOString(),
          reason: 'COST_CEILING_BREACH',
          message: `Cumulative observed cost ${totalObservedCostMicroUsd} microUSD exceeded ceiling ${effectiveCeilingMicroUsd}.`,
          terminatedFailClosed: true,
        };
        return { success: false, status: 200, killSwitch };
      }

      let schemaValid = false;
      try {
        OutputValidator.validateOutput(params.taskType, content, fixture.requestEnvelope);
        schemaValid = true;
      } catch {
        schemaValid = false;
      }

      let semanticScore = 0;
      let hardFailReasons: string[] = [];
      let pass = false;

      if (schemaValid) {
        try {
          const evalResult = EvaluationScorer.scoreCase(fixture, {
            candidate: {
              candidateId: params.candidate.candidateId,
              providerId: params.candidate.providerId,
              modelIdentifier: returnedModelIdentifier,
            },
            caseId: fixture.id,
            content,
            promptTokens,
            completionTokens,
            latencyMs,
            costMicroUsd: observedCostMicroUsd,
            promptVersion: 'v1.0.0',
          });
          semanticScore = Number((evalResult.weightedQualityScoreBps / 10000).toFixed(4));
          hardFailReasons = evalResult.hardFailReasons || [];
          pass =
            evalResult.passed &&
            semanticScore >= CANARY_SUCCESS_CRITERIA.minAggregateSemanticScore &&
            hardFailReasons.length === 0;
        } catch (evalErr: any) {
          pass = false;
          hardFailReasons = [evalErr?.message || 'EVALUATION_SCORER_EXCEPTION'];
        }
      } else {
        pass = false;
        hardFailReasons = ['SCHEMA_VALIDATION_FAILED'];
      }

      if (pass) {
        scoreSum += semanticScore;
      }

      const evidence: CanaryInvocationEvidenceRecord = {
        invocationIndex: totalTransportAttempts,
        timestamp: now().toISOString(),
        taskType: params.taskType,
        dataClassification: 'PUBLIC_BUSINESS',
        providerId: params.candidate.providerId,
        candidateId: params.candidate.candidateId,
        fixtureId: fixture.id,
        fixtureHash,
        requestedModelIdentifier: params.candidate.requestedModelIdentifier,
        returnedModelIdentifier,
        documentedVersionTarget,
        certificationBaselineModelVersion,
        providerReportedBackendFingerprint,
        providerReportedModelVersion,
        serviceTier: providerReportedServiceTier === 'flex' ? 'flex' : undefined,
        requestedServiceTier: params.candidate.providerId === 'gemini' ? 'flex' : undefined,
        providerReportedServiceTier: params.candidate.providerId === 'gemini' ? providerReportedServiceTier : null,
        endpointUrl,
        requestPayloadHash,
        responsePayloadHash,
        promptTokens,
        completionTokens,
        thinkingTokens,
        cacheHitTokens,
        cacheMissTokens,
        totalTokens: promptTokens + completionTokens,
        usageSource: 'PROVIDER_REPORTED',
        cacheStatus,
        pricingWindow: params.candidate.providerId === 'deepseek' ? currentPricingWindow : 'FLEX_STANDARD',
        estimatedCostMicroUsd: worstCaseInvocationCostMicroUsd,
        observedCostMicroUsd,
        latencyMs,
        attemptCount: params.attemptCount,
        fallbackTriggered: params.isFallback,
        semanticScore,
        schemaValid,
        pass,
        hardFailReasons: hardFailReasons.length > 0 ? hardFailReasons : undefined,
      };

      return {
        success: pass,
        status: 200,
        evidence,
      };
    };

    let logicalCaseCount = 0;
    let completedRequiredMatrixCases = 0;

    for (const candidate of CERTIFIED_CANARY_CANDIDATES) {
      for (const taskType of CERTIFIED_A12B2C_TASK_TYPES) {
        if (killSwitchEvents.length > 0 || abortSignal?.aborted) break;
        logicalCaseCount++;

        let callResult = await executeHardenedCall({
          candidate,
          taskType,
          attemptCount: 1,
          isRetry: false,
          isFallback: false,
        });

        if (callResult.killSwitch) {
          killSwitchEvents.push(callResult.killSwitch);
          break;
        }

        if (
          !callResult.success &&
          callResult.status === 503 &&
          callResult.retryable &&
          sameProviderRetriesCount < CANARY_INVOCATION_LIMITS.maxSameProviderRetries
        ) {
          callResult = await executeHardenedCall({
            candidate,
            taskType,
            attemptCount: 2,
            isRetry: true,
            isFallback: false,
          });

          if (callResult.killSwitch) {
            killSwitchEvents.push(callResult.killSwitch);
            break;
          }
        }

        if (
          !callResult.success &&
          candidate.providerId === 'deepseek' &&
          callResult.status === 503 &&
          crossProviderFallbacksCount < CANARY_INVOCATION_LIMITS.maxCrossProviderFallbacks
        ) {
          const geminiCandidate = CERTIFIED_CANARY_CANDIDATES.find((c) => c.providerId === 'gemini');
          if (geminiCandidate) {
            callResult = await executeHardenedCall({
              candidate: geminiCandidate,
              taskType,
              attemptCount: 1,
              isRetry: false,
              isFallback: true,
            });

            if (callResult.killSwitch) {
              killSwitchEvents.push(callResult.killSwitch);
              break;
            }
          }
        }

        if (callResult.evidence) {
          invocations.push(callResult.evidence);
          if (callResult.evidence.pass && !callResult.evidence.fallbackTriggered) {
            completedRequiredMatrixCases++;
          }
        } else {
          invocations.push({
            invocationIndex: totalTransportAttempts,
            timestamp: now().toISOString(),
            taskType,
            dataClassification: 'PUBLIC_BUSINESS',
            providerId: candidate.providerId,
            candidateId: candidate.candidateId,
            requestedModelIdentifier: candidate.requestedModelIdentifier,
            returnedModelIdentifier: candidate.expectedReturnedModelIdentifier,
            documentedVersionTarget: candidate.providerId === 'deepseek' ? 'DeepSeek-V4-Flash-0731' : 'gemini-3.5-flash-lite',
            certificationBaselineModelVersion: candidate.providerId === 'deepseek' ? 'DeepSeek-V4-Flash-0731' : 'gemini-3.5-flash-lite',
            providerReportedBackendFingerprint: null,
            providerReportedModelVersion: null,
            endpointUrl:
              candidate.providerId === 'deepseek'
                ? 'https://api.deepseek.com/v1/chat/completions'
                : 'https://generativelanguage.googleapis.com/v1beta/interactions',
            requestPayloadHash: '',
            responsePayloadHash: '',
            promptTokens: 0,
            completionTokens: 0,
            thinkingTokens: 0,
            cacheHitTokens: 0,
            cacheMissTokens: 0,
            totalTokens: 0,
            usageSource: 'PROVIDER_REPORTED',
            cacheStatus: 'NOT_VERIFIED',
            pricingWindow: candidate.pricingTier === 'offpeak' ? 'OFF_PEAK' : 'FLEX_STANDARD',
            estimatedCostMicroUsd: 0,
            observedCostMicroUsd: 0,
            latencyMs: 0,
            attemptCount: 1,
            fallbackTriggered: false,
            semanticScore: 0,
            schemaValid: false,
            pass: false,
            hardFailReasons: [`HTTP_STATUS_${callResult.status}`],
          });
        }
      }

      if (killSwitchEvents.length > 0 || abortSignal?.aborted) break;
    }

    let overallStatus: 'CANARY_EXECUTION_PASSED' | 'CANARY_EXECUTION_FAILED' | 'CANARY_KILL_SWITCH_TERMINATED';

    if (killSwitchEvents.length > 0) {
      overallStatus = 'CANARY_KILL_SWITCH_TERMINATED';
    } else if (
      completedRequiredMatrixCases === 14 &&
      totalTransportAttempts === 14 &&
      invocations.length === 14 &&
      invocations.every((i) => i.pass) &&
      sameProviderRetriesCount === 0 &&
      crossProviderFallbacksCount === 0 &&
      (invocations.length > 0 ? scoreSum / invocations.length : 0) >= 0.85 &&
      totalObservedCostMicroUsd <= effectiveCeilingMicroUsd
    ) {
      overallStatus = 'CANARY_EXECUTION_PASSED';
    } else {
      overallStatus = 'CANARY_EXECUTION_FAILED';
    }

    return {
      phase: 'A.12B.2C-5B',
      specificationVersion: CANARY_SPECIFICATION_VERSION,
      executionMode: 'LIVE_CONTROLLED_CANARY',
      timestamp: now().toISOString(),
      humanApproval: sanitizedApproval,
      overallStatus,
      logicalCaseCount,
      transportAttemptCount: totalTransportAttempts,
      completedRequiredMatrixCases,
      summaryCounts: {
        totalPlannedInvocations: 14,
        executedInvocations: totalTransportAttempts,
        passedInvocations: invocations.filter((i) => i.pass).length,
        failedInvocations: invocations.filter((i) => !i.pass).length,
        killSwitchEventsCount: killSwitchEvents.length,
        totalObservedCostMicroUsd,
        totalEstimatedCostMicroUsd,
        totalPreflightWorstCaseCostMicroUsd,
        aggregateSemanticScore: invocations.length > 0 ? Number((scoreSum / invocations.length).toFixed(4)) : 0,
      },
      attemptRecords,
      invocations,
      killSwitchEvents,
      productionRoutingEnforcementAllowed: false,
    };
  }
}
