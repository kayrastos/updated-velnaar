# VELNAR — R5 Human Authorization Trust Anchor Ceremony Operator Packet

**Document Identifier:** `VELNAR-DOC-R5-HUMAN-TRUST-CEREMONY-V1`  
**Classification:** PUBLIC OPERATIONAL SPECIFICATION  
**Scope:** Phase A.12B.2C-5U.3.5A Production Public Trust Preparation  
**Target Authority ID:** `velnar-lead-ops-prod`  
**Target Key Version:** `2026-v1`  
**Target Algorithm:** `Ed25519` (RFC 8032 / SPKI)  

---

## 1. Executive Summary & Purpose

This document provides complete, air-gapped operational instructions for executing the **Human Authorization Trust Anchor Provisioning Ceremony** for the Velnar production platform.

The cryptographic key pair generated during this ceremony serves as the root of trust for human authorization packages. These packages authorize live execution of sensitive, costly, or security-critical workflows (such as bounded DeepSeek Canary Certification).

### Strict Boundary Invariant
> **CRITICAL INVARIANT:**  
> The private key MUST be generated and retained **STRICTLY OUTSIDE** the code repository, outside the application runtime, and outside any AI agent context (including ChatGPT, Gemini, Antigravity, and Codex).
>
> **NEVER SHOW, PASTE, ATTACH, OR TRANSMIT THE PRIVATE KEY TO ANY AI ASSISTANT OR REMOTE SERVICE.**

Only public, verifiable artifacts may enter the repository.

---

## 2. Canonical Target Identity

The ceremony and subsequent validation engines strictly enforce the following canonical compile-time bindings:

| Parameter | Required Value | Notes |
|:---|:---|:---|
| **Authority ID** | `velnar-lead-ops-prod` | Caller-independent pinned identity |
| **Key Version** | `2026-v1` | Pinned initial key version |
| **Cryptographic Algorithm** | `Ed25519` | Pure Edwards-curve Digital Signature Algorithm |
| **Public Key Format** | SPKI PEM (`BEGIN PUBLIC KEY`) | SubjectPublicKeyInfo format |
| **Fingerprint Format** | SHA-256 of SPKI DER bytes | 64 lowercase hexadecimal characters |
| **Isolation Level** | `AIR_GAPPED_OFFLINE` | No networking allowed during generation |
| **Custody Mode** | `OFFLINE_OPERATOR_CUSTODY` | Secure hardware token or encrypted air-gapped vault |
| **Minimum Witnesses** | `3` | Independent roles required |

---

## 3. Ceremony Prerequisites & Environment

1. **Hardware Host:**
   - Dedicated, physically isolated workstation or live-boot OS (e.g., Tails or clean Debian/Ubuntu live media).
   - All network interfaces physically disconnected (Ethernet unplugged, Wi-Fi disabled in BIOS/hardware switch, Bluetooth disabled).
   - No external monitors or devices beyond keyboard, mouse, and local display.

2. **Entropy Generation:**
   - Use hardware-backed entropy (e.g., hardware security key, TrueRNG device, or verified CPU hardware RNG `/dev/random`).
   - Do NOT use deterministic PRNGs, predictable seeds, or VM-cloned entropy pools.

3. **Software Tooling (Air-Gapped):**
   - Standard OpenSSL 3.0+ or Node.js v20+ on the isolated host.

---

## 4. Required Ceremony Roles & Witnesses

A minimum of three (3) distinct, qualified individuals must participate:

| Role | Responsibility |
|:---|:---|
| **SECURITY_OFFICER** | Conducts the key generation on the air-gapped terminal and manages physical custody. |
| **ATTESTING_WITNESS** | Visually inspects the air-gap state, confirms commands, and validates public fingerprints. |
| **COMPLIANCE_AUDITOR** | Verifies adherence to ceremony contract, records transcript hashes, and certifies manual handoff. |

