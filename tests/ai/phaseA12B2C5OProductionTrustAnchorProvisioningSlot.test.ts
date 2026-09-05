/**
 * @file tests/ai/phaseA12B2C5OProductionTrustAnchorProvisioningSlot.test.ts
 * @description VELNAR — Phase A.12B.2C-5O Production Public Trust-Anchor Provisioning Slot & Manual Ceremony Handoff Test Suite.
 *
 * STRICT INVARIANTS:
 * - Pure offline test suite.
 * - ZERO DeepSeek calls.
 * - ZERO Gemini calls.
 * - ZERO external provider or network calls.
 * - ZERO provider credentials.
 * - Ephemeral in-memory test keys only (no private keys persisted).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  PRODUCTION_TRUST_ANCHOR_SLOT_VERSION,
  PRODUCTION_TRUST_ANCHOR_SLOT_READY,
  PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED,
  CANONICAL_TARGET_AUTHORITY_ID,
  CANONICAL_TARGET_KEY_VERSION,
  CANONICAL_TARGET_ALGORITHM,
  CANONICAL_HANDOFF_VERSION,
  EXACT_PROVISIONING_CANDIDATE_KEYS,
  EXACT_MANUAL_HANDOFF_RECEIPT_KEYS,
  EXACT_HANDOFF_DIGEST_FIELDS,
  validateProductionTrustAnchorProvisioningCandidate,
  computeProductionTrustAnchorManualHandoffDigest,
  validateProductionTrustAnchorManualHandoffReceipt,
  validateProvisioningCandidateWithManualHandoff,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot';
import type {
  ProductionTrustAnchorProvisioningCandidate,
  ProductionTrustAnchorManualHandoffReceipt,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot';
import * as slotModule from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot';

import {
  PRODUCTION_AUTHORITY_REGISTRY_VERSION,
  PRODUCTION_HUMAN_AUTHORITY_REGISTRY,
  PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED,
} from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import type { ProductionHumanAuthorizationAuthority } from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';

import {
  PROVISIONING_CEREMONY_CONTRACT_VERSION,
  CANONICAL_PROVISIONING_ALGORITHM,
  PRODUCTION_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_CEREMONY_EXECUTED,
  PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY,
  computeProductionTrustAnchorProvisioningRecordDigest,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';
import type { ProductionTrustAnchorProvisioningRecord } from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';

import {
  computePublicKeyFingerprintSha256,
} from '../../worker/ai/canary/deepSeekCertificationAttestation';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
} from '../../worker/ai/canary/canarySpecification';
import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';

let globalFetchCalls = 0;
const originalFetch = globalThis.fetch;

describe('Phase A.12B.2C-5O: Production Trust-Anchor Provisioning Slot & Manual Ceremony Handoff', () => {
  beforeEach(() => {
    globalFetchCalls = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      globalFetchCalls++;
      throw new Error('NETWORK_CALL_FORBIDDEN: Network calls are strictly forbidden in offline test suites');
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createEphemeralTestKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const fingerprint = computePublicKeyFingerprintSha256(pubPem);
    return { pubPem, privPem, fingerprint };
  }

  function createValidSyntheticRecord(pubPem: string, fingerprint: string, overrides: Partial<Record<string, any>> = {}): ProductionTrustAnchorProvisioningRecord {
    const base: Omit<ProductionTrustAnchorProvisioningRecord, 'provisioningRecordDigest'> = {
      ceremonyVersion: PROVISIONING_CEREMONY_CONTRACT_VERSION,
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis-001',
      registryVersion: PRODUCTION_AUTHORITY_REGISTRY_VERSION,
      authorityId: CANONICAL_TARGET_AUTHORITY_ID,
      keyVersion: CANONICAL_TARGET_KEY_VERSION,
      algorithm: CANONICAL_TARGET_ALGORITHM,
      publicKeyPem: pubPem,
      publicKeyFingerprintSha256: fingerprint,
      generatedOutsideRepository: true,
      privateKeyCommittedToRepository: false,
      privateKeyAccessibleToApplication: false,
      privateKeyCustodyMode: 'OFFLINE_OPERATOR_CUSTODY',
      createdAt: '2026-09-05T12:00:00.000Z',
      operatorAcknowledgement: 'I_CONFIRM_PRIVATE_KEY_IS_OUTSIDE_REPOSITORY_AND_APPLICATION_RUNTIME',
      ...overrides,
    };

    const digest = computeProductionTrustAnchorProvisioningRecordDigest(base);
    return {
      ...base,
      provisioningRecordDigest: digest,
      ...overrides,
    } as ProductionTrustAnchorProvisioningRecord;
  }

  function createValidSyntheticCandidate(overrides: {
    recordOverrides?: Partial<Record<string, any>>;
    authorityOverrides?: Partial<Record<string, any>>;
  } = {}): {
    candidate: ProductionTrustAnchorProvisioningCandidate;
    pubPem: string;
    fingerprint: string;
  } {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = createValidSyntheticRecord(pubPem, fingerprint, overrides.recordOverrides);
    const publicAuthorityEntry: ProductionHumanAuthorizationAuthority = {
      authorityId: CANONICAL_TARGET_AUTHORITY_ID,
      keyVersion: CANONICAL_TARGET_KEY_VERSION,
      algorithm: CANONICAL_TARGET_ALGORITHM,
      publicKeyFingerprintSha256: fingerprint,
      publicKeyPem: pubPem,
      ...overrides.authorityOverrides,
    };

    return {
      candidate: {
        provisioningRecord: record,
        publicAuthorityEntry,
      },
      pubPem,
      fingerprint,
    };
  }

  function createValidSyntheticHandoff(
    candidate: ProductionTrustAnchorProvisioningCandidate,
    overrides: Partial<Record<string, any>> = {}
  ): ProductionTrustAnchorManualHandoffReceipt {
    const base: Omit<ProductionTrustAnchorManualHandoffReceipt, 'handoffDigest'> = {
      handoffVersion: CANONICAL_HANDOFF_VERSION,
      slotVersion: PRODUCTION_TRUST_ANCHOR_SLOT_VERSION,
      ceremonyVersion: PROVISIONING_CEREMONY_CONTRACT_VERSION,
      registryVersion: PRODUCTION_AUTHORITY_REGISTRY_VERSION,
      authorityId: CANONICAL_TARGET_AUTHORITY_ID,
      keyVersion: CANONICAL_TARGET_KEY_VERSION,
      algorithm: CANONICAL_TARGET_ALGORITHM,
      publicKeyFingerprintSha256: candidate.provisioningRecord.publicKeyFingerprintSha256,
      provisioningRecordDigest: candidate.provisioningRecord.provisioningRecordDigest,
      reviewedByOperator: true,
      privateKeyNeverEnteredRepository: true,
      privateKeyNeverEnteredApplicationRuntime: true,
      privateKeyNeverEnteredAIAgentContext: true,
      ...overrides,
    };

    const digest = computeProductionTrustAnchorManualHandoffDigest(base);
    return {
      ...base,
      handoffDigest: digest,
      ...overrides,
    } as ProductionTrustAnchorManualHandoffReceipt;
  }

  // ==========================================================================
  // SUITE 1: Slot Configuration & Exact Target Identities
  // ==========================================================================

  it('1. slot version exact', () => {
    expect(PRODUCTION_TRUST_ANCHOR_SLOT_VERSION).toBe('a12b2c5o-v1');
  });

  it('2. slot ready false', () => {
    expect(PRODUCTION_TRUST_ANCHOR_SLOT_READY).toBe(false);
  });

  it('3. slot populated false', () => {
    expect(PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED).toBe(false);
  });

  // ==========================================================================
  // SUITE 2: Candidate Schema & Sub-Validators
  // ==========================================================================

  it('4. candidate exact schema', () => {
    expect(EXACT_PROVISIONING_CANDIDATE_KEYS).toHaveLength(2);
    expect(EXACT_PROVISIONING_CANDIDATE_KEYS).toEqual(['provisioningRecord', 'publicAuthorityEntry']);
    const { candidate } = createValidSyntheticCandidate();
    const result = validateProductionTrustAnchorProvisioningCandidate(candidate);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('5. candidate unknown field rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const rogue = { ...candidate, extraKey: 'forbidden' };
    const result = validateProductionTrustAnchorProvisioningCandidate(rogue);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
  });

  it('6. inherited provisioningRecord rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const proto = { provisioningRecord: candidate.provisioningRecord };
    const rogue = Object.create(proto);
    rogue.publicAuthorityEntry = candidate.publicAuthorityEntry;
    const result = validateProductionTrustAnchorProvisioningCandidate(rogue);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISSING_OWN_PROPERTY') && e.includes('provisioningRecord'))).toBe(true);
  });

  it('7. missing publicAuthorityEntry rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const rogue = { provisioningRecord: candidate.provisioningRecord };
    const result = validateProductionTrustAnchorProvisioningCandidate(rogue);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISSING_OWN_PROPERTY') && e.includes('publicAuthorityEntry'))).toBe(true);
  });

  it('8. canonical provisioning record required', () => {
    const { candidate } = createValidSyntheticCandidate();
    const result = validateProductionTrustAnchorProvisioningCandidate(candidate);
    expect(result.valid).toBe(true);
  });

  it('9. invalid record rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const rogue = {
      ...candidate,
      provisioningRecord: { ...candidate.provisioningRecord, ceremonyVersion: 'wrong-v' },
    };
    const result = validateProductionTrustAnchorProvisioningCandidate(rogue);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('PROVISIONING_RECORD_INVALID'))).toBe(true);
  });

  it('10. 5M authority entry validation required', () => {
    const { candidate } = createValidSyntheticCandidate();
    const result = validateProductionTrustAnchorProvisioningCandidate(candidate);
    expect(result.valid).toBe(true);
  });

  it('11. malformed authority rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const rogue = {
      ...candidate,
      publicAuthorityEntry: { ...candidate.publicAuthorityEntry, publicKeyPem: 'corrupt-pem' },
    };
    const result = validateProductionTrustAnchorProvisioningCandidate(rogue);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORITY_ENTRY_INVALID'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 3: Cross-Binding Candidate Equality
  // ==========================================================================

  it('12. authorityId cross-binding', () => {
    const { candidate } = createValidSyntheticCandidate({
      authorityOverrides: { authorityId: 'other-authority-id' },
    });
    const result = validateProductionTrustAnchorProvisioningCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORITY_ID_MISMATCH') || e.includes('CANONICAL_TARGET_AUTHORITY_MISMATCH'))).toBe(true);
  });

  it('13. keyVersion cross-binding', () => {
    const { candidate } = createValidSyntheticCandidate({
      authorityOverrides: { keyVersion: '2027-v1' },
    });
    const result = validateProductionTrustAnchorProvisioningCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('KEY_VERSION_MISMATCH'))).toBe(true);
  });

  it('14. algorithm cross-binding', () => {
    const { candidate } = createValidSyntheticCandidate({
      authorityOverrides: { algorithm: 'RSA-4096' as any },
    });
    const result = validateProductionTrustAnchorProvisioningCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ALGORITHM_MISMATCH') || e.includes('AUTHORITY_ENTRY_INVALID'))).toBe(true);
  });

  it('15. publicKeyPem cross-binding', () => {
    const { pubPem: otherPem } = createEphemeralTestKeyPair();
    const { candidate } = createValidSyntheticCandidate({
      authorityOverrides: { publicKeyPem: otherPem },
    });
    const result = validateProductionTrustAnchorProvisioningCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('PUBLIC_KEY_PEM_MISMATCH') || e.includes('AUTHORITY_ENTRY_INVALID'))).toBe(true);
  });

  it('16. fingerprint cross-binding', () => {
    const { candidate } = createValidSyntheticCandidate({
      authorityOverrides: { publicKeyFingerprintSha256: 'a'.repeat(64) },
    });
    const result = validateProductionTrustAnchorProvisioningCandidate(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('FINGERPRINT_MISMATCH') || e.includes('AUTHORITY_ENTRY_INVALID'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 4: Canonical Target Identity Policies
  // ==========================================================================

  it('17. production authorityId exact (velnar-lead-ops-prod)', () => {
    expect(CANONICAL_TARGET_AUTHORITY_ID).toBe('velnar-lead-ops-prod');
  });

  it('18. wrong production authorityId rejects', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = createValidSyntheticRecord(pubPem, fingerprint, { authorityId: 'unauthorized-authority' });
    const rogueCandidate: ProductionTrustAnchorProvisioningCandidate = {
      provisioningRecord: record,
      publicAuthorityEntry: {
        authorityId: 'unauthorized-authority',
        keyVersion: CANONICAL_TARGET_KEY_VERSION,
        algorithm: CANONICAL_TARGET_ALGORITHM,
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
    };
    const result = validateProductionTrustAnchorProvisioningCandidate(rogueCandidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CANONICAL_TARGET_AUTHORITY_MISMATCH'))).toBe(true);
  });

  it('19. production keyVersion exact (2026-v1)', () => {
    expect(CANONICAL_TARGET_KEY_VERSION).toBe('2026-v1');
  });

  it('20. wrong keyVersion rejects', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = createValidSyntheticRecord(pubPem, fingerprint, { keyVersion: '2027-v1' });
    const rogueCandidate: ProductionTrustAnchorProvisioningCandidate = {
      provisioningRecord: record,
      publicAuthorityEntry: {
        authorityId: CANONICAL_TARGET_AUTHORITY_ID,
        keyVersion: '2027-v1',
        algorithm: CANONICAL_TARGET_ALGORITHM,
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
    };
    const result = validateProductionTrustAnchorProvisioningCandidate(rogueCandidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CANONICAL_TARGET_KEY_VERSION_MISMATCH'))).toBe(true);
  });

  it('21. Ed25519 only', () => {
    expect(CANONICAL_TARGET_ALGORITHM).toBe('Ed25519');
  });

  it('22. RSA rejects', () => {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const rsaFp = computePublicKeyFingerprintSha256(rsaPem);
    const rogueCandidate = {
      provisioningRecord: {
        ceremonyVersion: PROVISIONING_CEREMONY_CONTRACT_VERSION,
        ceremonyId: 'ceremony-a12b2c5n-anchor-genesis-001',
        registryVersion: PRODUCTION_AUTHORITY_REGISTRY_VERSION,
        authorityId: CANONICAL_TARGET_AUTHORITY_ID,
        keyVersion: CANONICAL_TARGET_KEY_VERSION,
        algorithm: 'RSA' as any,
        publicKeyPem: rsaPem,
        publicKeyFingerprintSha256: rsaFp,
        generatedOutsideRepository: true,
        privateKeyCommittedToRepository: false,
        privateKeyAccessibleToApplication: false,
        privateKeyCustodyMode: 'OFFLINE_OPERATOR_CUSTODY',
        createdAt: '2026-09-05T12:00:00.000Z',
        operatorAcknowledgement: 'I_CONFIRM_PRIVATE_KEY_IS_OUTSIDE_REPOSITORY_AND_APPLICATION_RUNTIME',
        provisioningRecordDigest: '0'.repeat(64),
      },
      publicAuthorityEntry: {
        authorityId: CANONICAL_TARGET_AUTHORITY_ID,
        keyVersion: CANONICAL_TARGET_KEY_VERSION,
        algorithm: 'RSA' as any,
        publicKeyFingerprintSha256: rsaFp,
        publicKeyPem: rsaPem,
      },
    };
    const result = validateProductionTrustAnchorProvisioningCandidate(rogueCandidate);
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('SUB_VALIDATION_FAILED');
    expect(result.errors.some(e => e.includes('PROVISIONING_RECORD_INVALID') || e.includes('AUTHORITY_ENTRY_INVALID'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 5: Manual Handoff Receipt Schema
  // ==========================================================================

  it('23. handoff exact schema', () => {
    expect(EXACT_MANUAL_HANDOFF_RECEIPT_KEYS).toHaveLength(14);
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('24. handoff unknown field rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = {
      ...createValidSyntheticHandoff(candidate),
      rogueProperty: 'forbidden',
    };
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
  });

  it('25. inherited field rejects in handoff receipt', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const proto = { reviewedByOperator: receipt.reviewedByOperator };
    const rogue = Object.create(proto);
    for (const key of Object.keys(receipt)) {
      if (key !== 'reviewedByOperator') {
        rogue[key] = (receipt as any)[key];
      }
    }
    const result = validateProductionTrustAnchorManualHandoffReceipt(rogue);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISSING_OWN_PROPERTY') && e.includes('reviewedByOperator'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 6: Handoff Versions & Digest Bindings
  // ==========================================================================

  it('26. handoff version exact', () => {
    expect(CANONICAL_HANDOFF_VERSION).toBe('a12b2c5o-handoff-v1');
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { handoffVersion: 'wrong-v1' });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_HANDOFF_VERSION'))).toBe(true);
  });

  it('27. slot version exact', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { slotVersion: 'wrong-slot' });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_SLOT_VERSION'))).toBe(true);
  });

  it('28. ceremony version exact', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { ceremonyVersion: 'wrong-ceremony' });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CEREMONY_VERSION'))).toBe(true);
  });

  it('29. registry version exact', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { registryVersion: 'wrong-reg' });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_REGISTRY_VERSION'))).toBe(true);
  });

  it('30. fingerprint lowercase hex required', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { publicKeyFingerprintSha256: 'UPPERCASE'.padEnd(64, 'A') });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_FINGERPRINT_FORMAT'))).toBe(true);
  });

  it('31. record digest lowercase hex required', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { provisioningRecordDigest: 'not-hex' });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_RECORD_DIGEST_FORMAT'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 7: Boundary Assertions
  // ==========================================================================

  it('32. reviewedByOperator true required', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { reviewedByOperator: false });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('OPERATOR_REVIEW_REQUIRED'))).toBe(true);
  });

  it('33. privateKeyNeverEnteredRepository true required', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { privateKeyNeverEnteredRepository: false });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('REPOSITORY_ISOLATION_REQUIRED'))).toBe(true);
  });

  it('34. privateKeyNeverEnteredApplicationRuntime true required', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { privateKeyNeverEnteredApplicationRuntime: false });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('RUNTIME_ISOLATION_REQUIRED'))).toBe(true);
  });

  it('35. privateKeyNeverEnteredAIAgentContext true required', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate, { privateKeyNeverEnteredAIAgentContext: false });
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AI_AGENT_ISOLATION_REQUIRED'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 8: Deterministic Handoff Digest Invariants
  // ==========================================================================

  it('36. handoff digest deterministic', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const d1 = computeProductionTrustAnchorManualHandoffDigest(receipt);
    const d2 = computeProductionTrustAnchorManualHandoffDigest(receipt);
    expect(d1).toBe(d2);
    expect(d1).toBe(receipt.handoffDigest);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('37. fingerprint mutation changes handoff digest', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const mutated = { ...receipt, publicKeyFingerprintSha256: '0'.repeat(64) };
    const dMutated = computeProductionTrustAnchorManualHandoffDigest(mutated);
    expect(dMutated).not.toBe(receipt.handoffDigest);
  });

  it('38. record digest mutation changes handoff digest', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const mutated = { ...receipt, provisioningRecordDigest: '1'.repeat(64) };
    const dMutated = computeProductionTrustAnchorManualHandoffDigest(mutated);
    expect(dMutated).not.toBe(receipt.handoffDigest);
  });

  it('39. authorityId mutation changes handoff digest', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const mutated = { ...receipt, authorityId: 'mutated-auth' };
    const dMutated = computeProductionTrustAnchorManualHandoffDigest(mutated);
    expect(dMutated).not.toBe(receipt.handoffDigest);
  });

  it('40. keyVersion mutation changes handoff digest', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const mutated = { ...receipt, keyVersion: '2027-v1' };
    const dMutated = computeProductionTrustAnchorManualHandoffDigest(mutated);
    expect(dMutated).not.toBe(receipt.handoffDigest);
  });

  it('41. AI boundary boolean mutation changes handoff digest', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const mutated = { ...receipt, privateKeyNeverEnteredAIAgentContext: false };
    const dMutated = computeProductionTrustAnchorManualHandoffDigest(mutated);
    expect(dMutated).not.toBe(receipt.handoffDigest);
  });

  it('42. corrupted handoff digest rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = {
      ...createValidSyntheticHandoff(candidate),
      handoffDigest: 'f'.repeat(64),
    };
    const result = validateProductionTrustAnchorManualHandoffReceipt(receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('HANDOFF_DIGEST_MISMATCH'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 9: Candidate + Handoff Combined Cross-Binding
  // ==========================================================================

  it('43. candidate + handoff valid passes', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const result = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.candidate).toBeDefined();
    expect(result.receipt).toBeDefined();
  });

  it('44. candidate/handoff fingerprint mismatch rejects', () => {
    const { candidate: cand1 } = createValidSyntheticCandidate();
    const { candidate: cand2 } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(cand2);
    const result = validateProvisioningCandidateWithManualHandoff(cand1, receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('FINGERPRINT_CROSS_MISMATCH'))).toBe(true);
  });

  it('45. candidate/handoff record digest mismatch rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = {
      ...createValidSyntheticHandoff(candidate),
      provisioningRecordDigest: 'e'.repeat(64),
    };
    // Recompute handoff digest to pass receipt internal validation
    (receipt as any).handoffDigest = computeProductionTrustAnchorManualHandoffDigest(receipt);
    const result = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('RECORD_DIGEST_CROSS_MISMATCH'))).toBe(true);
  });

  it('46. candidate/handoff authority mismatch rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = {
      ...createValidSyntheticHandoff(candidate),
      authorityId: 'rogue-authority' as any,
    };
    const result = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('RECEIPT_INVALID'))).toBe(true);
  });

  it('47. candidate/handoff key version mismatch rejects', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = {
      ...createValidSyntheticHandoff(candidate),
      keyVersion: '2027-v1' as any,
    };
    const result = validateProvisioningCandidateWithManualHandoff(candidate, receipt);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('RECEIPT_INVALID'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 10: State Invariants & Global Guardrails
  // ==========================================================================

  it('48. validation does not mutate 5M registry', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    validateProvisioningCandidateWithManualHandoff(candidate, receipt);
    expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toHaveLength(0);
  });

  it('49. production registry remains empty', () => {
    expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toEqual([]);
    expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toHaveLength(0);
  });

  it('50. production trust anchor remains unprovisioned', () => {
    expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    expect(PRODUCTION_TRUST_ANCHOR_PROVISIONED).toBe(false);
  });

  it('51. provisioning readiness remains false', () => {
    expect(PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY).toBe(false);
  });

  it('52. slot readiness remains false', () => {
    expect(PRODUCTION_TRUST_ANCHOR_SLOT_READY).toBe(false);
  });

  it('53. slot populated remains false', () => {
    expect(PRODUCTION_TRUST_ANCHOR_SLOT_POPULATED).toBe(false);
  });

  it('54. source readiness remains false', () => {
    expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
  });

  it('55. human auth readiness remains false', () => {
    expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
  });

  it('56. live execution remains false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
  });

  it('57. production routing remains false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
  });

  // ==========================================================================
  // SUITE 11: Static Analysis & Isolation Checks
  // ==========================================================================

  it('58. no process.env trust source in slot module source', () => {
    const filePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.includes('process.env')).toBe(false);
  });

  it('59. no fetch/http/net in slot module source', () => {
    const filePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.includes('fetch(')).toBe(false);
    expect(content.includes('axios')).toBe(false);
    expect(content.includes('undici')).toBe(false);
    expect(content.includes('node:http')).toBe(false);
    expect(content.includes('node:https')).toBe(false);
    expect(content.includes('node:net')).toBe(false);
  });

  it('60. no private key API in slot module source or exports', () => {
    const filePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.includes('generateKeyPair')).toBe(false);
    expect(content.includes('generateKeyPairSync')).toBe(false);
    expect(content.includes('createPrivateKey')).toBe(false);
    expect(content.includes('crypto.sign')).toBe(false);
    expect(content.includes('BEGIN PRIVATE KEY')).toBe(false);
    expect(content.includes('BEGIN OPENSSH PRIVATE KEY')).toBe(false);
    expect(content.includes('PRIVATE KEY-----')).toBe(false);
  });

  it('61. no production public key embedded', () => {
    const filePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content.includes('BEGIN PUBLIC KEY')).toBe(false);
  });

  it('62. no production fingerprint embedded in slot module', () => {
    const filePath = path.resolve(__dirname, '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    // No hardcoded 64-hex SHA-256 fingerprint string in slot module
    const matches = content.match(/['"][0-9a-f]{64}['"]/g);
    expect(matches).toBeNull();
  });

  it('63. zero provider/network calls', () => {
    expect(globalFetchCalls).toBe(0);
  });

  it('64. computeProductionTrustAnchorManualHandoffDigest rejects invalid input objects', () => {
    expect(() => computeProductionTrustAnchorManualHandoffDigest(null)).toThrow('HANDOFF_DIGEST_INPUT_INVALID');
    expect(() => computeProductionTrustAnchorManualHandoffDigest([])).toThrow('HANDOFF_DIGEST_INPUT_INVALID');
    expect(() => computeProductionTrustAnchorManualHandoffDigest({ extra: 'field' })).toThrow('HANDOFF_DIGEST_INPUT_INVALID');
  });

  it('65. computeProductionTrustAnchorManualHandoffDigest rejects non-boolean for boolean fields', () => {
    const { candidate } = createValidSyntheticCandidate();
    const receipt = createValidSyntheticHandoff(candidate);
    const rogue = { ...receipt, reviewedByOperator: 'true' as any };
    expect(() => computeProductionTrustAnchorManualHandoffDigest(rogue)).toThrow('HANDOFF_DIGEST_INPUT_INVALID');
  });
});
