/**
 * @file execution/run_gemini_diagnostic.ts
 * @description Dedicated runner for Gemini 429 Error Diagnostic & Single Flex Smoke Case
 */

import { WorkerEnv } from '../worker/env';
import { CANDIDATE_B_GEMINI } from '../worker/ai/evaluation/evaluationLiveRunner';
import {
  EvaluationLiveClient,
  LiveProviderInvocationResult,
  LiveProviderInvocationError,
  GeminiSanitizedErrorDiagnostic,
} from '../worker/ai/providers/liveEvaluationClient';
import { getEvaluationCaseById } from '../worker/ai/evaluation/evaluationDataset';
import { EvaluationSecurityGate } from '../worker/ai/evaluation/evaluationSecurity';
import { PromptRegistry } from '../worker/ai/promptRegistry';
import * as fs from 'fs';
import * as path from 'path';

interface GeminiDiagnosticReport {
  timestamp: string;
  stepA_modelsMetadataProbe: {
    endpoint: string;
    httpStatus: number;
    latencyMs: number;
    success: boolean;
    availableModelsCount?: number;
    containsGemini35FlashLite?: boolean;
    sampleModels?: string[];
    diagnostic?: GeminiSanitizedErrorDiagnostic;
  };
  stepB_singleFlexSmokeProbe: {
    executed: boolean;
    targetCaseId: string;
    httpStatus?: number;
    latencyMs?: number;
    success?: boolean;
    returnedModel?: string;
    returnedServiceTier?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    diagnostic?: GeminiSanitizedErrorDiagnostic;
    errorCategory?: string;
    errorMessage?: string;
  };
  rootCauseClassification: string;
  actionableRemediation: string;
}

