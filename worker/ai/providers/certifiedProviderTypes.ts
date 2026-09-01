/**
 * @file worker/ai/providers/certifiedProviderTypes.ts
 * @description Type definitions for Phase A.12B.2C-2B Certified Provider Adapters
 * 
 * STRICT CONSTRAINTS:
 * - Dedicated types for sealed DeepSeek and Gemini certified profiles
 * - Strict telemetry preservation (cache hit/miss, thinking tokens, exact model ID)
 * - Zero CoT/reasoning leakage in returned content
 * - Standalone dormant definitions (not yet imported by aiRouter)
 */

import { TaskType, DataClassification, AIRequestEnvelope } from '../types';

export type CertifiedProviderId = 'deepseek' | 'gemini';

export interface CertifiedPromptPayload {
  system: string;
  user: string;
}

export interface CertifiedUsageTelemetry {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  thinkingTokens: number;
  usageSource: 'PROVIDER_REPORTED';
}

export interface CertifiedProviderResponse extends CertifiedUsageTelemetry {
  providerId: CertifiedProviderId;
  candidateId: string;
  requestedModelIdentifier: string;
  returnedModelIdentifier: string;
  providerModelVersion?: string;
  serviceTier?: string;
  content: string;
  rawTextHash: string;
  latencyMs: number;
  attemptCount: number;
  isMock?: boolean;
}

export type CertifiedFailoverCategory =
  | 'HTTP_429'
  | 'HTTP_500'
  | 'HTTP_502'
  | 'HTTP_503'
  | 'HTTP_504'
  | 'NETWORK_TRANSPORT_FAILURE'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIER_UNAVAILABLE'
  | 'PRICING_PREFLIGHT_UNAVAILABLE'
  | 'MODEL_SUBSTITUTION_DETECTED'
  | 'SERVICE_TIER_MISMATCH'
  | 'TELEMETRY_INCOMPLETE'
  | 'TELEMETRY_INTEGRITY_FAILURE'
  | 'PRIVACY_VIOLATION'
  | 'CREDENTIALS_MISSING'
  | 'MAX_RETRIES_EXCEEDED';

export class CertifiedProviderError extends Error {
  public readonly providerId: CertifiedProviderId;
  public readonly candidateId: string;
  public readonly errorCategory: CertifiedFailoverCategory | string;
  public readonly httpStatus?: number;
  public readonly attemptCount: number;
  public readonly latencyMs: number;
  public readonly isTransient: boolean;
  public readonly diagnosticDetails?: Record<string, unknown>;

  constructor(params: {
    providerId: CertifiedProviderId;
    candidateId: string;
    errorCategory: CertifiedFailoverCategory | string;
    message: string;
    httpStatus?: number;
    attemptCount: number;
    latencyMs: number;
    isTransient?: boolean;
    diagnosticDetails?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'CertifiedProviderError';
    this.providerId = params.providerId;
    this.candidateId = params.candidateId;
    this.errorCategory = params.errorCategory;
    this.httpStatus = params.httpStatus;
    this.attemptCount = params.attemptCount;
    this.latencyMs = params.latencyMs;
    this.isTransient = params.isTransient ?? false;
    this.diagnosticDetails = params.diagnosticDetails;
  }
}
