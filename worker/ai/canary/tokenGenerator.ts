/**
 * @file worker/ai/canary/tokenGenerator.ts
 * @description Offline cryptographic tool to generate human approval tokens for Phase A.12B.2C-5B.
 * 
 * STRICT INVARIANTS:
 * - 100% OFFLINE: ZERO network calls, zero provider calls.
 * - Enforces the 64-hex capability secret contract:
 *   32 cryptographically random bytes encoded as 64 lowercase hexadecimal characters.
 * - Fails closed on dirty working tree.
 * - Requires explicit Phase A.12B.2C-5B and CONTROLLED_CANARY environment target.
 * - Strict CLI parsing for documented arguments: --approved-by, --max-budget-micro-usd, --target-phase.
 * - Capability secret is strictly redacted and NEVER included in TokenGeneratorResult or envelope.
 */

import * as crypto from 'crypto';
import * as child_process from 'child_process';
import {
  CANARY_SPECIFICATION_VERSION,
  CanaryHumanApprovalEnvelope,
  generateCanaryApprovalToken,
  isValidCapabilitySecret,
} from './canarySpecification';

export interface TokenGeneratorInput {
  approvedBy?: string;
  targetPhase?: 'A.12B.2C-5B';
  environmentTarget?: 'CONTROLLED_CANARY';
  dateYyyyMmDd?: string;
  maxBudgetMicroUsd?: number;
  approvalTimestamp?: string;
  specificationVersion?: string;
  sourceCommitSha?: string;
  runNonce?: string;
  capabilitySecret?: string;
  allowDirtyGit?: boolean;
}

export interface TokenGeneratorResult {
  approvalToken: string;
  envelope: CanaryHumanApprovalEnvelope;
  exportCommand: string;
  exportBundle: string;
}

/**
 * Strict CLI argument parser for token generator invocation.
 * Rejects unknown or security-sensitive arguments, invalid budgets, wrong phases, and empty approved-by.
 */
export function parseTokenGeneratorCliArgs(argv: string[]): TokenGeneratorInput {
  const result: TokenGeneratorInput = {};
  let i = 0;

  while (i < argv.length) {
    const rawArg = argv[i];
    if (!rawArg) {
      i++;
      continue;
    }

    if (rawArg === '--allow-dirty-git') {
      result.allowDirtyGit = true;
      i++;
      continue;
    }

    if (rawArg.startsWith('--approved-by=')) {
      const val = rawArg.slice('--approved-by='.length).trim();
      if (!val) {
        throw new Error("Argument '--approved-by' cannot be empty.");
      }
      result.approvedBy = val;
      i++;
      continue;
    } else if (rawArg === '--approved-by') {
      i++;
      if (i >= argv.length || argv[i].startsWith('--')) {
        throw new Error("Argument '--approved-by' requires a non-empty value.");
      }
      const val = argv[i].trim();
      if (!val) {
        throw new Error("Argument '--approved-by' cannot be empty.");
      }
      result.approvedBy = val;
      i++;
      continue;
    }

    if (rawArg.startsWith('--max-budget-micro-usd=')) {
      const valStr = rawArg.slice('--max-budget-micro-usd='.length).trim();
      const val = Number(valStr);
      if (!valStr || !Number.isInteger(val) || val <= 0 || val > 50000) {
        throw new Error(`Argument '--max-budget-micro-usd' must be an integer between 1 and 50000 microUSD (got '${valStr}').`);
      }
      result.maxBudgetMicroUsd = val;
      i++;
      continue;
    } else if (rawArg === '--max-budget-micro-usd') {
      i++;
      if (i >= argv.length || argv[i].startsWith('--')) {
        throw new Error("Argument '--max-budget-micro-usd' requires an integer value between 1 and 50000.");
      }
      const valStr = argv[i].trim();
      const val = Number(valStr);
      if (!valStr || !Number.isInteger(val) || val <= 0 || val > 50000) {
        throw new Error(`Argument '--max-budget-micro-usd' must be an integer between 1 and 50000 microUSD (got '${valStr}').`);
      }
      result.maxBudgetMicroUsd = val;
      i++;
      continue;
    }

    if (rawArg.startsWith('--target-phase=')) {
      const val = rawArg.slice('--target-phase='.length).trim();
      if (val !== 'A.12B.2C-5B') {
        throw new Error(`Argument '--target-phase' must be exactly 'A.12B.2C-5B' (got '${val}').`);
      }
      result.targetPhase = 'A.12B.2C-5B';
      i++;
      continue;
    } else if (rawArg === '--target-phase') {
      i++;
      if (i >= argv.length || argv[i].startsWith('--')) {
        throw new Error("Argument '--target-phase' requires a value of 'A.12B.2C-5B'.");
      }
      const val = argv[i].trim();
      if (val !== 'A.12B.2C-5B') {
        throw new Error(`Argument '--target-phase' must be exactly 'A.12B.2C-5B' (got '${val}').`);
      }
      result.targetPhase = 'A.12B.2C-5B';
      i++;
      continue;
    }

    if (rawArg.startsWith('--source-commit-sha=')) {
      const val = rawArg.slice('--source-commit-sha='.length).trim().toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(val)) {
        throw new Error("Argument '--source-commit-sha' must be 40 lowercase hexadecimal characters.");
      }
      result.sourceCommitSha = val;
      i++;
      continue;
    } else if (rawArg === '--source-commit-sha') {
      i++;
      if (i >= argv.length || argv[i].startsWith('--')) {
        throw new Error("Argument '--source-commit-sha' requires a 40-character hex value.");
      }
      const val = argv[i].trim().toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(val)) {
        throw new Error("Argument '--source-commit-sha' must be 40 lowercase hexadecimal characters.");
      }
      result.sourceCommitSha = val;
      i++;
      continue;
    }

    // Reject unknown or unauthorized arguments
    throw new Error(
      `Unknown or unauthorized argument: '${rawArg}'. Supported arguments: --approved-by, --max-budget-micro-usd, --target-phase, --source-commit-sha, --allow-dirty-git.`
    );
  }

  return result;
}

