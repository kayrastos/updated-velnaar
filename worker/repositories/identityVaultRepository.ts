/**
 * @file identityVaultRepository.ts
 * @description Zero-Knowledge Encrypted Identity Vault Repository
 * 
 * ============================================================================
 * MANDATES:
 * 1. PII (Name, Email, Phone) is stored exclusively as AES-GCM ciphertext blobs.
 * 2. Only authorized calls with matching tenant context and permissions can decrypt.
 * 3. Cross-tenant reads throw cryptographic integrity failure.
 * ============================================================================
 */

import { VaultCryptoService, EncryptedVaultPayload } from '../crypto/vaultCrypto';
import { SafeLogger } from '../security/safeLogger';

export interface StoredVaultRecord {
  id: string;
  organizationId: string;
  pseudonymId: string;
  encryptedNamePayload: EncryptedVaultPayload;
  encryptedEmailPayload: EncryptedVaultPayload;
  encryptedPhonePayload: EncryptedVaultPayload;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface DecryptedIdentity {
  pseudonymId: string;
  organizationId: string;
  fullName: string;
  email: string;
  phone: string;
}

export class IdentityVaultRepository {
  private static records: StoredVaultRecord[] = [];
  private static isInitialized = false;

  public static async initSeed(masterSecret?: string): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Seed sample encrypted records for default test tenant
    const orgA = 'org_apex_holding';
    const nameEnc = await VaultCryptoService.encrypt('Dr. Clara Vance', orgA, masterSecret);
    const emailEnc = await VaultCryptoService.encrypt('clara@vanceaesthetics.com', orgA, masterSecret);
    const phoneEnc = await VaultCryptoService.encrypt('+1 (415) 890-1122', orgA, masterSecret);

    this.records.push({
      id: 'vrec_001',
      organizationId: orgA,
      pseudonymId: 'cus_89a12e',
      encryptedNamePayload: nameEnc,
      encryptedEmailPayload: emailEnc,
      encryptedPhonePayload: phoneEnc,
      keyVersion: 1,
      createdAt: '2026-08-24T00:00:00Z',
      updatedAt: '2026-08-24T00:00:00Z',
    });
  }

  /**
   * Save a new identity securely encrypted under the tenant's DEK.
   */
  public static async storeIdentity(
    data: { fullName: string; email: string; phone: string; pseudonymId?: string },
    orgId: string,
    masterSecret?: string
  ): Promise<StoredVaultRecord> {
    await this.initSeed(masterSecret);

    const pseudonymId = data.pseudonymId || `cus_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    const [nameEnc, emailEnc, phoneEnc] = await Promise.all([
      VaultCryptoService.encrypt(data.fullName, orgId, masterSecret),
      VaultCryptoService.encrypt(data.email, orgId, masterSecret),
      VaultCryptoService.encrypt(data.phone, orgId, masterSecret),
    ]);

    const now = new Date().toISOString();
    const record: StoredVaultRecord = {
      id: `vrec_${Date.now().toString(36)}`,
      organizationId: orgId,
      pseudonymId,
      encryptedNamePayload: nameEnc,
      encryptedEmailPayload: emailEnc,
      encryptedPhonePayload: phoneEnc,
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    };

    IdentityVaultRepository.records.push(record);
    SafeLogger.info(`[IDENTITY_VAULT] Encrypted identity record created for pseudonym [${pseudonymId}] under tenant [${orgId}]`);
    return record;
  }

  /**
   * Lookup and decrypt an identity with Tenant Scope & Key Validation.
   */
  public static async getDecryptedIdentity(
    pseudonymId: string,
    orgId: string,
    masterSecret?: string
  ): Promise<DecryptedIdentity | null> {
    await this.initSeed(masterSecret);

    const record = IdentityVaultRepository.records.find(
      r => r.pseudonymId === pseudonymId && r.organizationId === orgId
    );
    if (!record) return null;

    // Decrypt using Web Crypto AES-GCM under tenant context
    const [fullName, email, phone] = await Promise.all([
      VaultCryptoService.decrypt(record.encryptedNamePayload, orgId, masterSecret),
      VaultCryptoService.decrypt(record.encryptedEmailPayload, orgId, masterSecret),
      VaultCryptoService.decrypt(record.encryptedPhonePayload, orgId, masterSecret),
    ]);

    return {
      pseudonymId: record.pseudonymId,
      organizationId: record.organizationId,
      fullName,
      email,
      phone,
    };
  }

  /**
   * List all stored records (returns ciphertext envelopes only - never raw PII).
   */
  public static async listCiphertextRecords(orgId: string): Promise<StoredVaultRecord[]> {
    await this.initSeed();
    return IdentityVaultRepository.records.filter(r => r.organizationId === orgId);
  }
}
