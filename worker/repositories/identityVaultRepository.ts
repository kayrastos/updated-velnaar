/**
 * @file identityVaultRepository.ts
 * @description Cloudflare D1 Encrypted Identity Vault Repository
 * 
 * ============================================================================
 * MANDATES:
 * 1. PII (Name, Email, Phone) is stored exclusively as AES-GCM ciphertext payloads.
 * 2. Only authorized calls with matching tenant context and permissions can decrypt.
 * 3. Cross-tenant reads throw cryptographic integrity or tenant mismatch failures.
 * 4. Zero unencrypted PII in database rows or logs.
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
  // In-memory cache/mock store for test environments without D1 binding
  private static memRecords: StoredVaultRecord[] = [];
  private static isInitialized = false;

  private static async initSeedMem(environment: string = 'test', masterSecret?: string): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      const orgA = 'org_apex_holding';
      const nameEnc = await VaultCryptoService.encrypt('Dr. Clara Vance', orgA, environment, masterSecret);
      const emailEnc = await VaultCryptoService.encrypt('clara@vanceaesthetics.com', orgA, environment, masterSecret);
      const phoneEnc = await VaultCryptoService.encrypt('+1 (415) 890-1122', orgA, environment, masterSecret);

      this.memRecords.push({
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
    } catch {
      // Ignore if master secret is not set in non-dev env
    }
  }

  /**
   * Save a new identity securely encrypted under the tenant's DEK to D1.
   */
  public static async storeIdentity(
    db: D1Database | undefined,
    data: { fullName: string; email: string; phone: string; pseudonymId?: string },
    orgId: string,
    environment: string = 'production',
    masterSecret?: string
  ): Promise<StoredVaultRecord> {
    const pseudonymId = data.pseudonymId || `cus_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    
    // Encrypt each PII field individually with Tenant DEK
    const [nameEnc, emailEnc, phoneEnc] = await Promise.all([
      VaultCryptoService.encrypt(data.fullName, orgId, environment, masterSecret),
      VaultCryptoService.encrypt(data.email, orgId, environment, masterSecret),
      VaultCryptoService.encrypt(data.phone, orgId, environment, masterSecret),
    ]);

    const id = `vrec_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    const now = new Date().toISOString();

    const record: StoredVaultRecord = {
      id,
      organizationId: orgId,
      pseudonymId,
      encryptedNamePayload: nameEnc,
      encryptedEmailPayload: emailEnc,
      encryptedPhonePayload: phoneEnc,
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    };

    if (db) {
      await db.prepare(`
        INSERT INTO identity_vault (
          id, organization_id, pseudonym_id, 
          encrypted_name_payload, encrypted_email_payload, encrypted_phone_payload, 
          key_version, algorithm, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'AES-GCM-256', ?, ?)
      `).bind(
        id,
        orgId,
        pseudonymId,
        JSON.stringify(nameEnc),
        JSON.stringify(emailEnc),
        JSON.stringify(phoneEnc),
        1,
        now,
        now
      ).run();
    } else {
      IdentityVaultRepository.memRecords.push(record);
    }

    SafeLogger.info(`[IDENTITY_VAULT] Encrypted identity record created for pseudonym [${pseudonymId}] under tenant [${orgId}]`);
    return record;
  }

  /**
   * Lookup and decrypt an identity with Tenant Scope & Key Validation.
   */
  public static async getDecryptedIdentity(
    db: D1Database | undefined,
    pseudonymId: string,
    orgId: string,
    environment: string = 'production',
    masterSecret?: string
  ): Promise<DecryptedIdentity | null> {
    let rawRecord: {
      id: string;
      organization_id?: string;
      organizationId?: string;
      pseudonym_id?: string;
      pseudonymId?: string;
      encrypted_name_payload?: string;
      encrypted_email_payload?: string;
      encrypted_phone_payload?: string;
      encryptedNamePayload?: EncryptedVaultPayload;
      encryptedEmailPayload?: EncryptedVaultPayload;
      encryptedPhonePayload?: EncryptedVaultPayload;
    } | null = null;

    if (db) {
      const row = await db.prepare(`
        SELECT id, organization_id, pseudonym_id, encrypted_name_payload, encrypted_email_payload, encrypted_phone_payload, key_version, created_at, updated_at
        FROM identity_vault
        WHERE pseudonym_id = ? AND organization_id = ?
      `).bind(pseudonymId, orgId).first<{
        id: string;
        organization_id: string;
        pseudonym_id: string;
        encrypted_name_payload: string;
        encrypted_email_payload: string;
        encrypted_phone_payload: string;
        key_version: number;
        created_at: string;
        updated_at: string;
      }>();

      if (row) {
        rawRecord = {
          id: row.id,
          organizationId: row.organization_id,
          pseudonymId: row.pseudonym_id,
          encryptedNamePayload: JSON.parse(row.encrypted_name_payload),
          encryptedEmailPayload: JSON.parse(row.encrypted_email_payload),
          encryptedPhonePayload: JSON.parse(row.encrypted_phone_payload),
        };
      }
    } else {
      await this.initSeedMem(environment, masterSecret);
      const found = IdentityVaultRepository.memRecords.find(
        r => r.pseudonymId === pseudonymId && r.organizationId === orgId
      );
      if (found) rawRecord = found;
    }

    if (!rawRecord || !rawRecord.encryptedNamePayload || !rawRecord.encryptedEmailPayload || !rawRecord.encryptedPhonePayload) {
      return null;
    }

    // Decrypt using Web Crypto AES-GCM under tenant context
    const [fullName, email, phone] = await Promise.all([
      VaultCryptoService.decrypt(rawRecord.encryptedNamePayload, orgId, environment, masterSecret),
      VaultCryptoService.decrypt(rawRecord.encryptedEmailPayload, orgId, environment, masterSecret),
      VaultCryptoService.decrypt(rawRecord.encryptedPhonePayload, orgId, environment, masterSecret),
    ]);

    return {
      pseudonymId,
      organizationId: orgId,
      fullName,
      email,
      phone,
    };
  }

  /**
   * List all stored records (returns ciphertext envelopes only - never raw PII).
   */
  public static async listCiphertextRecords(
    db: D1Database | undefined,
    orgId: string
  ): Promise<StoredVaultRecord[]> {
    if (db) {
      const { results } = await db.prepare(`
        SELECT id, organization_id, pseudonym_id, encrypted_name_payload, encrypted_email_payload, encrypted_phone_payload, key_version, created_at, updated_at
        FROM identity_vault
        WHERE organization_id = ?
        ORDER BY created_at DESC
      `).bind(orgId).all<{
        id: string;
        organization_id: string;
        pseudonym_id: string;
        encrypted_name_payload: string;
        encrypted_email_payload: string;
        encrypted_phone_payload: string;
        key_version: number;
        created_at: string;
        updated_at: string;
      }>();

      return (results || []).map(r => ({
        id: r.id,
        organizationId: r.organization_id,
        pseudonymId: r.pseudonym_id,
        encryptedNamePayload: JSON.parse(r.encrypted_name_payload),
        encryptedEmailPayload: JSON.parse(r.encrypted_email_payload),
        encryptedPhonePayload: JSON.parse(r.encrypted_phone_payload),
        keyVersion: r.key_version,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    }

    await this.initSeedMem();
    return IdentityVaultRepository.memRecords.filter(r => r.organizationId === orgId);
  }
}
