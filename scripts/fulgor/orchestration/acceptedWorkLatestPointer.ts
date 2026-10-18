import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';

import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

export const ACCEPTED_WORK_LATEST_POINTER_SCHEMA =
  'VELNAR_ACCEPTED_WORK_LATEST_POINTER_V1' as const;

const MAX_POINTER_BYTES =
  16 * 1024;

const HEX40 =
  /^[0-9a-f]{40}$/;

const SAFE_REQUEST_ID =
  /^[A-Za-z0-9._-]{1,120}$/;

export interface AcceptedWorkLatestPointer {
  readonly schemaVersion:
    typeof ACCEPTED_WORK_LATEST_POINTER_SCHEMA;

  readonly requestId:
    string;

  readonly baseline:
    string;

  readonly runDirectory:
    string;

  readonly queuePath:
    string;

  readonly usefulUnique:
    number;

  readonly completedAtMs:
    number;
}

function exactKeys(
  value:
    Record<string, unknown>,

  keys:
    readonly string[],
): boolean {
  return (
    Object.keys(value)
      .sort()
      .join('\0') ===
    [...keys]
      .sort()
      .join('\0')
  );
}

function record(
  value:
    unknown,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !==
      'object' ||
    Array.isArray(value)
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_INVALID',
    );
  }

  return value as
    Record<string, unknown>;
}

function safeInteger(
  value:
    unknown,
): number {
  if (
    typeof value !==
      'number' ||
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_INTEGER_INVALID',
    );
  }

  return value;
}

function underRoot(
  root:
    string,

  child:
    string,
): boolean {
  const rel =
    relative(
      root,
      child,
    );

  return (
    rel.length >
      0 &&
    rel !==
      '..' &&
    !rel.startsWith(
      `..${process.platform === 'win32'
        ? '\\'
        : '/'}`,
    ) &&
    !isAbsolute(
      rel,
    )
  );
}

async function validateRoot(
  stateRoot:
    string,
): Promise<string> {
  if (
    !isAbsolute(
      stateRoot,
    ) ||
    resolve(
      stateRoot,
    ) !==
      stateRoot
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_ROOT_INVALID',
    );
  }

  const rootInfo =
    await lstat(
      stateRoot,
    );

  if (
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory()
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_ROOT_INVALID',
    );
  }

  if (
    await realpath(
      stateRoot,
    ) !==
      stateRoot
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_ROOT_ALIAS',
    );
  }

  return stateRoot;
}

async function validateTargetBindings(
  stateRoot:
    string,

  requestId:
    string,

  runDirectory:
    string,

  queuePath:
    string,
): Promise<void> {
  if (
    !SAFE_REQUEST_ID.test(
      requestId,
    ) ||
    !isAbsolute(
      runDirectory,
    ) ||
    !isAbsolute(
      queuePath,
    ) ||
    resolve(
      runDirectory,
    ) !==
      runDirectory ||
    resolve(
      queuePath,
    ) !==
      queuePath ||
    !underRoot(
      stateRoot,
      runDirectory,
    ) ||
    dirname(
      queuePath,
    ) !==
      runDirectory ||
    basename(
      queuePath,
    ) !==
      'queue.sqlite' ||
    basename(
      runDirectory,
    ) !==
      `live-8x8-${requestId}`
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_BINDING_INVALID',
    );
  }

  const runInfo =
    await lstat(
      runDirectory,
    );

  const queueInfo =
    await lstat(
      queuePath,
    );

  if (
    runInfo.isSymbolicLink() ||
    !runInfo.isDirectory() ||
    queueInfo.isSymbolicLink() ||
    !queueInfo.isFile()
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_TARGET_INVALID',
    );
  }

  if (
    await realpath(
      runDirectory,
    ) !==
      runDirectory ||
    await realpath(
      queuePath,
    ) !==
      queuePath
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_TARGET_ALIAS',
    );
  }
}

function canonicalPointer(
  value:
    AcceptedWorkLatestPointer,
): string {
  return JSON.stringify({
    schemaVersion:
      value.schemaVersion,

    requestId:
      value.requestId,

    baseline:
      value.baseline,

    runDirectory:
      value.runDirectory,

    queuePath:
      value.queuePath,

    usefulUnique:
      value.usefulUnique,

    completedAtMs:
      value.completedAtMs,
  }) + '\n';
}

