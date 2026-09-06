/**
 * @file worker/ai/canary/deepSeekProductionTrustAnchorPreProvisioningAudit.ts
 * @description VELNAR — Phase A.12B.2C-5P Synthetic End-to-End Trust-Anchor Pre-Provisioning Audit.
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - PURE OFFLINE PRE-PROVISIONING AUDIT ENGINE ONLY (NON-AUTHORITATIVE).
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO production private keys generated, stored, or embedded.
 * - ZERO real production public keys embedded or provisioned.
 * - ZERO operational key generation or signing APIs.
 * - NO dynamic trust injection (no environment variable loading, no filesystem secret loading, no remote JWKS/KMS).
 * - PRODUCTION_AUTHORITY_REGISTRY entry count remains strictly 0.
 * - PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED remains strictly false.
 * - PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY remains strictly false.
 * - PRODUCTION_TRUST_ANCHOR_SLOT_READY remains strictly false.
 * - PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED remains strictly false.
 * - CANARY_LIVE_EXECUTION_ENABLED remains strictly false.
 * - GUARDED_SOURCE_ATTESTATION_READY remains strictly false.
 * - GUARDED_HUMAN_AUTH_ATTESTATION_READY remains strictly false.
 *
 * NON-AUTHORITATIVE AUDIT SEMANTICS:
 * This audit module evaluates candidate pairs, manual handoffs, cross-bindings,
 * and fail-closed production-state invariants. It can NEVER authorize provisioning.
 * authorizesProvisioning remains strictly false under all outcomes.
 */

import {
  PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_HUMAN_AUTHORITY_REGISTRY,
} from './deepSeekProductionAuthorizationTrust';
import {
  PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY,
} from './deepSeekProductionTrustAnchorProvisioning';
import {
  PRODUCTION_TRUST_ANCHOR_SLOT_READY,
  PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED,
  validateProductionTrustAnchorProvisioningCandidate,
  validateProductionTrustAnchorManualHandoffReceipt,
  validateProvisioningCandidateWithManualHandoff,
} from './deepSeekProductionTrustAnchorProvisioningSlot';
import type {
  ProductionTrustAnchorProvisioningCandidate,
  ProductionTrustAnchorManualHandoffReceipt,
} from './deepSeekProductionTrustAnchorProvisioningSlot';
import { CANARY_LIVE_EXECUTION_ENABLED } from './canarySpecification';
import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from './deepSeekGuardedLiveTransport';

// ============================================================================
// 1. AUDIT CONSTANTS & CONFIGURATION
// ============================================================================

export const PRE_PROVISIONING_AUDIT_VERSION = 'a12b2c5p-v1' as const;

/**
 * Compile-time invariant: Audit can NEVER authorize provisioning.
 * Strictly false under all conditions and outcomes.
 */
export const PRE_PROVISIONING_AUDIT_CAN_AUTHORIZE_PROVISIONING = false as const;

/**
 * Indicates whether a real key is required for pre-provisioning rehearsal audit.
 * Strictly false: rehearsal accepts valid synthetic candidates for verification.
 */
export const PRE_PROVISIONING_REAL_KEY_REQUIRED = false as const;

// ============================================================================
// 2. EXACT PROPERTY ALLOWLISTS
// ============================================================================

/**
 * Exact 2 own properties required for ProductionTrustAnchorPreProvisioningAuditInput.
 */
export const EXACT_AUDIT_INPUT_KEYS = Object.freeze([
  'candidate',
  'handoffReceipt',
] as const);

const ALLOWED_AUDIT_INPUT_KEYS_SET = new Set<string>(EXACT_AUDIT_INPUT_KEYS);

// ============================================================================
// 3. TYPES & INTERFACES
// ============================================================================

/**
 * Input for the pre-provisioning rehearsal audit.
 * Strictly bounded: candidate and handoff receipt only.
 * No authority override, no registry override, no public-key override,
 * no private key, and no time override.
 */
export interface ProductionTrustAnchorPreProvisioningAuditInput {
  readonly candidate: ProductionTrustAnchorProvisioningCandidate;
  readonly handoffReceipt: ProductionTrustAnchorManualHandoffReceipt;
}

