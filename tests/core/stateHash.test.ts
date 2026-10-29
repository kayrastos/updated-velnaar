import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  STATE_HASH_SCHEMA_VERSION,
  buildVelnarProofCanonicalState,
  computeStateHash,
  createVelnarProofCertificate,
  serializeCanonicalJcs,
  sha256HexSync,
} from '../../src/utils/stateHash';
import {
  computeCanonicalEvidenceStateHash,
  verifyCanonicalEvidenceStateHash,
} from '../../scripts/fulgor/evidence/signedEvidence';
import type { ActionResultRow, BusinessRow } from '../../src/types/database';

describe('RFC 8785 (JCS) Deterministic state_hash & 3-Evidence Closure', () => {
  it('(a) excludes transient timestamp and run/session identifiers so identical deterministic states yield identical state_hash', () => {
    const baseState = {
      schemaVersion: STATE_HASH_SCHEMA_VERSION,
      isolation: {
        organizationId: 'org_velnar_01',
        businessId: 'biz_tr_01',
        market: 'TR',
        role: 'OWNER',
      },
      ruleTemplateVersion: 'VELNAR_V1_CORE_RULESET_2026',
      configuration: {
        currentEnv: 'production' as const,
        isSyntheticDataActive: false,
        allowRealIngestion: true,
        kmsProvider: 'kms_cloud_hsm' as const,
      },
      verifiedActions: [
        {
          id: 'res_01',
          growthActionId: 'act_01',
          status: 'success',
          revenueRecoveredMinor: 250000,
          metricDelta: { baseline: '12%', current: '19%', delta: '+7%' },
        },
      ],
    };

    const runAlpha = {
      ...baseState,
      scan_timestamp: '2026-10-29T10:00:00.000Z',
      timestamp: '2026-10-29T10:00:01.000Z',
      exportedAt: '2026-10-29T10:00:02.000Z',
      generatedAt: '2026-10-29T10:00:03.000Z',
      run_id: 'run-alpha-0001',
      sessionId: 'sess-alpha-999',
      isolation: {
        ...baseState.isolation,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-10-29T09:00:00Z',
      },
      verifiedActions: [
        {
          ...baseState.verifiedActions[0],
          verified_at: '2026-10-29T10:00:00Z',
          observedAtMs: 1793270000000,
        },
      ],
    };

    const runBeta = {
      ...baseState,
      scan_timestamp: '2026-10-30T23:59:59.999Z',
      timestamp: '2026-10-30T23:59:59.999Z',
      exportedAt: '2026-10-31T00:00:00.000Z',
      generatedAt: '2026-10-31T00:00:05.000Z',
      run_id: 'run-beta-8888',
      sessionId: 'sess-beta-111',
      isolation: {
        ...baseState.isolation,
        createdAt: '2025-05-10T12:30:00Z',
        updatedAt: '2026-10-30T22:15:00Z',
      },
      verifiedActions: [
        {
          ...baseState.verifiedActions[0],
          verified_at: '2026-10-30T23:59:59Z',
          observedAtMs: 1793399999999,
        },
      ],
    };

    const hashAlpha = computeStateHash(runAlpha);
    const hashBeta = computeStateHash(runBeta);
    const hashClean = computeStateHash(baseState);

    expect(hashAlpha).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashAlpha).toBe(hashBeta);
    expect(hashAlpha).toBe(hashClean);
    expect(serializeCanonicalJcs(runAlpha)).not.toContain('scan_timestamp');
    expect(serializeCanonicalJcs(runAlpha)).not.toContain('run-alpha-0001');
    expect(serializeCanonicalJcs(runAlpha)).not.toContain('sess-alpha-999');
  });

  it('(b) enforces RFC 8785 (JCS) lexicographical key ordering and matches node:crypto SHA-256 bit-for-bit', () => {
    const orderOne = {
      ruleTemplateVersion: 'V1.0.0',
      isolation: {
        role: 'ADMIN',
        market: 'US',
        businessId: 'biz_us_99',
        organizationId: 'org_us_99',
      },
      configuration: {
        kmsProvider: 'kms_cloud_hsm',
        allowRealIngestion: true,
        currentEnv: 'production',
        isSyntheticDataActive: false,
      },
    };

    const orderTwo = {
      configuration: {
        isSyntheticDataActive: false,
        currentEnv: 'production',
        allowRealIngestion: true,
        kmsProvider: 'kms_cloud_hsm',
      },
      isolation: {
        organizationId: 'org_us_99',
        businessId: 'biz_us_99',
        market: 'US',
        role: 'ADMIN',
      },
      ruleTemplateVersion: 'V1.0.0',
    };

    const canonicalOne = serializeCanonicalJcs(orderOne);
    const canonicalTwo = serializeCanonicalJcs(orderTwo);

    expect(canonicalOne).toBe(canonicalTwo);
    expect(canonicalOne).toBe(
      '{"configuration":{"allowRealIngestion":true,"currentEnv":"production","isSyntheticDataActive":false,"kmsProvider":"kms_cloud_hsm"},"isolation":{"businessId":"biz_us_99","market":"US","organizationId":"org_us_99","role":"ADMIN"},"ruleTemplateVersion":"V1.0.0"}',
    );

    const expectedNodeSha = createHash('sha256').update(canonicalOne, 'utf8').digest('hex');
    expect(sha256HexSync(canonicalOne)).toBe(expectedNodeSha);
    expect(computeStateHash(orderOne)).toBe(`sha256:${expectedNodeSha}`);
    expect(computeStateHash(orderTwo)).toBe(`sha256:${expectedNodeSha}`);
  });

  it('(c) immediately changes state_hash when any single isolation, rule version, or configuration parameter mutates', () => {
    const baseline = {
      schemaVersion: STATE_HASH_SCHEMA_VERSION,
      isolation: {
        organizationId: 'org_01',
        businessId: 'biz_01',
        market: 'TR',
        role: 'OWNER',
      },
      ruleTemplateVersion: 'VELNAR_V1',
      configuration: {
        currentEnv: 'production' as const,
        kmsProvider: 'kms_cloud_hsm' as const,
      },
      verifiedActions: [
        {
          id: 'res_1',
          growthActionId: 'act_1',
          status: 'success',
          revenueRecoveredMinor: 10000,
          metricDelta: { delta: '+5%' },
        },
      ],
    };

    const baseHash = computeStateHash(baseline);

    const orgChanged = computeStateHash({
      ...baseline,
      isolation: { ...baseline.isolation, organizationId: 'org_02' },
    });
    const bizChanged = computeStateHash({
      ...baseline,
      isolation: { ...baseline.isolation, businessId: 'biz_02' },
    });
    const ruleChanged = computeStateHash({
      ...baseline,
      ruleTemplateVersion: 'VELNAR_V1_PATCH_1',
    });
    const configChanged = computeStateHash({
      ...baseline,
      configuration: { ...baseline.configuration, kmsProvider: 'local_mock_vault' },
    });
    const revenueChanged = computeStateHash({
      ...baseline,
      verifiedActions: [
        { ...baseline.verifiedActions[0], revenueRecoveredMinor: 10001 },
      ],
    });

    expect(orgChanged).not.toBe(baseHash);
    expect(bizChanged).not.toBe(baseHash);
    expect(ruleChanged).not.toBe(baseHash);
    expect(configChanged).not.toBe(baseHash);
    expect(revenueChanged).not.toBe(baseHash);
  });

  it('(d) aligns VelnarProofView certificate state_hash and Fulgor signedEvidence canonical stateHash helper', () => {
    const business: BusinessRow = {
      id: 'biz_tr_apex',
      organization_id: 'org_apex_01',
      name: 'Apex Sanayi',
      industry: 'industrial',
      market: 'TR',
      currency: 'TRY',
      annual_revenue_run_rate_minor: 4850000000,
      baseline_margin_pct: 22,
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
    };

    const actionsA: ActionResultRow[] = [
      {
        id: 'ar_02',
        organization_id: 'org_apex_01',
        business_id: 'biz_tr_apex',
        growth_action_id: 'ga_02',
        status: 'success',
        revenue_recovered_amount_minor: 420000,
        metric_delta_json: '{"delta":"+11%","baseline":"10%","current":"21%"}',
        proof_notes: 'Verified cohort A',
        verified_at: '2026-10-28T08:00:00Z',
      },
      {
        id: 'ar_01',
        organization_id: 'org_apex_01',
        business_id: 'biz_tr_apex',
        growth_action_id: 'ga_01',
        status: 'success',
        revenue_recovered_amount_minor: 180000,
        metric_delta_json: '{"current":"15%","baseline":"9%","delta":"+6%"}',
        proof_notes: 'Verified cohort B',
        verified_at: '2026-10-29T09:00:00Z',
      },
    ];

    const actionsB: ActionResultRow[] = [
      { ...actionsA[1], verified_at: '2026-10-30T22:00:00Z' },
      { ...actionsA[0], verified_at: '2026-10-30T23:00:00Z' },
    ];

    const certA = createVelnarProofCertificate({
      currentMarket: 'TR',
      currentBusiness: business,
      actionResults: actionsA,
    });
    const certB = createVelnarProofCertificate({
      currentMarket: 'TR',
      currentBusiness: business,
      actionResults: actionsB,
    });

    expect(certA.state_hash).toBe(certB.state_hash);

    const canonicalStateWithTransients = {
      ...buildVelnarProofCanonicalState({
        currentMarket: 'TR',
        currentBusiness: business,
        actionResults: actionsA,
      }),
      scan_timestamp: '2026-10-29T14:45:00Z',
      run_id: 'fulgor-verify-01',
    };

    expect(computeCanonicalEvidenceStateHash(canonicalStateWithTransients)).toBe(
      certA.state_hash,
    );
    expect(
      verifyCanonicalEvidenceStateHash(canonicalStateWithTransients, certA.state_hash),
    ).toBe(true);
    expect(
      verifyCanonicalEvidenceStateHash(canonicalStateWithTransients, 'sha256:' + '0'.repeat(64)),
    ).toBe(false);
  });
});
