import {
  createProviderWorkOrder,
  type ProviderWorkOrder,
  type ProviderWorkRecord,
} from './providerWorkOrder';

import type {
  TransactionalProviderQueue,
} from './transactionalProviderQueue';

import {
  routeProviderTask,
  type ProviderTaskClass,
  type ProviderTaskLaneEvidence,
  type ProviderTaskRoutingDecision,
} from '../scheduler/providerTaskRouter';

export const PROVIDER_TASK_ROUTING_ADMISSION_SCHEMA =
  'VELNAR_PROVIDER_TASK_ROUTING_ADMISSION_V1' as const;

/*
 * Production enqueue-boundary wiring for the task router.
 *
 * This layer:
 * - may select an eligible provider,
 * - may HOLD work,
 * - may pin queue affinity before enqueue.
 *
 * It does NOT:
 * - claim queue work,
 * - invoke a provider,
 * - verify provider output,
 * - settle work,
 * - grant execution authority,
 * - expand the 8+8 / 16 envelope.
 *
 * The supplied lane evidence MUST be host-owned evidence for
 * the exact canonical task class. Caller/model claims are not
 * converted into certification here.
 */

export interface ProviderTaskRoutingAdmissionInput {
  readonly queue:
    TransactionalProviderQueue;

  readonly order:
    ProviderWorkOrder;

  readonly taskClass:
    ProviderTaskClass;

  readonly codex:
    ProviderTaskLaneEvidence;

  readonly antigravity:
    ProviderTaskLaneEvidence;

  readonly nowMs:
    number;
}

export type ProviderTaskRoutingAdmissionResult =
  | Readonly<{
      schemaVersion:
        typeof PROVIDER_TASK_ROUTING_ADMISSION_SCHEMA;

      status:
        'ENQUEUED';

      decision:
        ProviderTaskRoutingDecision;

      record:
        ProviderWorkRecord;

      verificationGranted:
        false;

      authorityGranted:
        false;

      executionGranted:
        false;
    }>
  | Readonly<{
      schemaVersion:
        typeof PROVIDER_TASK_ROUTING_ADMISSION_SCHEMA;

      status:
        'HOLD';

      decision:
        ProviderTaskRoutingDecision;

      record:
        null;

      verificationGranted:
        false;

      authorityGranted:
        false;

      executionGranted:
        false;
    }>;

function preferenceForOrder(
  order:
    ProviderWorkOrder,
) {
  return order.affinity ===
    'either'
    ? 'AUTO' as const
    : order.affinity;
}

export function routeAndEnqueueProviderWork(
  input:
    ProviderTaskRoutingAdmissionInput,
): ProviderTaskRoutingAdmissionResult {
  const decision =
    routeProviderTask({
      taskClass:
        input.taskClass,

      preference:
        preferenceForOrder(
          input.order,
        ),

      codex:
        input.codex,

      antigravity:
        input.antigravity,
    });

  /*
   * Defense in depth:
   * a routing decision is never execution/verification
   * authority even if the router implementation changes.
   */
  if (
    decision.verificationGranted !==
      false ||
    decision.authorityGranted !==
      false ||
    decision.automaticPromotionAllowed !==
      false
  ) {
    throw new Error(
      'TASK_ROUTING_ADMISSION_AUTHORITY_EXPANSION',
    );
  }

  if (
    decision.status ===
      'HOLD'
  ) {
    if (
      decision.provider !==
      null
    ) {
      throw new Error(
        'TASK_ROUTING_ADMISSION_HOLD_PROVIDER_PRESENT',
      );
    }

    return Object.freeze({
      schemaVersion:
        PROVIDER_TASK_ROUTING_ADMISSION_SCHEMA,

      status:
        'HOLD' as const,

      decision,

      record:
        null,

      verificationGranted:
        false as const,

      authorityGranted:
        false as const,

      executionGranted:
        false as const,
    });
  }

  if (
    decision.provider ===
      null
  ) {
    throw new Error(
      'TASK_ROUTING_ADMISSION_ROUTE_PROVIDER_MISSING',
    );
  }

  /*
   * An explicitly pinned order may never silently fall back
   * to the other provider.
   */
  if (
    input.order.affinity !==
      'either' &&
    input.order.affinity !==
      decision.provider
  ) {
    throw new Error(
      'TASK_ROUTING_ADMISSION_PIN_MISMATCH',
    );
  }

  const routedOrder =
    createProviderWorkOrder({
      jobId:
        input.order.jobId,

      baseline:
        input.order.baseline,

      task:
        input.order.task,

      evidenceIds:
        input.order.evidenceIds,

      affinity:
        decision.provider,
    });

  /*
   * This is the authority boundary:
   * routing may only affect affinity before queue admission.
   * claimNext() and all provider execution stay elsewhere.
   */
  const record =
    input.queue.enqueue(
      routedOrder,
      input.nowMs,
      input.taskClass,
    );

  return Object.freeze({
    schemaVersion:
      PROVIDER_TASK_ROUTING_ADMISSION_SCHEMA,

    status:
      'ENQUEUED' as const,

    decision,

    record,

    verificationGranted:
      false as const,

    authorityGranted:
      false as const,

    executionGranted:
      false as const,
  });
}
