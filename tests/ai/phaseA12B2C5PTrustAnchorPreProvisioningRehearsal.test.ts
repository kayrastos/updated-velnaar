/**
 * @file tests/ai/phaseA12B2C5PTrustAnchorPreProvisioningRehearsal.test.ts
 * @description VELNAR — Phase A.12B.2C-5P Synthetic End-to-End Trust-Anchor Pre-Provisioning Rehearsal Test Suite.
 *
 * STRICT ARCHITECTURAL INVARIANTS:
 * - PURE OFFLINE SYNTHETIC REHEARSAL ONLY.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external network calls.
 * - ZERO provider credentials (no API keys, no bearer tokens).
 * - ZERO REAL production private keys generated, committed, or accepted.
 * - ZERO REAL public keys provisioned to production registry.
 * - ZERO mutation of production trust state.
 * - Ephemeral synthetic Ed25519 key generation ONLY in test process memory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';

// 5P Pre-Provisioning Audit Imports
import {
  PRE_PROVISIONING_AUDIT_VERSION,
  PRE_PROVISIONING_AUDIT_CAN_AUTHORIZE_PROVISIONING,
  PRE_PROVISIONING_REAL_KEY_REQUIRED,
  EXACT_AUDIT_INPUT_KEYS,
  runProductionTrustAnchorPreProvisioningAudit,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorPreProvisioningAudit';
import type {
  ProductionTrustAnchorPreProvisioningAuditInput,
  ProductionTrustAnchorPreProvisioningAuditResult,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorPreProvisioningAudit';

// 5O Provisioning Slot Imports
import {
  PRODUCTION_TRUST_ANCHOR_SLOT_VERSION,
  PRODUCTION_TRUST_ANCHOR_SLOT_READY,
  PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED,
  CANONICAL_TARGET_AUTHORITY_ID,
  CANONICAL_TARGET_KEY_VERSION,
  CANONICAL_TARGET_ALGORITHM,
  CANONICAL_HANDOFF_VERSION,
  computeProductionTrustAnchorManualHandoffDigest,
  validateProductionTrustAnchorProvisioningCandidate,
  validateProductionTrustAnchorManualHandoffReceipt,
  validateProvisioningCandidateWithManualHandoff,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot';
import type {
  ProductionTrustAnchorProvisioningCandidate,
  ProductionTrustAnchorManualHandoffReceipt,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot';

// 5N Provisioning Ceremony Imports
import {
  PROVISIONING_CEREMONY_CONTRACT_VERSION,
  PRODUCTION_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_CEREMONY_EXECUTED,
  PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY,
  CANONICAL_PRIVATE_KEY_CUSTODY_MODE,
  CANONICAL_OPERATOR_ACKNOWLEDGEMENT,
  computeProductionTrustAnchorProvisioningRecordDigest,
  validateProductionTrustAnchorProvisioningRecord,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';
import type { ProductionTrustAnchorProvisioningRecord } from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';

// 5M Production Trust Foundation Imports
import {
  PRODUCTION_AUTHORITY_REGISTRY_VERSION,
  PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_KEY_ROTATION_IMPLEMENTED,
  PRODUCTION_HUMAN_AUTHORITY_REGISTRY,
  validateProductionAuthorityEntry,
  verifyProductionHumanAuthorizationPackage,
} from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import type { ProductionHumanAuthorizationAuthority } from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';

// 5L Attestation & Generic Cryptographic Verifier Imports
import {
  ATTESTATION_FOUNDATION_VERSION,
  CANONICAL_AUTHORIZATION_VERSION,
  CANONICAL_ALGORITHM,
  OFF_PEAK_MIN_BUDGET_MICRO_USD,
  computePublicKeyFingerprintSha256,
  buildTrustedSourceAttestation,
  canonicalizeHumanAuthorizationPayload,
  verifyHumanAuthorizationPackage,
} from '../../worker/ai/canary/deepSeekCertificationAttestation';
import type {
  CanonicalHumanAuthorizationPayload,
  SignedHumanAuthorizationPackage,
  HumanAuthorizationAuthorityDescriptor,
  TrustedSourceAttestation,
} from '../../worker/ai/canary/deepSeekCertificationAttestation';

// Guarded Transport and Canary Specification Constants
import {
  GUARDED_TRANSPORT_MODULE_VERSION,
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import { CANARY_LIVE_EXECUTION_ENABLED } from '../../worker/ai/canary/canarySpecification';
import {
  TRANSPORT_CONTRACT_VERSION,
  SEALED_PROVIDER,
  SEALED_MODEL,
  SEALED_OFF_PEAK_PROGRAM_ID,
  SEALED_OFF_PEAK_CANDIDATE_ID,
} from '../../worker/ai/canary/deepSeekLiveCertificationTransportContract';
import { SUCCESSOR_SPECIFICATION_VERSION } from '../../worker/ai/canary/deepSeekSingleProviderCertificationSpecification';

// ============================================================================
// NETWORK SENTINEL & ZERO-EXTERNAL GUARDS
// ============================================================================

let globalFetchCalls = 0;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalFetchCalls = 0;
  globalThis.fetch = (async () => {
    globalFetchCalls++;
    throw new Error('STRICT_OFFLINE_VIOLATION: network fetch attempted during Phase 5P rehearsal');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  expect(globalFetchCalls).toBe(0);
  globalThis.fetch = originalFetch;
  globalFetchCalls = 0;
});

// ============================================================================
// SYNTHETIC EPHEMERAL IN-MEMORY FIXTURES (TEST-ONLY)
// ============================================================================

const TEST_BASE_COMMIT = '941293c6b67bedef3d108300aac75428d03409a6';
const TEST_BASE_TREE = 'a8b627b03f60e9a7a4108a4ea443abd60f3275c5';

interface SyntheticEphemeralRehearsalKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyFingerprintSha256: string;
}

function createEphemeralRehearsalKeypair(): SyntheticEphemeralRehearsalKeypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const publicKeyFingerprintSha256 = computePublicKeyFingerprintSha256(publicKeyPem);

  return {
    publicKeyPem,
    privateKeyPem,
    publicKeyFingerprintSha256,
  };
}

function createSyntheticAuthorityEntry(keypair: SyntheticEphemeralRehearsalKeypair): ProductionHumanAuthorizationAuthority {
  return {
    authorityId: CANONICAL_TARGET_AUTHORITY_ID,
    keyVersion: CANONICAL_TARGET_KEY_VERSION,
    algorithm: CANONICAL_TARGET_ALGORITHM,
    publicKeyFingerprintSha256: keypair.publicKeyFingerprintSha256,
    publicKeyPem: keypair.publicKeyPem,
  };
}

function createSyntheticProvisioningRecord(keypair: SyntheticEphemeralRehearsalKeypair): ProductionTrustAnchorProvisioningRecord {
  const partial = {
    ceremonyVersion: PROVISIONING_CEREMONY_CONTRACT_VERSION,
    registryVersion: PRODUCTION_AUTHORITY_REGISTRY_VERSION,
    authorityId: CANONICAL_TARGET_AUTHORITY_ID,
    keyVersion: CANONICAL_TARGET_KEY_VERSION,
    algorithm: CANONICAL_TARGET_ALGORITHM,
    publicKeyPem: keypair.publicKeyPem,
    publicKeyFingerprintSha256: keypair.publicKeyFingerprintSha256,
    generatedOutsideRepository: true as const,
    privateKeyCommittedToRepository: false as const,
    privateKeyAccessibleToApplication: false as const,
    privateKeyCustodyMode: CANONICAL_PRIVATE_KEY_CUSTODY_MODE,
    operatorAcknowledgement: CANONICAL_OPERATOR_ACKNOWLEDGEMENT,
    ceremonyId: 'ceremony-a12b2c5p-synthetic-rehearsal-001',
    createdAt: '2026-09-06T12:00:00.000Z',
  };

  const provisioningRecordDigest = computeProductionTrustAnchorProvisioningRecordDigest(partial);
  return {
    ...partial,
    provisioningRecordDigest,
  };
}

function createSyntheticCandidate(keypair: SyntheticEphemeralRehearsalKeypair): ProductionTrustAnchorProvisioningCandidate {
  return {
    provisioningRecord: createSyntheticProvisioningRecord(keypair),
    publicAuthorityEntry: createSyntheticAuthorityEntry(keypair),
  };
}

function createSyntheticHandoffReceipt(
  keypair: SyntheticEphemeralRehearsalKeypair,
  provisioningRecordDigest: string
): ProductionTrustAnchorManualHandoffReceipt {
  const partial = {
    handoffVersion: CANONICAL_HANDOFF_VERSION,
    slotVersion: PRODUCTION_TRUST_ANCHOR_SLOT_VERSION,
    ceremonyVersion: PROVISIONING_CEREMONY_CONTRACT_VERSION,
    registryVersion: PRODUCTION_AUTHORITY_REGISTRY_VERSION,
    authorityId: CANONICAL_TARGET_AUTHORITY_ID,
    keyVersion: CANONICAL_TARGET_KEY_VERSION,
    algorithm: CANONICAL_TARGET_ALGORITHM,
    publicKeyFingerprintSha256: keypair.publicKeyFingerprintSha256,
    provisioningRecordDigest,
    reviewedByOperator: true as const,
    privateKeyNeverEnteredRepository: true as const,
    privateKeyNeverEnteredApplicationRuntime: true as const,
    privateKeyNeverEnteredAIAgentContext: true as const,
  };

  const handoffDigest = computeProductionTrustAnchorManualHandoffDigest(partial);
  return {
    ...partial,
    handoffDigest,
  };
}

function createSyntheticFullAuditChain(): {
  keypair: SyntheticEphemeralRehearsalKeypair;
  candidate: ProductionTrustAnchorProvisioningCandidate;
  handoffReceipt: ProductionTrustAnchorManualHandoffReceipt;
  auditInput: ProductionTrustAnchorPreProvisioningAuditInput;
} {
  const keypair = createEphemeralRehearsalKeypair();
  const candidate = createSyntheticCandidate(keypair);
  const handoffReceipt = createSyntheticHandoffReceipt(keypair, candidate.provisioningRecord.provisioningRecordDigest);
  const auditInput: ProductionTrustAnchorPreProvisioningAuditInput = {
    candidate,
    handoffReceipt,
  };
  return { keypair, candidate, handoffReceipt, auditInput };
}

function createSyntheticSignedAuthorizationPackage(
  keypair: SyntheticEphemeralRehearsalKeypair,
  attestation: TrustedSourceAttestation
): SignedHumanAuthorizationPackage {
  const payload: CanonicalHumanAuthorizationPayload = {
    authorizationVersion: CANONICAL_AUTHORIZATION_VERSION,
    authorityId: CANONICAL_TARGET_AUTHORITY_ID,
    issuedAt: '2026-09-06T12:00:00.000Z',
    expiresAt: '2026-09-06T12:10:00.000Z',
    targetProgram: SEALED_OFF_PEAK_PROGRAM_ID,
    pricingWindow: 'OFF_PEAK',
    candidateId: SEALED_OFF_PEAK_CANDIDATE_ID,
    sourceCommitSha: TEST_BASE_COMMIT,
    sourceTreeSha: TEST_BASE_TREE,
    specificationVersion: SUCCESSOR_SPECIFICATION_VERSION,
    maxBudgetMicroUsd: OFF_PEAK_MIN_BUDGET_MICRO_USD,
    runNonce: 'a12b2c5p_rehearsal_nonce_abcdef0123456789',
    singleUse: true,
    provider: SEALED_PROVIDER,
    model: SEALED_MODEL,
    canonicalTaskCount: 7,
    transportContractVersion: TRANSPORT_CONTRACT_VERSION,
    guardedTransportModuleVersion: GUARDED_TRANSPORT_MODULE_VERSION,
    sourceAttestationDigest: attestation.attestationDigest,
  };

  const canonicalBytes = Buffer.from(canonicalizeHumanAuthorizationPayload(payload), 'utf8');
  const signatureBuffer = crypto.sign(null, canonicalBytes, keypair.privateKeyPem);

  return {
    payload,
    signatureBase64: Buffer.from(signatureBuffer).toString('base64'),
    authorityId: CANONICAL_TARGET_AUTHORITY_ID,
    keyVersion: CANONICAL_TARGET_KEY_VERSION,
    algorithm: CANONICAL_TARGET_ALGORITHM,
  };
}

// ============================================================================
// TEST SUITE: 70+ RIGOROUS OFFLINE REHEARSAL TESTS
// ============================================================================

describe('VELNAR — Phase A.12B.2C-5P Synthetic Trust-Anchor Pre-Provisioning Rehearsal', () => {

  // --------------------------------------------------------------------------
  // SECTION 1: Audit Module Constants & Version Invariants (Tests 1-5)
  // --------------------------------------------------------------------------
  describe('Section 1: Audit Module Constants & Version Invariants', () => {
    it('1. verifies PRE_PROVISIONING_AUDIT_VERSION is strictly "a12b2c5p-v1"', () => {
      expect(PRE_PROVISIONING_AUDIT_VERSION).toBe('a12b2c5p-v1');
    });

    it('2. verifies PRE_PROVISIONING_AUDIT_CAN_AUTHORIZE_PROVISIONING is compile-time strictly false', () => {
      expect(PRE_PROVISIONING_AUDIT_CAN_AUTHORIZE_PROVISIONING).toBe(false);
    });

    it('3. verifies PRE_PROVISIONING_REAL_KEY_REQUIRED is strictly false for rehearsal', () => {
      expect(PRE_PROVISIONING_REAL_KEY_REQUIRED).toBe(false);
    });

    it('4. verifies EXACT_AUDIT_INPUT_KEYS contains exactly candidate and handoffReceipt in order', () => {
      expect(EXACT_AUDIT_INPUT_KEYS).toEqual(['candidate', 'handoffReceipt']);
      expect(Object.isFrozen(EXACT_AUDIT_INPUT_KEYS)).toBe(true);
    });

    it('5. verifies exact keys length is strictly 2', () => {
      expect(EXACT_AUDIT_INPUT_KEYS.length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 2: Audit Input Schema & Fail-Closed Boundaries (Tests 6-15)
  // --------------------------------------------------------------------------
  describe('Section 2: Audit Input Schema & Fail-Closed Boundaries', () => {
    it('6. rejects null audit input', () => {
      const res = runProductionTrustAnchorPreProvisioningAudit(null);
      expect(res.passed).toBe(false);
      expect(res.authorizesProvisioning).toBe(false);
      expect(res.errors.some(e => e.includes('INPUT_NULL_OR_NOT_OBJECT'))).toBe(true);
    });

    it('7. rejects undefined audit input', () => {
      const res = runProductionTrustAnchorPreProvisioningAudit(undefined);
      expect(res.passed).toBe(false);
      expect(res.authorizesProvisioning).toBe(false);
      expect(res.errors.some(e => e.includes('INPUT_NULL_OR_NOT_OBJECT'))).toBe(true);
    });

    it('8. rejects string primitive audit input', () => {
      const res = runProductionTrustAnchorPreProvisioningAudit('audit-input');
      expect(res.passed).toBe(false);
      expect(res.authorizesProvisioning).toBe(false);
    });

    it('9. rejects array audit input', () => {
      const res = runProductionTrustAnchorPreProvisioningAudit([]);
      expect(res.passed).toBe(false);
      expect(res.authorizesProvisioning).toBe(false);
      expect(res.errors.some(e => e.includes('INPUT_NULL_OR_NOT_OBJECT'))).toBe(true);
    });

    it('10. rejects empty object input lacking candidate and handoffReceipt', () => {
      const res = runProductionTrustAnchorPreProvisioningAudit({});
      expect(res.passed).toBe(false);
      expect(res.candidateValid).toBe(false);
      expect(res.handoffReceiptValid).toBe(false);
      expect(res.errors.some(e => e.includes('MISSING_OWN_PROPERTY: \'candidate\''))).toBe(true);
      expect(res.errors.some(e => e.includes('MISSING_OWN_PROPERTY: \'handoffReceipt\''))).toBe(true);
    });

    it('11. rejects unknown properties in audit input', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const mutated = { ...auditInput, unexpectedProperty: 'leak' };
      const res = runProductionTrustAnchorPreProvisioningAudit(mutated);
      expect(res.passed).toBe(false);
      expect(res.errors.some(e => e.includes('UNKNOWN_PROPERTY: \'unexpectedProperty\''))).toBe(true);
    });

    it('12. rejects input with missing candidate own property', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const { candidate: _, ...withoutCandidate } = auditInput;
      const res = runProductionTrustAnchorPreProvisioningAudit(withoutCandidate);
      expect(res.passed).toBe(false);
      expect(res.candidateValid).toBe(false);
      expect(res.errors.some(e => e.includes('MISSING_OWN_PROPERTY: \'candidate\''))).toBe(true);
    });

    it('13. rejects input with missing handoffReceipt own property', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const { handoffReceipt: _, ...withoutReceipt } = auditInput;
      const res = runProductionTrustAnchorPreProvisioningAudit(withoutReceipt);
      expect(res.passed).toBe(false);
      expect(res.handoffReceiptValid).toBe(false);
      expect(res.errors.some(e => e.includes('MISSING_OWN_PROPERTY: \'handoffReceipt\''))).toBe(true);
    });

    it('14. rejects inherited candidate property (prototype pollution rejection)', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const proto = { candidate: auditInput.candidate };
      const child = Object.create(proto);
      child.handoffReceipt = auditInput.handoffReceipt;

      const res = runProductionTrustAnchorPreProvisioningAudit(child);
      expect(res.passed).toBe(false);
      expect(res.errors.some(e => e.includes('MISSING_OWN_PROPERTY: \'candidate\''))).toBe(true);
    });

    it('15. rejects inherited handoffReceipt property', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const proto = { handoffReceipt: auditInput.handoffReceipt };
      const child = Object.create(proto);
      child.candidate = auditInput.candidate;

      const res = runProductionTrustAnchorPreProvisioningAudit(child);
      expect(res.passed).toBe(false);
      expect(res.errors.some(e => e.includes('MISSING_OWN_PROPERTY: \'handoffReceipt\''))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Synthetic Ephemeral Key Generation & 5M Authority Validation (Tests 16-22)
  // --------------------------------------------------------------------------
  describe('Section 3: Synthetic Ephemeral Key Generation & 5M Authority Validation', () => {
    it('16. generates valid ephemeral Ed25519 SPKI public key PEM in test memory', () => {
      const keypair = createEphemeralRehearsalKeypair();
      expect(keypair.publicKeyPem).toContain('BEGIN PUBLIC KEY');
      expect(keypair.publicKeyPem).toContain('END PUBLIC KEY');
      expect(keypair.publicKeyFingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('17. validates synthetic public authority entry against 5M authority validator', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const authority = createSyntheticAuthorityEntry(keypair);
      const val = validateProductionAuthorityEntry(authority);
      expect(val.valid).toBe(true);
      expect(val.errors).toHaveLength(0);
    });

    it('18. rejects synthetic authority entry if authorityId has invalid format', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const authority = { ...createSyntheticAuthorityEntry(keypair), authorityId: 'invalid authority id with spaces!' };
      const val = validateProductionAuthorityEntry(authority);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('INVALID_AUTHORITY_ID'))).toBe(true);
    });

    it('19. rejects synthetic authority entry if keyVersion has invalid format', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const authority = { ...createSyntheticAuthorityEntry(keypair), keyVersion: 'bad version with spaces!' };
      const val = validateProductionAuthorityEntry(authority);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('INVALID_KEY_VERSION'))).toBe(true);
    });

    it('20. rejects synthetic authority entry if algorithm is not Ed25519', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const authority = { ...createSyntheticAuthorityEntry(keypair), algorithm: 'RSA-4096' as any };
      const val = validateProductionAuthorityEntry(authority);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('INVALID_ALGORITHM'))).toBe(true);
    });

    it('21. rejects synthetic authority entry if public key PEM is corrupted', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const authority = { ...createSyntheticAuthorityEntry(keypair), publicKeyPem: 'not-a-valid-pem' };
      const val = validateProductionAuthorityEntry(authority);
      expect(val.valid).toBe(false);
    });

    it('22. rejects synthetic authority entry if fingerprint does not match computed PEM digest', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const authority = {
        ...createSyntheticAuthorityEntry(keypair),
        publicKeyFingerprintSha256: '0'.repeat(64),
      };
      const val = validateProductionAuthorityEntry(authority);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('FINGERPRINT_MISMATCH'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4: Synthetic 5N Canonical Provisioning Record Validation (Tests 23-30)
  // --------------------------------------------------------------------------
  describe('Section 4: Synthetic 5N Canonical Provisioning Record Validation', () => {
    it('23. validates synthetic canonical 5N provisioning record successfully', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const val = validateProductionTrustAnchorProvisioningRecord(record);
      expect(val.valid).toBe(true);
      expect(val.errors).toHaveLength(0);
    });

    it('24. rejects 5N record if ceremonyVersion is wrong', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = { ...createSyntheticProvisioningRecord(keypair), ceremonyVersion: 'wrong-ver' as any };
      const val = validateProductionTrustAnchorProvisioningRecord(record);
      expect(val.valid).toBe(false);
    });

    it('25. rejects 5N record if generatedOutsideRepository is false', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = { ...createSyntheticProvisioningRecord(keypair), generatedOutsideRepository: false as any };
      const val = validateProductionTrustAnchorProvisioningRecord(record);
      expect(val.valid).toBe(false);
    });

    it('26. rejects 5N record if privateKeyCommittedToRepository is true', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = { ...createSyntheticProvisioningRecord(keypair), privateKeyCommittedToRepository: true as any };
      const val = validateProductionTrustAnchorProvisioningRecord(record);
      expect(val.valid).toBe(false);
    });

    it('27. rejects 5N record if privateKeyAccessibleToApplication is true', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = { ...createSyntheticProvisioningRecord(keypair), privateKeyAccessibleToApplication: true as any };
      const val = validateProductionTrustAnchorProvisioningRecord(record);
      expect(val.valid).toBe(false);
    });

    it('28. rejects 5N record if custodyMode is not OFFLINE_OPERATOR_CUSTODY', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = { ...createSyntheticProvisioningRecord(keypair), privateKeyCustodyMode: 'CLOUD_HSM' as any };
      const val = validateProductionTrustAnchorProvisioningRecord(record);
      expect(val.valid).toBe(false);
    });

    it('29. rejects 5N record if operatorAcknowledgement does not match canonical phrase', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = { ...createSyntheticProvisioningRecord(keypair), operatorAcknowledgement: 'I_CONFIRM_KEY' as any };
      const val = validateProductionTrustAnchorProvisioningRecord(record);
      expect(val.valid).toBe(false);
    });

    it('30. rejects 5N record if provisioningRecordDigest is corrupted', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = { ...createSyntheticProvisioningRecord(keypair), provisioningRecordDigest: 'f'.repeat(64) };
      const val = validateProductionTrustAnchorProvisioningRecord(record);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('DIGEST_MISMATCH'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 5: Synthetic 5O Provisioning Candidate Validation (Tests 31-37)
  // --------------------------------------------------------------------------
  describe('Section 5: Synthetic 5O Provisioning Candidate Validation', () => {
    it('31. validates synthetic candidate pair successfully via validateProductionTrustAnchorProvisioningCandidate', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = createSyntheticCandidate(keypair);
      const val = validateProductionTrustAnchorProvisioningCandidate(candidate);
      expect(val.valid).toBe(true);
      expect(val.errors).toHaveLength(0);
      expect(val.candidate).toBeDefined();
    });

    it('32. rejects candidate if candidate is null or primitive', () => {
      const val = validateProductionTrustAnchorProvisioningCandidate(null);
      expect(val.valid).toBe(false);
    });

    it('33. rejects candidate if provisioningRecord is missing', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = { publicAuthorityEntry: createSyntheticAuthorityEntry(keypair) };
      const val = validateProductionTrustAnchorProvisioningCandidate(candidate);
      expect(val.valid).toBe(false);
    });

    it('34. rejects candidate if publicAuthorityEntry is missing', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = { provisioningRecord: createSyntheticProvisioningRecord(keypair) };
      const val = validateProductionTrustAnchorProvisioningCandidate(candidate);
      expect(val.valid).toBe(false);
    });

    it('35. rejects candidate if authorityId between record and authority entry diverges', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate: any = {
        provisioningRecord: createSyntheticProvisioningRecord(keypair),
        publicAuthorityEntry: { ...createSyntheticAuthorityEntry(keypair), authorityId: 'diverged-authority' },
      };
      const val = validateProductionTrustAnchorProvisioningCandidate(candidate);
      expect(val.valid).toBe(false);
    });

    it('36. rejects candidate if keyVersion between record and authority entry diverges', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate: any = {
        provisioningRecord: createSyntheticProvisioningRecord(keypair),
        publicAuthorityEntry: { ...createSyntheticAuthorityEntry(keypair), keyVersion: '2027-v2' },
      };
      const val = validateProductionTrustAnchorProvisioningCandidate(candidate);
      expect(val.valid).toBe(false);
    });

    it('37. rejects candidate if fingerprint between record and authority entry diverges', () => {
      const keypair1 = createEphemeralRehearsalKeypair();
      const keypair2 = createEphemeralRehearsalKeypair();
      const candidate: any = {
        provisioningRecord: createSyntheticProvisioningRecord(keypair1),
        publicAuthorityEntry: createSyntheticAuthorityEntry(keypair2),
      };
      const val = validateProductionTrustAnchorProvisioningCandidate(candidate);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('FINGERPRINT_MISMATCH'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 6: Synthetic 5O Manual Handoff Receipt & Digest Validation (Tests 38-46)
  // --------------------------------------------------------------------------
  describe('Section 6: Synthetic 5O Manual Handoff Receipt & Digest Validation', () => {
    it('38. validates synthetic manual handoff receipt successfully', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest);
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(true);
      expect(val.errors).toHaveLength(0);
      expect(val.receipt).toBeDefined();
    });

    it('39. rejects receipt if handoffVersion is wrong', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = { ...createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest), handoffVersion: 'wrong' as any };
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(false);
    });

    it('40. rejects receipt if slotVersion is wrong', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = { ...createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest), slotVersion: 'wrong' as any };
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(false);
    });

    it('41. rejects receipt if reviewedByOperator is not true', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = { ...createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest), reviewedByOperator: false as any };
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(false);
    });

    it('42. rejects receipt if privateKeyNeverEnteredRepository is false', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = { ...createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest), privateKeyNeverEnteredRepository: false as any };
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(false);
    });

    it('43. rejects receipt if privateKeyNeverEnteredApplicationRuntime is false', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = { ...createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest), privateKeyNeverEnteredApplicationRuntime: false as any };
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(false);
    });

    it('44. rejects receipt if privateKeyNeverEnteredAIAgentContext is false', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = { ...createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest), privateKeyNeverEnteredAIAgentContext: false as any };
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(false);
    });

    it('45. rejects receipt if handoffDigest does not match deterministic digest', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = { ...createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest), handoffDigest: '0'.repeat(64) };
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('HANDOFF_DIGEST_MISMATCH'))).toBe(true);
    });

    it('46. rejects receipt if unknown properties are present', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const record = createSyntheticProvisioningRecord(keypair);
      const receipt = { ...createSyntheticHandoffReceipt(keypair, record.provisioningRecordDigest), extraField: 'bad' };
      const val = validateProductionTrustAnchorManualHandoffReceipt(receipt);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 7: Candidate + Manual Handoff Cross-Binding Invariants (Tests 47-53)
  // --------------------------------------------------------------------------
  describe('Section 7: Candidate + Manual Handoff Cross-Binding Invariants', () => {
    it('47. validates combined candidate and receipt cross-binding successfully', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = createSyntheticCandidate(keypair);
      const receipt = createSyntheticHandoffReceipt(keypair, candidate.provisioningRecord.provisioningRecordDigest);
      const val = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
      expect(val.valid).toBe(true);
      expect(val.errors).toHaveLength(0);
      expect(val.candidate).toBeDefined();
      expect(val.receipt).toBeDefined();
    });

    it('48. cross-binding rejects mismatched authorityId between candidate and receipt', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = createSyntheticCandidate(keypair);
      const receipt = {
        ...createSyntheticHandoffReceipt(keypair, candidate.provisioningRecord.provisioningRecordDigest),
        authorityId: 'velnar-alt-authority' as any,
      };
      const val = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
      expect(val.valid).toBe(false);
    });

    it('49. cross-binding rejects mismatched keyVersion between candidate and receipt', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = createSyntheticCandidate(keypair);
      const receipt = {
        ...createSyntheticHandoffReceipt(keypair, candidate.provisioningRecord.provisioningRecordDigest),
        keyVersion: '2027-v1' as any,
      };
      const val = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
      expect(val.valid).toBe(false);
    });

    it('50. cross-binding rejects mismatched algorithm between candidate and receipt', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = createSyntheticCandidate(keypair);
      const receipt = {
        ...createSyntheticHandoffReceipt(keypair, candidate.provisioningRecord.provisioningRecordDigest),
        algorithm: 'ECDSA' as any,
      };
      const val = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
      expect(val.valid).toBe(false);
    });

    it('51. cross-binding rejects mismatched publicKeyFingerprintSha256 between candidate and receipt', () => {
      const keypair1 = createEphemeralRehearsalKeypair();
      const keypair2 = createEphemeralRehearsalKeypair();
      const candidate = createSyntheticCandidate(keypair1);
      const receipt = createSyntheticHandoffReceipt(keypair2, candidate.provisioningRecord.provisioningRecordDigest);
      const val = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('FINGERPRINT_CROSS_MISMATCH'))).toBe(true);
    });

    it('52. cross-binding rejects mismatched provisioningRecordDigest between candidate and receipt', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = createSyntheticCandidate(keypair);
      const receipt = createSyntheticHandoffReceipt(keypair, '1'.repeat(64));
      const val = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.includes('RECORD_DIGEST_CROSS_MISMATCH'))).toBe(true);
    });

    it('53. cross-binding fails immediately if prerequisites (candidate or receipt) are invalid', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const candidate = { ...createSyntheticCandidate(keypair), extra: 'invalid' };
      const receipt = createSyntheticHandoffReceipt(keypair, 'a'.repeat(64));
      const val = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
      expect(val.valid).toBe(false);
      expect(val.failureReason).toBe('CROSS_BINDING_PREREQUISITES_FAILED');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 8: End-to-End Pre-Provisioning Audit on Synthetic Rehearsal Chain (Tests 54-60)
  // --------------------------------------------------------------------------
  describe('Section 8: End-to-End Pre-Provisioning Audit on Synthetic Rehearsal Chain', () => {
    it('54. passes complete pre-provisioning rehearsal audit with valid synthetic inputs', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const result = runProductionTrustAnchorPreProvisioningAudit(auditInput);

      expect(result.passed).toBe(true);
      expect(result.auditVersion).toBe(PRE_PROVISIONING_AUDIT_VERSION);
      expect(result.candidateValid).toBe(true);
      expect(result.handoffReceiptValid).toBe(true);
      expect(result.candidateReceiptCrossBindingValid).toBe(true);
      expect(result.productionRegistryEmpty).toBe(true);
      expect(result.productionTrustAnchorUnprovisioned).toBe(true);
      expect(result.provisioningReadinessFalse).toBe(true);
      expect(result.slotReadyFalse).toBe(true);
      expect(result.slotPopulatedFalse).toBe(true);
      expect(result.sourceAttestationReadinessFalse).toBe(true);
      expect(result.humanAuthorizationReadinessFalse).toBe(true);
      expect(result.liveExecutionFalse).toBe(true);
      expect(result.authorizesProvisioning).toBe(false);
      expect(result.errors).toHaveLength(0);
    });

    it('55. pre-provisioning audit returns structured errors if candidate is invalid', () => {
      const { auditInput, keypair } = createSyntheticFullAuditChain();
      const corruptedCandidate = {
        ...auditInput.candidate,
        publicAuthorityEntry: { ...auditInput.candidate.publicAuthorityEntry, publicKeyPem: 'bad' },
      };
      const result = runProductionTrustAnchorPreProvisioningAudit({
        candidate: corruptedCandidate,
        handoffReceipt: auditInput.handoffReceipt,
      });

      expect(result.passed).toBe(false);
      expect(result.candidateValid).toBe(false);
      expect(result.authorizesProvisioning).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('56. pre-provisioning audit returns structured errors if handoff receipt is invalid', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const corruptedReceipt = {
        ...auditInput.handoffReceipt,
        handoffDigest: 'e'.repeat(64),
      };
      const result = runProductionTrustAnchorPreProvisioningAudit({
        candidate: auditInput.candidate,
        handoffReceipt: corruptedReceipt,
      });

      expect(result.passed).toBe(false);
      expect(result.handoffReceiptValid).toBe(false);
      expect(result.authorizesProvisioning).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('57. pre-provisioning audit returns structured errors if cross-binding diverges', () => {
      const keypair1 = createEphemeralRehearsalKeypair();
      const keypair2 = createEphemeralRehearsalKeypair();
      const candidate = createSyntheticCandidate(keypair1);
      const receipt = createSyntheticHandoffReceipt(keypair2, candidate.provisioningRecord.provisioningRecordDigest);

      const result = runProductionTrustAnchorPreProvisioningAudit({ candidate, handoffReceipt: receipt });
      expect(result.passed).toBe(false);
      expect(result.candidateReceiptCrossBindingValid).toBe(false);
      expect(result.authorizesProvisioning).toBe(false);
    });

    it('58. pre-provisioning audit requires both candidate and handoff to be valid before cross-binding is evaluated', () => {
      const result = runProductionTrustAnchorPreProvisioningAudit({
        candidate: { invalid: true },
        handoffReceipt: { invalid: true },
      });
      expect(result.passed).toBe(false);
      expect(result.candidateValid).toBe(false);
      expect(result.handoffReceiptValid).toBe(false);
      expect(result.candidateReceiptCrossBindingValid).toBe(false);
    });

    it('59. pre-provisioning audit result preserves auditVersion exactly', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const result = runProductionTrustAnchorPreProvisioningAudit(auditInput);
      expect(result.auditVersion).toBe('a12b2c5p-v1');
    });

    it('60. pre-provisioning audit is purely deterministic across multiple executions', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const r1 = runProductionTrustAnchorPreProvisioningAudit(auditInput);
      const r2 = runProductionTrustAnchorPreProvisioningAudit(auditInput);
      expect(r1).toEqual(r2);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 9: Non-Authoritative Invariant: Passing Audit NEVER Authorizes Provisioning (Tests 61-65)
  // --------------------------------------------------------------------------
  describe('Section 9: Non-Authoritative Invariant: Passing Audit NEVER Authorizes Provisioning', () => {
    it('61. confirms authorizesProvisioning is strictly false when passed is true', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const result = runProductionTrustAnchorPreProvisioningAudit(auditInput);
      expect(result.passed).toBe(true);
      expect(result.authorizesProvisioning).toBe(false);
    });

    it('62. confirms authorizesProvisioning is strictly false when passed is false', () => {
      const result = runProductionTrustAnchorPreProvisioningAudit({});
      expect(result.passed).toBe(false);
      expect(result.authorizesProvisioning).toBe(false);
    });

    it('63. verifies PRE_PROVISIONING_AUDIT_CAN_AUTHORIZE_PROVISIONING matches result field strictly', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      const result = runProductionTrustAnchorPreProvisioningAudit(auditInput);
      expect(result.authorizesProvisioning).toBe(PRE_PROVISIONING_AUDIT_CAN_AUTHORIZE_PROVISIONING);
    });

    it('64. confirms audit execution does not write or mutate any slot storage', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      runProductionTrustAnchorPreProvisioningAudit(auditInput);
      expect(PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED).toBe(false);
      expect(PRODUCTION_TRUST_ANCHOR_SLOT_READY).toBe(false);
    });

    it('65. confirms audit execution does not alter production trust registry', () => {
      const { auditInput } = createSyntheticFullAuditChain();
      runProductionTrustAnchorPreProvisioningAudit(auditInput);
      expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY.length).toBe(0);
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 10: Immutable Production-State Fail-Closed Verification (Tests 66-74)
  // --------------------------------------------------------------------------
  describe('Section 10: Immutable Production-State Fail-Closed Verification', () => {
    it('66. verifies PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED is strictly false', () => {
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('67. verifies PRODUCTION_HUMAN_AUTHORITY_REGISTRY is strictly empty (length 0)', () => {
      expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toHaveLength(0);
      expect(Array.isArray(PRODUCTION_HUMAN_AUTHORITY_REGISTRY)).toBe(true);
    });

    it('68. verifies PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY is strictly false', () => {
      expect(PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY).toBe(false);
    });

    it('69. verifies PRODUCTION_TRUST_ANCHOR_SLOT_READY is strictly false', () => {
      expect(PRODUCTION_TRUST_ANCHOR_SLOT_READY).toBe(false);
    });

    it('70. verifies PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED is strictly false', () => {
      expect(PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED).toBe(false);
    });

    it('71. verifies CANARY_LIVE_EXECUTION_ENABLED is strictly false', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('72. verifies GUARDED_SOURCE_ATTESTATION_READY is strictly false', () => {
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
    });

    it('73. verifies GUARDED_HUMAN_AUTH_ATTESTATION_READY is strictly false', () => {
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
    });

    it('74. verifies PRODUCTION_KEY_ROTATION_IMPLEMENTED is strictly false', () => {
      expect(PRODUCTION_KEY_ROTATION_IMPLEMENTED).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 11: Synthetic 5L Cryptographic Rehearsal: Generic Verifier vs Production Verifier (Tests 75-80)
  // --------------------------------------------------------------------------
  describe('Section 11: Synthetic 5L Cryptographic Rehearsal: Generic Verifier vs Production Verifier', () => {
    it('75. generic 5L verifier successfully verifies synthetic package when ephemeral authority descriptor is explicitly provided', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_BASE_COMMIT,
        sourceTreeSha: TEST_BASE_TREE,
        createdAt: '2026-09-06T12:00:00.000Z',
      });
      const signedPackage = createSyntheticSignedAuthorizationPackage(keypair, attestation);

      const authorityDescriptor: HumanAuthorizationAuthorityDescriptor = {
        authorityId: CANONICAL_TARGET_AUTHORITY_ID,
        keyVersion: CANONICAL_TARGET_KEY_VERSION,
        algorithm: CANONICAL_TARGET_ALGORITHM,
        publicKeyPem: keypair.publicKeyPem,
        publicKeyFingerprintSha256: keypair.publicKeyFingerprintSha256,
      };

      const result = verifyHumanAuthorizationPackage(signedPackage, authorityDescriptor, {
        sourceAttestation: attestation,
        nowUtc: new Date('2026-09-06T12:05:00.000Z'),
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.authorizationPackageDigest).toBeDefined();
    });

    it('76. production 5M verifier strictly FAILS CLOSED on the same synthetic package because registry is unprovisioned', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_BASE_COMMIT,
        sourceTreeSha: TEST_BASE_TREE,
        createdAt: '2026-09-06T12:00:00.000Z',
      });
      const signedPackage = createSyntheticSignedAuthorizationPackage(keypair, attestation);

      const prodResult = verifyProductionHumanAuthorizationPackage(signedPackage, attestation);
      expect(prodResult.verified).toBe(false);
      expect(prodResult.failureReason).toBe('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED');
      expect(prodResult.errors.some(e => e.includes('PRODUCTION_AUTHORITY_TRUST_ANCHOR_NOT_PROVISIONED'))).toBe(true);
    });

    it('77. generic verifier rejects synthetic package if signature is tampered', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_BASE_COMMIT,
        sourceTreeSha: TEST_BASE_TREE,
        createdAt: '2026-09-06T12:00:00.000Z',
      });
      const signedPackage = createSyntheticSignedAuthorizationPackage(keypair, attestation);

      // Mutate signature
      const tamperedPackage = {
        ...signedPackage,
        signatureBase64: Buffer.from('corrupted-signature-bytes').toString('base64'),
      };

      const authorityDescriptor: HumanAuthorizationAuthorityDescriptor = {
        authorityId: CANONICAL_TARGET_AUTHORITY_ID,
        keyVersion: CANONICAL_TARGET_KEY_VERSION,
        algorithm: CANONICAL_TARGET_ALGORITHM,
        publicKeyPem: keypair.publicKeyPem,
        publicKeyFingerprintSha256: keypair.publicKeyFingerprintSha256,
      };

      const result = verifyHumanAuthorizationPackage(tamperedPackage, authorityDescriptor, {
        sourceAttestation: attestation,
        nowUtc: new Date('2026-09-06T12:05:00.000Z'),
      });

      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('SIGNATURE_VERIFICATION_FAILED');
    });

    it('78. generic verifier rejects synthetic package if payload is tampered', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_BASE_COMMIT,
        sourceTreeSha: TEST_BASE_TREE,
        createdAt: '2026-09-06T12:00:00.000Z',
      });
      const signedPackage = createSyntheticSignedAuthorizationPackage(keypair, attestation);

      // Tamper maxBudgetMicroUsd in payload without re-signing
      const tamperedPayload = {
        ...signedPackage.payload,
        maxBudgetMicroUsd: signedPackage.payload.maxBudgetMicroUsd + 1000,
      };

      const tamperedPackage = {
        ...signedPackage,
        payload: tamperedPayload,
      };

      const authorityDescriptor: HumanAuthorizationAuthorityDescriptor = {
        authorityId: CANONICAL_TARGET_AUTHORITY_ID,
        keyVersion: CANONICAL_TARGET_KEY_VERSION,
        algorithm: CANONICAL_TARGET_ALGORITHM,
        publicKeyPem: keypair.publicKeyPem,
        publicKeyFingerprintSha256: keypair.publicKeyFingerprintSha256,
      };

      const result = verifyHumanAuthorizationPackage(tamperedPackage, authorityDescriptor, {
        sourceAttestation: attestation,
        nowUtc: new Date('2026-09-06T12:05:00.000Z'),
      });

      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('SIGNATURE_VERIFICATION_FAILED');
    });

    it('79. generic verifier rejects synthetic package verified against a different public key', () => {
      const keypair1 = createEphemeralRehearsalKeypair();
      const keypair2 = createEphemeralRehearsalKeypair();
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_BASE_COMMIT,
        sourceTreeSha: TEST_BASE_TREE,
        createdAt: '2026-09-06T12:00:00.000Z',
      });
      const signedPackage = createSyntheticSignedAuthorizationPackage(keypair1, attestation);

      const wrongAuthorityDescriptor: HumanAuthorizationAuthorityDescriptor = {
        authorityId: CANONICAL_TARGET_AUTHORITY_ID,
        keyVersion: CANONICAL_TARGET_KEY_VERSION,
        algorithm: CANONICAL_TARGET_ALGORITHM,
        publicKeyPem: keypair2.publicKeyPem,
        publicKeyFingerprintSha256: keypair2.publicKeyFingerprintSha256,
      };

      const result = verifyHumanAuthorizationPackage(signedPackage, wrongAuthorityDescriptor, {
        sourceAttestation: attestation,
        nowUtc: new Date('2026-09-06T12:05:00.000Z'),
      });

      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('SIGNATURE_VERIFICATION_FAILED');
    });

    it('80. generic verifier rejects synthetic package when evaluated after expiry time', () => {
      const keypair = createEphemeralRehearsalKeypair();
      const attestation = buildTrustedSourceAttestation({
        sourceCommitSha: TEST_BASE_COMMIT,
        sourceTreeSha: TEST_BASE_TREE,
        createdAt: '2026-09-06T12:00:00.000Z',
      });
      const signedPackage = createSyntheticSignedAuthorizationPackage(keypair, attestation);

      const authorityDescriptor: HumanAuthorizationAuthorityDescriptor = {
        authorityId: CANONICAL_TARGET_AUTHORITY_ID,
        keyVersion: CANONICAL_TARGET_KEY_VERSION,
        algorithm: CANONICAL_TARGET_ALGORITHM,
        publicKeyPem: keypair.publicKeyPem,
        publicKeyFingerprintSha256: keypair.publicKeyFingerprintSha256,
      };

      // expiresAt is 12:10:00, evaluating at 12:11:00
      const result = verifyHumanAuthorizationPackage(signedPackage, authorityDescriptor, {
        sourceAttestation: attestation,
        nowUtc: new Date('2026-09-06T12:11:00.000Z'),
      });

      expect(result.valid).toBe(false);
      expect(result.failureReason).toContain('AUTHORIZATION_EXPIRED');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 12: Boundary Isolation & Environment Safety (Tests 81-85)
  // --------------------------------------------------------------------------
  describe('Section 12: Boundary Isolation & Environment Safety', () => {
    it('81. verifies zero network calls occurred throughout rehearsal', () => {
      expect(globalFetchCalls).toBe(0);
    });

    it('82. verifies no operational key generation function exists in audit module', async () => {
      const auditModule = await import('../../worker/ai/canary/deepSeekProductionTrustAnchorPreProvisioningAudit');
      expect((auditModule as any).generateKeyPair).toBeUndefined();
      expect((auditModule as any).generateKeyPairSync).toBeUndefined();
      expect((auditModule as any).createPrivateKey).toBeUndefined();
    });

    it('83. verifies no signing function exists in audit module', async () => {
      const auditModule = await import('../../worker/ai/canary/deepSeekProductionTrustAnchorPreProvisioningAudit');
      expect((auditModule as any).sign).toBeUndefined();
      expect((auditModule as any).issueAuthorization).toBeUndefined();
    });

    it('84. verifies production registry cannot be mutated via array push in frozen/sealed checks', () => {
      expect(Object.isFrozen(PRODUCTION_HUMAN_AUTHORITY_REGISTRY)).toBe(true);
      expect(() => {
        (PRODUCTION_HUMAN_AUTHORITY_REGISTRY as any).push({});
      }).toThrow();
    });

    it('85. verifies final rehearsal state leaves system safely offline and fail-closed', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
      expect(PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED).toBe(false);
    });
  });
});