/**
 * Structured audit result.
 * authorizesProvisioning is compile-time and runtime locked to strictly false.
 */
export interface ProductionTrustAnchorPreProvisioningAuditResult {
  readonly auditVersion: typeof PRE_PROVISIONING_AUDIT_VERSION;
  readonly passed: boolean;
  readonly candidateValid: boolean;
  readonly handoffReceiptValid: boolean;
  readonly candidateReceiptCrossBindingValid: boolean;
  readonly productionRegistryEmpty: boolean;
  readonly productionTrustAnchorUnprovisioned: boolean;
  readonly provisioningReadinessFalse: boolean;
  readonly slotReadyFalse: boolean;
  readonly slotPopulatedFalse: boolean;
  readonly sourceAttestationReadinessFalse: boolean;
  readonly humanAuthorizationReadinessFalse: boolean;
  readonly liveExecutionFalse: boolean;
  readonly authorizesProvisioning: false;
  readonly errors: readonly string[];
}

// ============================================================================
// 4. AUDIT EXECUTION ENGINE
// ============================================================================

/**
 * Runs the pre-provisioning rehearsal audit.
 *
 * Verifies:
 * 1. Exact audit input schema (no extra/missing/inherited properties).
 * 2. Candidate validity via validateProductionTrustAnchorProvisioningCandidate.
 * 3. Handoff receipt validity via validateProductionTrustAnchorManualHandoffReceipt.
 * 4. Combined cross-binding via validateProvisioningCandidateWithManualHandoff.
 * 5. Sealed production-state fail-closed invariants:
 *    - PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED === false
 *    - PRODUCTION_HUMAN_AUTHORITY_REGISTRY.length === 0
 *    - PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY === false
 *    - PRODUCTION_TRUST_ANCHOR_SLOT_READY === false
 *    - PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED === false
 *    - CANARY_LIVE_EXECUTION_ENABLED === false
 *    - GUARDED_SOURCE_ATTESTATION_READY === false
 *    - GUARDED_HUMAN_AUTH_ATTESTATION_READY === false
 *
 * CRITICAL: authorizesProvisioning is ALWAYS strictly false.
 */
