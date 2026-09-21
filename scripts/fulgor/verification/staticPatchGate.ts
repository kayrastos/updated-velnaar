export type StaticPatchGateFailureCode =
  | 'EMPTY_PATCH'
  | 'MALFORMED_PATCH'
  | 'UNSAFE_PATH'
  | 'OUTSIDE_DECLARED_SCOPE'
  | 'FORBIDDEN_PATH'
  | 'MAX_FILES_EXCEEDED'
  | 'MAX_HUNKS_EXCEEDED'
  | 'MAX_CHANGED_LINES_EXCEEDED'
  | 'PATCH_APPLY_FAILED';

export interface StaticPatchGatePolicy {
  allowedScope: readonly string[];
  forbiddenPaths: readonly string[];
  maxFiles: number;
  maxHunks: number;
  maxChangedLines: number;
}

export interface StaticPatchGateInput {
  patch: string;
  dryRunApplySucceeded: boolean;
}

export interface StaticPatchGateResult {
  accepted: boolean;
  failureCode: StaticPatchGateFailureCode | null;
  touchedFiles: readonly string[];
  hunkCount: number;
  changedLineCount: number;
}

interface ParsedPatch {
  touchedFiles: string[];
  hunkCount: number;
  changedLineCount: number;
}

const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function normalizePath(input: string): string {
  if (
    input.length === 0 ||
    input.includes('\0') ||
    input.startsWith('/') ||
    input.startsWith('\\') ||
    /^[A-Za-z]:/.test(input)
  ) {
    throw new Error('UNSAFE_PATH');
  }

  const normalized = input.replace(/\\/g, '/');
  const parts = normalized.split('/');

  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === '.' ||
        part === '..' ||
        /[<>:"|?*\u0000-\u001f]/.test(part) ||
        /[ .]$/.test(part) ||
        WINDOWS_RESERVED.test(part),
    )
  ) {
    throw new Error('UNSAFE_PATH');
  }

  return parts.join('/');
}

function pathWithin(
  path: string,
  root: string,
): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function parsePatch(patch: string): ParsedPatch {
  if (patch.trim().length === 0) {
    throw new Error('EMPTY_PATCH');
  }

  const touched = new Set<string>();
  let hunkCount = 0;
  let changedLineCount = 0;
  let inHunk = false;

  for (const line of patch.split(/\r?\n/)) {
    const diffMatch =
      /^diff --git a\/(.+) b\/(.+)$/.exec(line);

    if (diffMatch) {
      const left = normalizePath(diffMatch[1]);
      const right = normalizePath(diffMatch[2]);

      if (left !== right) {
        touched.add(left);
        touched.add(right);
      } else {
        touched.add(right);
      }

      inHunk = false;
      continue;
    }

    if (/^@@ /.test(line)) {
      hunkCount += 1;
      inHunk = true;
      continue;
    }

    if (
      inHunk &&
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      changedLineCount += 1;
    }
  }

  if (touched.size === 0) {
    throw new Error('MALFORMED_PATCH');
  }

  return {
    touchedFiles: [...touched].sort(),
    hunkCount,
    changedLineCount,
  };
}

function failure(
  code: StaticPatchGateFailureCode,
  parsed?: ParsedPatch,
): StaticPatchGateResult {
  return {
    accepted: false,
    failureCode: code,
    touchedFiles: parsed?.touchedFiles ?? [],
    hunkCount: parsed?.hunkCount ?? 0,
    changedLineCount:
      parsed?.changedLineCount ?? 0,
  };
}

function positiveInteger(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value > 0
  );
}

export function evaluateStaticPatchGate(
  input: StaticPatchGateInput,
  policy: StaticPatchGatePolicy,
): StaticPatchGateResult {
  if (
    !positiveInteger(policy.maxFiles) ||
    !positiveInteger(policy.maxHunks) ||
    !positiveInteger(policy.maxChangedLines)
  ) {
    return failure('MALFORMED_PATCH');
  }

  let parsed: ParsedPatch;

  try {
    parsed = parsePatch(input.patch);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '';

    if (message === 'EMPTY_PATCH') {
      return failure('EMPTY_PATCH');
    }

    if (message === 'UNSAFE_PATH') {
      return failure('UNSAFE_PATH');
    }

    return failure('MALFORMED_PATCH');
  }

  if (
    parsed.hunkCount === 0 ||
    parsed.changedLineCount === 0
  ) {
    return failure('EMPTY_PATCH', parsed);
  }

  if (parsed.touchedFiles.length > policy.maxFiles) {
    return failure('MAX_FILES_EXCEEDED', parsed);
  }

  let normalizedScope: string[];
  let normalizedForbidden: string[];

  try {
    normalizedScope =
      policy.allowedScope.map(normalizePath);

    normalizedForbidden =
      policy.forbiddenPaths.map(normalizePath);
  } catch {
    return failure('UNSAFE_PATH', parsed);
  }

  for (const file of parsed.touchedFiles) {
    const inScope = normalizedScope.some(
      (scope) => pathWithin(file, scope),
    );

    if (!inScope) {
      return failure(
        'OUTSIDE_DECLARED_SCOPE',
        parsed,
      );
    }

    const forbidden =
      normalizedForbidden.some(
        (entry) => pathWithin(file, entry),
      );

    if (forbidden) {
      return failure('FORBIDDEN_PATH', parsed);
    }
  }

  if (parsed.hunkCount > policy.maxHunks) {
    return failure('MAX_HUNKS_EXCEEDED', parsed);
  }

  if (
    parsed.changedLineCount >
    policy.maxChangedLines
  ) {
    return failure(
      'MAX_CHANGED_LINES_EXCEEDED',
      parsed,
    );
  }

  if (!input.dryRunApplySucceeded) {
    return failure('PATCH_APPLY_FAILED', parsed);
  }

  return {
    accepted: true,
    failureCode: null,
    touchedFiles: parsed.touchedFiles,
    hunkCount: parsed.hunkCount,
    changedLineCount: parsed.changedLineCount,
  };
}