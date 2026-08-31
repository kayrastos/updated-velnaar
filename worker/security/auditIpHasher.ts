/**
 * @file worker/security/auditIpHasher.ts
 * @description Cryptographic HMAC-SHA-256 IP Address Hasher for Immutable Audit Logs & Telemetry
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Never store raw IP, partial IP (e.g. slice(0, 16)), or X-Forwarded-For text.
 * 2. In production, requires server-side AUDIT_IP_HASH_SECRET binding.
 * 3. If AUDIT_IP_HASH_SECRET is missing/unconfigured in production, returns 'UNKNOWN'.
 * 4. In development/test, deterministic synthetic hashing is permitted.
 * ============================================================================
 */

export class AuditIpHasher {
  /**
   * Hashes a client IP using HMAC-SHA-256 and the server-side audit secret.
   * Never stores raw or partial IP addresses.
   */
  public static async hashIp(
    rawIp: string | null | undefined,
    secret: string | undefined,
    environment: string = 'production'
  ): Promise<string> {
    if (!rawIp || typeof rawIp !== 'string') {
      return 'UNKNOWN';
    }

    const cleanIp = rawIp.trim();
    if (cleanIp.length === 0 || cleanIp === 'UNKNOWN') {
      return 'UNKNOWN';
    }

    // Extract first IP if X-Forwarded-For list was passed
    const canonicalIp = cleanIp.split(',')[0].trim();
    if (canonicalIp.length === 0 || canonicalIp === 'UNKNOWN') {
      return 'UNKNOWN';
    }

    const isDevOrTest = environment === 'development' || environment === 'test';

    if (!secret || secret.trim().length === 0) {
      if (isDevOrTest) {
        // Deterministic synthetic hash for test/dev using Web Crypto SHA-256
        return await this.sha256Hex(`dev_synthetic_salt:${canonicalIp}`);
      }
      // Production without secret must return UNKNOWN and NEVER raw/partial IP
      return 'UNKNOWN';
    }

    try {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret.trim());
      const ipData = encoder.encode(canonicalIp);

      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signature = await crypto.subtle.sign('HMAC', cryptoKey, ipData);
      const hashArray = Array.from(new Uint8Array(signature));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex;
    } catch {
      return 'UNKNOWN';
    }
  }

  private static async sha256Hex(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(digest));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
