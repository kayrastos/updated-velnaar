import { describe, it, expect } from 'vitest';
import { DataClassifier } from '../../worker/ai/dataClassifier';

describe('Sprint 4 - AI Data Classification Engine', () => {
  it('correctly classifies API keys and tokens as SECRET', () => {
    expect(DataClassifier.classify('Here is my secret token: sk-123456789012345678901234')).toBe('SECRET');
    expect(DataClassifier.classify('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeak')).toBe('SECRET');
    expect(DataClassifier.classify({ authKey: 'sec_abcdef1234567890123' })).toBe('SECRET');
  });

  it('correctly classifies raw customer healthcare/financial keywords as SENSITIVE', () => {
    expect(DataClassifier.classify('Customer medical diagnosis record attached')).toBe('SENSITIVE');
    expect(DataClassifier.classify({ payload: 'raw_pii', credit_card: '4111222233334444' })).toBe('SENSITIVE');
  });

  it('correctly classifies unredacted personal identifiers as PERSONAL', () => {
    expect(DataClassifier.classify('Customer email is john.doe@example.com')).toBe('PERSONAL');
    expect(DataClassifier.classify('Call customer at 555-123-4567')).toBe('PERSONAL');
  });

  it('correctly classifies pseudonymous telemetry as PSEUDONYMOUS_OPERATIONAL', () => {
    expect(DataClassifier.classify({
      leadId: 'lead_84920482',
      funnel_stage: 'appointment_scheduled',
      response_latency: 140,
      estimated_deal_value_minor: 500000,
    })).toBe('PSEUDONYMOUS_OPERATIONAL');
  });

  it('correctly classifies public business content as PUBLIC_BUSINESS', () => {
    expect(DataClassifier.classify('Apex Industrial operates Monday to Friday from 08:00 to 18:00')).toBe('PUBLIC_BUSINESS');
    expect(DataClassifier.classify({ serviceName: 'Hydraulic Cylinder Repair', category: 'Heavy Machinery' })).toBe('PUBLIC_BUSINESS');
  });

  it('enforces safety boundary for external AI transmission', () => {
    expect(DataClassifier.isSafeForExternalAI('PUBLIC_BUSINESS')).toBe(true);
    expect(DataClassifier.isSafeForExternalAI('PSEUDONYMOUS_OPERATIONAL')).toBe(true);
    expect(DataClassifier.isSafeForExternalAI('PERSONAL')).toBe(false);
    expect(DataClassifier.isSafeForExternalAI('SENSITIVE')).toBe(false);
    expect(DataClassifier.isSafeForExternalAI('SECRET')).toBe(false);
  });
});
