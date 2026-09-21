import {
  PersistentFulgorStateStore,
} from '../automation/persistentState';

import {
  runBoundedSupervisorOnce,
} from '../automation/supervisor';

import type {
  SupervisorRunSummary,
} from '../automation/supervisor';

import {
  CloudRunIdTokenTransport,
} from './cloudRunIdTokenTransport';

import {
  L4WorkerClient,
} from './l4WorkerClient';

import type {
  L4WorkerTransport,
} from './l4WorkerClient';

import type {
  FulgorGcpConfig,
} from './gcpConfig';

export function createControllerStateStore(
  config: FulgorGcpConfig,
): PersistentFulgorStateStore {
  return new PersistentFulgorStateStore(
    config.statePath,
    config.queueMaxDepth,
  );
}

export function createCloudRunControllerTransport():
L4WorkerTransport {
  return new CloudRunIdTokenTransport();
}

export async function runGcpControllerOnce(
  config: FulgorGcpConfig,
  transport: L4WorkerTransport,
): Promise<SupervisorRunSummary> {
  const store =
    createControllerStateStore(
      config,
    );

  const worker =
    new L4WorkerClient(
      config,
      transport,
    );

  /*
   * This is a bounded single controller pass.
   * No commit, push, merge, deploy, training,
   * retry loop, or holdout access exists here.
   */
  return runBoundedSupervisorOnce(
    store,
    worker,
    config.maxJobsPerRun,
  );
}

export async function runAuthenticatedGcpControllerOnce(
  config: FulgorGcpConfig,
): Promise<SupervisorRunSummary> {
  /*
   * Production Cloud Run path: Google-signed ID
   * token + exact pinned audience/origin. Runtime
   * service-account identity remains deployment
   * evidence and is not inferred from HTTP body.
   */
  return runGcpControllerOnce(
    config,
    createCloudRunControllerTransport(),
  );
}
