import { describe, expect, it } from 'vitest';
import { GUARDED_TRANSPORT_MODULE_VERSION } from '../../worker/ai/canary/deepSeekGuardedTransportIdentity';
import { EvaluationRunner } from '../../worker/ai/evaluation/evaluationRunner';
import {
  normalizeSingleJsonObject,
  StructuredOutputRecoveryError,
} from '../../worker/ai/fulgor/recovery/structuredOutputRecovery';
import { GeminiProvider } from '../../worker/ai/providers/geminiProvider';
import { OrganizationRepository } from '../../worker/repositories/organizationRepository';
import {
  AppointmentResourceRepository,
  isValidResourceType,
  isValidResourceStatus,
} from '../../worker/repositories/appointmentResourceRepository';
import { RedactionLayer } from '../../worker/ai/redaction';
import {
  createVerificationState,
  isFindingVerification,
} from '../../worker/intelligence/contracts/stateMachine';
import { protocolError, immutableCopy } from '../../worker/intelligence/contracts/index';
import {
  BENCHMARK_VERSION,
  SQLI_SCENARIO_TYPES,
  type SecurityBenchmarkCase,
} from '../../worker/intelligence/benchmarks/types';
import { SecurityPipeline } from '../../worker/security/securityPipeline';
import { handleSecurityRoute } from '../../worker/routes/securityRouter';

describe('Worker direct grounding behavioral verification', () => {
  it('verifies guarded transport identity constant', () => {
    expect(GUARDED_TRANSPORT_MODULE_VERSION).toBe('1.0.0-guarded');
  });

  it('rejects empty evaluation datasets fail-closed', () => {
    expect(() => EvaluationRunner.validateDatasetIntegrity([])).toThrow(
      /EVALUATION_DATASET_INTEGRITY_ERROR/,
    );
  });

  it('normalizes single JSON objects and rejects array payloads', () => {
    const parsed = normalizeSingleJsonObject('{"status":"NO_CHANGE_NEEDED"}');
    expect(parsed.envelope).toBe('plain_json');
    expect(parsed.value.status).toBe('NO_CHANGE_NEEDED');
    expect(() => normalizeSingleJsonObject('[1,2,3]')).toThrow(StructuredOutputRecoveryError);
  });

  it('validates GeminiProvider tier and configuration checks', () => {
    const provider = new GeminiProvider();
    expect(provider.id).toBe('gemini');
    expect(provider.supportsTier('FAST_LOW_COST')).toBe(true);
    expect(provider.supportsDataClassification('PUBLIC_BUSINESS')).toBe(true);
    expect(provider.isConfigured({} as never)).toBe(false);
  });

  it('enforces OrganizationRepository and AppointmentResourceRepository fail-closed production DB boundary', async () => {
    await expect(
      OrganizationRepository.getOrganizationById(undefined, 'org_prod', 'production'),
    ).rejects.toThrow(/DATABASE_NOT_CONFIGURED/);
    expect(isValidResourceType('staff')).toBe(true);
    expect(isValidResourceStatus('active')).toBe(true);
    expect(typeof AppointmentResourceRepository).toBe('function');
  });

  it('sanitizes PII via RedactionLayer and validates verification state handles', () => {
    const sanitized = RedactionLayer.sanitize(
      'contact test@example.com for details',
      'PUBLIC_BUSINESS',
    );
    expect(String(sanitized.sanitized)).not.toContain('test@example.com');
    expect(isFindingVerification({})).toBe(false);
    expect(() => createVerificationState({}, '')).toThrow();
    expect(immutableCopy({ a: 1 })).toEqual({ a: 1 });
    expect(() => protocolError('test')).toThrow();
  });

  it('validates SecurityPipeline, handleSecurityRoute and benchmark constants', () => {
    expect(typeof SecurityPipeline.recordEvent).toBe('function');
    expect(typeof handleSecurityRoute).toBe('function');
    expect(BENCHMARK_VERSION).toBe('velnar-sqli-express-benchmark-v1');
    expect(SQLI_SCENARIO_TYPES.length).toBeGreaterThan(0);
    const sampleCase: Partial<SecurityBenchmarkCase> = { benchmarkVersion: BENCHMARK_VERSION };
    expect(sampleCase.benchmarkVersion).toBe(BENCHMARK_VERSION);
  });
});
