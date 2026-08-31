/**
 * @file src/services/aiClient.ts
 * @description Frontend Client for Server-Side VELNAR AI Layer (/api/ai/*)
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. Zero client-side API keys or model names.
 * 2. All AI inference and prompt templates live in Cloudflare Worker.
 * 3. Uses ApiClient.getAuthenticatedHeaders for strict single Bearer token and tenant formatting.
 * 4. Reuses canonical AIRunRow, AIRunStatus, AIRunTaskType, AIRunDataClassification.
 * 5. Strict runtime validation via validateCanonicalAIRunRecord.
 * ============================================================================
 */

import { ApiClient } from './apiClient';
import { 
  AIRunRow, 
  AIRunStatus, 
  AIRunTaskType, 
  AIRunDataClassification 
} from '../types/database';
import { isValidIsoWithTimezone } from '../utils/rfc3339Validator';

export { isValidIsoWithTimezone };
export type { AIRunStatus, AIRunTaskType, AIRunDataClassification, AIRunRow };
export type AIRunItem = AIRunRow;

export type AITierStatus = 'CONFIGURED' | 'NOT_CONFIGURED' | 'DISABLED';

export interface AITierInfo {
  status: AITierStatus;
  name: string;
  description: string;
}

export interface AIStatusData {
  serviceName: 'VELNAR AI';
  privacyGateway: 'CONFIGURED' | 'NOT_CONFIGURED' | 'UNKNOWN';
  externalAiEnabled: boolean;
  tiers: {
    DETERMINISTIC_ONLY: AITierInfo;
    FAST_LOW_COST: AITierInfo;
    REASONING: AITierInfo;
    LONG_CONTEXT: AITierInfo;
    PRIVATE_LOCAL_FUTURE: AITierInfo;
  };
  policy: {
    humanApprovalRequired: boolean;
    allowPublicBusinessData: boolean;
    allowPseudonymousOperationalData: boolean;
    allowPersonalData: boolean;
    maxDailyRequests: number;
    maxMonthlyCostMicroUsd: number;
  };
}

export interface GrowthActionDraftPayload {
  title: string;
  summary: string;
  evidenceReferences: string[];
  recommendedSteps: string[];
  expectedMechanism: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresHumanApproval: true;
  hypothesis: string;
  actionType: string;
  suggestedPayload: Record<string, any>;
  revenueLeakId: string;
  estimatedImpactMinor?: number;
  isMock?: boolean;
}

export interface PolicyValidationResult {
  passed: boolean;
  violations: string[];
  riskScore: number;
  guardrailStatus: 'PASSED' | 'FAILED' | 'NOT_EVALUATED';
  evaluatedPolicies: string[];
}

const CANONICAL_STATUSES: readonly AIRunStatus[] = [
  'completed',
  'failed',
  'throttled',
  'blocked_by_policy',
  'budget_exceeded',
] as const;

const CANONICAL_TASK_TYPES: readonly AIRunTaskType[] = [
  'LEAD_INTENT_CLASSIFICATION',
  'LEAK_EXPLANATION',
  'GROWTH_ACTION_DRAFT',
  'BUSINESS_TWIN_SUMMARY',
  'FUNNEL_DIAGNOSTIC_EXPLANATION',
  'SEO_CONTENT_SUGGESTION',
  'ANOMALY_TRIAGE',
] as const;

const CANONICAL_DATA_CLASSIFICATIONS: readonly AIRunDataClassification[] = [
  'PUBLIC_BUSINESS',
  'PSEUDONYMOUS_OPERATIONAL',
  'PERSONAL',
  'SENSITIVE',
  'SECRET',
] as const;

export function isValidAIRunStatus(val: unknown): val is AIRunStatus {
  return typeof val === 'string' && (CANONICAL_STATUSES as readonly string[]).includes(val);
}

export function isValidAIRunTaskType(val: unknown): val is AIRunTaskType {
  return typeof val === 'string' && (CANONICAL_TASK_TYPES as readonly string[]).includes(val);
}

export function isValidAIRunDataClassification(val: unknown): val is AIRunDataClassification {
  return typeof val === 'string' && (CANONICAL_DATA_CLASSIFICATIONS as readonly string[]).includes(val);
}

