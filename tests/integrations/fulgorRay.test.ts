import { describe, it, expect } from 'vitest';
import { fulgorRayAdapter, DisabledFulgorRayAdapter } from '../../src/integrations/fulgorRay/adapter';

describe('Fulgor Ray Anomaly Detector Adapter Interface', () => {
  it('should be disabled by default in this release gate', () => {
    expect(fulgorRayAdapter.isEnabled).toBe(false);
    expect(fulgorRayAdapter.status).toBe('DISABLED');
  });

  it('should fail-safe and refuse telemetry emission when disabled', async () => {
    const res = await fulgorRayAdapter.emitTelemetry({
      organizationId: 'org_apex_holding',
      businessId: 'biz_apex_beauty',
      eventType: 'lead.decay',
      timestamp: new Date().toISOString(),
      metrics: { latency: 450 },
    });

    expect(res.delivered).toBe(false);
    expect(res.reason).toContain('disabled');
  });

  it('should return empty anomaly report in offline receiver mode', async () => {
    const report = await fulgorRayAdapter.checkAnomalies('biz_apex_beauty');
    expect(report.anomalyDetected).toBe(false);
    expect(report.confidenceScore).toBe(0);
    expect(report.category).toBe('none');
  });
});
