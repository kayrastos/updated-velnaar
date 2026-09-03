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
   * Sanitize raw string messages to prevent accidental leakage of sensitive tokens, PII, and secrets.
   */
  public static sanitizeMessage(msg: string): string {
    if (!msg || typeof msg !== 'string') return '';

    let sanitized = msg;

    // 1. Redact Bearer tokens
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]');

    // 2. Redact JWT-like tokens (3 base64 url-encoded parts separated by dots)
    sanitized = sanitized.replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');

    // 3. Redact Basic auth tokens
    sanitized = sanitized.replace(/Basic\s+[A-Za-z0-9+/=]{10,}/gi, 'Basic [REDACTED_AUTH]');

    // 4. Redact Key-Value secret patterns like "apiKey: secret123" or "password=xyz"
    sanitized = sanitized.replace(
      /(api_?key|secret|password|auth(?:orization)?|token)\s*[:=]\s*["']?[A-Za-z0-9_\-.~+]{8,}["']?/gi,
      '$1: [REDACTED_SECRET]'
    );

    // 5. Mask email addresses in raw message string
    sanitized = sanitized.replace(
      /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
      (match, local, domain) => {
        if (local.length <= 2) {
          return `${local[0]}***@${domain}`;
        }
        return `${local[0]}***${local[local.length - 1]}@${domain}`;
      }
    );

    // 6. Mask international phone number patterns
    sanitized = sanitized.replace(
      /(\+?[0-9]{1,4}[\s-]?)?(\(?[0-9]{2,4}\)?[\s-]?)?[0-9]{3,4}[\s-]?[0-9]{3,4}/g,
      (match) => {
        const digitsOnly = match.replace(/\D/g, '');
        if (digitsOnly.length >= 7) {
          return SafeLogger.maskPhone(match);
        }
        return match;
      }
    );

    return sanitized;
  }

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
      return SafeLogger.sanitizeMessage(obj) as unknown as T;
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
      } else if (typeof value === 'string') {
        cleaned[key] = SafeLogger.sanitizeMessage(value);
      } else {
        cleaned[key] = value;
      }
    }

    return cleaned as T;
  }

  public static info(message: string, context?: Record<string, unknown>): void {
    const safeMsg = SafeLogger.sanitizeMessage(message);
    const safeContext = context ? SafeLogger.redactData(context) : undefined;
    console.log(`[VELNAR:INFO] [${new Date().toISOString()}] ${safeMsg}`, safeContext ? JSON.stringify(safeContext) : '');
  }

  public static warn(message: string, context?: Record<string, unknown>): void {
    const safeMsg = SafeLogger.sanitizeMessage(message);
    const safeContext = context ? SafeLogger.redactData(context) : undefined;
    console.warn(`[VELNAR:WARN] [${new Date().toISOString()}] ${safeMsg}`, safeContext ? JSON.stringify(safeContext) : '');
  }

  public static error(message: string, context?: Record<string, unknown>): void {
    const safeMsg = SafeLogger.sanitizeMessage(message);
    const safeContext = context ? SafeLogger.redactData(context) : undefined;
    console.error(`[VELNAR:ERROR] [${new Date().toISOString()}] ${safeMsg}`, safeContext ? JSON.stringify(safeContext) : '');
  }
}
