/**
 * @file worker/ai/sovereignBoundary.ts
 * @description VELNAR Sovereign Boundary Multi-Model Runtime Enforcement & Task Capsule Engine.
 * Phase: Prelive to Controlled Live Mission V1 (Hard Gate 2 Readiness)
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * - CUSTOMER CODE = DATA, NOT AUTHORITY.
 * - AI Model outputs are UNTRUSTED CLAIMS; zero runtime authority over IAM, D1, Worker config, or route gates.
 * - BLACK data is CATEGORICALLY PROHIBITED from ever leaving VELNAR (No exceptions through sanitization).
 * - GREY data may leave ONLY after strict minimization and sanitization as a bounded Task Capsule.
 * - GREY must NEVER contain BLACK material.
 * - Synthetic fixtures are preferred where sufficient, but GREY is not limited exclusively to synthetic fixtures.
 * - Outbound provider destinations strictly bound to certified allowlist.
 * - Default DENY on all validation paths.
 */

import { DataClassifier } from './dataClassifier';
import type { TaskType } from './types';

// ============================================================================
// 1. SOVEREIGN BOUNDARY DATA CLASSIFICATION
// ============================================================================

export type SovereignClassification = 'BLACK' | 'GREY' | 'WHITE';

export const SOVEREIGN_BOUNDARY_VERSION = 'v1.0-gate2' as const;
export const SOVEREIGN_BOUNDARY_RUNTIME_ENFORCEMENT_IMPLEMENTED = true as const;

/**
 * 10 Mandatory Categories of BLACK Sovereign Boundary Data.
 * Any occurrence immediately halts and rejects outbound dispatch.
 */
export const MANDATORY_BLACK_CATEGORIES = [
  'full Security Memory',
  'proprietary verification algorithms',
  'detection heuristics',
  'private benchmark answers',
  'customer credentials',
  'production secrets',
  'master keys',
  'critical IAM policy internals',
  'critical Safety Kernel internals',
  'critical routing/policy internals',
] as const;

export const ADDITIONAL_BLACK_CATEGORIES = [
  'Customer PII and raw identity data',
  'VELNAR master KMS keys',
] as const;

export const ALL_BLACK_CATEGORIES = [
  ...MANDATORY_BLACK_CATEGORIES,
  ...ADDITIONAL_BLACK_CATEGORIES,
] as const;

/**
 * Regex patterns identifying mandatory BLACK material.
 */
export const BLACK_MATERIAL_PATTERNS: ReadonlyArray<{ category: string; pattern: RegExp }> = [
  { category: 'production secrets', pattern: /sec_[a-zA-Z0-9_-]{16,}/i },
  { category: 'production secrets', pattern: /sk-[a-zA-Z0-9_-]{20,}/i },
  { category: 'production secrets', pattern: /dsk-[a-zA-Z0-9_-]{20,}/i },
  { category: 'production secrets', pattern: /AIzaSy[a-zA-Z0-9_-]{33}/ },
  { category: 'production secrets', pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/i },
  { category: 'production secrets', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { category: 'production secrets', pattern: /\b(?:production_secret|production\s+secret)\b/i },
  { category: 'master keys', pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  { category: 'VELNAR master KMS keys', pattern: /VELNAR_MASTER_KMS_SECRET/i },
  { category: 'master keys', pattern: /\b(?:master_key|master\s+key)\b/i },
  { category: 'customer credentials', pattern: /password\s*[:=]\s*['"][^'"]+['"]/i },
  { category: 'customer credentials', pattern: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i },
  { category: 'customer credentials', pattern: /client_secret\s*[:=]\s*['"][^'"]+['"]/i },
  { category: 'customer credentials', pattern: /\b(?:customer_credential|customer\s+credential)\b/i },
  { category: 'full Security Memory', pattern: /\b(?:full_security_memory|full\s+security\s+memory|fullSecurityMemory)\b/i },
  { category: 'proprietary verification algorithms', pattern: /\bproprietary\s*(?:_|\s*)verification\s*(?:_|\s*)algorithm/i },
  { category: 'detection heuristics', pattern: /\bdetection\s*(?:_|\s*)heuristic/i },
  { category: 'private benchmark answers', pattern: /\bprivate\s*(?:_|\s*)benchmark\s*(?:_|\s*)answer/i },
  { category: 'critical IAM policy internals', pattern: /\bcritical\s*(?:_|\s*)iam\s*(?:_|\s*)policy\s*(?:_|\s*)internal/i },
  { category: 'critical Safety Kernel internals', pattern: /\bcritical\s*(?:_|\s*)safety\s*(?:_|\s*)kernel\s*(?:_|\s*)internal/i },
  { category: 'critical routing/policy internals', pattern: /\bcritical\s*(?:_|\s*)routing\s*(?:_|\s*)policy\s*(?:_|\s*)internal/i },
  { category: 'Customer PII and raw identity data', pattern: /\bidentity_vault_plaintext\b/i },
  { category: 'Customer PII and raw identity data', pattern: /\braw_pii\b/i },
];

/**
 * Certified Provider Destinations Allowlist.
 * Outbound requests MUST match exactly one certified host and path.
 */
export const CERTIFIED_PROVIDER_DESTINATIONS: Record<string, { endpoint: string; host: string; path: string }> = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    host: 'api.deepseek.com',
    path: '/v1/chat/completions',
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions',
    host: 'generativelanguage.googleapis.com',
    path: '/v1beta/interactions',
  },
};

