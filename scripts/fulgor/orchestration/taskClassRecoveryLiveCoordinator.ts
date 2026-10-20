import { createHash } from 'node:crypto';
import { coordinateTaskClassRecovery, type TaskClassRecoveryCoordinatorInput } from './taskClassRecoveryCoordinator';
import { createTaskClassRecoveryAuthorization, type RecoveryAuthorizationCreateDependencies } from './taskClassRecoveryAuthorizationBridge';
import { TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3, type RecoveryAuthorityCheckDependencies } from './taskClassRecoveryAuthorityCheckBridge';
import { consumeRecoveryEffectGateThroughBridge, type RecoveryEffectGateDependencies } from './taskClassRecoveryEffectGateBridge';
import { runTaskClassRecoveryWithHostAdapter, type TaskClassRecoveryHostAdapterDependencies } from './taskClassRecoveryHostAdapter';
import { validateTaskClassRecoveryRunInput, type TaskClassRecoveryJob } from './taskClassRecoveryRunner';
import { TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA, type TaskClassRecoveryTransaction } from './taskClassRecoveryTransaction';

// A lease must come from the host's existing Antigravity capacity account.
// This module does not create a worker pool or mint capacity from lane evidence.
export interface TaskClassRecoveryHostSlot {
  readonly provider: 'antigravity';
  readonly maxConcurrency: 1;
  readonly isHeld: () => boolean;
  readonly release: () => Promise<void>;
  readonly leaseId?: string;
  readonly capacityControllerId?: string;
  readonly purpose?: 'RECOVERY';
}
export interface TaskClassRecoveryLiveDependencies extends RecoveryAuthorityCheckDependencies,
  RecoveryAuthorizationCreateDependencies, RecoveryEffectGateDependencies {
  readonly acquireHostAntigravitySlot: () => Promise<TaskClassRecoveryHostSlot>;
  readonly invokeBoundAntigravity: TaskClassRecoveryHostAdapterDependencies['invokeBoundAntigravity'];
  readonly appendBoundHostOutcome: TaskClassRecoveryHostAdapterDependencies['appendBoundHostOutcome'];
  readonly nowMs: () => number;
}

function keys(value: object, expected: readonly string[]): boolean {
  return value !== null && typeof value === 'object' && Object.keys(value).length === expected.length &&
    Object.keys(value).every(key => expected.includes(key));
}
function intentJobs(raw: string): readonly TaskClassRecoveryJob[] {
  const intent = JSON.parse(raw);
  if (intent.schemaVersion !== TASK_CLASS_RECOVERY_INTENT_SCHEMA_V3 || !Array.isArray(intent.jobs)) {
    throw new Error('RECOVERY_LIVE_INTENT_INVALID');
  }
  const jobs = intent.jobs.map(job => {
    if (!keys(job, ['jobId', 'provider', 'taskClass', 'task', 'evidence']) || !Array.isArray(job.evidence) ||
        !job.evidence.every(binding => keys(binding, ['id', 'path', 'sha256']))) {
      throw new Error('RECOVERY_LIVE_JOB_KEYS_INVALID');
    }
    return Object.freeze({ ...job, evidence: Object.freeze(job.evidence.map(binding => Object.freeze({ ...binding }))) });
  });
  return Object.freeze(jobs);
}

