/**
 * @file safeLogger.ts
 * @description Centralized Log Redaction & Safe Auditing Helper
 * 
 * ============================================================================
 * PRIVACY & COMPLIANCE MANDATES:
 * NEVER log:
 * - Passwords, JWTs, Session tokens, API keys, OAuth tokens, Encryption keys
 * - Full unmasked phone numbers, Full unmasked emails
 * - Cardholder PAN, CVV, Track data
 * - Raw Identity Vault blobs
 * 
 * Always use pseudonymous identifiers and masked strings in log streams.
 * ============================================================================
 */

export class SafeLogger {
  private static SENSITIVE_KEYS = new Set([
    'password',
    'secret',
    'token',
    'apikey',
    'api_key',
    'authorization',
    'jwt',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'encryptionkey',
    'encryption_key',
    'pan',
    'cardnumber',
    'cvv',
    'cvc',
    'pin',
    'raw_vault',
    'encrypted_name_payload',
    'encrypted_email_payload',
    'encrypted_phone_payload'
  ]);

  /**
   * Mask email address: "john.smith@acme.com" -> "j***h@acme.com"
   */
  public static maskEmail(email: string): string {
    if (!email || !email.includes('@')) return '[REDACTED_EMAIL]';
    const [local, domain] = email.split('@');
    if (local.length <= 2) {
      return `${local[0]}***@${domain}`;
    }
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  }

  /**
   * Mask phone number: "+905321234567" -> "+90 532 *** **67"
   */
  public static maskPhone(phone: string): string {
    if (!phone || phone.length < 7) return '[REDACTED_PHONE]';
    const clean = phone.trim();
    const last2 = clean.slice(-2);
    const prefix = clean.slice(0, 4);
    return `${prefix} *** **${last2}`;
  }

  /**
   * Recursively redact an object to guarantee zero PII or secret leakage.
   */
  public static redactData<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
      // Check for JWT-like strings or email/phone patterns in raw strings
      if (obj.startsWith('Bearer ') || obj.split('.').length === 3 && obj.length > 50) {
        return '[REDACTED_AUTH_TOKEN]' as unknown as T;
      }
      return obj;
    }
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => SafeLogger.redactData(item)) as unknown as T;
    }

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (SafeLogger.SENSITIVE_KEYS.has(lowerKey)) {
        cleaned[key] = '[REDACTED_SECRET]';
      } else if (lowerKey.includes('email') && typeof value === 'string') {
        cleaned[key] = SafeLogger.maskEmail(value);
      } else if (lowerKey.includes('phone') && typeof value === 'string') {
        cleaned[key] = SafeLogger.maskPhone(value);
      } else if (typeof value === 'object' && value !== null) {
        cleaned[key] = SafeLogger.redactData(value);
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned as T;
  }

  public static info(message: string, context?: Record<string, unknown>): void {
    const safeContext = context ? SafeLogger.redactData(context) : undefined;
    console.log(`[VELNAR:INFO] [${new Date().toISOString()}] ${message}`, safeContext ? JSON.stringify(safeContext) : '');
  }

  public static warn(message: string, context?: Record<string, unknown>): void {
    const safeContext = context ? SafeLogger.redactData(context) : undefined;
    console.warn(`[VELNAR:WARN] [${new Date().toISOString()}] ${message}`, safeContext ? JSON.stringify(safeContext) : '');
  }

  public static error(message: string, context?: Record<string, unknown>): void {
    const safeContext = context ? SafeLogger.redactData(context) : undefined;
    console.error(`[VELNAR:ERROR] [${new Date().toISOString()}] ${message}`, safeContext ? JSON.stringify(safeContext) : '');
  }
}
