import { describe, it, expect } from 'vitest';
import { VaultCryptoService, EncryptedVaultPayload } from '../../worker/crypto/vaultCrypto';

describe('VaultCryptoService (Standard Web Crypto AES-GCM-256 Envelope)', () => {
  const orgAlpha = 'org_apex_holding';
  const orgBeta = 'org_istanbul_dining';

  it('should encrypt and decrypt plaintext using Web Crypto AES-GCM-256 correctly', async () => {
    const rawPii = 'Dr. Clara Vance | +90 532 999 8877 | clara.vance@clinic.com';
    const encrypted = await VaultCryptoService.encrypt(rawPii, orgAlpha);

    expect(encrypted.algorithm).toBe('AES-GCM-256');
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.tagLength).toBe(128);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.ciphertext).not.toContain(rawPii);

    const decrypted = await VaultCryptoService.decrypt(encrypted, orgAlpha);
    expect(decrypted).toBe(rawPii);
  });

  it('should enforce HKDF tenant DEK separation (Org Beta cannot decrypt Org Alpha ciphertext)', async () => {
    const rawPii = 'Confidential Patient Alpha';
    const encryptedAlpha = await VaultCryptoService.encrypt(rawPii, orgAlpha);

    await expect(VaultCryptoService.decrypt(encryptedAlpha, orgBeta)).rejects.toThrow();
  });

  it('should reject tampered ciphertext with GCM authenticated tag verification failure', async () => {
    const rawPii = 'Tamper Detection Test';
    const encrypted = await VaultCryptoService.encrypt(rawPii, orgAlpha);

    // Tamper single base64 char
    const bytes = atob(encrypted.ciphertext).split('');
    bytes[0] = bytes[0] === 'A' ? 'B' : 'A';
    const tamperedCiphertext = btoa(bytes.join(''));

    const tamperedPayload: EncryptedVaultPayload = {
      ...encrypted,
      ciphertext: tamperedCiphertext,
    };

    await expect(VaultCryptoService.decrypt(tamperedPayload, orgAlpha)).rejects.toThrow();
  });

  it('should fail-closed in production when master KMS secret is missing', async () => {
    const prodEnv = { ENVIRONMENT: 'production' };
    await expect(
      VaultCryptoService.encrypt('Test Plaintext', orgAlpha, undefined, prodEnv)
    ).rejects.toThrow(/VELNAR_MASTER_KMS_SECRET/);
  });
});
