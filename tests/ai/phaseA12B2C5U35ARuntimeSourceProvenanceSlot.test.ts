import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Gate imports
import {
  PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED,
  PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY,
} from '../../worker/ai/canary/deepSeekProductionOperationalRoutePolicy';
import {
  CANARY_LIVE_EXECUTION_ENABLED,
  CANARY_LIVE_EXECUTION_STATE,
} from '../../worker/ai/canary/canarySpecification';
import {
  PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_HUMAN_AUTHORITY_REGISTRY,
} from '../../worker/ai/canary/deepSeekProductionAuthorizationTrust';
import {
  RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED,
  PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES,
} from '../../worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance';
import { DEEPSEEK_FIRST_PROVIDER_STRATEGY } from '../../worker/ai/canary/deepSeekFirstProviderStrategy';
import { PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY } from '../../worker/auth/cloudflareAccessOperationalAuth';

// Human trust slot constants
import {
  CANONICAL_TARGET_AUTHORITY_ID,
} from '../../worker/ai/canary/deepSeekProductionTrustAnchorProvisioningSlot';

// Runtime provenance slot imports
import {
  RUNTIME_SOURCE_PROVENANCE_SLOT_VERSION,
  RUNTIME_SOURCE_PROVENANCE_SLOT_READY,
  RUNTIME_SOURCE_PROVENANCE_SLOT_POPULATED,
  CANONICAL_TARGET_PROVENANCE_ISSUER_ID,
  CANONICAL_TARGET_PROVENANCE_KEY_VERSION,
  CANONICAL_TARGET_PROVENANCE_ALGORITHM,
  CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION,
  CANONICAL_PROVENANCE_HANDOFF_VERSION,
  CANONICAL_PROVENANCE_PRIVATE_KEY_CUSTODY_MODE,
  CANONICAL_PROVENANCE_OPERATOR_ACKNOWLEDGEMENT,
  computeRuntimeSourceProvenanceProvisioningRecordDigest,
  computeRuntimeSourceProvenanceManualHandoffDigest,
  validateRuntimeSourceProvenanceProvisioningRecord,
  validateRuntimeSourceProvenanceProvisioningCandidate,
  validateRuntimeSourceProvenanceManualHandoffReceipt,
  validateProvenanceCandidateWithManualHandoff,
} from '../../worker/ai/canary/deepSeekRuntimeSourceProvenanceProvisioningSlot';

import { computePublicKeyFingerprintSha256 } from '../../worker/ai/canary/deepSeekCertificationAttestation';
import { buildHumanAuthorizationSigningPayload } from '../../scripts/buildHumanAuthorizationSigningPayload.mjs';
import { buildRuntimeSourceProvenanceSigningPayload } from '../../scripts/buildRuntimeSourceProvenanceSigningPayload.mjs';

