# VELNAR — R5 Runtime Source Provenance Operator Packet

**Document Identifier:** `VELNAR-DOC-R5-SOURCE-PROVENANCE-V1`  
**Classification:** PUBLIC OPERATIONAL SPECIFICATION  
**Scope:** Phase A.12B.2C-5U.3.5A Runtime Source Provenance Foundation  
**Target Issuer ID:** `velnar-runtime-provenance-prod`  
**Target Key Version:** `2026-v1`  
**Target Algorithm:** `Ed25519` (RFC 8032 / SPKI)  
**Canonical Repository:** `kayrastos/updated-velnaar`  
**Canonical Environment:** `production`  

---

## 1. Distinct Trust Domain Architecture

The **Runtime Source Provenance Authority** represents an independent, distinct cryptographic trust domain from the Human Authorization Authority.

| Domain | Human Authorization | Runtime Source Provenance |
|:---|:---|:---|
| **Purpose** | Authorizes execution of live tasks & budget spend | Attests exact source commit, build, and deployment identity |
| **Authority ID** | `velnar-lead-ops-prod` | `velnar-runtime-provenance-prod` |
| **Custody Role** | Lead Operations Officers | Secure Build & Release Pipeline Custody |
| **Key Separation** | Isolated Ed25519 key pair | Isolated Ed25519 key pair |
| **Reuse Policy** | STRICTLY FORBIDDEN to share keys between these domains |

Reusing the human authorization private key for build/source provenance is strictly prohibited.

---

## 2. Strict Boundary Invariant

> **CRITICAL INVARIANT:**  
> The runtime provenance private key MUST be generated and retained **STRICTLY OUTSIDE** the code repository, outside the Cloudflare Worker application runtime, and outside any AI agent context (including ChatGPT, Gemini, Antigravity, and Codex).
>
> **NEVER SHOW, PASTE, ATTACH, OR TRANSMIT THE PROVENANCE PRIVATE KEY TO ANY AI ASSISTANT OR REMOTE SERVICE.**

Only public keys, candidate registration receipts, and signed provenance receipts may enter the repository or Worker runtime.

---

## 3. Runtime Source Provenance Receipt Contract

Every runtime verification requires a signed `RuntimeSourceProvenanceReceipt` containing exactly these 14 own properties:

```typescript
export interface RuntimeSourceProvenanceReceipt {
  readonly provenanceVersion: 'a12b2c5q-v1';
  readonly repositoryFullName: 'kayrastos/updated-velnaar';
  readonly sourceCommitSha: string;     // 40-char lowercase git commit SHA
  readonly sourceTreeSha: string;       // 40-char lowercase git tree SHA
  readonly buildArtifactSha256: string; // 64-char lowercase SHA-256 of deployed bundle
  readonly buildId: string;             // 32-128 char build identifier
  readonly deploymentId: string;        // 32-128 char deployment identifier
  readonly environment: 'production';
  readonly issuedAt: string;            // Strict ISO 8601 UTC timestamp
  readonly expiresAt: string;           // Strict ISO 8601 UTC timestamp (> issuedAt)
  readonly issuerId: 'velnar-runtime-provenance-prod';
  readonly issuerKeyVersion: '2026-v1';
  readonly algorithm: 'Ed25519';
  readonly signatureBase64: string;     // Ed25519 signature over canonical payload
}
```

---

## 4. Offline Signing Payload Preparation

To generate the signature over the provenance receipt:

1. Populate a JSON file (e.g. `receipt_draft.json`) containing the 13 required fields (all except `signatureBase64`).
2. Run the offline payload builder:
   ```bash
   node scripts/buildRuntimeSourceProvenanceSigningPayload.mjs receipt_draft.json > payload_output.json
   ```
3. The script verifies that:
   - Zero private keys or secrets are present in the input.
   - All required fields are present and strictly typed.
   - The canonical JSON string (`canonicalPayload`) is deterministically formatted matching `deepSeekTrustedRuntimeSourceProvenance.ts`.
   - The SHA-256 digest (`payloadSha256`) is computed.

---

## 5. External Signing Procedure (Outside AI Context)

On the secure build signing host:

### Using OpenSSL:
```bash
# Sign the exact canonical payload bytes
echo -n "$CANONICAL_PAYLOAD" | openssl pkeyutl -sign -rawin -inkey provenance_private.pem | base64 -w 0
```

### Using Node.js crypto:
```javascript
import crypto from 'node:crypto';
import fs from 'node:fs';

const privateKeyPem = fs.readFileSync('/secure/path/provenance_private.pem', 'utf8');
const signature = crypto.sign(null, Buffer.from(canonicalPayload, 'utf8'), privateKeyPem);
console.log(signature.toString('base64'));
```

Assign the base64 signature string to `signatureBase64` in the final `RuntimeSourceProvenanceReceipt`.

---

## 6. Public Artifacts Returned to Repository

Only public artifacts may be brought into the repository or execution evidence:

1. **Public Key PEM:** SPKI format (`-----BEGIN PUBLIC KEY-----`).
2. **Public Key Fingerprint:** SHA-256 of the SPKI DER representation.
3. **Provisioning Candidate:** JSON containing `provisioningRecord` and `publicAuthorityEntry`.
4. **Manual Handoff Receipt:** JSON certifying isolated custody and review.
5. **Completed Receipt:** Signed `RuntimeSourceProvenanceReceipt`.

---

## 7. Abort Criteria

The signing process MUST be aborted and investigated if:
1. The source commit or tree SHA does not match the canonical git HEAD on `main`.
2. The repository name is not `kayrastos/updated-velnaar`.
3. The environment is not `production`.
4. `expiresAt` is earlier than or equal to `issuedAt`.
5. Any private key is requested or exposed in logs, tickets, or chat prompts.