/**
 * Strict Canonical AIRun Timestamp Validator.
 * Must match exact format YYYY-MM-DDTHH:mm:ss.sssZ (exact 4-digit year, 2-digit month,
 * 2-digit day, T, 2-digit hour, 2-digit minute, 2-digit second, exactly 3 millisecond digits, literal Z).
 * Verifies real calendar date (rejects non-leap Feb 29, impossible months/days/hours/minutes/seconds).
 */
export function isValidCanonicalAIRunTimestamp(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(val)) {
    return false;
  }
  const date = new Date(val);
  if (isNaN(date.getTime())) {
    return false;
  }
  return date.toISOString() === val;
}

/**
 * Strict Canonical AIRun Record Validator.
 * Rejects any missing fields, invalid enums, non-integers, impossible dates, non-canonical timestamps, or tenant/business mismatches.
 */
export function validateCanonicalAIRunRecord(
  raw: unknown,
  expectedOrganizationId?: string,
  expectedBusinessId?: string
): AIRunRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('SERVER_PROTOCOL_ERROR: Invalid AI run record payload, expected object.');
  }

  const r = raw as Record<string, any>;

  if (typeof r.id !== 'string' || r.id.trim().length === 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: Missing or empty id in AIRunRecord.');
  }

  if (typeof r.organization_id !== 'string' || r.organization_id.trim().length === 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: Missing or empty organization_id in AIRunRecord.');
  }
  if (expectedOrganizationId && r.organization_id !== expectedOrganizationId) {
    throw new Error('SERVER_PROTOCOL_ERROR: Organization ID mismatch in AIRunRecord.');
  }

  if (typeof r.business_id !== 'string' || r.business_id.trim().length === 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: Missing or empty business_id in AIRunRecord.');
  }
  if (expectedBusinessId && r.business_id !== expectedBusinessId) {
    throw new Error('SERVER_PROTOCOL_ERROR: Business ID mismatch in AIRunRecord.');
  }

  if (!isValidAIRunTaskType(r.task_type)) {
    throw new Error(`SERVER_PROTOCOL_ERROR: Invalid task_type "${r.task_type}" in AIRunRecord.`);
  }

  if (typeof r.gateway_provider_id !== 'string' || r.gateway_provider_id.trim().length === 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: Missing or empty gateway_provider_id in AIRunRecord.');
  }

  if (typeof r.model_identifier !== 'string' || r.model_identifier.trim().length === 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: Missing or empty model_identifier in AIRunRecord.');
  }

  if (!isValidAIRunDataClassification(r.data_classification)) {
    throw new Error(`SERVER_PROTOCOL_ERROR: Invalid data_classification "${r.data_classification}" in AIRunRecord.`);
  }

  if (typeof r.prompt_version !== 'string' || r.prompt_version.trim().length === 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: Missing or empty prompt_version in AIRunRecord.');
  }

  if (typeof r.prompt_tokens !== 'number' || !Number.isSafeInteger(r.prompt_tokens) || r.prompt_tokens < 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: prompt_tokens must be a non-negative safe integer.');
  }

  if (typeof r.completion_tokens !== 'number' || !Number.isSafeInteger(r.completion_tokens) || r.completion_tokens < 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: completion_tokens must be a non-negative safe integer.');
  }

  if (typeof r.latency_ms !== 'number' || !Number.isSafeInteger(r.latency_ms) || r.latency_ms < 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: latency_ms must be a non-negative safe integer.');
  }

  if (typeof r.estimated_cost_microusd !== 'number' || !Number.isSafeInteger(r.estimated_cost_microusd) || r.estimated_cost_microusd < 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: estimated_cost_microusd must be a non-negative safe integer.');
  }

  if (typeof r.redaction_count !== 'number' || !Number.isSafeInteger(r.redaction_count) || r.redaction_count < 0) {
    throw new Error('SERVER_PROTOCOL_ERROR: redaction_count must be a non-negative safe integer.');
  }

  if (!isValidAIRunStatus(r.status)) {
    throw new Error(`SERVER_PROTOCOL_ERROR: Invalid status "${r.status}" in AIRunRecord.`);
  }

  if (r.error_code !== undefined && r.error_code !== null) {
    if (typeof r.error_code !== 'string' || r.error_code.length > 256) {
      throw new Error('SERVER_PROTOCOL_ERROR: error_code must be null or a bounded string (<= 256 chars).');
    }
  }

  if (r.input_fingerprint !== undefined && r.input_fingerprint !== null) {
    if (typeof r.input_fingerprint !== 'string') {
      throw new Error('SERVER_PROTOCOL_ERROR: input_fingerprint must be a string or null.');
    }
  }

  if (typeof r.purpose !== 'string' || r.purpose.trim().length === 0 || r.purpose.length > 1000) {
    throw new Error('SERVER_PROTOCOL_ERROR: purpose must be a non-empty bounded string (<= 1000 chars).');
  }

  if (!isValidCanonicalAIRunTimestamp(r.created_at)) {
    throw new Error(`SERVER_PROTOCOL_ERROR: created_at must be a valid canonical AIRun ISO timestamp (YYYY-MM-DDTHH:mm:ss.sssZ). Got: ${r.created_at}`);
  }

  if (r.isMock !== undefined && typeof r.isMock !== 'boolean') {
    throw new Error('SERVER_PROTOCOL_ERROR: isMock must be a boolean if present.');
  }

  const result: AIRunRow = {
    id: r.id,
    organization_id: r.organization_id,
    business_id: r.business_id,
    task_type: r.task_type,
    gateway_provider_id: r.gateway_provider_id,
    model_identifier: r.model_identifier,
    data_classification: r.data_classification,
    prompt_version: r.prompt_version,
    prompt_tokens: r.prompt_tokens,
    completion_tokens: r.completion_tokens,
    latency_ms: r.latency_ms,
    estimated_cost_microusd: r.estimated_cost_microusd,
    redaction_count: r.redaction_count,
    status: r.status,
    error_code: r.error_code ?? null,
    input_fingerprint: r.input_fingerprint ?? null,
    purpose: r.purpose,
    created_at: r.created_at,
  };

  if (typeof r.isMock === 'boolean') {
    result.isMock = r.isMock;
  }

  return result;
}

