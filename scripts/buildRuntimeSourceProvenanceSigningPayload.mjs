#!/usr/bin/env node
/**
 * @file scripts/buildRuntimeSourceProvenanceSigningPayload.mjs
 * @description VELNAR — Offline Canonical Runtime Source Provenance Signing Payload Builder.
 *
 * STRICT SECURITY INVARIANTS:
 * - Pure offline canonical byte serializer and digest generator.
 * - ZERO private keys accepted, read, or processed.
 * - ZERO network calls.
 * - ZERO provider credentials.
 * - Input contains public/non-secret provenance receipt fields ONLY.
 * - Deterministic serialization strictly matches canonical verifier in:
 *   worker/ai/canary/deepSeekTrustedRuntimeSourceProvenance.ts
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

const EXACT_PAYLOAD_KEYS = Object.freeze([
  'provenanceVersion',
  'repositoryFullName',
  'sourceCommitSha',
  'sourceTreeSha',
  'buildArtifactSha256',
  'buildId',
  'deploymentId',
  'environment',
  'issuedAt',
  'expiresAt',
  'issuerId',
  'issuerKeyVersion',
  'algorithm',
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

export function buildRuntimeSourceProvenanceSigningPayload(input) {
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

  // If input is a receipt containing signatureBase64, omit signatureBase64 for signing payload
  const rawPayload = {};
  for (const key of Object.keys(input)) {
    if (key === 'signatureBase64') continue;
    if (!ALLOWED_PAYLOAD_KEYS_SET.has(key)) {
      throw new Error(`UNKNOWN_FIELD: field '${key}' is not permitted in provenance payload`);
    }
    rawPayload[key] = input[key];
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

  // All 13 fields must be strings (coercion prohibited)
  for (const field of EXACT_PAYLOAD_KEYS) {
    if (typeof rawPayload[field] !== 'string') {
      throw new Error(`TYPE_ERROR: field '${field}' must be a string, got ${typeof rawPayload[field]}`);
    }
  }

  // Strict property-by-property deterministic ordering
  const ordered = {
    provenanceVersion: rawPayload.provenanceVersion,
    repositoryFullName: rawPayload.repositoryFullName,
    sourceCommitSha: rawPayload.sourceCommitSha,
    sourceTreeSha: rawPayload.sourceTreeSha,
    buildArtifactSha256: rawPayload.buildArtifactSha256,
    buildId: rawPayload.buildId,
    deploymentId: rawPayload.deploymentId,
    environment: rawPayload.environment,
    issuedAt: rawPayload.issuedAt,
    expiresAt: rawPayload.expiresAt,
    issuerId: rawPayload.issuerId,
    issuerKeyVersion: rawPayload.issuerKeyVersion,
    algorithm: rawPayload.algorithm,
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
      console.error('Usage: node scripts/buildRuntimeSourceProvenanceSigningPayload.mjs <receipt.json>');
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
    const result = buildRuntimeSourceProvenanceSigningPayload(parsed);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('buildRuntimeSourceProvenanceSigningPayload.mjs')) {
  main();
}
