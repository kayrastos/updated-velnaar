import { describe, it, expect } from 'vitest';
import { RedactionLayer } from '../../worker/ai/redaction';

describe('Sprint 4 - AI Redaction & Privacy Engine', () => {
  it('masks emails, phones, and URL tokens in strings', () => {
    const input = 'Contact john.doe@velnar.com or call 555-234-5678. Redirect to https://app.velnar.com?token=sec_secret1234567890';
    const { sanitized, report } = RedactionLayer.sanitize(input);

    expect(sanitized).not.toContain('john.doe@velnar.com');
    expect(sanitized).not.toContain('555-234-5678');
    expect(sanitized).not.toContain('sec_secret1234567890');
    expect(sanitized).toContain('j***@velnar.com');
    expect(sanitized).toContain('[REDACTED_PHONE]');
    expect(report.patternsRedacted).toBeGreaterThanOrEqual(3);
  });

  it('strips prohibited identity and secret fields entirely from objects', () => {
    const payload = {
      lead_id: 'lead_99214',
      fullName: 'Alice Smith',
      email: 'alice@domain.com',
      phoneNumber: '+1-555-019-2834',
      encrypted_name_payload: 'enc_payload_bytes',
      funnel_stage: 'lead_captured',
      calculatedMetrics: {
        latencyMinutes: 12,
      },
    };

    const { sanitized, report } = RedactionLayer.sanitize(payload);

    expect(sanitized.fullName).toBeUndefined();
    expect(sanitized.email).toBeUndefined();
    expect(sanitized.phoneNumber).toBeUndefined();
    expect(sanitized.encrypted_name_payload).toBeUndefined();
    expect(sanitized.lead_id).toBe('lead_99214');
    expect(report.fieldsRemoved).toContain('fullName');
    expect(report.fieldsRemoved).toContain('email');
    expect(report.fieldsRemoved).toContain('phoneNumber');
    expect(report.fieldsRemoved).toContain('encrypted_name_payload');
    expect(report.safeForExternalProcessing).toBe(true);
  });

  it('marks safeForExternalProcessing as false if raw secrets remain after redaction', () => {
    const unredactableSecret = {
      diagnosis: 'Severe medical issue',
      notes: 'Customer raw_pii record',
    };

    const { report } = RedactionLayer.sanitize(unredactableSecret);
    expect(report.safeForExternalProcessing).toBe(false);
  });
});
