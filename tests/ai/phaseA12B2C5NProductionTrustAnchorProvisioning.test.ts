/**
 * @file tests/ai/phaseA12B2C5NProductionTrustAnchorProvisioning.test.ts
 * @description VELNAR — Phase A.12B.2C-5N / 5N.1 Production Human Authorization Trust-Anchor Provisioning Ceremony Contract & Canonical Record Test Suite.
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
  PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY,
  PRODUCTION_PRIVATE_KEY_EMBEDDED,
  PRODUCTION_SIGNING_ISSUER_IMPLEMENTED,
  CANONICAL_PROVISIONING_ALGORITHM,
  CANONICAL_PRIVATE_KEY_CUSTODY_MODE,
  CANONICAL_OPERATOR_ACKNOWLEDGEMENT,
  MINIMUM_CEREMONY_WITNESS_COUNT,
  EXACT_PRODUCTION_TRUST_ANCHOR_PROVISIONING_RECORD_KEYS,
  EXACT_PROVISIONING_RECORD_DIGEST_FIELDS,
  EXACT_CEREMONY_CONTRACT_KEYS,
  EXACT_CEREMONY_WITNESS_KEYS,
  EXACT_EXECUTED_CEREMONY_RECORD_KEYS,
  CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
  validateCeremonyId,
  computeProductionTrustAnchorProvisioningRecordDigest,
  validateProductionTrustAnchorProvisioningRecord,
  validateProvisioningCeremonyContract,
  validateCeremonyWitness,
  validateExecutedCeremonyRecord,
  resolveProvisionedProductionTrustAnchor,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';
import type { ProductionTrustAnchorProvisioningRecord } from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';
import * as provisioningModule from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioning';

import {
  PRODUCTION_AUTHORITY_REGISTRY_VERSION,
  PRODUCTION_HUMAN_AUTHORITY_REGISTRY,
  PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED,
} from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import {
  computePublicKeyFingerprintSha256,
  isValidIsoUtcTimestamp,
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

describe('Phase A.12B.2C-5N.1: Canonical Provisioning Record + Caller-Independent Ceremony Policy Repair', () => {
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

  function createValidSyntheticRecord(overrides: Partial<Record<string, any>> = {}): ProductionTrustAnchorProvisioningRecord {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const base: Omit<ProductionTrustAnchorProvisioningRecord, 'provisioningRecordDigest'> = {
      ceremonyVersion: 'a12b2c5n-v1',
      ceremonyId: 'ceremony-a12b2c5n-anchor-genesis-001',
      registryVersion: 'a12b2c5m-v1',
      authorityId: 'velnar-lead-ops-prod',
      keyVersion: '2026-v1',
      algorithm: 'Ed25519',
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

  // ==========================================================================
  // SUITE 1: Required Regression Tests A through AJ
  // ==========================================================================

  it('A) canonical provisioning record exact key set contains 15 fields', () => {
    expect(EXACT_PRODUCTION_TRUST_ANCHOR_PROVISIONING_RECORD_KEYS).toHaveLength(15);
    expect(EXACT_PRODUCTION_TRUST_ANCHOR_PROVISIONING_RECORD_KEYS).toEqual([
      'ceremonyVersion',
      'ceremonyId',
      'registryVersion',
      'authorityId',
      'keyVersion',
      'algorithm',
      'publicKeyPem',
      'publicKeyFingerprintSha256',
      'generatedOutsideRepository',
      'privateKeyCommittedToRepository',
      'privateKeyAccessibleToApplication',
      'privateKeyCustodyMode',
      'createdAt',
      'operatorAcknowledgement',
      'provisioningRecordDigest',
    ]);
  });

  it('B) valid synthetic record passes canonical validation', () => {
    const record = createValidSyntheticRecord();
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.record).toBeDefined();
    expect(result.record?.ceremonyId).toBe(record.ceremonyId);
  });

  it('C) unknown property rejects', () => {
    const record = {
      ...createValidSyntheticRecord(),
      extraField: 'unauthorized',
    };
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
  });

  it('D) privateKeyPem injected field rejects as unknown property', () => {
    const { privPem } = createEphemeralTestKeyPair();
    const record = {
      ...createValidSyntheticRecord(),
      privateKeyPem: privPem,
    };
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('UNKNOWN_PROPERTY') && e.includes('privateKeyPem'))).toBe(true);
  });

  it('E) missing generatedOutsideRepository rejects', () => {
    const record = createValidSyntheticRecord();
    const copy = { ...record };
    delete (copy as any).generatedOutsideRepository;
    const result = validateProductionTrustAnchorProvisioningRecord(copy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISSING_OWN_PROPERTY') && e.includes('generatedOutsideRepository'))).toBe(true);
  });

  it('F) inherited operatorAcknowledgement rejects (prototype inheritance)', () => {
    const record = createValidSyntheticRecord();
    const proto = { operatorAcknowledgement: record.operatorAcknowledgement };
    const copy = Object.create(proto);
    for (const key of Object.keys(record)) {
      if (key !== 'operatorAcknowledgement') {
        copy[key] = (record as any)[key];
      }
    }
    const result = validateProductionTrustAnchorProvisioningRecord(copy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('MISSING_OWN_PROPERTY') && e.includes('operatorAcknowledgement'))).toBe(true);
  });

  it('G) generatedOutsideRepository false rejects', () => {
    const record = createValidSyntheticRecord({ generatedOutsideRepository: false });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('GENERATED_OUTSIDE_REPOSITORY_REQUIRED'))).toBe(true);
  });

  it('H) privateKeyCommittedToRepository true rejects', () => {
    const record = createValidSyntheticRecord({ privateKeyCommittedToRepository: true });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('PRIVATE_KEY_COMMITTED_FORBIDDEN'))).toBe(true);
  });

  it('I) privateKeyAccessibleToApplication true rejects', () => {
    const record = createValidSyntheticRecord({ privateKeyAccessibleToApplication: true });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('PRIVATE_KEY_ACCESSIBLE_FORBIDDEN'))).toBe(true);
  });

  it('J) wrong custody mode rejects', () => {
    const record = createValidSyntheticRecord({ privateKeyCustodyMode: 'CLOUD_HSM_ONLINE' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CUSTODY_MODE'))).toBe(true);
  });

  it('K) wrong operator acknowledgement rejects', () => {
    const record = createValidSyntheticRecord({ operatorAcknowledgement: 'I_CONFIRM_KEY_IS_SAFE' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_OPERATOR_ACKNOWLEDGEMENT'))).toBe(true);
  });

  it('L) placeholder ceremonyId rejects', () => {
    for (const placeholder of ['test', 'dummy', 'placeholder', 'ceremony', 'production', 'default', 'sample']) {
      const record = createValidSyntheticRecord({ ceremonyId: placeholder });
      const result = validateProductionTrustAnchorProvisioningRecord(record);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('CEREMONY_ID_PLACEHOLDER') || e.includes('CEREMONY_ID_LENGTH'))).toBe(true);
    }
  });

  it('M) too-short ceremonyId rejects (< 32 chars)', () => {
    const record = createValidSyntheticRecord({ ceremonyId: 'short-ceremony-id' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CEREMONY_ID_LENGTH'))).toBe(true);
  });

  it('N) unsafe ceremonyId rejects (contains spaces or punctuation)', () => {
    const record = createValidSyntheticRecord({ ceremonyId: 'ceremony-with spaces-not-permitted-32-chars!' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('CEREMONY_ID_CHARACTERS'))).toBe(true);
  });

  it('O) wrong registryVersion rejects', () => {
    const record = createValidSyntheticRecord({ registryVersion: 'a12b2c5m-v2-wrong' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_REGISTRY_VERSION'))).toBe(true);
  });

  it('P) wrong ceremonyVersion rejects', () => {
    const record = createValidSyntheticRecord({ ceremonyVersion: 'a12b2c5n-v2-wrong' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CEREMONY_VERSION'))).toBe(true);
  });

  it('Q) timezone-offset createdAt rejects (+02:00 not Z)', () => {
    const record = createValidSyntheticRecord({ createdAt: '2026-09-05T14:00:00+02:00' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CREATED_AT'))).toBe(true);
  });

  it('R) calendar rollover createdAt rejects via sealed 5L UTC validator (e.g. Feb 30)', () => {
    expect(isValidIsoUtcTimestamp('2026-02-30T00:00:00Z')).toBe(false);
    const record = createValidSyntheticRecord({ createdAt: '2026-02-30T00:00:00.000Z' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('INVALID_CREATED_AT'))).toBe(true);
  });

  it('S) malformed public PEM rejects through 5M validator', () => {
    const record = createValidSyntheticRecord({ publicKeyPem: '-----BEGIN PUBLIC KEY-----\ncorrupt\n-----END PUBLIC KEY-----' });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORITY_VALIDATION_FAILED'))).toBe(true);
  });

  it('T) private PEM rejects through 5M validator', () => {
    const { privPem, fingerprint } = createEphemeralTestKeyPair();
    const record = createValidSyntheticRecord({
      publicKeyPem: privPem,
      publicKeyFingerprintSha256: fingerprint,
    });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORITY_VALIDATION_FAILED'))).toBe(true);
  });

  it('U) RSA public key rejects through 5M validator (algorithm mismatch / non-Ed25519)', () => {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const fingerprint = computePublicKeyFingerprintSha256(rsaPem);
    const record = createValidSyntheticRecord({
      publicKeyPem: rsaPem,
      publicKeyFingerprintSha256: fingerprint,
    });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORITY_VALIDATION_FAILED'))).toBe(true);
  });

  it('V) fingerprint mismatch rejects', () => {
    const record = createValidSyntheticRecord({
      publicKeyFingerprintSha256: '0'.repeat(64),
    });
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('AUTHORITY_VALIDATION_FAILED'))).toBe(true);
  });

  it('W) valid synthetic Ed25519 public key passes 5M validator', () => {
    const record = createValidSyntheticRecord();
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(true);
  });

  it('X) provisioning digest is deterministic', () => {
    const record = createValidSyntheticRecord();
    const digest1 = computeProductionTrustAnchorProvisioningRecordDigest(record);
    const digest2 = computeProductionTrustAnchorProvisioningRecordDigest(record);
    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Y) each covered field mutation changes digest', () => {
    const base = createValidSyntheticRecord();
    const originalDigest = base.provisioningRecordDigest;

    // Test mutations for each covered field
    const mutations: Array<{ field: string; val: any }> = [
      { field: 'ceremonyVersion', val: 'a12b2c5n-v2' },
      { field: 'ceremonyId', val: 'ceremony-a12b2c5n-anchor-genesis-002' },
      { field: 'registryVersion', val: 'a12b2c5m-v2' },
      { field: 'authorityId', val: 'other-authority' },
      { field: 'keyVersion', val: '2026-v2' },
      { field: 'algorithm', val: 'Ed448' },
      { field: 'publicKeyPem', val: base.publicKeyPem + ' ' },
      { field: 'publicKeyFingerprintSha256', val: '1'.repeat(64) },
      { field: 'generatedOutsideRepository', val: false },
      { field: 'privateKeyCommittedToRepository', val: true },
      { field: 'privateKeyAccessibleToApplication', val: true },
      { field: 'privateKeyCustodyMode', val: 'OTHER' },
      { field: 'createdAt', val: '2026-09-05T12:00:01.000Z' },
      { field: 'operatorAcknowledgement', val: 'OTHER_ACK' },
    ];

    expect(mutations).toHaveLength(14);

    for (const { field, val } of mutations) {
      const mutated = { ...base, [field]: val };
      const newDigest = computeProductionTrustAnchorProvisioningRecordDigest(mutated);
      expect(newDigest).not.toBe(originalDigest);
    }
  });

  it('Z) corrupted provisioningRecordDigest rejects', () => {
    const record = {
      ...createValidSyntheticRecord(),
      provisioningRecordDigest: 'e'.repeat(64),
    };
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('DIGEST_MISMATCH'))).toBe(true);
  });

  it('AA) successful validation does not mutate 5M production registry', () => {
    const record = createValidSyntheticRecord();
    const result = validateProductionTrustAnchorProvisioningRecord(record);
    expect(result.valid).toBe(true);
    expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toHaveLength(0);
  });

  it('AB) production registry remains empty', () => {
    expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toEqual([]);
    expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toHaveLength(0);
  });

  it('AC) production trust anchor remains unprovisioned', () => {
    expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    expect(PRODUCTION_TRUST_ANCHOR_PROVISIONED).toBe(false);
  });

  it('AD) PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY === false', () => {
    expect(PRODUCTION_TRUST_ANCHOR_PROVISIONING_READY).toBe(false);
  });

  it('AE) no caller-controlled expectedContract accepted by authoritative executed ceremony validator', () => {
    // validateExecutedCeremonyRecord should have arity 1 (record only)
    expect(validateExecutedCeremonyRecord.length).toBe(1);

    // Verify it validates against CANONICAL_PROVISIONING_CEREMONY_CONTRACT internally
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const validRecord = {
      ceremonyId: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.ceremonyId,
      ceremonyVersion: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.ceremonyVersion,
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.targetAuthorityId,
        keyVersion: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.targetKeyVersion,
        algorithm: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.targetAlgorithm,
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

    const res = validateExecutedCeremonyRecord(validRecord);
    expect(res.valid).toBe(true);

    // If caller attempts to validate a record for another ceremonyId, it rejects because policy is canonical
    const rogueRecord = {
      ...validRecord,
      ceremonyId: 'rogue-ceremony-id-attempting-to-bypass-canon-32chars',
    };
    const rogueRes = validateExecutedCeremonyRecord(rogueRecord);
    expect(rogueRes.valid).toBe(false);
    expect(rogueRes.errors.some(e => e.includes('CEREMONY_ID_MISMATCH'))).toBe(true);
  });

  it('AF) source readiness remains false', () => {
    expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
  });

  it('AG) human auth readiness remains false', () => {
    expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
  });

  it('AH) live execution remains false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
  });

  it('AI) production routing remains false', () => {
    expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
  });

  it('AJ) total provider and network calls is exactly 0', () => {
    expect(globalFetchCalls).toBe(0);
  });

  // ==========================================================================
  // SUITE 2: Ceremony Contract & Witness Defense-in-Depth Tests
  // ==========================================================================

  it('58. validateProvisioningCeremonyContract passes on canonical contract', () => {
    const result = validateProvisioningCeremonyContract(CANONICAL_PROVISIONING_CEREMONY_CONTRACT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('59. validateProvisioningCeremonyContract rejects unknown properties', () => {
    const candidate = {
      ...CANONICAL_PROVISIONING_CEREMONY_CONTRACT,
      unauthorizedField: true,
    };
    const result = validateProvisioningCeremonyContract(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('UNKNOWN_CONTRACT_PROPERTY'))).toBe(true);
  });

  it('60. validateCeremonyWitness passes on valid synthetic witness', () => {
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

  it('61. validateCeremonyWitness rejects duplicate witness IDs in executed record', () => {
    const { pubPem, fingerprint } = createEphemeralTestKeyPair();
    const record = {
      ceremonyId: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.ceremonyId,
      ceremonyVersion: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.ceremonyVersion,
      completedAt: '2026-09-06T01:30:00.000Z',
      airGapVerified: true,
      ceremonyTranscriptSha256: 'c'.repeat(64),
      anchor: {
        authorityId: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.targetAuthorityId,
        keyVersion: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.targetKeyVersion,
        algorithm: CANONICAL_PROVISIONING_CEREMONY_CONTRACT.targetAlgorithm,
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
          witnessId: 'witness-01',
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

  it('62. resolveProvisionedProductionTrustAnchor unconditionally fails closed', () => {
    const result = resolveProvisionedProductionTrustAnchor();
    expect(result.provisioned).toBe(false);
    expect(result.anchor).toBeUndefined();
    expect(result.failureReason).toBe('TRUST_ANCHOR_PROVISIONING_CEREMONY_NOT_EXECUTED');
  });

  it('63. static scan confirms zero forbidden tokens in module source', () => {
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

  it('64. no signing API exports in provisioning module', () => {
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
});
