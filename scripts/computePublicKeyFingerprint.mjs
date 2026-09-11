#!/usr/bin/env node
/**
 * @file scripts/computePublicKeyFingerprint.mjs
 * @description VELNAR — Offline Public Key Fingerprint Generator.
 *
 * STRICT SECURITY INVARIANTS:
 * - Pure offline public key reader and SHA-256 fingerprint generator.
 * - Accepts ONLY public key PEM files (SPKI format).
 * - Categorically REJECTS private keys.
 * - ZERO network calls.
 * - Canonical normalization: pem.trim().replace(/\r\n/g, '\n')
 * - Matches worker/ai/canary/deepSeekCertificationAttestation.ts:computePublicKeyFingerprintSha256
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

export function computeNormalizedPublicKeyFingerprint(publicKeyPem) {
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.trim()) {
    throw new Error('INPUT_INVALID: public key must be a non-empty string');
  }

  // Reject any private key material
  if (/PRIVATE\s+KEY/i.test(publicKeyPem)) {
    throw new Error(
      'SECURITY_VIOLATION: private key detected. This tool accepts strictly PUBLIC keys.'
    );
  }

  // Verify basic public key header presence
  if (!publicKeyPem.includes('-----BEGIN PUBLIC KEY-----')) {
    throw new Error('INVALID_PEM: expected SPKI public key (-----BEGIN PUBLIC KEY-----)');
  }

  // Canonical normalization exactly matching verifier
  const normalized = publicKeyPem.trim().replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').toLowerCase();
}

function main() {
  const args = process.argv.slice(2);
  let rawPem = '';

  if (args.length > 0 && args[0] !== '-') {
    const filePath = args[0];
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    rawPem = fs.readFileSync(filePath, 'utf8');
  } else {
    try {
      rawPem = fs.readFileSync(0, 'utf8');
    } catch {
      console.error('Usage: node scripts/computePublicKeyFingerprint.mjs <public_key.pub>');
      process.exit(1);
    }
  }

  try {
    const fingerprint = computeNormalizedPublicKeyFingerprint(rawPem);
    console.log(fingerprint);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('computePublicKeyFingerprint.mjs')) {
  main();
}
