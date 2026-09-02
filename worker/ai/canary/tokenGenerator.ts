/**
 * @file worker/ai/canary/tokenGenerator.ts
 * @description Offline cryptographic tool to generate human approval tokens for Phase A.12B.2C-5B.
 * 
 * STRICT INVARIANTS:
 * - 100% OFFLINE: ZERO network calls, zero provider calls.
 * - Enforces the 64-hex capability secret contract:
 *   32 cryptographically random bytes encoded as 64 lowercase hexadecimal characters.
 * - Verifies working tree status (fails closed on dirty working tree).
 * - Requires explicit Phase A.12B.2C-5B and CONTROLLED_CANARY environment target.
 * - Output conforms to CanaryHumanApprovalEnvelope without exposing capability secret.
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

  const approvedBy = (input?.approvedBy || process.env.CANARY_APPROVED_BY || process.env.USER || 'velnar-security-officer').trim();
  if (!approvedBy || approvedBy.length < 3) {
    throw new Error('approvedBy must be a valid identifier of at least 3 characters.');
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

  let sourceCommitSha = (input?.sourceCommitSha || '').trim().toLowerCase();
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
    capabilitySecret,
  };

  const exportCommand = `export VELNAR_CANARY_APPROVAL_TOKEN="${approvalToken}"`;

  return {
    approvalToken,
    envelope,
    exportCommand,
  };
}

// CLI Entrypoint execution
if (process.argv[1] && (process.argv[1].endsWith('tokenGenerator.ts') || process.argv[1].endsWith('tokenGenerator.js'))) {
  try {
    const result = generateOfflineCanaryToken();
    console.log('\n=== Phase A.12B.2C-5B Human Approval Token Generated ===\n');
    console.log(`Approval Token:     ${result.approvalToken}`);
    console.log(`Approved By:        ${result.envelope.approvedBy}`);
    console.log(`Target Phase:       ${result.envelope.targetPhase}`);
    console.log(`Environment Target: ${result.envelope.environmentTarget}`);
    console.log(`Budget MicroUSD:    ${result.envelope.maxBudgetMicroUsd}`);
    console.log(`Timestamp (UTC):    ${result.envelope.approvalTimestamp}`);
    console.log(`Commit SHA:         ${result.envelope.sourceCommitSha}`);
    console.log(`Run Nonce:          ${result.envelope.runNonce}`);
    console.log(`\nBash export statement:`);
    console.log(`  ${result.exportCommand}\n`);
    process.exit(0);
  } catch (err: any) {
    console.error(`\n[FATAL ERROR] Token generation failed: ${err.message}\n`);
    process.exit(1);
  }
}
