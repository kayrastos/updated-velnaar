/**
 * @file vaultCrypto.ts
 * @description Standard Web Crypto AES-GCM Server-Side Envelope Encryption Service
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES (Sprint 3.4):
 * 1. Standard Web Crypto API (crypto.subtle) - ZERO invented crypto.
 * 2. AES-GCM 256-bit authenticated encryption with 96-bit unique IV per operation.
 * 3. Master Secret (KMS/Worker Env) + Tenant Context -> HKDF -> Tenant DEK.
 * 4. Fail-closed: In production, missing VELNAR_MASTER_KMS_SECRET MUST throw CONFIGURATION_ERROR.
 * 5. In development/test: Explicit dev fallback secret is allowed.
 * 6. Tamper detection: GCM tag validation rejects altered ciphertexts deterministically.
 * 7. Cross-tenant isolation: Tenant A cannot decrypt Tenant B ciphertext.
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

/**
 * Check if a supplied secret string meets the minimum master secret length requirements (>= 16 chars).
 */
export function isValidMasterSecret(secret?: string): boolean {
  return Boolean(secret && typeof secret === 'string' && secret.trim().length >= 16);
}

/**
 * Canonical vault configuration check.
 * Evaluates whether a vault operation can obtain the required master secret in the current environment.
 * 
 * Rules:
 * - development: true (uses dev fallback if secret is absent)
 * - test: true (uses test fallback if secret is absent)
 * - preview: true ONLY if VELNAR_MASTER_KMS_SECRET is present and valid (>= 16 chars)
 * - production: true ONLY if VELNAR_MASTER_KMS_SECRET is present and valid (>= 16 chars)
 * - unknown environment: fail closed; true ONLY if valid secret is present
 */
export function isVaultConfigured(environment?: string, envSecret?: string): boolean {
  const normEnv = (environment || 'production').toLowerCase().trim();
  const hasValidSecret = isValidMasterSecret(envSecret);

  if (normEnv === 'development' || normEnv === 'test') {
    return true;
  }

  if (normEnv === 'production' || normEnv === 'preview') {
    return hasValidSecret;
  }

  // Unknown environment: fail closed
  return hasValidSecret;
}

export class VaultCryptoService {
  private static readonly DEV_DEFAULT_MASTER_SECRET = 'DEV_MASTER_SECRET_DO_NOT_USE_IN_PROD_32BYTES_TEST!';
  private static readonly CURRENT_KEY_VERSION = 1;
  private static readonly ALGORITHM = 'AES-GCM';

  /**
   * Helper to check if environment is strictly development or test mode.
   */
  public static isDevelopmentOrTest(environment?: string): boolean {
    if (!environment) return false;
    const normalized = environment.toLowerCase().trim();
    return normalized === 'development' || normalized === 'test';
  }

  /**
   * Check whether the vault is configured for the given environment.
   */
  public static isVaultConfigured(environment?: string, envSecret?: string): boolean {
    return isVaultConfigured(environment, envSecret);
  }

  /**
   * Check whether a secret string is valid.
   */
  public static isValidMasterSecret(secret?: string): boolean {
    return isValidMasterSecret(secret);
  }

  /**
   * Resolve Master Secret from Worker Environment bindings or fail closed.
   * 
   * Rules:
   * - If envSecret is provided and valid (>= 16 chars), use it.
   * - If environment is development/test, fallback to explicit dev secret.
   * - If environment is production/preview/unknown and envSecret is missing/invalid, THROW CONFIGURATION_ERROR.
   */
  public static getMasterSecret(environment: string, envSecret?: string): string {
    if (isValidMasterSecret(envSecret)) {
      return envSecret!.trim();
    }

    if (VaultCryptoService.isDevelopmentOrTest(environment)) {
      return VaultCryptoService.DEV_DEFAULT_MASTER_SECRET;
    }

    // Production / Preview fail-closed: Never fall back to dev secret
    throw new Error(
      `CONFIGURATION_ERROR: VELNAR_MASTER_KMS_SECRET is required in ${environment} and must be at least 16 characters.`
    );
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
   * Encrypt plaintext under Tenant DEK using standard Web Crypto AES-GCM
   */
  public static async encrypt(
    plaintext: string,
    tenantId: string,
    environment: string,
    masterSecret?: string
  ): Promise<EncryptedVaultPayload> {
    const resolvedSecret = VaultCryptoService.getMasterSecret(environment, masterSecret);
    const dek = await VaultCryptoService.deriveTenantDEK(resolvedSecret, tenantId);

    // Generate unique 96-bit (12-byte) IV for AES-GCM per encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encodedPlaintext = encoder.encode(plaintext);

    const ciphertextBuffer = await crypto.subtle.encrypt(
      {
        name: VaultCryptoService.ALGORITHM,
        iv,
        tagLength: 128, // 128-bit authentication tag
      },
      dek,
      encodedPlaintext
    );

    return {
      version: 1,
      algorithm: 'AES-GCM-256',
      keyVersion: VaultCryptoService.CURRENT_KEY_VERSION,
      iv: VaultCryptoService.arrayBufferToBase64(iv.buffer),
      ciphertext: VaultCryptoService.arrayBufferToBase64(ciphertextBuffer),
      tagLength: 128,
    };
  }

  /**
   * Decrypt ciphertext under Tenant DEK with tamper validation
   */
  public static async decrypt(
    payload: EncryptedVaultPayload,
    tenantId: string,
    environment: string,
    masterSecret?: string
  ): Promise<string> {
    const resolvedSecret = VaultCryptoService.getMasterSecret(environment, masterSecret);
    const dek = await VaultCryptoService.deriveTenantDEK(resolvedSecret, tenantId);

    const iv = new Uint8Array(VaultCryptoService.base64ToArrayBuffer(payload.iv));
    const ciphertextBuffer = VaultCryptoService.base64ToArrayBuffer(payload.ciphertext);

    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: VaultCryptoService.ALGORITHM,
          iv,
          tagLength: payload.tagLength || 128,
        },
        dek,
        ciphertextBuffer
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (err) {
      throw new Error(`VAULT_DECRYPTION_FAILED: GCM authentication tag verification failed or wrong tenant DEK.`);
    }
  }

  // --- Encoding Utilities ---
  public static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  public static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
