import {
  runLocalContinuousController,
} from './localContinuousControllerRuntime';

const abortController =
  new AbortController();

let stopRequested =
  false;

function requestStop(): void {
  if (stopRequested) {
    return;
  }

  stopRequested = true;

  abortController.abort();
}

process.once(
  'SIGINT',
  requestStop,
);

process.once(
  'SIGTERM',
  requestStop,
);

console.log(
  'FULGOR_CONTINUOUS_RUNNER_STARTING=True',
);

console.log(
  'AUTO_COMMIT=False',
);

console.log(
  'AUTO_PUSH=False',
);

console.log(
  'AUTO_MERGE=False',
);

console.log(
  'AUTO_DEPLOY=False',
);

runLocalContinuousController(
  process.env,
  abortController.signal,
)
  .then(
    (result) => {
      console.log(
        `FULGOR_RUNNER_STOP_REASON=${result.reason}`,
      );

      console.log(
        `FULGOR_RUNNER_CYCLES=${result.cycles}`,
      );
    },
  )
  .catch(
    (error: unknown) => {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error
          ? String(error.code)
          : (
              error instanceof Error
                ? error.name
                : 'UNKNOWN'
            );

      console.error(
        `FULGOR_RUNNER_FAILED=${code}`,
      );

      process.exitCode = 1;
    },
  )
  .finally(
    () => {
      process.off(
        'SIGINT',
        requestStop,
      );

      process.off(
        'SIGTERM',
        requestStop,
      );
    },
  );