// One phase per invocation. There is no retry, automatic certification phase,
// fallback, default executor, authority override, or provider-authored routing.
export async function runTaskClassRecoveryLive(
  input: TaskClassRecoveryCoordinatorInput,
  dependencies: TaskClassRecoveryLiveDependencies,
) {
  input = Object.freeze({ ...input, lane: Object.freeze({ ...input.lane, counters: Object.freeze({ ...input.lane.counters }) }),
    recovery: Object.freeze({ ...input.recovery }),
    ...(input.checkOnly ? { checkOnly: Object.freeze({ ...input.checkOnly, input: Object.freeze({ ...input.checkOnly.input }) }) } : {}),
  });
  const slot = await dependencies.acquireHostAntigravitySlot();
  if (slot?.provider !== 'antigravity' || slot.maxConcurrency !== 1 ||
      (slot.purpose !== undefined && slot.purpose !== 'RECOVERY') ||
      (slot.leaseId !== undefined && (typeof slot.leaseId !== 'string' || slot.leaseId.trim() === '')) ||
      (slot.capacityControllerId !== undefined && (typeof slot.capacityControllerId !== 'string' || slot.capacityControllerId.trim() === '')) ||
      typeof slot.isHeld !== 'function' || typeof slot.release !== 'function') {
    if (typeof slot?.release === 'function') await slot.release();
    throw new Error('RECOVERY_LIVE_HOST_SLOT_INVALID');
  }
  const hostSlot = Object.freeze({
    provider: 'antigravity' as const,
    maxConcurrency: 1 as const,
    ...(slot.leaseId !== undefined ? { leaseId: slot.leaseId } : {}),
    ...(slot.capacityControllerId !== undefined ? { capacityControllerId: slot.capacityControllerId } : {}),
    ...(slot.purpose !== undefined ? { purpose: slot.purpose } : {}),
  });
  const requireSlot = () => { if (slot.isHeld() !== true) throw new Error('RECOVERY_LIVE_HOST_SLOT_LOST'); };
  try {
    requireSlot();
    // An absent check-only request can return policy HOLD but cannot create
    // authorization. Never invent an intent or call a provider to fill it in.
    if (!input.checkOnly) {
      const coordinator = await coordinateTaskClassRecovery(input);
      return Object.freeze({ status: coordinator.status, coordinator, authorization: null, run: null, hostSlot,
        automaticRetry: false, codexFallback: false, verificationGranted: false, automaticPromotionAllowed: false });
    }
    const raw = await dependencies.readIntent(input.checkOnly.input.intentPath);
    if (createHash('sha256').update(raw, 'utf8').digest('hex') !== input.checkOnly.expectedIntentSha256) {
      throw new Error('RECOVERY_LIVE_INTENT_CHANGED');
    }
    const coordinator = await coordinateTaskClassRecovery(input, {
      readIntent: async () => raw, executeAuthorizer: request => dependencies.executeAuthorizer(request),
    });
    if (coordinator.status !== 'AUTHORIZATION_REQUIRED' || !coordinator.checkOnly) {
      return Object.freeze({ status: coordinator.status, coordinator, authorization: null, run: null, hostSlot,
        automaticRetry: false, codexFallback: false, verificationGranted: false, automaticPromotionAllowed: false });
    }
    const check = coordinator.checkOnly;
    const runInput = Object.freeze({ batchId: check.batchId, baseline: check.baseline, provider: check.provider,
      taskClass: check.taskClass, phase: check.phase, requestedModel: check.requestedModel,
      maxConcurrency: check.requestedConcurrency, jobs: intentJobs(raw) });
    // Validate the whole phase before any durable authorization effect.
    validateTaskClassRecoveryRunInput(runInput);
    requireSlot();
    const authorization = await createTaskClassRecoveryAuthorization(coordinator, dependencies);
    const transaction: TaskClassRecoveryTransaction = Object.freeze({
      schemaVersion: TASK_CLASS_RECOVERY_TRANSACTION_SCHEMA,
      baseline: authorization.baseline, foundationCommit: authorization.baseline,
      batchId: authorization.batchId, authorizationId: authorization.authorizationId,
      intentSha256: authorization.intentSha256, provider: authorization.provider,
      taskClass: authorization.taskClass, phase: authorization.phase, requestedModel: authorization.requestedModel,
      totalProviderCalls: authorization.authorizedProviderCalls, maxConcurrency: authorization.maxConcurrency,
    });
    const run = await runTaskClassRecoveryWithHostAdapter({ ...runInput, transaction }, {
      consumeHostEffectGate: async request => {
        requireSlot();
        const gate = await consumeRecoveryEffectGateThroughBridge({ request,
          authorizedProviderCalls: transaction.totalProviderCalls,
          expectedRemainingProviderCalls: transaction.totalProviderCalls - request.ordinal,
        }, dependencies);
        requireSlot();
        return gate.receipt;
      },
      invokeBoundAntigravity: async request => {
        requireSlot();
        return dependencies.invokeBoundAntigravity(request);
      },
      appendBoundHostOutcome: outcome => dependencies.appendBoundHostOutcome(outcome),
      nowMs: dependencies.nowMs,
    });
    return Object.freeze({ status: run.status, coordinator, authorization, run, hostSlot,
      automaticRetry: false, codexFallback: false, verificationGranted: false, automaticPromotionAllowed: false });
  } finally { await slot.release(); }
}
