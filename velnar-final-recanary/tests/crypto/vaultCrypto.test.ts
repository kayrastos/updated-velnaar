import { describe, it, expect } from 'vitest';
import { VaultCryptoService, EncryptedVaultPayload } from '../../worker/crypto/vaultCrypto';

describe('VaultCryptoService (Standard Web Crypto AES-GCM-256 Envelope)', () => {
  const orgAlpha = 'org_apex_holding';
  const orgBeta = 'org_istanbul_dining';

  it('should encrypt and decrypt plaintext using Web Crypto AES-GCM-256 correctly', async () => {
    const rawPii = 'Dr. Clara Vance | +90 532 999 8877 | clara.vance@clinic.com';
    const encrypted = await VaultCryptoService.encrypt(rawPii, orgAlpha, 'test');

    expect(encrypted.algorithm).toBe('AES-GCM-256');
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.tagLength).toBe(128);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.ciphertext).not.toContain(rawPii);

    const decrypted = await VaultCryptoService.decrypt(encrypted, orgAlpha, 'test');
    expect(decrypted).toBe(rawPii);
  });

  it('should enforce HKDF tenant DEK separation (Org Beta cannot decrypt Org Alpha ciphertext)', async () => {
    const rawPii = 'Confidential Patient Alpha';
    const encryptedAlpha = await VaultCryptoService.encrypt(rawPii, orgAlpha, 'test');

    await expect(VaultCryptoService.decrypt(encryptedAlpha, orgBeta, 'test')).rejects.toThrow();
  });

  it('should reject tampered ciphertext with GCM authenticated tag verification failure', async () => {
    const rawPii = 'Tamper Detection Test';
    const encrypted = await VaultCryptoService.encrypt(rawPii, orgAlpha, 'test');

    // Tamper single base64 char
    const bytes = atob(encrypted.ciphertext).split('');
    bytes[0] = bytes[0] === 'A' ? 'B' : 'A';
    const tamperedCiphertext = btoa(bytes.join(''));

    const tamperedPayload: EncryptedVaultPayload = {
      ...encrypted,
      ciphertext: tamperedCiphertext,
    };

    await expect(VaultCryptoService.decrypt(tamperedPayload, orgAlpha, 'test')).rejects.toThrow();
  });

  it('should fail-closed in production when master KMS secret is missing on encrypt', async () => {
    await expect(
      VaultCryptoService.encrypt('Test Plaintext', orgAlpha, 'production', undefined)
    ).rejects.toThrow(/VELNAR_MASTER_KMS_SECRET/);
  });

  it('should fail-closed in production when master KMS secret is missing on decrypt', async () => {
    const payload: EncryptedVaultPayload = {
      version: 1,
      ciphertext: 'YWJj',
      iv: 'MTIzNDU2Nzg5MDEy',
      algorithm: 'AES-GCM-256',
      tagLength: 128,
      keyVersion: 1,
    };
    await expect(
      VaultCryptoService.decrypt(payload, orgAlpha, 'production', undefined)
    ).rejects.toThrow(/VELNAR_MASTER_KMS_SECRET/);
  });

  it('should succeed in production when valid master KMS secret is provided', async () => {
    const prodSecret = 'velnar_prod_kms_secret_32_bytes_super_secure_key_123';
    const rawPii = 'Production Secure Patient Record';
    const encrypted = await VaultCryptoService.encrypt(rawPii, orgAlpha, 'production', prodSecret);
    const decrypted = await VaultCryptoService.decrypt(encrypted, orgAlpha, 'production', prodSecret);
    expect(decrypted).toBe(rawPii);
  });

  describe('isVaultConfigured canonical policy', () => {
    const validSecret = 'velnar_super_secret_kms_32_bytes_ok!';
    const shortSecret = 'short';

    it('development: always configured (uses dev fallback if secret is absent)', () => {
      expect(VaultCryptoService.isVaultConfigured('development', undefined)).toBe(true);
      expect(VaultCryptoService.isVaultConfigured('development', validSecret)).toBe(true);
    });

    it('test: always configured (uses test fallback if secret is absent)', () => {
      expect(VaultCryptoService.isVaultConfigured('test', undefined)).toBe(true);
      expect(VaultCryptoService.isVaultConfigured('test', validSecret)).toBe(true);
    });

    it('preview: configured ONLY when a valid master secret is supplied', () => {
      expect(VaultCryptoService.isVaultConfigured('preview', undefined)).toBe(false);
      expect(VaultCryptoService.isVaultConfigured('preview', '')).toBe(false);
      expect(VaultCryptoService.isVaultConfigured('preview', shortSecret)).toBe(false);
      expect(VaultCryptoService.isVaultConfigured('preview', validSecret)).toBe(true);
    });

    it('production: configured ONLY when a valid master secret is supplied', () => {
      expect(VaultCryptoService.isVaultConfigured('production', undefined)).toBe(false);
      expect(VaultCryptoService.isVaultConfigured('production', '')).toBe(false);
      expect(VaultCryptoService.isVaultConfigured('production', shortSecret)).toBe(false);
      expect(VaultCryptoService.isVaultConfigured('production', validSecret)).toBe(true);
    });

    it('unknown environment: fails closed and requires valid master secret', () => {
      expect(VaultCryptoService.isVaultConfigured('staging_unknown', undefined)).toBe(false);
      expect(VaultCryptoService.isVaultConfigured('staging_unknown', validSecret)).toBe(true);
    });

    it('preview throws CONFIGURATION_ERROR when secret is missing', async () => {
      await expect(
        VaultCryptoService.encrypt('Secret Plaintext', orgAlpha, 'preview', undefined)
      ).rejects.toThrow(/CONFIGURATION_ERROR/);
    });
  });
});
