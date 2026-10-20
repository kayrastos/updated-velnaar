export const TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA = 'VELNAR_TASK_CLASS_RECOVERY_TRANSACTION_V3' as const;

export interface TaskClassRecoveryTransaction {
  readonly schemaVersion: typeof TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA;
  readonly baseline: string;
  readonly foundationCommit: string;
  readonly batchId: string;
  readonly authorizationId: string;
  readonly intentSha256: string;
  readonly provider: 'antigravity';
  readonly taskClass: 'GENERAL';
  readonly phase: 'PROBATION_BOOTSTRAP' | 'BOUNDED_CERTIFICATION';
  readonly requestedModel: 'gemini-3.8-flash-high';
  readonly totalProviderCalls: number;
  readonly maxConcurrency: 1;
}

export function validateRecoveryTransaction(value: TaskClassRecoveryTransaction): void {
  const keys = ['schemaVersion', 'baseline', 'foundationCommit', 'batchId', 'authorizationId',
    'intentSha256', 'provider', 'taskClass', 'phase', 'requestedModel', 'totalProviderCalls', 'maxConcurrency'];
  if (!value || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
      value.schemaVersion !== TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA ||
      typeof value.baseline !== 'string' || value.baseline.length !== 40 || !/^[0-9a-f]{40}$/.test(value.baseline) ||
      value.foundationCommit !== value.baseline || typeof value.batchId !== 'string' ||
      value.batchId.trim() !== value.batchId || !/^[A-Za-z0-9_-]{1,64}$/.test(value.batchId) ||
      value.authorizationId !== value.batchId || typeof value.intentSha256 !== 'string' ||
      value.intentSha256.length !== 64 || !/^[0-9a-f]{64}$/.test(value.intentSha256) ||
      value.provider !== 'antigravity' || value.taskClass !== 'GENERAL' ||
      value.requestedModel !== 'gemini-3.8-flash-high' || value.maxConcurrency !== 1 ||
      !Number.isSafeInteger(value.totalProviderCalls) || value.totalProviderCalls < 1 || value.totalProviderCalls > 7 ||
      (value.phase !== 'PROBATION_BOOTSTRAP' && value.phase !== 'BOUNDED_CERTIFICATION') ||
      (value.phase === 'PROBATION_BOOTSTRAP' && value.totalProviderCalls !== 1)) {
    throw new Error('RECOVERY_TRANSACTION_INVALID');
  }
}

export function sameRecoveryTransaction(value: unknown, expected: TaskClassRecoveryTransaction): boolean {
  try {
    validateRecoveryTransaction(value as TaskClassRecoveryTransaction);
    return Object.keys(expected).every(key => value[key] === expected[key]);
  } catch { return false; }
}
