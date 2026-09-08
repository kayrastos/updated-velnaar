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

export interface OutboundProviderValidationParams {
  readonly provider: string;
  readonly destinationUrl: string;
  readonly model?: string;
  readonly taskType?: string;
  readonly payload?: unknown;
  readonly serializedBody?: string;
  readonly capsule?: TaskCapsule;
  readonly classification?: SovereignClassification;
  readonly isSanitized?: boolean;
  readonly isMinimized?: boolean;
}

// ============================================================================
// 3. SOVEREIGN BOUNDARY RUNTIME ENFORCEMENT ENGINE
// ============================================================================

export class SovereignBoundaryEnforcer {
  /**
   * Deterministically and recursively scans an arbitrary value (object, array, nested object,
   * string, primitive) for BLACK material.
   * Traverses nested structures fail-closed.
   * Returns list of violated categories (empty if clean).
   */
  public static detectBlackMaterial(data: unknown): string[] {
    if (data === null || data === undefined) return [];

    const violations = new Set<string>();
    const seen = new WeakSet<object>();

    function scanString(str: string): void {
      if (!str || typeof str !== 'string') return;
      for (const { category, pattern } of BLACK_MATERIAL_PATTERNS) {
        if (pattern.test(str)) {
          violations.add(category);
        }
      }
      try {
        const cls = DataClassifier.classify(str);
        if (cls === 'SECRET') {
          violations.add('production secrets');
        } else if (cls === 'PERSONAL' || cls === 'SENSITIVE') {
          violations.add('Customer PII and raw identity data');
        }
      } catch {
        // Fallback if string classification throws
      }
    }

    function walk(val: unknown, depth = 0): void {
      if (depth > 32) {
        // Excessively deep structure -> fail closed
        violations.add('proprietary verification algorithms');
        return;
      }
      if (val === null || val === undefined) return;

      if (typeof val === 'string') {
        scanString(val);
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        // Safe primitive
      } else if (typeof val === 'object') {
        if (seen.has(val as object)) {
          // Circular reference -> fail closed
          violations.add('proprietary verification algorithms');
          return;
        }
        seen.add(val as object);

        if (Array.isArray(val)) {
          for (const item of val) {
            walk(item, depth + 1);
          }
        } else {
          // Object: scan property keys AND property values
          for (const [k, v] of Object.entries(val)) {
            scanString(k);
            walk(v, depth + 1);
          }
          // Also run DataClassifier on the object directly
          try {
            const cls = DataClassifier.classify(val as Record<string, any>);
            if (cls === 'SECRET') {
              violations.add('production secrets');
            } else if (cls === 'PERSONAL' || cls === 'SENSITIVE') {
              violations.add('Customer PII and raw identity data');
            }
          } catch {
            violations.add('proprietary verification algorithms');
          }
        }
      } else {
        // Function, Symbol, BigInt are not permitted in task capsules -> fail closed
        violations.add('proprietary verification algorithms');
      }
    }

    try {
      walk(data);
    } catch {
      violations.add('proprietary verification algorithms');
    }

    return Array.from(violations);
  }

