/**
 * @file tests/ai/phaseA12B2C5NProductionTrustAnchorProvisioning.test.ts
 * @description VELNAR — Phase A.12B.2C-5N Production Human Authorization Trust-Anchor Provisioning Ceremony Contract Test Suite.
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
  PROVISIONING_CEREMONY_CONTRACT_VERSION,
  PRODUCTION_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_CEREMONY_EXECUTED,
  PRODUCTION_PRIVATE_KEY_EMBEDDED,
  PRODUCTION_SIGNING_ISSUER_IMPLEMENTED,
  CANONICAL_PROVISIONING_ALGORITHM,
  MINIMUM_CEREMONY_WITNESS_COUNT,
  EXACT_CEREMONY_CONTRACT_KEYS,
  EXACT_CEREMONY_WITNESS_KEYS,
  EXACT_EXECUTED_CEREMONY_RECORD_KEYS,
  CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
  validateProvisioningCeremonyContract,
  validateCeremonyWitness,
  validateExecutedCeremonyRecord,
  resolveProvisionedProductionTrustAnchor,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';
import * as provisioningModule from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';

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

describe('Phase A.12B.2C-5N: Production Human Authorization Trust-Anchor Provisioning Ceremony Contract', () => {
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
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const fingerprint = computePublicKeyFingerprintSha256(pubPem);
    return { pubPem, fingerprint };
  }

  // ==========================================================================
  // SUITE 1: Ceremony Contract Constants and State
  // ==========================================================================

  it('1. ceremony contract version exact', () => {
    expect(PROVISIONING_CEREMONY_CONTRACT_VERSION).toBe('a12b2c5n-v1');
  });

  it('2. production trust anchor provisioned is strictly false', () => {
    expect(PRODUCTION_TRUST_ANCHOR_PROVISIONED).toBe(false);
  });

  it('3. production ceremony executed is strictly false', () => {
    expect(PRODUCTION_CEREMONY_EXECUTED).toBe(false);
  });

  it('4. production private key embedded is strictly false', () => {
    expect(PRODUCTION_PRIVATE_KEY_EMBEDDED).toBe(false);
  });

  it('5. production signing issuer implemented is strictly false', () => {
    expect(PRODUCTION_SIGNING_ISSUER_IMPLEMENTED).toBe(false);
  });

  it('6. canonical provisioning algorithm is strictly Ed25519', () => {
    expect(CANONICAL_PROVISIONING_ALGORITHM).toBe('Ed25519');
  });

  it('7. minimum ceremony witness count is 3', () => {
    expect(MINIMUM_CEREMONY_WITNESS_COUNT).toBe(3);
  });

  it('8. canonical contract is immutable and contains required properties', () => {
    expect(Object.isFrozen(CANONICAL_PROVISIONING_CEREMONY_CONTRACT)).toBe(true);
    expect(CANONICAL_PROVISIONING_CEREMONY_CONTRACT.ceremonyVersion).toBe('a12b2c5n-v1');
    expect(CANONICAL_PROVISIONING_CEREMONY_CONTRACT.ceremonyId).toBe('ceremony-a12b2c5n-anchor-genesis');
  });

  it('9. canonical contract requires AIR_GAPPED_OFFLINE isolation', () => {
    expect(CANONICAL_PROVISIONING_CEREMONY_CONTRACT.isolationLevel).toBe('AIR_GAPPED_OFFLINE');
  });

  it('10. canonical contract requireAirGapConfirmation is true', () => {
    expect(CANONICAL_PROVISIONING_CEREMONY_CONTRACT.requireAirGapConfirmation).toBe(true);
  });

  it('11. canonical contract requireHardwareEntropy is true', () => {
    expect(CANONICAL_PROVISIONING_CEREMONY_CONTRACT.requireHardwareEntropy).toBe(true);
  });

  it('12. canonical contract prohibitKeyPersistenceOnDisk is true', () => {
    expect(CANONICAL_PROVISIONING_CEREMONY_CONTRACT.prohibitKeyPersistenceOnDisk).toBe(true);
  });

  // ==========================================================================
  // SUITE 2: Ceremony Contract Validation
  // ==========================================================================

  it('13. validateProvisioningCeremonyContract passes on canonical contract', () => {
    const result = validateProvisioningCeremonyContract(CANONICAL_PROVISIONING_CEREMONY_CONTRACT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('14. validateProvisioningCeremonyContract rejects null or non-object', () => {
    expect(validateProvisioningCeremonyContract(null).valid).toBe(false);
    expect(validateProvisioningCeremonyContract('string').valid).toBe(false);
    expect(validateProvisioningCeremonyContract([]).valid).toBe(false);
  });

  it('15. validateProvisioningCeremonyContract rejects unknown properties', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      unauthorizedField: true,
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('UNKNOWN_CONTRACT_PROPERTY'))).toBe(true);
  });

  it('16. validateProvisioningCeremonyContract rejects inherited properties', () => {
    const proto = { ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT };
    const candidate = Object.create(proto);
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('17. validateProvisioningCeremonyContract rejects wrong ceremonyVersion', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      ceremonyVersion: 'v2-unsupported',
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CEREMONY_VERSION'))).toBe(true);
  });

  it('18. validateProvisioningCeremonyContract rejects empty ceremonyId', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      ceremonyId: '',
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CEREMONY_ID'))).toBe(true);
  });

  it('19. validateProvisioningCeremonyContract rejects invalid scheduledEpochUtc', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      scheduledEpochUtc: 'not-a-timestamp',
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_SCHEDULED_EPOCH'))).toBe(true);
  });

  it('20. validateProvisioningCeremonyContract rejects invalid isolationLevel', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      isolationLevel: 'CONNECTED_NETWORK',
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_ISOLATION_LEVEL'))).toBe(true);
  });

  it('21. validateProvisioningCeremonyContract rejects non-Ed25519 target algorithm', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      targetAlgorithm: 'RSA-4096',
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_TARGET_ALGORITHM'))).toBe(true);
  });

  it('22. validateProvisioningCeremonyContract rejects witness count less than minimum', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      minimumWitnessCount: 2,
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_MINIMUM_WITNESS_COUNT'))).toBe(true);
  });

  it('23. validateProvisioningCeremonyContract rejects non-integer witness count', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      minimumWitnessCount: 3.5,
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_MINIMUM_WITNESS_COUNT'))).toBe(true);
  });

  it('24. validateProvisioningCeremonyContract rejects requireAirGapConfirmation !== true', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      requireAirGapConfirmation: false,
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AIR_GAP_CONFIRMATION_REQUIRED'))).toBe(true);
  });

  it('25. validateProvisioningCeremonyContract rejects requireHardwareEntropy !== true', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      requireHardwareEntropy: false,
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('HARDWARE_ENTROPY_REQUIRED'))).toBe(true);
  });

  it('26. validateProvisioningCeremonyContract rejects prohibitKeyPersistenceOnDisk !== true', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      prohibitKeyPersistenceOnDisk: false,
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('KEY_PERSISTENCE_PROHIBITION_REQUIRED'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 3: Witness Schema Validation
  // ==========================================================================

  it('27. validateCeremonyWitness passes on valid synthetic witness', () => {
    const witness = {
      witnessId: 'witness-lead-sec-01',
      role: 'SECURITY_OFFICER',
      organization: 'Velnar Security Council',
      confirmedFingerprintSha256: 'a'.repeat(64),
      signedAttestationSha256: 'b'.repeat(64),
    };
    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('28. validateCeremonyWitness rejects null/primitive', () => {
    expect(validateCeremonyWitness(null).valid).toBe(false);
    expect(validateCeremonyWitness(123).valid).toBe(false);
  });

  it('29. validateCeremonyWitness rejects unknown property', () => {
    const witness = {
      witnessId: 'witness-01',
      role: 'ATTESTING_WITNESS',
      organization: 'Org',
      confirmedFingerprintSha256: 'a'.repeat(64),
      signedAttestationSha256: 'b'.repeat(64),
      extraUnauthorized: 1,
    };
    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('UNKNOWN_WITNESS_PROPERTY'))).toBe(true);
  });

  it('30. validateCeremonyWitness rejects inherited property', () => {
    const proto = { witnessId: 'witness-01' };
    const witness = Object.create(proto);
    witness.role = 'COMPLIANCE_AUDITOR';
    witness.organization = 'Org';
    witness.confirmedFingerprintSha256 = 'a'.repeat(64);
    witness.signedAttestationSha256 = 'b'.repeat(64);

    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('31. validateCeremonyWitness rejects empty witnessId', () => {
    const witness = {
      witnessId: '',
      role: 'ATTESTING_WITNESS',
      organization: 'Org',
      confirmedFingerprintSha256: 'a'.repeat(64),
      signedAttestationSha256: 'b'.repeat(64),
    };
    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_WITNESS_ID'))).toBe(true);
  });

  it('32. validateCeremonyWitness rejects invalid role', () => {
    const witness = {
      witnessId: 'witness-01',
      role: 'OBSERVER_GUEST',
      organization: 'Org',
      confirmedFingerprintSha256: 'a'.repeat(64),
      signedAttestationSha256: 'b'.repeat(64),
    };
    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_WITNESS_ROLE'))).toBe(true);
  });

  it('33. validateCeremonyWitness rejects empty organization', () => {
    const witness = {
      witnessId: 'witness-01',
      role: 'COMPLIANCE_AUDITOR',
      organization: '',
      confirmedFingerprintSha256: 'a'.repeat(64),
      signedAttestationSha256: 'b'.repeat(64),
    };
    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_WITNESS_ORGANIZATION'))).toBe(true);
  });

  it('34. validateCeremonyWitness rejects non-hex confirmedFingerprintSha256', () => {
    const witness = {
      witnessId: 'witness-01',
      role: 'COMPLIANCE_AUDITOR',
      organization: 'Org',
      confirmedFingerprintSha256: 'not-hex',
      signedAttestationSha256: 'b'.repeat(64),
    };
    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CONFIRMED_FINGERPRINT'))).toBe(true);
  });

  it('35. validateCeremonyWitness rejects uppercase confirmedFingerprintSha256', () => {
    const witness = {
      witnessId: 'witness-01',
      role: 'COMPLIANCE_AUDITOR',
      organization: 'Org',
      confirmedFingerprintSha256: 'A'.repeat(64),
      signedAttestationSha256: 'b'.repeat(64),
    };
    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CONFIRMED_FINGERPRINT'))).toBe(true);
  });

  it('36. validateCeremonyWitness rejects non-hex signedAttestationSha256', () => {
    const witness = {
      witnessId: 'witness-01',
      role: 'COMPLIANCE_AUDITOR',
      organization: 'Org',
      confirmedFingerprintSha256: 'a'.repeat(64),
      signedAttestationSha256: 'invalid',
    };
    const result = validateCeremonyWitness(witness);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_SIGNED_ATTESTATION'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 4: Executed Ceremony Record Validation
  // ==========================================================================

  it('37. validateExecutedCeremonyRecord passes on valid synthetic record', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [
        {
          witnessId: 'witness-01',
          role: 'SECURITY_OFFICER',
          organization: 'Velnar Security',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'd'.repeat(64),
        },
        {
          witnessId: 'witness-02',
          role: 'ATTESTING_WITNESS',
          organization: 'Independent Trust Foundation',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'e'.repeat(64),
        },
        {
          witnessId: 'witness-03',
          role: 'COMPLIANCE_AUDITOR',
          organization: 'Audit Systems Global',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'f'.repeat(64),
        },
      ],
    };

    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('38. validateExecutedCeremonyRecord rejects null/primitive', () => {
    expect(validateExecutedCeremonyRecord(null).valid).toBe(false);
  });

  it('39. validateExecutedCeremonyRecord rejects unknown property', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [],
      unauthorizedField: true,
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('UNKNOWN_RECORD_PROPERTY'))).toBe(true);
  });

  it('40. validateExecutedCeremonyRecord rejects inherited property', () => {
    const proto = { ceremonyId: 'ceremony-a12b2c5n-anchor-genesis' };
    const record = Object.create(proto);
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISSING_OWN_PROPERTY'))).toBe(true);
  });

  it('41. validateExecutedCeremonyRecord rejects mismatched ceremonyVersion', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v2-wrong',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CEREMONY_VERSION_MISMATCH'))).toBe(true);
  });

  it('42. validateExecutedCeremonyRecord rejects mismatched ceremonyId', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'wrong-ceremony-id',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CEREMONY_ID_MISMATCH'))).toBe(true);
  });

  it('43. validateExecutedCeremonyRecord rejects invalid completedAt timestamp', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-02-30T00:00:00.000Z', // invalid date
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_COMPLETED_AT'))).toBe(true);
  });

  it('44. validateExecutedCeremonyRecord rejects airGapVerified !== true', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: false,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AIR_GAP_NOT_VERIFIED'))).toBe(true);
  });

  it('45. validateExecutedCeremonyRecord rejects invalid transcript hash', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'not-a-sha256',
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_TRANSCRIPT_HASH'))).toBe(true);
  });

  it('46. validateExecutedCeremonyRecord rejects anchor authorityId mismatch', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'wrong-authority-id',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ANCHOR_AUTHORITY_ID_MISMATCH'))).toBe(true);
  });

  it('47. validateExecutedCeremonyRecord rejects anchor keyVersion mismatch', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: 'wrong-version',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ANCHOR_KEY_VERSION_MISMATCH'))).toBe(true);
  });

  it('48. validateExecutedCeremonyRecord rejects fewer than minimum witnesses', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [
        {
          witnessId: 'witness-01',
          role: 'SECURITY_OFFICER',
          organization: 'Org',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'd'.repeat(64),
        },
      ],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INSUFFICIENT_WITNESSES'))).toBe(true);
  });

  it('49. validateExecutedCeremonyRecord rejects duplicate witness IDs', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [
        {
          witnessId: 'witness-01',
          role: 'SECURITY_OFFICER',
          organization: 'Org',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'd'.repeat(64),
        },
        {
          witnessId: 'witness-01', // duplicate ID
          role: 'ATTESTING_WITNESS',
          organization: 'Org',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'e'.repeat(64),
        },
        {
          witnessId: 'witness-03',
          role: 'COMPLIANCE_AUDITOR',
          organization: 'Org',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'f'.repeat(64),
        },
      ],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('DUPLICATE_WITNESS_ID'))).toBe(true);
  });

  it('50. validateExecutedCeremonyRecord rejects witness with mismatched confirmed fingerprint', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis',
      ceremonyVersion: 'a12b2c5n-v1',
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: 'velnar-lead-ops-prod',
        keyVersion: '2026-v1',
        algorithm: 'Ed25519',
        publicKeyFingerprintSha256: fingerprint,
        publicKeyPem: pubPem,
      },
      witnesses: [
        {
          witnessId: 'witness-01',
          role: 'SECURITY_OFFICER',
          organization: 'Org',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'd'.repeat(64),
        },
        {
          witnessId: 'witness-02',
          role: 'ATTESTING_WITNESS',
          organization: 'Org',
          confirmedFingerprintSha256: '0'.repeat(64), // mismatched fingerprint
          signedAttestationSha256: 'e'.repeat(64),
        },
        {
          witnessId: 'witness-03',
          role: 'COMPLIANCE_AUDITOR',
          organization: 'Org',
          confirmedFingerprintSha256: fingerprint,
          signedAttestationSha256: 'f'.repeat(64),
        },
      ],
    };
    const result = validateExecutedCeremonyRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('WITNESS_FINGERPRINT_MISMATCH'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 5: Fail-Closed Production Resolution API
  // ==========================================================================

  it('51. resolveProvisionedProductionTrustAnchor unconditionally fails closed', () => {
    const result = resolveProvisionedProductionTrustAnchor();
    expect(result.provisioned).toBe(false);
    expect(result.anchor).toBeUndefined();
    expect(result.failureReason).toBe('TRUST_ANCHOR_PROVISIONING_CEREMONY_NOT_EXECUTED');
    expect(result.errors.some(e => e.includes('TRUST_ANCHOR_PROVISIONING_CEREMONY_NOT_EXECUTED'))).toBe(true);
  });

  // ==========================================================================
  // SUITE 6: Static Security & Invariants
  // ==========================================================================

  it('52. static scan confirms zero forbidden strings or tokens in module source', () => {
    const modulePath = path.resolve(
      __dirname,
      '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning.ts'
    );
    const code = fs.readFileSync(modulePath, 'utf8');

    expect(code.includes('BEGIN PRIVATE KEY')).toBe(false);
    expect(code.includes('BEGIN OPENSSH PRIVATE KEY')).toBe(false);
    expect(code.includes('PRIVATE KEY-----')).toBe(false);
    expect(code.includes('DEEPSEEK_API_KEY')).toBe(false);
    expect(code.includes('capabilitySecret')).toBe(false);
    expect(code.includes('process.env')).toBe(false);
    expect(code.includes('fetch(')).toBe(false);
    expect(code.includes('axios')).toBe(false);
    expect(code.includes('undici')).toBe(false);
    expect(code.includes('node:http')).toBe(false);
    expect(code.includes('node:https')).toBe(false);
    expect(code.includes('node:net')).toBe(false);
  });

  it('53. no signing API exports in provisioning module', () => {
    const forbidden = [
      'issueHumanAuthorization',
      'signHumanAuthorization',
      'generateKeyPair',
      'generateProductionKey',
      'createPrivateKey',
      'sign',
    ];
    for (const exp of forbidden) {
      expect((provisioningModule as any)[exp]).toBeUndefined();
    }
  });

  it('54. CANARY_LIVE_EXECUTION_ENABLED remains strictly false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
  });

  it('55. GUARDED_SOURCE_ATTESTATION_READY remains strictly false', () => {
    expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
  });

  it('56. GUARDED_HUMAN_AUTH_ATTESTATION_READY remains strictly false', () => {
    expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
  });

  it('57. total provider network calls during test suite execution is exactly 0', () => {
    expect(globalFetchCalls).toBe(0);
  });
});
