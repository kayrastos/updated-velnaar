import {
  resolve,
} from 'node:path';

import {
  acceptedWorkFulgorPermitPreviewSummary,
  acceptedWorkFulgorPermitPublishSummary,
  previewAcceptedWorkFulgorPermitCandidate,
  publishAcceptedWorkFulgorPermit,
  type AcceptedWorkFulgorPermitPublishExpectation,
} from './acceptedWorkFulgorPermitPublisher';

function fail(
  message:
    string,
): never {
  process.stderr.write(
    `${message}\n`,
  );

  process.exitCode =
    1;

  throw new Error(
    message,
  );
}

function parseArgs(
  argv:
    readonly string[],
): Map<string, string> {
  const result =
    new Map<
      string,
      string
    >();

  for (
    let index =
      0;

    index <
      argv.length;

    index +=
      2
  ) {
    const key =
      argv[index];

    const value =
      argv[index + 1];

    if (
      typeof key !==
        'string' ||
      !key.startsWith(
        '--',
      ) ||
      typeof value !==
        'string' ||
      value.length ===
        0 ||
      result.has(
        key,
      )
    ) {
      fail(
        'FULGOR_PERMIT_PUBLISHER_ARGUMENTS_INVALID',
      );
    }

    result.set(
      key,
      value,
    );
  }

  return result;
}

function required(
  values:
    ReadonlyMap<string, string>,

  key:
    string,
): string {
  const value =
    values.get(key);

  if (
    typeof value !==
      'string' ||
    value.length ===
      0
  ) {
    fail(
      `FULGOR_PERMIT_PUBLISHER_MISSING_${key.slice(2).toUpperCase().replaceAll('-', '_')}`,
    );
  }

  return value;
}

async function main(): Promise<void> {
  const args =
    parseArgs(
      process.argv.slice(2),
    );

  const mode =
    required(
      args,
      '--mode',
    );

  const options = {
    stateRoot:
      resolve(
        required(
          args,
          '--state-root',
        ),
      ),

    repoRoot:
      resolve(
        required(
          args,
          '--repo-root',
        ),
      ),

    permitRoot:
      resolve(
        required(
          args,
          '--permit-root',
        ),
      ),
  };

  if (
    mode ===
      'preview'
  ) {
    const allowed =
      new Set([
        '--mode',
        '--state-root',
        '--repo-root',
        '--permit-root',
      ]);

    for (
      const key
      of args.keys()
    ) {
      if (
        !allowed.has(
          key,
        )
      ) {
        fail(
          'FULGOR_PERMIT_PREVIEW_ARGUMENT_SURFACE_INVALID',
        );
      }
    }

    const preview =
      await previewAcceptedWorkFulgorPermitCandidate(
        options,
      );

    process.stdout.write(
      acceptedWorkFulgorPermitPreviewSummary(
        preview,
      ),
    );

    return;
  }

  if (
    mode !==
      'publish'
  ) {
    fail(
      'FULGOR_PERMIT_PUBLISHER_MODE_INVALID',
    );
  }

  const allowed =
    new Set([
      '--mode',
      '--state-root',
      '--repo-root',
      '--permit-root',
      '--request-id',
      '--baseline',
      '--bridge-identity',
      '--job-id',
      '--blinded-id',
      '--candidate-identity',
      '--candidate-path',
      '--candidate-sha256',
      '--patch-sha256',
    ]);

  for (
    const key
    of args.keys()
  ) {
    if (
      !allowed.has(
        key,
      )
    ) {
      fail(
        'FULGOR_PERMIT_PUBLISH_ARGUMENT_SURFACE_INVALID',
      );
    }
  }

  const expected:
    AcceptedWorkFulgorPermitPublishExpectation =
      {
        requestId:
          required(
            args,
            '--request-id',
          ),

        baseline:
          required(
            args,
            '--baseline',
          ),

        bridgeIdentity:
          required(
            args,
            '--bridge-identity',
          ),

        jobId:
          required(
            args,
            '--job-id',
          ),

        blindedId:
          required(
            args,
            '--blinded-id',
          ),

        candidateIdentity:
          required(
            args,
            '--candidate-identity',
          ),

        candidatePath:
          required(
            args,
            '--candidate-path',
          ),

        candidateSha256:
          required(
            args,
            '--candidate-sha256',
          ),

        patchSha256:
          required(
            args,
            '--patch-sha256',
          ),
      };

  const result =
    await publishAcceptedWorkFulgorPermit(
      options,
      expected,
    );

  process.stdout.write(
    acceptedWorkFulgorPermitPublishSummary(
      result,
    ),
  );
}

main().catch(
  error => {
    process.stderr.write(
      `${
        error instanceof Error
          ? error.message
          : 'FULGOR_PERMIT_PUBLISHER_UNKNOWN_ERROR'
      }\n`,
    );

    process.exitCode =
      1;
  },
);