Each witness must produce an independent attestation confirming:
1. They witnessed the generation in an air-gapped environment.
2. The private key was never displayed on an internet-connected device or entered into any software repository or AI tool.
3. The public key fingerprint displayed matches their personal independent computation.

---

## 5. Offline Key Generation Procedure (Operator Terminal)

Execute the following commands **ONLY ON THE AIR-GAPPED SYSTEM**:

### Step 5.1: Verify Air-Gap Isolation
```bash
# Verify no network interfaces are UP (except lo)
ip link show
# Expected: Only 'lo' is active; all eth/wlan interfaces are DOWN or absent.
```

### Step 5.2: Generate Ed25519 Key Pair
```bash
# Generate private key directly into secure storage / encrypted ramfs
openssl genpkey -algorithm Ed25519 -out velnar_lead_ops_prod_2026_v1.key

# Set strict permissions immediately
chmod 400 velnar_lead_ops_prod_2026_v1.key

# Extract public key in SPKI PEM format
openssl pkey -in velnar_lead_ops_prod_2026_v1.key -pubout -out velnar_lead_ops_prod_2026_v1.pub
```

> **SAFETY CHECK:** Verify `velnar_lead_ops_prod_2026_v1.pub` contains:
> `-----BEGIN PUBLIC KEY-----` and NOT `-----BEGIN PRIVATE KEY-----`.

### Step 5.3: Compute Public Key Fingerprint
The fingerprint is defined canonically as the SHA-256 hash of the DER-encoded SPKI public key:
```bash
# Extract DER representation and compute SHA-256
openssl pkey -pubin -in velnar_lead_ops_prod_2026_v1.pub -outform DER | sha256sum | awk '{print $1}'
```
All three witnesses must record and verify this exact 64-character lowercase hex string.

### Step 5.4: Secure Private Key Custody
1. Transfer `velnar_lead_ops_prod_2026_v1.key` into secure offline physical custody (e.g., dual-custody hardware security modules, encrypted offline hardware vault).
2. Securely erase working memory on the air-gapped host (`shred -u` or reboot ephemeral live OS).
3. Confirm that the private key file **NEVER** leaves the offline custody boundary.

---

## 6. Public Artifacts Brought Back to Repository

Only the following four (4) artifacts may be copied to transport media and transferred to the repository workspace:

1. **Public Key PEM:** `velnar_lead_ops_prod_2026_v1.pub`
2. **Public Key Fingerprint String:** 64-character lowercase hexadecimal hash.
3. **Canonical Provisioning Record (`ProductionTrustAnchorProvisioningRecord`):**
   - JSON format conforming to Phase 5N.1 schema.
   - Includes ceremony ID, timestamp, operator acknowledgement, and SHA-256 record digest.
4. **Manual Handoff Receipt (`ProductionTrustAnchorManualHandoffReceipt`):**
   - JSON format certifying `reviewedByOperator: true`, `privateKeyNeverEnteredRepository: true`, `privateKeyNeverEnteredApplicationRuntime: true`, `privateKeyNeverEnteredAIAgentContext: true`.
   - Includes deterministic `handoffDigest`.

---

## 7. Verification & Repository Ingestion

Once the public artifacts are provided:
1. Run `validateProductionTrustAnchorProvisioningCandidate` from `deepSeekProductionTrustAnchorProvisioningSlot.ts`.
2. Run `validateProductionTrustAnchorManualHandoffReceipt` from `deepSeekProductionTrustAnchorProvisioningSlot.ts`.
3. Run `validateProvisioningCandidateWithManualHandoff` to verify cross-binding.
4. Verify fingerprint recomputation matches exactly.

---

## 8. Abort Criteria

The ceremony MUST be immediately aborted, generated keys destroyed, and restarted if:
1. Any network interface or RF transmitter is found enabled on the host during generation.
2. An unauthorized person accesses the generation terminal.
3. Any witness fails to confirm the fingerprint or refuses to sign an attestation.
4. Any attempt is made to log, display, export, or transmit the private key to a connected device or AI agent.
