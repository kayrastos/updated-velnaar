/**
 * @file worker/ai/dataClassifier.ts
 * @description Data Classification Engine for Zero PII & Zero Secret Leakage with Strict Security Floor
 */

import { DataClassification } from './types';

export class DataClassifier {
  public static readonly SEVERITY_ORDER: Record<DataClassification, number> = {
    PUBLIC_BUSINESS: 0,
    PSEUDONYMOUS_OPERATIONAL: 1,
    PERSONAL: 2,
    SENSITIVE: 3,
    SECRET: 4,
  };

  public static maxSeverity(a: DataClassification, b: DataClassification): DataClassification {
    const sevA = this.SEVERITY_ORDER[a] ?? 0;
    const sevB = this.SEVERITY_ORDER[b] ?? 0;
    return sevA >= sevB ? a : b;
  }

  private static readonly SECRET_PATTERNS: RegExp[] = [
    /sec_[a-zA-Z0-9_-]{16,}/i,
    /sk-[a-zA-Z0-9_-]{20,}/i,
    /dsk-[a-zA-Z0-9_-]{20,}/i,
    /AIzaSy[a-zA-Z0-9_-]{33}/,
    /Bearer\s+[a-zA-Z0-9._-]{20,}/i,
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
    /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
    /VELNAR_MASTER_KMS_SECRET/i,
    /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
    /password\s*[:=]\s*['"][^'"]+['"]/i,
    /oauth[_-]?token\s*[:=]\s*['"][^'"]+['"]/i,
    /secret\s*[:=]\s*['"][^'"]+['"]/i,
  ];

  private static readonly PERSONAL_PATTERNS: RegExp[] = [
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // email
    /(?:\+?90\s?)?(?:\(?0?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}|\(?0?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4})/, // Turkish phone formats
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/, // international phone formats
    /\b(?:TR\d{2}\s?(?:\d{4}\s?){5}\d{2}|[A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/i, // IBAN
    /(?:tckn|tc_kimlik|kimlik_no|identity_no|tckimlik)[\s:=_-]*\b([1-9]\d{10})\b/i, // Turkish TCKN
  ];

  private static readonly SENSITIVE_KEYWORDS: string[] = [
    'diagnosis',
    'medical_history',
    'credit_card',
    'cvv',
    'ssn',
    'tckn',
    'passport_number',
    'raw_pii',
    'identity_vault_plaintext',
    'encrypted_name_payload',
    'encrypted_email_payload',
    'encrypted_phone_payload',
  ];

  public static normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  public static readonly FORBIDDEN_OBJECT_KEYS = new Set([
    'fullname',
    'email',
    'phone',
    'phonenumber',
    'address',
    'rawpii',
    'encryptednamepayload',
    'encryptedemailpayload',
    'encryptedphonepayload',
    'mastersecret',
    'velnarmasterkmssecret',
    'clientsecret',
    'secret',
    'password',
    'token',
    'accesstoken',
    'oauthtoken',
    'apikey',
    'ssn',
    'tckn',
    'cvv',
    'creditcard',
    'identityvaultplaintext',
    'identityvaultrecord',
    'identityvault',
  ]);

  /**
   * Recursively checks if an object structure contains sensitive/personal/secret keys.
   */
  private static scanObjectKeys(obj: any): DataClassification | null {
    if (!obj || typeof obj !== 'object') return null;

    if (Array.isArray(obj)) {
      let maxClass: DataClassification | null = null;
      for (const item of obj) {
        const res = this.scanObjectKeys(item);
        if (res) {
          maxClass = maxClass ? this.maxSeverity(maxClass, res) : res;
        }
      }
      return maxClass;
    }

    let maxClass: DataClassification | null = null;
    for (const key of Object.keys(obj)) {
      const normalizedKey = this.normalizeKey(key);
      if (this.FORBIDDEN_OBJECT_KEYS.has(normalizedKey)) {
        if (
          normalizedKey.includes('secret') ||
          normalizedKey.includes('password') ||
          normalizedKey.includes('key') ||
          normalizedKey.includes('token')
        ) {
          return 'SECRET';
        }
        if (
          normalizedKey.includes('vault') ||
          normalizedKey.includes('ssn') ||
          normalizedKey.includes('tckn') ||
          normalizedKey.includes('credit') ||
          normalizedKey.includes('encrypted')
        ) {
          maxClass = maxClass ? this.maxSeverity(maxClass, 'SENSITIVE') : 'SENSITIVE';
        } else {
          maxClass = maxClass ? this.maxSeverity(maxClass, 'PERSONAL') : 'PERSONAL';
        }
      }

      const valClass = this.scanObjectKeys(obj[key]);
      if (valClass) {
        maxClass = maxClass ? this.maxSeverity(maxClass, valClass) : valClass;
      }
    }

    return maxClass;
  }

  /**
   * Classifies arbitrary raw strings or payload structures.
   */
  public static classify(data: string | Record<string, any> | Array<any>): DataClassification {
    if (data === null || data === undefined) {
      return 'PUBLIC_BUSINESS';
    }

    let structuralClass: DataClassification = 'PUBLIC_BUSINESS';
    if (typeof data === 'object') {
      const scanned = this.scanObjectKeys(data);
      if (scanned) {
        structuralClass = scanned;
      }
    }

    const serialized = typeof data === 'string' ? data : JSON.stringify(data);

    // 1. Check for Secrets
    for (const pattern of this.SECRET_PATTERNS) {
      if (pattern.test(serialized)) {
        return 'SECRET';
      }
    }

    // 2. Check for Sensitive PII / Restricted keywords
    const lower = serialized.toLowerCase();
    for (const kw of this.SENSITIVE_KEYWORDS) {
      if (lower.includes(kw)) {
        return this.maxSeverity(structuralClass, 'SENSITIVE');
      }
    }

    // 3. Check for Personal Identifiers (unredacted email, phone, etc.)
    for (const pattern of this.PERSONAL_PATTERNS) {
      if (pattern.test(serialized)) {
        return this.maxSeverity(structuralClass, 'PERSONAL');
      }
    }

    if (structuralClass !== 'PUBLIC_BUSINESS') {
      return structuralClass;
    }

    // 4. Check if data is pseudonymous operational
    if (
      lower.includes('lead_') ||
      lower.includes('cus_') ||
      lower.includes('pseudonym') ||
      lower.includes('funnel_stage') ||
      lower.includes('response_latency') ||
      lower.includes('estimated_deal_value_minor') ||
      lower.includes('utilization_pct')
    ) {
      return 'PSEUDONYMOUS_OPERATIONAL';
    }

    return 'PUBLIC_BUSINESS';
  }

  /**
   * Evaluates if data is safe for external AI provider transmission.
   */
  public static isSafeForExternalAI(classification: DataClassification): boolean {
    return classification === 'PUBLIC_BUSINESS' || classification === 'PSEUDONYMOUS_OPERATIONAL';
  }
}
