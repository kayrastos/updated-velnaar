import type {
  FulgorAutomationJob,
} from './types';

export type QueueFailureCode =
  | 'INVALID_QUEUE_DEPTH'
  | 'INVALID_JOB_ID'
  | 'DUPLICATE_JOB_ID'
  | 'QUEUE_FULL';

export class FulgorQueueError extends Error {
  readonly code: QueueFailureCode;

  constructor(code: QueueFailureCode) {
    super(code);
    this.name = 'FulgorQueueError';
    this.code = code;
  }
}

export class InMemoryFulgorQueue {
  private readonly pending: FulgorAutomationJob[] = [];
  private readonly pendingIds = new Set<string>();

  constructor(
    readonly maxDepth: number,
  ) {
    if (
      !Number.isInteger(maxDepth) ||
      maxDepth <= 0
    ) {
      throw new FulgorQueueError(
        'INVALID_QUEUE_DEPTH',
      );
    }
  }

  get size(): number {
    return this.pending.length;
  }

  enqueue(job: FulgorAutomationJob): void {
    if (
      typeof job.jobId !== 'string' ||
      job.jobId.trim().length === 0
    ) {
      throw new FulgorQueueError(
        'INVALID_JOB_ID',
      );
    }

    if (this.pendingIds.has(job.jobId)) {
      throw new FulgorQueueError(
        'DUPLICATE_JOB_ID',
      );
    }

    if (this.pending.length >= this.maxDepth) {
      throw new FulgorQueueError(
        'QUEUE_FULL',
      );
    }

    this.pending.push(job);
    this.pendingIds.add(job.jobId);
  }

  dequeue(): FulgorAutomationJob | undefined {
    const job = this.pending.shift();

    if (job) {
      this.pendingIds.delete(job.jobId);
    }

    return job;
  }

  peek(): FulgorAutomationJob | undefined {
    return this.pending[0];
  }
}