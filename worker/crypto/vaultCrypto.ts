/**
 * @file vaultCrypto.ts
 * @description Standard Web Crypto AES-GCM Server-Side Envelope Encryption Service
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Standard Web Crypto API (crypto.subtle) - ZERO invented or fake crypto.
 * 2. AES-GCM 256-bit authenticated encryption with 96-bit unique IV per operation.
 * 3. Master Secret (KMS/Worker Env) + Tenant Context -> HKDF -> Tenant DEK.
 * 4. Tamper detection: GCM tag validation rejects altered ciphertexts deterministically.
 * 5. Cross-tenant isolation: Tenant A cannot decrypt Tenant B ciphertext even with same Master Secret.
 * ============================================================================
 */

export interface EncryptedVaultPayload {
  version: number;
  algorithm: 'AES-GCM-256';
  keyVersion: number;
  iv: string; // Base64 encoded 12-byte IV
  ciphertext: string; // Base64 encoded ciphertext with authenticated tag
  tagLength: number; // 128 bits
}

export class VaultCryptoService {
  private static readonly DEV_DEFAULT_MASTER_SECRET = 'DEV_MASTER_SECRET_DO_NOT_USE_IN_PROD_32BYTES_TEST!';
  private static readonly CURRENT_KEY_VERSION = 1;
  private static readonly ALGORITHM = 'AES-GCM';

  /**
   * Resolve Master Secret from Worker Environment bindings or local development fallback.
   */
  public static getMasterSecret(envSecret?: string): string {
    if (envSecret && envSecret.trim().length >= 16) {
      return envSecret;
    }
    // Safe dev fallback explicitly named
    return VaultCryptoService.DEV_DEFAULT_MASTER_SECRET;
  }

  /**
   * Derive a Tenant Data Encryption Key (DEK) from Master Secret using HKDF with Tenant ID as salt/info context.
   */
  private static async deriveTenantDEK(masterSecret: string, tenantId: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const masterKeyBytes = encoder.encode(masterSecret);
    const tenantContextBytes = encoder.encode(`velnar:tenant_dek:${tenantId}`);

    // Import master secret as HKDF base key
    const baseKey = await crypto.subtle.importKey(
      'raw',
      masterKeyBytes,
      'HKDF',
      false,
      ['deriveKey']
    );

    // Derive 256-bit AES-GCM Key uniquely scoped to this Tenant ID
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode(`salt_${tenantId}`),
        info: tenantContextBytes,
      },
      baseKey,
      {
        name: VaultCryptoService.ALGORITHM,
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt a sensitive PII field (e.g. name, email, phone) using Tenant-Scoped AES-GCM.
   */
  public static async encrypt(
    plaintext: string,
    tenantId: string,
    masterSecret?: string,
    keyVersion: number = VaultCryptoService.CURRENT_KEY_VERSION
  ): Promise<EncryptedVaultPayload> {
    const effectiveSecret = VaultCryptoService.getMasterSecret(masterSecret);
    const tenantKey = await VaultCryptoService.deriveTenantDEK(effectiveSecret, tenantId);

    // Generate cryptographically random 96-bit (12 byte) IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const ciphertextBuffer = await crypto.subtle.encrypt(
      {
        name: VaultCryptoService.ALGORITHM,
        iv,
        tagLength: 128,
      },
      tenantKey,
      data
    );

    return {
      version: 1,
      algorithm: 'AES-GCM-256',
      keyVersion,
      iv: VaultCryptoService.arrayBufferToBase64(iv.buffer),
      ciphertext: VaultCryptoService.arrayBufferToBase64(ciphertextBuffer),
      tagLength: 128,
    };
  }

  /**
   * Decrypt an encrypted vault payload using Tenant-Scoped AES-GCM.
   * Fails and throws if ciphertext was tampered with or if queried by wrong tenantId.
   */
  public static async decrypt(
    payload: EncryptedVaultPayload,
    tenantId: string,
    masterSecret?: string
  ): Promise<string> {
    const effectiveSecret = VaultCryptoService.getMasterSecret(masterSecret);
    const tenantKey = await VaultCryptoService.deriveTenantDEK(effectiveSecret, tenantId);

    const iv = VaultCryptoService.base64ToArrayBuffer(payload.iv);
    const ciphertext = VaultCryptoService.base64ToArrayBuffer(payload.ciphertext);

    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: VaultCryptoService.ALGORITHM,
          iv: new Uint8Array(iv),
          tagLength: payload.tagLength || 128,
        },
        tenantKey,
        ciphertext
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (err) {
      throw new Error(
        `VAULT_DECRYPTION_FAILED: Cryptographic verification failed. Ciphertext may be tampered, corrupted, or accessed under invalid tenant context [${tenantId}].`
      );
    }
  }

  // --- Binary Conversion Helpers ---

  private static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