/**
 * Resolves current git commit SHA (40 hex characters) and checks working tree.
 */
export function resolveGitState(cwd: string = process.cwd(), allowDirty: boolean = false): string {
  try {
    const statusOutput = child_process.execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (statusOutput.length > 0 && !allowDirty) {
      throw new Error(`Git working tree is dirty (${statusOutput.split('\n').length} uncommitted file(s)). Commit or stash changes before generating approval token.`);
    }

    const sha = child_process.execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().toLowerCase();

    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`Invalid git commit SHA resolved from repository: '${sha}'. Expected 40 lowercase hex characters.`);
    }

    return sha;
  } catch (err: any) {
    throw new Error(`Git state resolution failed: ${err.message}`);
  }
}

/**
 * Formats a Date into UTC YYYYMMDD string.
 */
export function formatUtcYyyyMmDd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Generates an approval token and CanaryHumanApprovalEnvelope offline.
 * Capability secret is strictly redacted from public output.
 */
export function generateOfflineCanaryToken(input?: TokenGeneratorInput): TokenGeneratorResult {
  const now = new Date();
  const targetPhase = input?.targetPhase ?? 'A.12B.2C-5B';
  if (targetPhase !== 'A.12B.2C-5B') {
    throw new Error(`Target phase must be 'A.12B.2C-5B', received: '${targetPhase}'.`);
  }

  const environmentTarget = input?.environmentTarget ?? 'CONTROLLED_CANARY';
  if (environmentTarget !== 'CONTROLLED_CANARY') {
    throw new Error(`Environment target must be 'CONTROLLED_CANARY', received: '${environmentTarget}'.`);
  }

  const capabilitySecret = (input?.capabilitySecret || process.env.VELNAR_CANARY_CAPABILITY_SECRET || '').trim();
  if (!capabilitySecret) {
    throw new Error(
      'VELNAR_CANARY_CAPABILITY_SECRET is missing. Provide via options or set VELNAR_CANARY_CAPABILITY_SECRET in environment.\n' +
      'Format requirement: exactly 32 cryptographically random bytes encoded as 64 lowercase hexadecimal characters (generate via: openssl rand -hex 32).'
    );
  }

  if (!isValidCapabilitySecret(capabilitySecret)) {
    throw new Error(
      `Invalid capability secret format. Must be exactly 64 lowercase hexadecimal characters (32 bytes entropy).\n` +
      `Received length: ${capabilitySecret.length}.`
    );
  }

  const approvedBy = (input?.approvedBy || process.env.VELNAR_CANARY_APPROVED_BY || process.env.CANARY_APPROVED_BY || '').trim();
  if (!approvedBy || approvedBy.length < 3) {
    throw new Error(
      'approvedBy is required and must be at least 3 characters. Provide via --approved-by CLI argument or set VELNAR_CANARY_APPROVED_BY in the environment.'
    );
  }

  const dateYyyyMmDd = input?.dateYyyyMmDd || formatUtcYyyyMmDd(now);
  if (!/^\d{8}$/.test(dateYyyyMmDd)) {
    throw new Error(`dateYyyyMmDd must be exactly 8 digits (YYYYMMDD), received: '${dateYyyyMmDd}'.`);
  }

  const maxBudgetMicroUsd = input?.maxBudgetMicroUsd ?? 50000;
  if (!Number.isInteger(maxBudgetMicroUsd) || maxBudgetMicroUsd <= 0 || maxBudgetMicroUsd > 50000) {
    throw new Error(`maxBudgetMicroUsd must be an integer between 1 and 50000 microUSD (got ${maxBudgetMicroUsd}).`);
  }

  const approvalTimestamp = input?.approvalTimestamp || now.toISOString();
  const specificationVersion = input?.specificationVersion || CANARY_SPECIFICATION_VERSION;
  const runNonce = input?.runNonce || Buffer.from(crypto.randomBytes(16)).toString('hex');

  let sourceCommitSha = (input?.sourceCommitSha || process.env.GIT_COMMIT_SHA || process.env.VELNAR_CANARY_SOURCE_COMMIT || '').trim().toLowerCase();
  if (!sourceCommitSha) {
    sourceCommitSha = resolveGitState(process.cwd(), input?.allowDirtyGit ?? false);
  } else if (!/^[0-9a-f]{40}$/.test(sourceCommitSha)) {
    throw new Error(`sourceCommitSha must be exactly 40 lowercase hexadecimal characters, received: '${sourceCommitSha}'.`);
  }

  const approvalToken = generateCanaryApprovalToken({
    approvedBy,
    targetPhase,
    environmentTarget,
    dateYyyyMmDd,
    maxBudgetMicroUsd,
    approvalTimestamp,
    specificationVersion,
    sourceCommitSha,
    runNonce,
    capabilitySecret,
  });

  // Redact capability secret completely from the return envelope
  const envelope: CanaryHumanApprovalEnvelope = {
    approvalToken,
    approvedBy,
    targetPhase,
    environmentTarget,
    maxBudgetMicroUsd,
    approvalTimestamp,
    specificationVersion,
    sourceCommitSha,
    runNonce,
  };
  delete (envelope as any).capabilitySecret;

  const exportCommand = `export VELNAR_CANARY_APPROVAL_TOKEN="${approvalToken}"`;
  const exportBundle = [
    `export VELNAR_CANARY_APPROVAL_TOKEN="${approvalToken}"`,
    `export VELNAR_CANARY_APPROVED_BY="${approvedBy}"`,
    `export APPROVAL_TIMESTAMP="${approvalTimestamp}"`,
    `export GIT_COMMIT_SHA="${sourceCommitSha}"`,
    `export VELNAR_CANARY_RUN_NONCE="${runNonce}"`,
    `export VELNAR_CANARY_MAX_BUDGET_MICRO_USD="${maxBudgetMicroUsd}"`,
    `export VELNAR_CANARY_PHASE="${targetPhase}"`,
  ].join('\n');

  return {
    approvalToken,
    envelope,
    exportCommand,
    exportBundle,
  };
}