async function runGeminiDiagnostic() {
  const logLines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logLines.push(`[${new Date().toISOString()}] ${msg}`);
  };

  log('================================================================');
  log('VELNAR PHASE A.12B.2B — GEMINI 429 ERROR DIAGNOSTIC PROVENANCE');
  log('================================================================');

  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    log('FATAL: GEMINI_API_KEY is not set in environment.');
    process.exit(1);
  }

  log('GEMINI_API_KEY presence verified. Starting non-generation metadata probe...');

  const report: GeminiDiagnosticReport = {
    timestamp: new Date().toISOString(),
    stepA_modelsMetadataProbe: {
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      httpStatus: 0,
      latencyMs: 0,
      success: false,
    },
    stepB_singleFlexSmokeProbe: {
      executed: false,
      targetCaseId: 'eval_v1_lead_01',
    },
    rootCauseClassification: 'PENDING',
    actionableRemediation: 'PENDING',
  };

  // --------------------------------------------------------------------------
  // STEP A: Lightweight Non-Generation GET /v1beta/models Probe
  // --------------------------------------------------------------------------
  const startA = Date.now();
  try {
    const resA = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
      },
    });

    const latencyA = Date.now() - startA;
    report.stepA_modelsMetadataProbe.httpStatus = resA.status;
    report.stepA_modelsMetadataProbe.latencyMs = latencyA;

    log(`Step A (GET /models) responded with HTTP ${resA.status} in ${latencyA}ms`);

    if (resA.ok) {
      report.stepA_modelsMetadataProbe.success = true;
      const json: any = await resA.json();
      const modelsList: any[] = json.models || [];
      const modelNames = modelsList.map((m: any) => m.name?.replace('models/', '') || '');
      report.stepA_modelsMetadataProbe.availableModelsCount = modelNames.length;
      report.stepA_modelsMetadataProbe.containsGemini35FlashLite = modelNames.some(
        (n: string) => n.includes('gemini-3.5-flash-lite') || n.includes('3.5-flash-lite')
      );
      report.stepA_modelsMetadataProbe.sampleModels = modelNames.slice(0, 10);
      log(`Step A: Found ${modelNames.length} available models. gemini-3.5-flash-lite present: ${report.stepA_modelsMetadataProbe.containsGemini35FlashLite}`);
    } else {
      const rawBody = await resA.text();
      const diag = EvaluationLiveClient.parseAndSanitizeGeminiErrorResponse(
        resA.status,
        resA.headers,
        rawBody,
        apiKey
      );
      report.stepA_modelsMetadataProbe.diagnostic = diag;
      log(`Step A ERROR: ${diag.classifiedCategory} (Reason: ${diag.errorReason || 'N/A'}, QuotaMetric: ${diag.quotaMetric || 'N/A'}, Limit: ${diag.quotaLimit || 'N/A'})`);
    }
  } catch (err: any) {
    const latencyA = Date.now() - startA;
    report.stepA_modelsMetadataProbe.latencyMs = latencyA;
    log(`Step A Network Exception: ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // STEP B: Single Flex Smoke Case Probe (eval_v1_lead_01)
  // --------------------------------------------------------------------------
  log('\n----------------------------------------------------------------');
  log('STEP B: Single Gemini 3.5 Flash-Lite Flex Smoke Probe (eval_v1_lead_01)');
  log('----------------------------------------------------------------');

  const evalCase = getEvaluationCaseById('eval_v1_lead_01')!;
  if (!evalCase) {
    log('FATAL: eval_v1_lead_01 not found.');
    process.exit(1);
  }

  const prep = EvaluationSecurityGate.prepareEvaluationCase(evalCase);
  if (prep.disposition !== 'ELIGIBLE') {
    log(`FATAL: eval_v1_lead_01 disposition is ${prep.disposition}`);
    process.exit(1);
  }

  report.stepB_singleFlexSmokeProbe.executed = true;
  const startB = Date.now();

  try {
    const result = await EvaluationLiveClient.invokeCandidate(
      CANDIDATE_B_GEMINI,
      prep.requestEnvelope,
      { GEMINI_API_KEY: apiKey } as WorkerEnv
    );

    const latencyB = Date.now() - startB;
    report.stepB_singleFlexSmokeProbe.httpStatus = 200;
    report.stepB_singleFlexSmokeProbe.latencyMs = latencyB;
    report.stepB_singleFlexSmokeProbe.success = true;
    report.stepB_singleFlexSmokeProbe.returnedModel = result.returnedModelIdentifier;
    report.stepB_singleFlexSmokeProbe.returnedServiceTier = result.serviceTier;
    report.stepB_singleFlexSmokeProbe.promptTokens = result.promptTokens;
    report.stepB_singleFlexSmokeProbe.completionTokens = result.completionTokens;
    report.stepB_singleFlexSmokeProbe.totalTokens = result.totalTokens;

    log(`Step B SUCCESS: Returned model "${result.returnedModelIdentifier}" on tier "${result.serviceTier}" in ${latencyB}ms`);
    report.rootCauseClassification = 'GEMINI_CAPACITY_RECOVERED_OR_OPERATIONAL';
    report.actionableRemediation = 'Gemini Flex endpoint is operational. Ready for standard controlled evaluation.';
  } catch (err: any) {
    const latencyB = Date.now() - startB;
    report.stepB_singleFlexSmokeProbe.latencyMs = latencyB;
    report.stepB_singleFlexSmokeProbe.success = false;

    if (err instanceof LiveProviderInvocationError) {
      report.stepB_singleFlexSmokeProbe.errorCategory = err.errorCategory;
      report.stepB_singleFlexSmokeProbe.errorMessage = err.message;
      report.stepB_singleFlexSmokeProbe.diagnostic = err.diagnosticDetails;

      log(`Step B FAILED with LiveProviderInvocationError:`);
      log(`  Category: ${err.errorCategory}`);
      log(`  Message: ${err.message}`);
      if (err.diagnosticDetails) {
        log(`  HTTP Status: ${err.diagnosticDetails.httpStatus}`);
        log(`  RPC Status: ${err.diagnosticDetails.rpcStatus || 'N/A'}`);
        log(`  Error Reason: ${err.diagnosticDetails.errorReason || 'N/A'}`);
        log(`  Quota Metric: ${err.diagnosticDetails.quotaMetric || 'N/A'}`);
        log(`  Quota Limit: ${err.diagnosticDetails.quotaLimit || 'N/A'}`);
        log(`  Retry Delay: ${err.diagnosticDetails.retryDelay || 'N/A'}`);
        log(`  Retry-After Header: ${err.diagnosticDetails.retryAfterHeader || 'N/A'}`);
      }

      // Determine classification & remediation
      if (err.errorCategory === 'GEMINI_QUOTA_PROVISIONING_ERROR' || err.diagnosticDetails?.quotaLimit === '0') {
        report.rootCauseClassification = 'GEMINI_QUOTA_PROVISIONING_ERROR';
        report.actionableRemediation = 'Project API quota for Gemini 3.5 Flash-Lite or Generative Language API is unprovisioned (0 QPM limit) or unpaid project quota tier is exceeded. Check Google Cloud / AI Studio project quota and billing plan.';
      } else if (err.errorCategory === 'GEMINI_FLEX_CAPACITY_UNAVAILABLE') {
        report.rootCauseClassification = 'GEMINI_FLEX_CAPACITY_UNAVAILABLE';
        report.actionableRemediation = 'Google Cloud reported transient capacity constraint on service_tier "flex" for gemini-3.5-flash-lite. Retry during off-peak window or adjust flex tier retry policy.';
      } else if (err.errorCategory === 'GEMINI_RATE_LIMITED') {
        report.rootCauseClassification = 'GEMINI_RATE_LIMITED';
        report.actionableRemediation = 'Requests exceeded short-term rate limit (QPS/QPM). Apply exponential backoff with retry headers.';
      } else {
        report.rootCauseClassification = err.errorCategory;
        report.actionableRemediation = 'Inspect provider response logs and quota console.';
      }
    } else {
      report.stepB_singleFlexSmokeProbe.errorCategory = 'UNEXPECTED_ERROR';
      report.stepB_singleFlexSmokeProbe.errorMessage = err.message;
      report.rootCauseClassification = 'UNEXPECTED_EXCEPTION';
      report.actionableRemediation = 'Inspect exception stack trace.';
      log(`Step B Unexpected Exception: ${err.message}`);
    }
  }

  log('\n================================================================');
  log(`DIAGNOSTIC CONCLUSION: ${report.rootCauseClassification}`);
  log(`ACTIONABLE REMEDIATION: ${report.actionableRemediation}`);
  log('================================================================');

  // Write diagnostic artifacts
  fs.writeFileSync(
    path.join(process.cwd(), 'execution', 'a12b2b_gemini_429_diagnostic.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(process.cwd(), 'execution', 'a12b2b_gemini_429_diagnostic.log'),
    logLines.join('\n'),
    'utf8'
  );

  log('Diagnostic artifacts written to execution/a12b2b_gemini_429_diagnostic.json and execution/a12b2b_gemini_429_diagnostic.log');
}

runGeminiDiagnostic().catch((err) => {
  console.error('Fatal diagnostic runner error:', err);
  process.exit(1);
});