/**
 * Certified Provider Strategy Candidate Models.
 */
export const CERTIFIED_STRATEGY_MODELS: Record<string, string> = {
  deepseek: 'deepseek-v4-flash',
  gemini: 'gemini-3.5-flash-lite',
};

// Maximum allowed size for a single Task Capsule payload (64 KB)
export const MAX_TASK_CAPSULE_BYTES = 65536;

// ============================================================================
// 2. TASK CAPSULE INTERFACE
// ============================================================================

export interface TaskCapsuleMetadata {
  readonly taskId: string;
  readonly runId?: string;
  readonly latencyMs?: number;
  readonly costMicroUsd?: number;
  readonly taskType: TaskType | string;
}

export interface TaskCapsule {
  readonly version: string;
  readonly classification: SovereignClassification;
  readonly taskType: TaskType | string;
  readonly payload: unknown;
  readonly metadata: TaskCapsuleMetadata;
  readonly isSanitized: boolean;
  readonly isMinimized: boolean;
}

export interface TaskCapsuleValidationResult {
  readonly ok: boolean;
  readonly classification: SovereignClassification;
  readonly errors: string[];
  readonly violatedCategories: string[];
  readonly destinationAllowed: boolean;
  readonly safeForOutboundDispatch: boolean;
}

// ============================================================================
// 3. SOVEREIGN BOUNDARY RUNTIME ENFORCEMENT ENGINE
// ============================================================================

export class SovereignBoundaryEnforcer {
  /**
   * Scans an arbitrary string or serialized object for BLACK material.
   * Returns list of violated categories (empty if clean).
   */
  public static detectBlackMaterial(data: unknown): string[] {
    if (data === null || data === undefined) return [];

    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    const violations = new Set<string>();

    // 1. Check regex patterns for explicit BLACK categories
    for (const { category, pattern } of BLACK_MATERIAL_PATTERNS) {
      if (pattern.test(serialized)) {
        violations.add(category);
      }
    }

    // 2. Cross-check with DataClassifier
    const classification = DataClassifier.classify(typeof data === 'object' && data !== null ? (data as Record<string, any>) : serialized);
    if (classification === 'SECRET') {
      violations.add('production secrets');
    } else if (classification === 'PERSONAL' || classification === 'SENSITIVE') {
      violations.add('Customer PII and raw identity data');
    }

    return Array.from(violations);
  }