// CLI Entrypoint execution
if (process.argv[1] && (process.argv[1].endsWith('tokenGenerator.ts') || process.argv[1].endsWith('tokenGenerator.js'))) {
  try {
    const rawArgs = process.argv.slice(2);
    const parsedArgs = parseTokenGeneratorCliArgs(rawArgs);
    const result = generateOfflineCanaryToken(parsedArgs);
    console.log('\n=== Phase A.12B.2C-5B Human Approval Token Generated ===\n');
    console.log(`Approval Token:     ${result.approvalToken}`);
    console.log(`Approved By:        ${result.envelope.approvedBy}`);
    console.log(`Target Phase:       ${result.envelope.targetPhase}`);
    console.log(`Environment Target: ${result.envelope.environmentTarget}`);
    console.log(`Budget MicroUSD:    ${result.envelope.maxBudgetMicroUsd}`);
    console.log(`Timestamp (UTC):    ${result.envelope.approvalTimestamp}`);
    console.log(`Commit SHA:         ${result.envelope.sourceCommitSha}`);
    console.log(`Run Nonce:          ${result.envelope.runNonce}`);
    console.log(`\nBash export statements (Operator Metadata Bundle):`);
    console.log(result.exportBundle);
    console.log('');
    process.exit(0);
  } catch (err: any) {
    console.error(`\n[FATAL ERROR] Token generation failed: ${err.message}\n`);
    process.exit(1);
  }
}