/**
 * Shared, pure production boundary for validating server AIRunRecord returned
 * during leak scan / growth action drafting operations before state ingestion.
 */
export function validateLeakScanAIRunResponse(
  draftResult: { runRecord?: unknown } | null | undefined,
  expectedOrganizationId: string,
  expectedBusinessId: string
): AIRunRow {
  if (!draftResult || typeof draftResult !== 'object' || !draftResult.runRecord) {
    throw new Error('SERVER_PROTOCOL_ERROR: Server did not return a canonical AIRunRecord.');
  }

  return validateCanonicalAIRunRecord(draftResult.runRecord, expectedOrganizationId, expectedBusinessId);
}

export class AIClient {
  /**
   * Fetch public capability status for VELNAR AI.
   */
  public static async getStatus(orgId: string, token?: string): Promise<AIStatusData> {
    if (!orgId || orgId.trim().length === 0) {
      throw new Error('TENANT_ID_REQUIRED: Organization ID must be explicitly provided.');
    }
    const headers = ApiClient.getAuthenticatedHeaders({ customToken: token, customTenantId: orgId });
    const res = await fetch(`/api/ai/status?orgId=${encodeURIComponent(orgId)}`, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch AI status: ${res.statusText}`);
    }
    const json = (await res.json()) as { data: AIStatusData };
    return json.data;
  }

  /**
   * List tenant-scoped AI run telemetry strictly scoped to a business workspace.
   */
  public static async listRuns(orgId: string, businessId: string, token?: string): Promise<AIRunRow[]> {
    if (!orgId || orgId.trim().length === 0) {
      throw new Error('TENANT_ID_REQUIRED: Organization ID must be explicitly provided.');
    }
    if (!businessId || businessId.trim().length === 0) {
      throw new Error('BUSINESS_ID_REQUIRED: Business ID must be explicitly provided.');
    }
    const headers = ApiClient.getAuthenticatedHeaders({ customToken: token, customTenantId: orgId });
    const url = `/api/ai/runs?orgId=${encodeURIComponent(orgId)}&businessId=${encodeURIComponent(businessId.trim())}`;
    const res = await fetch(url, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch AI runs: ${res.statusText}`);
    }
    const json = (await res.json()) as { data: unknown[] };
    const rawList = json.data || [];
    return rawList.map(item => validateCanonicalAIRunRecord(item, orgId, businessId));
  }

  /**
   * Draft a Growth Action from Revenue Leak Evidence via Server-Side AI.
   */
  public static async draftActionFromLeak(
    input: {
      businessId: string;
      leakId: string;
    },
    orgId: string,
    token?: string
  ): Promise<{
    actionDraft: GrowthActionDraftPayload;
    guardrailResult: PolicyValidationResult;
    runId: string;
    runRecord?: AIRunRow;
    isMock?: boolean;
  }> {
    if (!orgId || orgId.trim().length === 0) {
      throw new Error('TENANT_ID_REQUIRED: Organization ID must be explicitly provided.');
    }
    if (!input.businessId || input.businessId.trim().length === 0) {
      throw new Error('BUSINESS_ID_REQUIRED: Business ID must be explicitly provided.');
    }
    const headers = ApiClient.getAuthenticatedHeaders({ customToken: token, customTenantId: orgId });
    const res = await fetch(`/api/ai/actions/draft?orgId=${encodeURIComponent(orgId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        businessId: input.businessId,
        leakId: input.leakId,
      }),
    });

    if (!res.ok) {
      let errorCode = 'AI_SERVICE_UNAVAILABLE';
      try {
        const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string; errorCode?: string; error_code?: string };
        const raw = err.errorCode || err.error_code || err.error || err.message;
        if (raw === 'NO_EVIDENCE_CLAIM') errorCode = 'NO_EVIDENCE_CLAIM';
        else if (raw === 'AI_BUDGET_EXCEEDED') errorCode = 'AI_BUDGET_EXCEEDED';
        else if (raw === 'ERR_PRIVACY_UNSAFE' || raw === 'ERR_ORG_AI_DISABLED') errorCode = 'AI_POLICY_BLOCKED';
        else if (raw === 'SERVER_PROTOCOL_ERROR') errorCode = 'SERVER_PROTOCOL_ERROR';
        else if (res.status === 401) errorCode = 'UNAUTHORIZED';
        else if (res.status === 403) errorCode = 'FORBIDDEN';
        else if (res.status === 404) errorCode = 'BUSINESS_NOT_FOUND';
        else if (res.status >= 500) errorCode = 'AI_SERVICE_UNAVAILABLE';
        else if (typeof raw === 'string' && /^[A-Z0-9_]+$/.test(raw)) errorCode = raw;
      } catch {
        errorCode = res.status === 403 ? 'FORBIDDEN' : res.status === 401 ? 'UNAUTHORIZED' : 'AI_SERVICE_UNAVAILABLE';
      }
      throw new Error(errorCode);
    }

    const json = (await res.json()) as {
      data: GrowthActionDraftPayload;
      guardrailResult: PolicyValidationResult;
      runId: string;
      runRecord?: unknown;
      isMock?: boolean;
    };

    let validatedRunRecord: AIRunRow | undefined;
    if (json.runRecord) {
      validatedRunRecord = validateCanonicalAIRunRecord(json.runRecord, orgId, input.businessId);
    }

    return {
      actionDraft: json.data,
      guardrailResult: json.guardrailResult,
      runId: json.runId,
      runRecord: validatedRunRecord,
      isMock: json.isMock,
    };
  }

  /**
   * Validate an action payload against server-side deterministic policy guardrails.
   */
  public static async verifyPolicy(
    payload: Record<string, any>,
    orgId: string,
    token?: string
  ): Promise<PolicyValidationResult> {
    if (!orgId || orgId.trim().length === 0) {
      throw new Error('TENANT_ID_REQUIRED: Organization ID must be explicitly provided.');
    }
    const headers = ApiClient.getAuthenticatedHeaders({ customToken: token, customTenantId: orgId });
    const res = await fetch(`/api/ai/actions/verify-policy?orgId=${encodeURIComponent(orgId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return {
        passed: false,
        violations: ['POLICY_API_UNAVAILABLE: Could not verify policy on server.'],
        riskScore: 1.0,
        guardrailStatus: 'FAILED',
        evaluatedPolicies: [],
      };
    }

    const json = (await res.json()) as { data: PolicyValidationResult };
    return json.data;
  }
}