export async function
publishAcceptedWorkLatestPointer(
  stateRoot:
    string,

  input:
    AcceptedWorkLatestPointer,
): Promise<string> {
  const root =
    await validateRoot(
      stateRoot,
    );

  if (
    input.schemaVersion !==
      ACCEPTED_WORK_LATEST_POINTER_SCHEMA ||
    !HEX40.test(
      input.baseline,
    ) ||
    !Number.isSafeInteger(
      input.usefulUnique,
    ) ||
    input.usefulUnique <
      0 ||
    input.usefulUnique >
      16 ||
    !Number.isSafeInteger(
      input.completedAtMs,
    ) ||
    input.completedAtMs <
      0
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_INPUT_INVALID',
    );
  }

  await validateTargetBindings(
    root,
    input.requestId,
    input.runDirectory,
    input.queuePath,
  );

  const destination =
    join(
      root,
      'accepted-work-latest.json',
    );

  const temporary =
    join(
      root,
      `.accepted-work-latest-${
        input.requestId
      }.tmp`,
    );

  await rm(
    temporary,
    {
      force:
        true,
    },
  );

  const handle =
    await open(
      temporary,
      'wx',
      0o600,
    );

  try {
    await handle.writeFile(
      canonicalPointer(
        input,
      ),
      'utf8',
    );

    await handle.sync();
  } finally {
    await handle.close();
  }

  await rename(
    temporary,
    destination,
  );

  return destination;
}

export async function
readAcceptedWorkLatestPointer(
  pointerPath:
    string,

  stateRoot:
    string,
): Promise<AcceptedWorkLatestPointer> {
  const root =
    await validateRoot(
      stateRoot,
    );

  const expected =
    join(
      root,
      'accepted-work-latest.json',
    );

  if (
    pointerPath !==
      expected
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_PATH_INVALID',
    );
  }

  const info =
    await lstat(
      pointerPath,
    );

  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.size < 2 ||
    info.size >
      MAX_POINTER_BYTES ||
    (
      info.mode &
      0o077
    ) !==
      0
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_FILE_INVALID',
    );
  }

  if (
    await realpath(
      pointerPath,
    ) !==
      pointerPath
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_FILE_ALIAS',
    );
  }

  let decoded:
    unknown;

  try {
    decoded =
      JSON.parse(
        await readFile(
          pointerPath,
          'utf8',
        ),
      );
  } catch {
    throw new Error(
      'ACCEPTED_WORK_POINTER_JSON_INVALID',
    );
  }

  const value =
    record(
      decoded,
    );

  if (
    !exactKeys(
      value,
      [
        'schemaVersion',
        'requestId',
        'baseline',
        'runDirectory',
        'queuePath',
        'usefulUnique',
        'completedAtMs',
      ],
    ) ||
    value.schemaVersion !==
      ACCEPTED_WORK_LATEST_POINTER_SCHEMA ||
    typeof value.requestId !==
      'string' ||
    typeof value.baseline !==
      'string' ||
    typeof value.runDirectory !==
      'string' ||
    typeof value.queuePath !==
      'string' ||
    !HEX40.test(
      value.baseline,
    )
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_SCHEMA_INVALID',
    );
  }

  const usefulUnique =
    safeInteger(
      value.usefulUnique,
    );

  const completedAtMs =
    safeInteger(
      value.completedAtMs,
    );

  if (
    usefulUnique >
      16
  ) {
    throw new Error(
      'ACCEPTED_WORK_POINTER_USEFUL_COUNT_INVALID',
    );
  }

  await validateTargetBindings(
    root,
    value.requestId,
    value.runDirectory,
    value.queuePath,
  );

  return Object.freeze({
    schemaVersion:
      ACCEPTED_WORK_LATEST_POINTER_SCHEMA,

    requestId:
      value.requestId,

    baseline:
      value.baseline,

    runDirectory:
      value.runDirectory,

    queuePath:
      value.queuePath,

    usefulUnique,
    completedAtMs,
  });
}