export function runProductionTrustAnchorPreProvisioningAudit(
  input: unknown
): ProductionTrustAnchorPreProvisioningAuditResult {
  const errors: string[] = [];

  // Evaluate sealed production-state invariants
  const productionTrustAnchorUnprovisioned = PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED === false;
  if (!productionTrustAnchorUnprovisioned) {
    errors.push('PRODUCTION_STATE_VIOLATION: PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED must be strictly false');
  }

  const productionRegistryEmpty = PRODUCTION_HUMAN_AUTHORITY_REGISTRY.length === 0;
  if (!productionRegistryEmpty) {
    errors.push(
      `PRODUCTION_STATE_VIOLATION: PRODUCTION_HUMAN_AUTHORITY_REGISTRY must have length 0, got ${PRODUCTION_HUMAN_AUTHORITY_REGISTRY.length}`
    );
  }

  const provisioningReadinessFalse = PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY === false;
  if (!provisioningReadinessFalse) {
    errors.push('PRODUCTION_STATE_VIOLATION: PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY must be strictly false');
  }

  const slotReadyFalse = PRODUCTION_TRUST_ANCHOR_SLOT_READY === false;
  if (!slotReadyFalse) {
    errors.push('PRODUCTION_STATE_VIOLATION: PRODUCTION_TRUST_ANCHOR_SLOT_READY must be strictly false');
  }

  const slotPopulatedFalse = PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED === false;
  if (!slotPopulatedFalse) {
    errors.push('PRODUCTION_STATE_VIOLATION: PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED must be strictly false');
  }

  const sourceAttestationReadinessFalse = GUARDED_SOURCE_ATTESTATION_READY === false;
  if (!sourceAttestationReadinessFalse) {
    errors.push('PRODUCTION_STATE_VIOLATION: GUARDED_SOURCE_ATTESTATION_READY must be strictly false');
  }

  const humanAuthorizationReadinessFalse = GUARDED_HUMAN_AUTH_ATTESTATION_READY === false;
  if (!humanAuthorizationReadinessFalse) {
    errors.push('PRODUCTION_STATE_VIOLATION: GUARDED_HUMAN_AUTH_ATTESTATION_READY must be strictly false');
  }

  const liveExecutionFalse = CANARY_LIVE_EXECUTION_ENABLED === false;
  if (!liveExecutionFalse) {
    errors.push('PRODUCTION_STATE_VIOLATION: CANARY_LIVE_EXECUTION_ENABLED must be strictly false');
  }

  let candidateValid = false;
  let handoffReceiptValid = false;
  let candidateReceiptCrossBindingValid = false;

  // Validate input container
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push('INPUT_NULL_OR_NOT_OBJECT: audit input must be a non-null object');
    return {
      auditVersion: PRE_PROVISIONING_AUDIT_VERSION,
      passed: false,
      candidateValid: false,
      handoffReceiptValid: false,
      candidateReceiptCrossBindingValid: false,
      productionRegistryEmpty,
      productionTrustAnchorUnprovisioned,
      provisioningReadinessFalse,
      slotReadyFalse,
      slotPopulatedFalse,
      sourceAttestationReadinessFalse,
      humanAuthorizationReadinessFalse,
      liveExecutionFalse,
      authorizesProvisioning: false,
      errors,
    };
  }

  const inp = input as Record<string, unknown>;

  // Reject unknown properties
  for (const key of Object.keys(inp)) {
    if (!ALLOWED_AUDIT_INPUT_KEYS_SET.has(key)) {
      errors.push(`UNKNOWN_PROPERTY: '${key}' is not permitted in audit input`);
    }
  }

  // Require own properties
  for (const key of EXACT_AUDIT_INPUT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(inp, key)) {
      errors.push(`MISSING_OWN_PROPERTY: '${key}' must be an own property of audit input`);
    }
  }

  // Sub-validation: candidate
  if (Object.prototype.hasOwnProperty.call(inp, 'candidate')) {
    const candVal = validateProductionTrustAnchorProvisioningCandidate(inp.candidate);
    candidateValid = candVal.valid;
    if (!candVal.valid) {
      errors.push(...candVal.errors.map(e => `CANDIDATE_INVALID: ${e}`));
    }
  }

  // Sub-validation: handoff receipt
  if (Object.prototype.hasOwnProperty.call(inp, 'handoffReceipt')) {
    const recVal = validateProductionTrustAnchorManualHandoffReceipt(inp.handoffReceipt);
    handoffReceiptValid = recVal.valid;
    if (!recVal.valid) {
      errors.push(...recVal.errors.map(e => `HANDOFF_RECEIPT_INVALID: ${e}`));
    }
  }

  // Cross-binding validation (only if individual schemas were valid)
  if (candidateValid && handoffReceiptValid) {
    const combVal = validateProvisioningCandidateWithManualHandoff(inp.candidate, inp.handoffReceipt);
    candidateReceiptCrossBindingValid = combVal.valid;
    if (!combVal.valid) {
      errors.push(...combVal.errors.map(e => `CROSS_BINDING_INVALID: ${e}`));
    }
  }

  const passed =
    errors.length === 0 &&
    candidateValid &&
    handoffReceiptValid &&
    candidateReceiptCrossBindingValid &&
    productionRegistryEmpty &&
    productionTrustAnchorUnprovisioned &&
    provisioningReadinessFalse &&
    slotReadyFalse &&
    slotPopulatedFalse &&
    sourceAttestationReadinessFalse &&
    humanAuthorizationReadinessFalse &&
    liveExecutionFalse;

  return {
    auditVersion: PRE_PROVISIONING_AUDIT_VERSION,
    passed,
    candidateValid,
    handoffReceiptValid,
    candidateReceiptCrossBindingValid,
    productionRegistryEmpty,
    productionTrustAnchorUnprovisioned,
    provisioningReadinessFalse,
    slotReadyFalse,
    slotPopulatedFalse,
    sourceAttestationReadinessFalse,
    humanAuthorizationReadinessFalse,
    liveExecutionFalse,
    authorizesProvisioning: false,
    errors,
  };
}
