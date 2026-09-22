import type { FindingCandidate, VerificationRequest, VerificationResult, VerificationState } from './types';
import { immutableCopy, protocolError, validateFindingCandidate, validateVerificationRequest, validateVerificationResult } from './validators';

declare const stateBrand: unique symbol;
export interface FindingVerification {
  readonly [stateBrand]: true;
  readonly organizationId: string;
  readonly candidate: FindingCandidate;
  readonly state: VerificationState;
  readonly request?: VerificationRequest;
  readonly result?: VerificationResult;
}
export type VerificationTransition =
  | { readonly type: 'BEGIN'; readonly request: unknown }
  | { readonly type: 'COMPLETE'; readonly result: unknown; readonly evidence: unknown }
  | { readonly type: 'RESOLVE' };

// A serialized/spread/cast object is not a state handle. Only this module mints handles.
// This is in-process provenance, not a durable signature, ACL or hostile-JS sandbox.
const handles = new WeakSet<object>();
function mint(raw: Omit<FindingVerification, typeof stateBrand>): FindingVerification {
  const state = immutableCopy(raw) as FindingVerification;
  handles.add(state); return state;
}
export function createVerificationState(rawCandidate: unknown, expectedOrganizationId: string): FindingVerification {
  // The required expected tenant must not be bypassed with undefined from JavaScript.
  if (typeof expectedOrganizationId !== 'string' || !expectedOrganizationId) protocolError('expected tenant required');
  const candidate = validateFindingCandidate(rawCandidate, expectedOrganizationId);
  return mint({ organizationId: candidate.organizationId, candidate, state: 'CANDIDATE' });
}
export function isFindingVerification(value: unknown): value is FindingVerification {
  return !!value && typeof value === 'object' && handles.has(value);
}
/**
 * The sole VERIFIED promotion mechanism. AI prose/sensor output has no authority.
 * Pure immutable transitions; no execution, persistence, network or implicit retries.
 * RESOLVED closes the workflow on this snapshot; it does NOT prove a fix in a new commit.
 */
export async function transitionVerificationState(current: FindingVerification, raw: VerificationTransition): Promise<FindingVerification> {
  if (!isFindingVerification(current)) protocolError('unrecognized state handle');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) protocolError('invalid transition');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (!descriptors.type || !('value' in descriptors.type)) protocolError('missing transition type');
  const type = descriptors.type.value;
  const fields = type === 'BEGIN' ? ['type', 'request'] : type === 'COMPLETE' ? ['type', 'result', 'evidence'] : type === 'RESOLVE' ? ['type'] : [];
  if (!fields.length || Reflect.ownKeys(raw).length !== fields.length
    || fields.some(k => !descriptors[k] || !('value' in descriptors[k]) || !descriptors[k].enumerable)
    || Reflect.ownKeys(raw).some(k => typeof k !== 'string' || !fields.includes(k))) protocolError('invalid transition fields');
  if (raw.type === 'BEGIN') {
    if (!['CANDIDATE', 'NOT_VERIFIED', 'INCONCLUSIVE'].includes(current.state)) protocolError('BEGIN forbidden from this state');
    const request = validateVerificationRequest(raw.request, current.candidate, current.organizationId);
    if (current.request && (request.requestId === current.request.requestId || request.createdAt < current.result.completedAt)) {
      protocolError('retry requires a new request after previous execution');
    }
    return mint({ organizationId: current.organizationId, candidate: current.candidate, state: 'PENDING_VERIFICATION', request });
  }
  if (raw.type === 'COMPLETE') {
    if (current.state !== 'PENDING_VERIFICATION' || !current.request) protocolError('COMPLETE requires pending verification');
    const result = await validateVerificationResult(raw.result, current.request, current.candidate, raw.evidence, current.organizationId);
    return mint({ organizationId: current.organizationId, candidate: current.candidate, state: result.result, request: current.request, result });
  }
  if (current.state !== 'VERIFIED') protocolError('RESOLVE requires verified workflow');
  return mint({ organizationId: current.organizationId, candidate: current.candidate, state: 'RESOLVED', request: current.request, result: current.result });
}
