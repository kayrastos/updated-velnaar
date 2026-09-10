#!/usr/bin/env node
/**
 * @file scripts/buildHumanAuthorizationSigningPayload.mjs
 * @description VELNAR — Offline Canonical Human Authorization Signing Payload Builder.
 *
 * STRICT SECURITY INVARIANTS:
 * - Pure offline canonical byte serializer and digest generator.
 * - ZERO private keys accepted, read, or processed.
 * - ZERO network calls.
 * - ZERO provider credentials.
 * - Input contains public/non-secret authorization fields ONLY.
 * - Deterministic serialization strictly matches canonical verifier in:
 *   worker/ai/canary/deepSeekCertificationAttestation.ts
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

const EXACT_PAYLOAD_KEYS = Object.freeze([
  'authorizationVersion',
  'authorityId',
  'issuedAt',
  'expiresAt',
  'targetProgram',
  'pricingWindow',
  'candidateId',
  'sourceCommitSha',
  'sourceTreeSha',
  'specificationVersion',
  'maxBudgetMicroUsd',
  'runNonce',
  'singleUse',
  'provider',
  'model',
  'canonicalTaskCount',
  'transportContractVersion',
  'guardedTransportModuleVersion',
  'sourceAttestationDigest',
]);

const ALLOWED_PAYLOAD_KEYS_SET = new Set(EXACT_PAYLOAD_KEYS);

const FORBIDDEN_SECRET_KEYS = Object.freeze([
  'privatekey',
  'private_key',
  'privatekeypath',
  'private_key_path',
  'privatekeypem',
  'private_key_pem',
  'secret',
  'secretkey',
  'secret_key',
  'seed',
  'password',
]);

export function buildHumanAuthorizationSigningPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('INPUT_INVALID: input must be a non-null object');
  }

  // 1. Scan for forbidden secret keys
  for (const key of Object.keys(input)) {
    for (const forbidden of FORBIDDEN_SECRET_KEYS) {
      if (key.toLowerCase().includes(forbidden.toLowerCase())) {
        throw new Error(
          `SECURITY_VIOLATION: prohibited secret or key field '${key}' detected in input. ` +
          `Private keys must NEVER be passed to signing payload builders.`
        );
      }
    }
  }

  // If wrapped in payload property (e.g. { payload: { ... } }), unwrap
  const rawPayload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload
    : input;

  // Check for unknown keys
  for (const key of Object.keys(rawPayload)) {
    if (!ALLOWED_PAYLOAD_KEYS_SET.has(key)) {
      throw new Error(`UNKNOWN_FIELD: field '${key}' is not permitted in human authorization payload`);
    }
  }

  // Check for missing required own properties
  for (const key of EXACT_PAYLOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rawPayload, key)) {
      throw new Error(`MISSING_FIELD: required field '${key}' must be an own property of payload`);
    }
    if (rawPayload[key] === undefined || rawPayload[key] === null) {
      throw new Error(`NULL_OR_UNDEFINED_FIELD: required field '${key}' cannot be null or undefined`);
    }
  }

  // Exact type validation
  const requiredStringFields = [
    'authorizationVersion',
    'authorityId',
    'issuedAt',
    'expiresAt',
    'targetProgram',
    'pricingWindow',
    'candidateId',
    'sourceCommitSha',
    'sourceTreeSha',
    'specificationVersion',
    'runNonce',
    'provider',
    'model',
    'transportContractVersion',
    'guardedTransportModuleVersion',
    'sourceAttestationDigest',
  ];

  for (const field of requiredStringFields) {
    if (typeof rawPayload[field] !== 'string') {
      throw new Error(`TYPE_ERROR: field '${field}' must be a string, got ${typeof rawPayload[field]}`);
    }
  }

  if (
    typeof rawPayload.maxBudgetMicroUsd !== 'number' ||
    !Number.isFinite(rawPayload.maxBudgetMicroUsd) ||
    !Number.isInteger(rawPayload.maxBudgetMicroUsd)
  ) {
    throw new Error("TYPE_ERROR: field 'maxBudgetMicroUsd' must be a finite integer number");
  }

  if (typeof rawPayload.singleUse !== 'boolean') {
    throw new Error("TYPE_ERROR: field 'singleUse' must be a boolean");
  }

  if (
    typeof rawPayload.canonicalTaskCount !== 'number' ||
    !Number.isFinite(rawPayload.canonicalTaskCount) ||
    !Number.isInteger(rawPayload.canonicalTaskCount)
  ) {
    throw new Error("TYPE_ERROR: field 'canonicalTaskCount' must be a finite integer number");
  }

  // Strict property-by-property deterministic ordering
  const ordered = {
    authorizationVersion: rawPayload.authorizationVersion,
    authorityId: rawPayload.authorityId,
    issuedAt: rawPayload.issuedAt,
    expiresAt: rawPayload.expiresAt,
    targetProgram: rawPayload.targetProgram,
    pricingWindow: rawPayload.pricingWindow,
    candidateId: rawPayload.candidateId,
    sourceCommitSha: rawPayload.sourceCommitSha,
    sourceTreeSha: rawPayload.sourceTreeSha,
    specificationVersion: rawPayload.specificationVersion,
    maxBudgetMicroUsd: rawPayload.maxBudgetMicroUsd,
    runNonce: rawPayload.runNonce,
    singleUse: rawPayload.singleUse,
    provider: rawPayload.provider,
    model: rawPayload.model,
    canonicalTaskCount: rawPayload.canonicalTaskCount,
    transportContractVersion: rawPayload.transportContractVersion,
    guardedTransportModuleVersion: rawPayload.guardedTransportModuleVersion,
    sourceAttestationDigest: rawPayload.sourceAttestationDigest,
  };

  const canonicalPayload = JSON.stringify(ordered);
  const payloadSha256 = crypto
    .createHash('sha256')
    .update(canonicalPayload, 'utf8')
    .digest('hex')
    .toLowerCase();

  return {
    canonicalPayload,
    payloadSha256,
    byteLength: Buffer.byteLength(canonicalPayload, 'utf8'),
    orderedPayload: ordered,
    signingInstructions: {
      algorithm: 'Ed25519',
      procedure: 'Sign the UTF-8 bytes of canonicalPayload using Ed25519 private key outside repository and AI context.',
      opensslExample: 'echo -n "$CANONICAL_PAYLOAD" | openssl pkeyutl -sign -rawin -inkey ed25519_private.pem | base64',
      nodeExample: 'crypto.sign(null, Buffer.from(canonicalPayload, "utf8"), privateKey).toString("base64")',
    },
  };
}

// CLI execution if invoked directly
function main() {
  const args = process.argv.slice(2);
  let rawInput = '';

  if (args.length > 0 && args[0] !== '-') {
    const filePath = args[0];
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    rawInput = fs.readFileSync(filePath, 'utf8');
  } else {
    try {
      rawInput = fs.readFileSync(0, 'utf8');
    } catch {
      console.error('Usage: node scripts/buildHumanAuthorizationSigningPayload.mjs <payload.json>');
      process.exit(1);
    }
  }

  if (!rawInput.trim()) {
    console.error('Error: Empty input provided');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawInput);
  } catch (err) {
    console.error(`Error: Invalid JSON input: ${err.message}`);
    process.exit(1);
  }

  try {
    const result = buildHumanAuthorizationSigningPayload(parsed);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('buildHumanAuthorizationSigningPayload.mjs')) {
  main();
}