describe('Phase A.12B.2C-5U.3.5A — Runtime Source Provenance Slot & Gate Invariants', () => {
  // ==========================================================================
  // 1. CANONICAL PRODUCTION GATE INVARIANTS
  // ==========================================================================
  describe('Canonical Production Gate Baseline Invariants', () => {
    it('Gate 1: PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED remains strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_ROUTE_ENABLED).toBe(false);
    });

    it('Gate 2: PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY remains strictly false', () => {
      expect(PRODUCTION_CANARY_OPERATIONAL_INGRESS_AUTH_READY).toBe(false);
    });

    it('Gate 3: CANARY_LIVE_EXECUTION_ENABLED remains strictly false', () => {
      expect(CANARY_LIVE_EXECUTION_ENABLED).toBe(false);
    });

    it('Gate 4: CANARY_LIVE_EXECUTION_STATE remains strictly BLOCKED_PENDING_CERTIFICATION', () => {
      expect(CANARY_LIVE_EXECUTION_STATE).toBe('BLOCKED_PENDING_CERTIFICATION');
    });

    it('Gate 7: PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED remains strictly false', () => {
      expect(PRODUCTION_AUTHORITY_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('Gate 8: RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED remains strictly false', () => {
      expect(RUNTIME_SOURCE_PROVENANCE_TRUST_ANCHOR_PROVISIONED).toBe(false);
    });

    it('Gate 12: productionRoutingEnforcementAllowed remains strictly false', () => {
      expect(DEEPSEEK_FIRST_PROVIDER_STRATEGY.securityInvariants.productionRoutingEnforcementAllowed).toBe(false);
    });

    it('Immutable production registries remain strictly empty', () => {
      expect(PRODUCTION_HUMAN_AUTHORITY_REGISTRY).toHaveLength(0);
      expect(PRODUCTION_RUNTIME_SOURCE_PROVENANCE_AUTHORITIES).toHaveLength(0);
      expect(PRODUCTION_OPERATIONAL_SUPERADMIN_REGISTRY).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 2. TRUST DOMAIN SEPARATION
  // ==========================================================================
  describe('Dual Trust Domain Separation', () => {
    it('human authorization authority and provenance issuer are strictly distinct identifiers', () => {
      expect(CANONICAL_TARGET_AUTHORITY_ID).toBe('velnar-lead-ops-prod');
      expect(CANONICAL_TARGET_PROVENANCE_ISSUER_ID).toBe('velnar-runtime-provenance-prod');
      expect(CANONICAL_TARGET_AUTHORITY_ID).not.toBe(CANONICAL_TARGET_PROVENANCE_ISSUER_ID);
    });

    it('slot readiness flags remain strictly false in Phase R5A', () => {
      expect(RUNTIME_SOURCE_PROVENANCE_SLOT_READY).toBe(false);
      expect(RUNTIME_SOURCE_PROVENANCE_SLOT_POPULATED).toBe(false);
    });
  });

  // ==========================================================================
  // 3. OFFLINE PROVENANCE PROVISIONING SLOT VALIDATION
  // ==========================================================================
  describe('Runtime Source Provenance Provisioning Slot Validators', () => {
    // Generate an ephemeral test Ed25519 key pair for offline validator unit tests
    const testKeyPair = crypto.generateKeyPairSync('ed25519');
    const testPubPem = testKeyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const testPrivPem = testKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const testFingerprint = computePublicKeyFingerprintSha256(testPubPem);

    const validRecordFields = {
      ceremonyVersion: CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION,
      ceremonyId: 'ceremony-a12b2c5u35a-provenance-genesis-01',
      registryVersion: 'a12b2c5q-registry-v1',
      issuerId: CANONICAL_TARGET_PROVENANCE_ISSUER_ID,
      keyVersion: CANONICAL_TARGET_PROVENANCE_KEY_VERSION,
      algorithm: CANONICAL_TARGET_PROVENANCE_ALGORITHM,
      publicKeyPem: testPubPem,
      publicKeyFingerprintSha256: testFingerprint,
      generatedOutsideRepository: true,
      privateKeyCommittedToRepository: false,
      privateKeyAccessibleToApplication: false,
      privateKeyCustodyMode: CANONICAL_PROVENANCE_PRIVATE_KEY_CUSTODY_MODE,
      createdAt: '2026-09-10T22:00:00.000Z',
      operatorAcknowledgement: CANONICAL_PROVENANCE_OPERATOR_ACKNOWLEDGEMENT,
    };

    const validRecordDigest = computeRuntimeSourceProvenanceProvisioningRecordDigest(validRecordFields);
    const validRecord = { ...validRecordFields, provisioningRecordDigest: validRecordDigest };

    const validAuthority = {
      issuerId: CANONICAL_TARGET_PROVENANCE_ISSUER_ID,
      keyVersion: CANONICAL_TARGET_PROVENANCE_KEY_VERSION,
      algorithm: CANONICAL_TARGET_PROVENANCE_ALGORITHM,
      publicKeyFingerprintSha256: testFingerprint,
      publicKeyPem: testPubPem,
    };

    const validHandoffFields = {
      handoffVersion: CANONICAL_PROVENANCE_HANDOFF_VERSION,
      slotVersion: RUNTIME_SOURCE_PROVENANCE_SLOT_VERSION,
      ceremonyVersion: CANONICAL_PROVENANCE_CEREMONY_CONTRACT_VERSION,
      registryVersion: 'a12b2c5q-registry-v1',
      issuerId: CANONICAL_TARGET_PROVENANCE_ISSUER_ID,
      keyVersion: CANONICAL_TARGET_PROVENANCE_KEY_VERSION,
      algorithm: CANONICAL_TARGET_PROVENANCE_ALGORITHM,
      publicKeyFingerprintSha256: testFingerprint,
      provisioningRecordDigest: validRecordDigest,
      reviewedByOperator: true,
      privateKeyNeverEnteredRepository: true,
      privateKeyNeverEnteredApplicationRuntime: true,
      privateKeyNeverEnteredAIAgentContext: true,
    };

    const validHandoffDigest = computeRuntimeSourceProvenanceManualHandoffDigest(validHandoffFields);
    const validHandoff = { ...validHandoffFields, handoffDigest: validHandoffDigest };

    it('validates a conformant offline provenance candidate and handoff receipt', () => {
      const recVal = validateRuntimeSourceProvenanceProvisioningRecord(validRecord);
      expect(recVal.valid).toBe(true);
      expect(recVal.record).toBeDefined();

      const candVal = validateRuntimeSourceProvenanceProvisioningCandidate({
        provisioningRecord: validRecord,
        publicAuthorityEntry: validAuthority,
      });
      expect(candVal.valid).toBe(true);

      const handoffVal = validateRuntimeSourceProvenanceManualHandoffReceipt(validHandoff);
      expect(handoffVal.valid).toBe(true);

      const crossVal = validateProvenanceCandidateWithManualHandoff(
        { provisioningRecord: validRecord, publicAuthorityEntry: validAuthority },
        validHandoff
      );
      expect(crossVal.valid).toBe(true);
    });

    it('rejects private key material passed in publicKeyPem or extra fields', () => {
      const badRecordPem = {
        ...validRecordFields,
        publicKeyPem: testPrivPem,
      };
      const badDigest = computeRuntimeSourceProvenanceProvisioningRecordDigest(badRecordPem);
      const resPem = validateRuntimeSourceProvenanceProvisioningRecord({
        ...badRecordPem,
        provisioningRecordDigest: badDigest,
      });
      expect(resPem.valid).toBe(false);
      expect(resPem.errors.some(e => e.includes('PRIVATE_KEY_MATERIAL_FORBIDDEN'))).toBe(true);

      const badRecordExtra = {
        ...validRecord,
        privateKey: testPrivPem,
      };
      const resExtra = validateRuntimeSourceProvenanceProvisioningRecord(badRecordExtra);
      expect(resExtra.valid).toBe(false);
      expect(resExtra.errors.some(e => e.includes('UNKNOWN_PROPERTY'))).toBe(true);
    });

    it('rejects if private key is reported committed to repo or accessible to app', () => {
      const violatedCustody1 = {
        ...validRecordFields,
        privateKeyCommittedToRepository: true,
      };
      const d1 = computeRuntimeSourceProvenanceProvisioningRecordDigest(violatedCustody1);
      const res1 = validateRuntimeSourceProvenanceProvisioningRecord({
        ...violatedCustody1,
        provisioningRecordDigest: d1,
      });
      expect(res1.valid).toBe(false);
      expect(res1.errors.some(e => e.includes('PRIVATE_KEY_COMMITTED_FORBIDDEN'))).toBe(true);

      const violatedCustody2 = {
        ...validRecordFields,
        privateKeyAccessibleToApplication: true,
      };
      const d2 = computeRuntimeSourceProvenanceProvisioningRecordDigest(violatedCustody2);
      const res2 = validateRuntimeSourceProvenanceProvisioningRecord({
        ...violatedCustody2,
        provisioningRecordDigest: d2,
      });
      expect(res2.valid).toBe(false);
      expect(res2.errors.some(e => e.includes('PRIVATE_KEY_ACCESSIBLE_FORBIDDEN'))).toBe(true);
    });

    it('cryptographically detects and rejects public key fingerprint mismatch', () => {
      const tamperedFingerprint = '0000000000000000000000000000000000000000000000000000000000000000';
      const tamperedRecord = {
        ...validRecordFields,
        publicKeyFingerprintSha256: tamperedFingerprint,
      };
      const d = computeRuntimeSourceProvenanceProvisioningRecordDigest(tamperedRecord);
      const res = validateRuntimeSourceProvenanceProvisioningRecord({
        ...tamperedRecord,
        provisioningRecordDigest: d,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('PUBLIC_KEY_FINGERPRINT_MISMATCH'))).toBe(true);
    });

    it('rejects cross-binding if candidate and handoff fingerprints mismatch', () => {
      const mismatchedHandoffFields = {
        ...validHandoffFields,
        publicKeyFingerprintSha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      };
      const d = computeRuntimeSourceProvenanceManualHandoffDigest(mismatchedHandoffFields);
      const mismatchedHandoff = { ...mismatchedHandoffFields, handoffDigest: d };

      const crossVal = validateProvenanceCandidateWithManualHandoff(
        { provisioningRecord: validRecord, publicAuthorityEntry: validAuthority },
        mismatchedHandoff
      );
      expect(crossVal.valid).toBe(false);
      expect(crossVal.errors.some(e => e.includes('FINGERPRINT_CROSS_MISMATCH'))).toBe(true);
    });
  });

  // ==========================================================================
  // 4. SIGNING PAYLOAD BUILDER SCRIPTS REJECT PRIVATE KEYS
  // ==========================================================================
  describe('Signing Payload Builders Invariants', () => {
    it('buildHumanAuthorizationSigningPayload rejects input containing privateKey fields', () => {
      expect(() => {
        buildHumanAuthorizationSigningPayload({
          privateKey: 'secret_bytes',
          authorizationVersion: 'a12b2c5d-v1',
        });
      }).toThrow(/SECURITY_VIOLATION/);

      expect(() => {
        buildHumanAuthorizationSigningPayload({
          privateKeyPath: '/etc/keys/id.key',
          authorizationVersion: 'a12b2c5d-v1',
        });
      }).toThrow(/SECURITY_VIOLATION/);
    });

    it('buildRuntimeSourceProvenanceSigningPayload rejects input containing privateKey fields', () => {
      expect(() => {
        buildRuntimeSourceProvenanceSigningPayload({
          privateKey: 'secret_bytes',
          provenanceVersion: 'a12b2c5q-v1',
        });
      }).toThrow(/SECURITY_VIOLATION/);

      expect(() => {
        buildRuntimeSourceProvenanceSigningPayload({
          secretKey: 'top_secret',
          provenanceVersion: 'a12b2c5q-v1',
        });
      }).toThrow(/SECURITY_VIOLATION/);
    });

    it('buildRuntimeSourceProvenanceSigningPayload produces deterministic canonical JSON and SHA-256', () => {
      const samplePayload = {
        provenanceVersion: 'a12b2c5q-v1',
        repositoryFullName: 'kayrastos/updated-velnaar',
        sourceCommitSha: '12f9bc3c9f8a4c0c628253caa2cebdf841927b0f',
        sourceTreeSha: '9f00039a5df09ef744bc629a66c100d5e669c9c7',
        buildArtifactSha256: 'a'.repeat(64),
        buildId: 'build-production-cert-001-abc123456789',
        deploymentId: 'deploy-production-cert-001-abc123456789',
        environment: 'production',
        issuedAt: '2026-09-10T22:00:00.000Z',
        expiresAt: '2026-09-11T22:00:00.000Z',
        issuerId: 'velnar-runtime-provenance-prod',
        issuerKeyVersion: '2026-v1',
        algorithm: 'Ed25519',
      };

      const res = buildRuntimeSourceProvenanceSigningPayload(samplePayload);
      expect(res.canonicalPayload).toBeDefined();
      expect(res.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(res.byteLength).toBeGreaterThan(0);
      expect(res.signingInstructions.algorithm).toBe('Ed25519');
    });
  });

  // ==========================================================================
  // 5. NO NETWORK OR PROVIDER CALLS IN PROVISIONING CODE
  // ==========================================================================
  describe('Zero Network / External Call Purity', () => {
    it('deepSeekRuntimeSourceProvenanceProvisioningSlot.ts contains zero network calls', () => {
      const filePath = path.resolve(
        __dirname,
        '../../worker/ai/canary/deepSeekRuntimeSourceProvenanceProvisioningSlot.ts'
      );
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).not.toContain('fetch(');
      expect(content).not.toContain('axios');
      expect(content).not.toContain('XMLHttpRequest');
      expect(content).not.toContain('http.request');
      expect(content).not.toContain('https.request');
    });
  });
});