  /**
   * Verifies destination URL against certified provider allowlist.
   */
  public static isDestinationAllowed(provider: string, destinationUrl: string): boolean {
    const config = CERTIFIED_PROVIDER_DESTINATIONS[provider.toLowerCase()];
    if (!config) return false;
    return destinationUrl === config.endpoint;
  }

  /**
   * Validates a Task Capsule before outbound dispatch to an external AI model.
   * Enforces Sovereign Boundary invariants fail-closed.
   */
  public static validateOutboundTaskCapsule(
    capsule: TaskCapsule,
    targetProvider: string,
    targetDestination: string
  ): TaskCapsuleValidationResult {
    const errors: string[] = [];
    const violatedCategories: string[] = [];

    // Default deny on null/undefined or invalid shape
    if (!capsule || typeof capsule !== 'object') {
      return {
        ok: false,
        classification: 'BLACK',
        errors: ['TASK_CAPSULE_NULL_OR_INVALID'],
        violatedCategories: [],
        destinationAllowed: false,
        safeForOutboundDispatch: false,
      };
    }

    // 1. Destination verification
    const destinationAllowed = this.isDestinationAllowed(targetProvider, targetDestination);
    if (!destinationAllowed) {
      errors.push(`OUTBOUND_DESTINATION_FORBIDDEN: Target destination ${targetDestination} for provider ${targetProvider} is outside certified allowlist.`);
    }

    // 2. Classification rules enforcement
    if (capsule.classification === 'BLACK') {
      errors.push('SOVEREIGN_BOUNDARY_CLASSIFICATION_BLACK: Capsule explicitly classified as BLACK. Outbound transmission forbidden.');
      return {
        ok: false,
        classification: 'BLACK',
        errors,
        violatedCategories: [],
        destinationAllowed,
        safeForOutboundDispatch: false,
      };
    }

    // 3. Payload size bound check (fail fast before deep regex scan)
    const serializedPayload = JSON.stringify(capsule.payload ?? '');
    if (Buffer.byteLength(serializedPayload, 'utf-8') > MAX_TASK_CAPSULE_BYTES) {
      errors.push(`TASK_CAPSULE_SIZE_EXCEEDED: Size exceeds maximum allowed ${MAX_TASK_CAPSULE_BYTES} bytes.`);
      return {
        ok: false,
        classification: capsule.classification,
        errors,
        violatedCategories: [],
        destinationAllowed,
        safeForOutboundDispatch: false,
      };
    }

    // 4. Scan entire capsule (payload + metadata) for BLACK material
    const payloadViolations = this.detectBlackMaterial(capsule.payload);
    const metaViolations = this.detectBlackMaterial(capsule.metadata);
    for (const v of payloadViolations) violatedCategories.push(v);
    for (const v of metaViolations) {
      if (!violatedCategories.includes(v)) violatedCategories.push(v);
    }

    if (violatedCategories.length > 0) {
      errors.push(`SOVEREIGN_BOUNDARY_BLACK_DATA_DETECTED: Categories: ${violatedCategories.join(', ')}`);
      return {
        ok: false,
        classification: 'BLACK',
        errors,
        violatedCategories,
        destinationAllowed,
        safeForOutboundDispatch: false,
      };
    }

    // 5. GREY requirements
    if (capsule.classification === 'GREY') {
      if (!capsule.isSanitized) {
        errors.push('GREY_BOUNDARY_VIOLATION: GREY data must be explicitly sanitized before outbound dispatch.');
      }
      if (!capsule.isMinimized) {
        errors.push('GREY_BOUNDARY_VIOLATION: GREY data must be strictly minimized to bounded task capsule context.');
      }
    } else if (capsule.classification !== 'WHITE') {
      errors.push(`UNKNOWN_SOVEREIGN_CLASSIFICATION: ${capsule.classification}`);
    }

    const ok = errors.length === 0 && destinationAllowed;

    return {
      ok,
      classification: capsule.classification,
      errors,
      violatedCategories,
      destinationAllowed,
      safeForOutboundDispatch: ok,
    };
  }
}
