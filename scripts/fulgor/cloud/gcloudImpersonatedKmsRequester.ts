import {
  spawnSync,
} from 'node:child_process';

import type {
  GcpKmsRequester,
  GcpKmsSignRequest,
} from './gcpKmsEvidenceSigner';

export type GcloudAccessTokenCommandResult = {
  status: number | null;
  stdout: string;
};

export type GcloudAccessTokenCommand =
  () => GcloudAccessTokenCommandResult;

export type ImpersonatedKmsFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const SERVICE_ACCOUNT =
  /^[a-z0-9][a-z0-9._-]*@[a-z0-9-]+\.iam\.gserviceaccount\.com$/i;

const KMS_URL =
  /^https:\/\/cloudkms\.googleapis\.com\/v1\/projects\/[^/\s]+\/locations\/[^/\s]+\/keyRings\/[^/\s]+\/cryptoKeys\/[^/\s]+\/cryptoKeyVersions\/[^/\s]+:asymmetricSign$/;

function fail(): never {
  throw new Error(
    'GCLOUD_IMPERSONATED_KMS_REQUEST_FAILED',
  );
}

function validToken(
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 16384 &&
    !/\s/.test(value)
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function defaultAccessTokenCommand():
GcloudAccessTokenCommandResult {
  const shell =
    process.env.ComSpec ??
    'C:\\Windows\\System32\\cmd.exe';

  const result =
    spawnSync(
      shell,
      [
        '/d',
        '/s',
        '/c',
        'gcloud.cmd auth print-access-token --quiet',
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );

  return {
    status:
      result.status,

    stdout:
      typeof result.stdout === 'string'
        ? result.stdout
        : '',
  };
}

function assertRequest(
  request: GcpKmsSignRequest,
): void {
  if (
    request.method !== 'POST' ||
    !KMS_URL.test(request.url) ||
    typeof request.data.data !== 'string' ||
    request.data.data.length === 0 ||
    request.data.data.length > 2_000_000
  ) {
    return fail();
  }
}

export function createGcloudImpersonatedKmsRequester(
  controllerServiceAccount: string,
  accessTokenCommand:
    GcloudAccessTokenCommand =
      defaultAccessTokenCommand,
  fetchImpl:
    ImpersonatedKmsFetch =
      globalThis.fetch,
): GcpKmsRequester {
  if (
    !SERVICE_ACCOUNT.test(
      controllerServiceAccount,
    )
  ) {
    return fail();
  }

  return async (
    request: GcpKmsSignRequest,
  ): Promise<unknown> => {
    assertRequest(request);

    const commandResult =
      accessTokenCommand();

    const sourceAccessToken =
      commandResult.stdout.trim();

    if (
      commandResult.status !== 0 ||
      !validToken(sourceAccessToken)
    ) {
      return fail();
    }

    const iamUrl =
      'https://iamcredentials.googleapis.com/v1/' +
      'projects/-/serviceAccounts/' +
      encodeURIComponent(
        controllerServiceAccount,
      ) +
      ':generateAccessToken';

    let iamResponse: Response;

    try {
      iamResponse =
        await fetchImpl(
          iamUrl,
          {
            method: 'POST',

            headers: {
              authorization:
                `Bearer ${sourceAccessToken}`,

              'content-type':
                'application/json',
            },

            body:
              JSON.stringify({
                scope: [
                  'https://www.googleapis.com/auth/cloud-platform',
                ],

                lifetime:
                  '3600s',
              }),
          },
        );
    } catch {
      return fail();
    }

    if (!iamResponse.ok) {
      return fail();
    }

    let iamBody: unknown;

    try {
      iamBody =
        await iamResponse.json();
    } catch {
      return fail();
    }

    if (
      !isRecord(iamBody) ||
      !validToken(
        iamBody.accessToken,
      )
    ) {
      return fail();
    }

    const controllerAccessToken =
      iamBody.accessToken;

    let kmsResponse: Response;

    try {
      kmsResponse =
        await fetchImpl(
          request.url,
          {
            method: 'POST',

            headers: {
              authorization:
                `Bearer ${controllerAccessToken}`,

              'content-type':
                'application/json',
            },

            body:
              JSON.stringify(
                request.data,
              ),
          },
        );
    } catch {
      return fail();
    }

    if (!kmsResponse.ok) {
      return fail();
    }

    try {
      return await kmsResponse.json();
    } catch {
      return fail();
    }
  };
}