  /**
   * Hardened destination URL verification against certified provider allowlist.
   * Parses using standard URL constructor and enforces:
   * - protocol === 'https:'
   * - No username or password (userinfo)
   * - Exact allowed hostname (no suffix, no prefix, no substring matching)
   * - Exact allowed pathname
   * - Standard port only (reject unexpected ports)
   * - No query parameters (search must be empty)
   * - No fragments (hash must be empty)
   * - Default fail-closed on malformed or unparseable URLs.
   */
  public static isDestinationAllowed(provider: string, destinationUrl: string): boolean {
    if (!provider || !destinationUrl || typeof destinationUrl !== 'string') return false;
    const config = CERTIFIED_PROVIDER_DESTINATIONS[provider.toLowerCase()];
    if (!config) return false;

    try {
      const parsed = new URL(destinationUrl);
      if (parsed.protocol !== 'https:') return false;
      if (parsed.username || parsed.password) return false;
      if (parsed.hostname !== config.host) return false;
      if (parsed.pathname !== config.path) return false;
      if (parsed.port && parsed.port !== '443' && parsed.port !== '') return false;
      if (parsed.search && parsed.search !== '') return false;
      if (parsed.hash && parsed.hash !== '') return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validates a Task Capsule before outbound dispatch to an external AI model.
   * Enforces Sovereign Boundary invariants fail-closed.
   * Classification label is NOT authority: BLACK detection is performed on all payloads,
   * even if claimed to be WHITE or GREY.
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

    // 1. Hardened destination verification
    const destinationAllowed = this.isDestinationAllowed(targetProvider, targetDestination);
    if (!destinationAllowed) {
      errors.push(`OUTBOUND_DESTINATION_FORBIDDEN: Target destination ${targetDestination} for provider ${targetProvider} is outside certified allowlist.`);
    }

    // 2. Explicit BLACK classification check
    if (capsule.classification === 'BLACK') {
      errors.push('SOVEREIGN_BOUNDARY_CLASSIFICATION_BLACK: Capsule explicitly classified as BLACK. Outbound transmission forbidden.');
    }

    // 3. Payload size bound check (fail fast before deep scan)
    let serializedPayload = '';
    try {
      serializedPayload = typeof capsule.payload === 'string' ? capsule.payload : JSON.stringify(capsule.payload ?? '');
    } catch {
      errors.push('TASK_CAPSULE_SERIALIZATION_FAILED: Payload cannot be deterministically serialized.');
      return {
        ok: false,
        classification: capsule.classification || 'BLACK',
        errors,
        violatedCategories: ['proprietary verification algorithms'],
        destinationAllowed,
        safeForOutboundDispatch: false,
      };
    }

    if (Buffer.byteLength(serializedPayload, 'utf-8') > MAX_TASK_CAPSULE_BYTES) {
      errors.push(`TASK_CAPSULE_SIZE_EXCEEDED: Size exceeds maximum allowed ${MAX_TASK_CAPSULE_BYTES} bytes.`);
      return {
        ok: false,
        classification: capsule.classification || 'BLACK',
        errors,
        violatedCategories: [],
        destinationAllowed,
        safeForOutboundDispatch: false,
      };
    }

    // 4. Scan entire capsule (payload + metadata) for BLACK material regardless of claimed classification
    const payloadViolations = this.detectBlackMaterial(capsule.payload);
    const metaViolations = this.detectBlackMaterial(capsule.metadata);
    for (const v of payloadViolations) violatedCategories.push(v);
    for (const v of metaViolations) {
      if (!violatedCategories.includes(v)) violatedCategories.push(v);
    }

    if (violatedCategories.length > 0) {
      errors.push(`SOVEREIGN_BOUNDARY_BLACK_DATA_DETECTED: Categories: ${violatedCategories.join(', ')}`);
    }

    // 5. GREY / WHITE classification requirements
    if (capsule.classification === 'GREY') {
      if (capsule.isSanitized !== true) {
        errors.push('GREY_BOUNDARY_VIOLATION: GREY data must be explicitly sanitized before outbound dispatch (isSanitized === true required).');
      }
      if (capsule.isMinimized !== true) {
        errors.push('GREY_BOUNDARY_VIOLATION: GREY data must be strictly minimized to bounded task capsule context (isMinimized === true required).');
      }
    } else if (capsule.classification !== 'WHITE' && capsule.classification !== 'BLACK') {
      errors.push(`UNKNOWN_SOVEREIGN_CLASSIFICATION: ${capsule.classification}`);
    }

    const ok = errors.length === 0 && destinationAllowed && violatedCategories.length === 0 && capsule.classification !== 'BLACK';

    return {
      ok,
      classification: violatedCategories.length > 0 ? 'BLACK' : capsule.classification,
      errors,
      violatedCategories,
      destinationAllowed,
      safeForOutboundDispatch: ok,
    };
  }

  /**
   * Primary single fail-closed enforcement point called immediately before any provider network dispatch.
   * Validates destination, provider, model, payload boundaries, BLACK data scanning, and TaskCapsule
   * requirements in one atomic check.
   */
  public static validateOutboundProviderRequest(
    params: OutboundProviderValidationParams
  ): TaskCapsuleValidationResult {
    const errors: string[] = [];
    const violatedCategories: string[] = [];

    if (!params || typeof params !== 'object') {
      return {
        ok: false,
        classification: 'BLACK',
        errors: ['OUTBOUND_PARAMS_NULL_OR_INVALID'],
        violatedCategories: [],
        destinationAllowed: false,
        safeForOutboundDispatch: false,
      };
    }

    const { provider, destinationUrl, model, payload, serializedBody, capsule } = params;

    // 1. Destination check
    const destinationAllowed = this.isDestinationAllowed(provider, destinationUrl);
    if (!destinationAllowed) {
      errors.push(`OUTBOUND_DESTINATION_FORBIDDEN: Target destination '${destinationUrl}' for provider '${provider}' is outside certified allowlist.`);
    }

    // 2. Model strategy verification
    if (model) {
      const allowedModel = CERTIFIED_STRATEGY_MODELS[provider?.toLowerCase()];
      if (allowedModel && model !== allowedModel) {
        errors.push(`UNAPPROVED_PROVIDER_MODEL: Model '${model}' is not certified for provider '${provider}'. Expected '${allowedModel}'.`);
      }
    }

    // 3. Payload size bound check
    if (serializedBody) {
      if (Buffer.byteLength(serializedBody, 'utf-8') > MAX_TASK_CAPSULE_BYTES) {
        errors.push(`OUTBOUND_PAYLOAD_SIZE_EXCEEDED: Body size ${Buffer.byteLength(serializedBody, 'utf-8')} bytes exceeds maximum ${MAX_TASK_CAPSULE_BYTES} bytes.`);
        return {
          ok: false,
          classification: params.classification ?? 'BLACK',
          errors,
          violatedCategories: [],
          destinationAllowed,
          safeForOutboundDispatch: false,
        };
      }
    }

    // 4. Scan payload and serialized body for BLACK material (regardless of claimed classification)
    if (payload !== undefined) {
      for (const v of this.detectBlackMaterial(payload)) {
        if (!violatedCategories.includes(v)) violatedCategories.push(v);
      }
    }
    if (serializedBody) {
      for (const v of this.detectBlackMaterial(serializedBody)) {
        if (!violatedCategories.includes(v)) violatedCategories.push(v);
      }
    }

    // 5. Delegate to TaskCapsule validation if capsule provided
    let effectiveClassification: SovereignClassification = params.classification ?? 'GREY';
    if (capsule) {
      const capsuleResult = this.validateOutboundTaskCapsule(capsule, provider, destinationUrl);
      if (!capsuleResult.ok) {
        for (const err of capsuleResult.errors) {
          if (!errors.includes(err)) errors.push(err);
        }
        for (const cat of capsuleResult.violatedCategories) {
          if (!violatedCategories.includes(cat)) violatedCategories.push(cat);
        }
      }
      effectiveClassification = capsuleResult.classification;
    } else {
      // Direct params without capsule envelope
      if (effectiveClassification === 'BLACK') {
        errors.push('SOVEREIGN_BOUNDARY_CLASSIFICATION_BLACK: Request classified as BLACK.');
      } else if (effectiveClassification === 'GREY') {
        if (params.isSanitized !== true) {
          errors.push('GREY_BOUNDARY_VIOLATION: GREY data must be explicitly sanitized before outbound dispatch (isSanitized === true required).');
        }
        if (params.isMinimized !== true) {
          errors.push('GREY_BOUNDARY_VIOLATION: GREY data must be strictly minimized to bounded task context (isMinimized === true required).');
        }
      }
    }

    if (violatedCategories.length > 0) {
      const msg = `SOVEREIGN_BOUNDARY_BLACK_DATA_DETECTED: Categories: ${violatedCategories.join(', ')}`;
      if (!errors.includes(msg)) errors.push(msg);
      effectiveClassification = 'BLACK';
    }

    const ok = errors.length === 0 && destinationAllowed && violatedCategories.length === 0 && effectiveClassification !== 'BLACK';

    return {
      ok,
      classification: effectiveClassification,
      errors,
      violatedCategories,
      destinationAllowed,
      safeForOutboundDispatch: ok,
    };
  }
}
