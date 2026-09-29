import {
  spawnSync,
} from 'node:child_process';

import {
  L4WorkerClientError,
} from './l4WorkerClient';

import type {
  L4Fetch,
  L4IdTokenProvider,
} from './cloudRunIdTokenTransport';

export interface GcloudAccessTokenCommandResult {
  status: number | null;
  stdout: string;
}

export type GcloudAccessTokenCommand =
  () => GcloudAccessTokenCommandResult;

function fail(): never {
  throw new L4WorkerClientError(
    'TRANSPORT_ERROR',
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

function assertAudience(
  audience: string,
): void {
  let parsed: URL;

  try {
    parsed = new URL(audience);
  } catch {
    return fail();
  }

  const hostname =
    parsed.hostname.toLowerCase();

  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length !== 0 ||
    parsed.password.length !== 0 ||
    parsed.port.length !== 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0 ||
    !hostname.endsWith('.run.app') ||
    hostname === 'run.app' ||
    parsed.origin !== audience
  ) {
    return fail();
  }
}

function assertServiceAccount(
  value: string,
): void {
  if (
    !/^[a-z0-9][a-z0-9._-]*@[a-z0-9-]+\.iam\.gserviceaccount\.com$/i
      .test(value)
  ) {
    return fail();
  }
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
    status: result.status,

    stdout:
      typeof result.stdout === 'string'
        ? result.stdout
        : '',
  };
}

function decodeClaims(
  token: string,
): Record<string, unknown> {
  const parts =
    token.split('.');

  if (parts.length !== 3) {
    return fail();
  }

  let decoded: unknown;

  try {
    decoded =
      JSON.parse(
        Buffer
          .from(
            parts[1],
            'base64url',
          )
          .toString('utf8'),
      );
  } catch {
    return fail();
  }

  if (!isRecord(decoded)) {
    return fail();
  }

  return decoded;
}

export class GcloudIamIdTokenProvider
implements L4IdTokenProvider {
  private readonly controllerServiceAccount: string;

  private readonly accessTokenCommand: GcloudAccessTokenCommand;

  private readonly fetchImpl: L4Fetch;

  constructor(
    controllerServiceAccount: string,
    accessTokenCommand:
      GcloudAccessTokenCommand =
        defaultAccessTokenCommand,
    fetchImpl:
      L4Fetch = globalThis.fetch,
  ) {
    assertServiceAccount(
      controllerServiceAccount,
    );

    this.controllerServiceAccount =
      controllerServiceAccount;

    this.accessTokenCommand =
      accessTokenCommand;

    this.fetchImpl =
      fetchImpl;
  }

  async fetchIdToken(
    audience: string,
  ): Promise<string> {
    assertAudience(audience);

    const commandResult =
      this.accessTokenCommand();

    if (
      commandResult.status !== 0 ||
      typeof commandResult.stdout
        !== 'string'
    ) {
      return fail();
    }

    const accessToken =
      commandResult.stdout.trim();

    if (
      accessToken.length === 0 ||
      /\s/.test(accessToken)
    ) {
      return fail();
    }

    const uri =
      'https://iamcredentials.googleapis.com/v1/' +
      'projects/-/serviceAccounts/' +
      encodeURIComponent(
        this.controllerServiceAccount,
      ) +
      ':generateIdToken';

    let response: Response;

    try {
      response =
        await this.fetchImpl(
          uri,
          {
            method: 'POST',

            headers: {
              authorization:
                `Bearer ${accessToken}`,

              'content-type':
                'application/json',
            },

            body:
              JSON.stringify({
                audience,
                includeEmail: true,
              }),
          },
        );
    } catch {
      return fail();
    }

    if (!response.ok) {
      return fail();
    }

    let payload: unknown;

    try {
      payload =
        await response.json();
    } catch {
      return fail();
    }

    if (!isRecord(payload)) {
      return fail();
    }

    const token =
      payload.token;

    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      /\s/.test(token)
    ) {
      return fail();
    }

    const claims =
      decodeClaims(token);

    if (
      claims.aud !== audience ||
      claims.email !==
        this.controllerServiceAccount
    ) {
      return fail();
    }

    return token;
  }
}