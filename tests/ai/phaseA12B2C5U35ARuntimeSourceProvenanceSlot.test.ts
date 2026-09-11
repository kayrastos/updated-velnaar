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
import {
  GUARDED_SOURCE_ATTESTATION_READY,
  GUARDED_HUMAN_AUTH_ATTESTATION_READY,
} from '../../worker/ai/canary/deepSeekGuardedLiveTransport';
import {
  D1_REPLAY_BACKEND_PRODUCTION_BOUND,
  D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED,
  D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED,
} from '../../worker/ai/canary/d1AuthorizationReplayBackend';
import { buildHumanAuthorizationSigningPayload } from '../../scripts/buildHumanAuthorizationSigningPayload.mjs';
import { buildRuntimeSourceProvenanceSigningPayload } from '../../scripts/buildRuntimeSourceProvenanceSigningPayload.mjs';
import { computeNormalizedPublicKeyFingerprint } from '../../scripts/computePublicKeyFingerprint.mjs';

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

  // ==========================================================================
  // 6. INDEPENDENT REVIEW CANONICAL EVIDENCE & CONTRACT REGRESSION SUITE
  // ==========================================================================
  describe('Independent Review Canonical Evidence & Contract Regression Suite', () => {
    const jsonPath = path.resolve(
      __dirname,
      '../../execution/a12b2c5u35a_remaining_gate_dependency_readiness.json'
    );
    const mdPath = path.resolve(
      __dirname,
      '../../execution/a12b2c5u35a_remaining_gate_dependency_readiness.md'
    );

    const jsonRaw = fs.readFileSync(jsonPath, 'utf8');
    const mdRaw = fs.readFileSync(mdPath, 'utf8');
    const jsonData = JSON.parse(jsonRaw);

    it('1. Public fingerprint ceremony calculation equals computePublicKeyFingerprintSha256(publicPem)', () => {
      const { publicKey } = crypto.generateKeyPairSync('ed25519');
      const publicPemLf = publicKey.export({ type: 'spki', format: 'pem' }) as string;
      const publicPemCrlf = publicPemLf.replace(/\n/g, '\r\n');
      const publicPemWithSpaces = `  \n  ${publicPemCrlf}  \n  `;

      const canonicalFingerprint = computePublicKeyFingerprintSha256(publicPemLf);
      const scriptFingerprint = computeNormalizedPublicKeyFingerprint(publicPemLf);
      const crlfFingerprint = computeNormalizedPublicKeyFingerprint(publicPemCrlf);
      const whitespaceFingerprint = computeNormalizedPublicKeyFingerprint(publicPemWithSpaces);

      expect(scriptFingerprint).toBe(canonicalFingerprint);
      expect(crlfFingerprint).toBe(canonicalFingerprint);
      expect(whitespaceFingerprint).toBe(canonicalFingerprint);

      // Verify rejection of private keys
      const { privateKey } = crypto.generateKeyPairSync('ed25519');
      const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
      expect(() => computeNormalizedPublicKeyFingerprint(privatePem)).toThrow(/SECURITY_VIOLATION/);
    });

    it('2. R5A evidence Gate 5 owner is exactly worker/ai/canary/deepSeekGuardedLiveTransport.ts', () => {
      const gate5 = jsonData.gateLedger.find((g: { gate: number }) => g.gate === 5);
      expect(gate5).toBeDefined();
      expect(gate5.owner).toBe('worker/ai/canary/deepSeekGuardedLiveTransport.ts');
      expect(gate5.symbol).toBe('GUARDED_SOURCE_ATTESTATION_READY');
      expect(gate5.currentValue).toBe(false);
      expect(GUARDED_SOURCE_ATTESTATION_READY).toBe(false);
      expect(mdRaw).toContain('| **5** | `GUARDED_SOURCE_ATTESTATION_READY` | `deepSeekGuardedLiveTransport.ts`');
    });

    it('3. R5A evidence Gate 6 owner is exactly worker/ai/canary/deepSeekGuardedLiveTransport.ts', () => {
      const gate6 = jsonData.gateLedger.find((g: { gate: number }) => g.gate === 6);
      expect(gate6).toBeDefined();
      expect(gate6.owner).toBe('worker/ai/canary/deepSeekGuardedLiveTransport.ts');
      expect(gate6.symbol).toBe('GUARDED_HUMAN_AUTH_ATTESTATION_READY');
      expect(gate6.currentValue).toBe(false);
      expect(GUARDED_HUMAN_AUTH_ATTESTATION_READY).toBe(false);
      expect(mdRaw).toContain('| **6** | `GUARDED_HUMAN_AUTH_ATTESTATION_READY` | `deepSeekGuardedLiveTransport.ts`');
    });

    it('4. Gate 9 exact symbol is D1_REPLAY_BACKEND_PRODUCTION_BOUND and owner is worker/ai/canary/d1AuthorizationReplayBackend.ts', () => {
      const gate9 = jsonData.gateLedger.find((g: { gate: number }) => g.gate === 9);
      expect(gate9).toBeDefined();
      expect(gate9.symbol).toBe('D1_REPLAY_BACKEND_PRODUCTION_BOUND');
      expect(gate9.owner).toBe('worker/ai/canary/d1AuthorizationReplayBackend.ts');
      expect(gate9.currentValue).toBe(true);
      expect(D1_REPLAY_BACKEND_PRODUCTION_BOUND).toBe(true);
      expect(mdRaw).toContain('| **9** | `D1_REPLAY_BACKEND_PRODUCTION_BOUND` | `d1AuthorizationReplayBackend.ts` | `true`');
    });

    it('5. Gate 10 exact symbol is D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED and owner is worker/ai/canary/d1AuthorizationReplayBackend.ts', () => {
      const gate10 = jsonData.gateLedger.find((g: { gate: number }) => g.gate === 10);
      expect(gate10).toBeDefined();
      expect(gate10.symbol).toBe('D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED');
      expect(gate10.owner).toBe('worker/ai/canary/d1AuthorizationReplayBackend.ts');
      expect(gate10.currentValue).toBe(true);
      expect(D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED).toBe(true);
      expect(mdRaw).toContain('| **10** | `D1_REPLAY_BACKEND_REAL_DATABASE_PROVISIONED` | `d1AuthorizationReplayBackend.ts` | `true`');
    });

    it('6. Gate 11 exact symbol is D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED and owner is worker/ai/canary/d1AuthorizationReplayBackend.ts', () => {
      const gate11 = jsonData.gateLedger.find((g: { gate: number }) => g.gate === 11);
      expect(gate11).toBeDefined();
      expect(gate11.symbol).toBe('D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED');
      expect(gate11.owner).toBe('worker/ai/canary/d1AuthorizationReplayBackend.ts');
      expect(gate11.currentValue).toBe(true);
      expect(D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED).toBe(true);
      expect(mdRaw).toContain('| **11** | `D1_REPLAY_BACKEND_REAL_CONCURRENCY_CERTIFIED` | `d1AuthorizationReplayBackend.ts` | `true`');
    });

    it('7. R5A evidence contains zero raw D1 database identifiers', () => {
      expect(jsonRaw).not.toContain('71221bb0');
      expect(mdRaw).not.toContain('71221bb0');
      expect(jsonData.rawDatabaseIdRepeatedInR5AEvidence).toBe(false);
      const gate9 = jsonData.gateLedger.find((g: { gate: number }) => g.gate === 9);
      expect(gate9.requiredProviderResources[0]).toContain(
        '62ebb801413e1f691e0a30d9d4388c7d17e0060ff0594dcd8238f25fc6857055'
      );
      expect(gate9.requiredProviderResources[0]).toContain('4de303');
    });

    it('8. Runtime provenance evidence does NOT claim a maximum lifetime is enforced', () => {
      expect(
        jsonData.provenanceGapAnalysis.receiptLifetimePolicy.runtimeSourceProvenanceMaximumLifetimeEnforced
      ).toBe(false);
      expect(
        jsonData.provenanceGapAnalysis.receiptLifetimePolicy.runtimeSourceProvenanceLifetimePolicyStatus
      ).toBe('UNRESOLVED_REQUIRES_EXPLICIT_POLICY_BEFORE_R5B_OR_R5C');
      expect(mdRaw).toContain('runtimeSourceProvenanceMaximumLifetimeEnforced = false');
      expect(mdRaw).toContain('UNRESOLVED_REQUIRES_EXPLICIT_POLICY_BEFORE_R5B_OR_R5C');
      expect(mdRaw).not.toContain('bounded validity window (e.g. 7–30 days)');
    });

    it('9. R5C planning text contains explicit EXTERNAL/OFFLINE signing boundary without repository/agent signing', () => {
      const r5cScopeJson = JSON.stringify(jsonData.futureMasterBatches.R5C);
      expect(r5cScopeJson).toContain('signed externally inside the approved offline provenance signing boundary');
      expect(r5cScopeJson).toContain('signed externally inside the approved offline human-authorization signing boundary');
      expect(r5cScopeJson).toContain('Private keys NEVER enter');

      expect(mdRaw).toContain('signed externally inside the approved offline provenance signing boundary');
      expect(mdRaw).toContain('signed externally inside the approved offline human-authorization signing boundary');
      expect(mdRaw).toContain('Private keys NEVER enter repository, Worker runtime, ChatGPT, Antigravity, Codex, Gemini, or any AI agent context');
    });
  });

  // ==========================================================================
  // 7. EVIDENCE HYGIENE & DATA MINIMIZATION REGRESSION SUITE
  // ==========================================================================
  describe('Evidence Hygiene & Data Minimization Regressions', () => {
    const jsonPath = path.resolve(
      __dirname,
      '../../execution/a12b2c5u35a_remaining_gate_dependency_readiness.json'
    );
    const mdPath = path.resolve(
      __dirname,
      '../../execution/a12b2c5u35a_remaining_gate_dependency_readiness.md'
    );

    const jsonRaw = fs.readFileSync(jsonPath, 'utf8');
    const mdRaw = fs.readFileSync(mdPath, 'utf8');
    const jsonData = JSON.parse(jsonRaw);

    it('1. Readiness JSON and Markdown do NOT contain the literal string "100-worker"', () => {
      expect(jsonRaw).not.toContain('100-worker');
      expect(mdRaw).not.toContain('100-worker');
    });

    it('2. Gate 11 evidence contains exact bounded R4 concurrency statistics', () => {
      const gate11 = jsonData.gateLedger.find((g: { gate: number }) => g.gate === 11);
      expect(gate11).toBeDefined();
      expect(gate11.concurrencyCertificationStatistics).toEqual({
        totalAttempts: 1280,
        totalReserved: 660,
        totalAlreadyReserved: 620,
        concurrencyRetries: 0,
        contestedRounds: 20,
        contendersPerRound: 32,
        controlAttempts: 640,
      });

      // Textual verification in explanation and markdown
      const expectedText =
        'Real D1 concurrency certified by 20 contested rounds × 32 concurrent contenders plus 640 independent control attempts: 1280 total attempts, 660 RESERVED / inserted certification rows, 620 ALREADY_RESERVED conflict non-writes, zero retries';
      expect(gate11.explanation).toContain(expectedText);
      expect(mdRaw).toContain(expectedText);
    });

    it('3. Readiness JSON and Markdown do NOT contain "?kid=" or "&kid=" or unredacted query kid values', () => {
      expect(jsonRaw).not.toContain('?kid=');
      expect(jsonRaw).not.toContain('&kid=');
      expect(mdRaw).not.toContain('?kid=');
      expect(mdRaw).not.toContain('&kid=');
      expect(jsonRaw).not.toMatch(/[?&]kid=[a-zA-Z0-9_-]+/);
      expect(mdRaw).not.toMatch(/[?&]kid=[a-zA-Z0-9_-]+/);
    });

    it('4. rawAccessKidRecordedInR5AEvidence is strictly false', () => {
      expect(jsonData.rawAccessKidRecordedInR5AEvidence).toBe(false);
      expect(jsonData.cloudflareManagementPlaneSnapshot.edgeProbe.rawKidRecorded).toBe(false);
      expect(mdRaw).toContain('rawAccessKidRecordedInR5AEvidence = false');
    });

    it('5. rawAccessAudRecordedInR5AEvidence is strictly false', () => {
      expect(jsonData.rawAccessAudRecordedInR5AEvidence).toBe(false);
      expect(
        jsonData.cloudflareManagementPlaneSnapshot.edgeProbe.managementPlaneAudReadAvailable
      ).toBe(false);
      expect(mdRaw).toContain('rawAccessAudRecordedInR5AEvidence = false');
    });

    it('6. rawDatabaseIdRepeatedInR5AEvidence is strictly false', () => {
      expect(jsonData.rawDatabaseIdRepeatedInR5AEvidence).toBe(false);
      expect(mdRaw).toContain('rawDatabaseIdRepeatedInR5AEvidence = false');
      expect(jsonRaw).not.toContain('71221bb0');
      expect(mdRaw).not.toContain('71221bb0');
    });
  });
});
