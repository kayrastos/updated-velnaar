import {
  runAutomationJob,
} from './controller';

import type {
  FulgorVerifierWorker,
} from './types';

import {
  PersistentFulgorStateStore,
} from './persistentState';

export type SupervisorFailureCode =
  | 'INVALID_MAX_JOBS_PER_RUN';

export class FulgorSupervisorError extends Error {
  readonly code: SupervisorFailureCode;

  constructor(code: SupervisorFailureCode) {
    super(code);
    this.name = 'FulgorSupervisorError';
    this.code = code;
  }
}

export interface SupervisorRunSummary {
  recoveredInterrupted: number;
  processed: number;
  pending: number;
  running: number;
  completed: number;
  needsReview: number;
}

export interface SupervisorCompletionContext {
  jobId: string;
  result: Awaited<
    ReturnType<typeof runAutomationJob>
  >;
}

export type SupervisorCompletionHook = (
  context: SupervisorCompletionContext,
) => Promise<void>;

export async function runBoundedSupervisorOnce(
  store: PersistentFulgorStateStore,
  worker: FulgorVerifierWorker,
  maxJobsPerRun = 1,
  completionHook?: SupervisorCompletionHook,
): Promise<SupervisorRunSummary> {
  if (
    !Number.isInteger(maxJobsPerRun) ||
    maxJobsPerRun <= 0 ||
    maxJobsPerRun > 16
  ) {
    throw new FulgorSupervisorError(
      'INVALID_MAX_JOBS_PER_RUN',
    );
  }

  /*
   * A previously RUNNING job may have already
   * reached an external verifier before a crash.
   * Never retry it automatically.
   */
  const recoveredInterrupted =
    await store.recoverInterrupted();

  let processed = 0;

  while (processed < maxJobsPerRun) {
    const job = await store.claimNext();

    if (!job) {
      break;
    }

    try {
      const result =
        await runAutomationJob(
          job,
          worker,
        );

      if (completionHook) {
        await completionHook({
          jobId: job.jobId,
          result,
        });
      }

      await store.complete(
        job.jobId,
        result,
      );
    } catch {
      /*
       * Fail closed. A controller-level unexpected
       * failure receives no automatic retry.
       */
      await store.markNeedsReview(
        job.jobId,
        'SUPERVISOR_UNHANDLED_ERROR_NO_RETRY',
      );
    }

    processed += 1;
  }

  const snapshot =
    await store.snapshot();

  return {
    recoveredInterrupted,
    processed,

    pending:
      snapshot.jobs.filter(
        (record) =>
          record.status === 'PENDING',
      ).length,

    running:
      snapshot.jobs.filter(
        (record) =>
          record.status === 'RUNNING',
      ).length,

    completed:
      snapshot.jobs.filter(
        (record) =>
          record.status === 'COMPLETED',
      ).length,

    needsReview:
      snapshot.jobs.filter(
        (record) =>
          record.status === 'NEEDS_REVIEW',
      ).length,
  };
}