/**
 * @file worker/ai/canary/deepSeekGuardedTransportIdentity.ts
 * @description Guarded Transport Identity & Version Specification.
 * Phase: A.12B.2C-5U.2
 *
 * Provides isolated identity constants to prevent circular dependency cycles
 * between deepSeekCertificationAttestation and deepSeekGuardedLiveTransport.
 */

export const GUARDED_TRANSPORT_MODULE_VERSION = '1.0.0-guarded' as const;
