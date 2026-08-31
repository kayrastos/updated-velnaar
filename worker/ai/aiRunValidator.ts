/**
 * @file worker/ai/aiRunValidator.ts
 * @description Canonical Strict Server-Side Validator for AIRunRecord
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. Protocol validity is mandatory before D1 write and after D1 read.
 * 2. Fail-closed: missing identity or invalid enums throw SERVER_PROTOCOL_ERROR.
 * 3. Exact enum sets, safe non-negative integers, strict RFC3339 timestamps.
 * ============================================================================
 */

import { 
  AIRunRecord, 
  AIRunStatus, 
  TaskType, 
  DataClassification 
} from './types';

export const CANONICAL_AIRUN_STATUSES: readonly AIRunStatus[] = [
  'completed',
  'failed',
  'throttled',
  'blocked_by_policy',
  'budget_exceeded',
] as const;

export const CANONICAL_TASK_TYPES: readonly TaskType[] = [
  'LEAD_INTENT_CLASSIFICATION',
  'LEAK_EXPLANATION',
  'GROWTH_ACTION_DRAFT',
  'BUSINESS_TWIN_SUMMARY',
  'FUNNEL_DIAGNOSTIC_EXPLANATION',
  'SEO_CONTENT_SUGGESTION',
  'ANOMALY_TRIAGE',
] as const;

export const CANONICAL_DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  'PUBLIC_BUSINESS',
  'PSEUDONYMOUS_OPERATIONAL',
  'PERSONAL',
  'SENSITIVE',
  'SECRET',
] as const;

export function isValidAIRunStatus(val: unknown): val is AIRunStatus {
  return typeof val === 'string' && (CANONICAL_AIRUN_STATUSES as readonly string[]).includes(val);
}

export function isValidAIRunTaskType(val: unknown): val is TaskType {
  return typeof val === 'string' && (CANONICAL_TASK_TYPES as readonly string[]).includes(val);
}

export function isValidAIRunDataClassification(val: unknown): val is DataClassification {
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

export function validateCanonicalAIRunRecord(
  raw: unknown,
  expectedOrganizationId?: string,
  expectedBusinessId?: string
): AIRunRecord {
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

  const result: AIRunRecord = {
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
