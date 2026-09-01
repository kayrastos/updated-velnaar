/**
 * @file worker/ai/redaction.ts
 * @description PII Sanitization & Redaction Layer for External AI Protection with Strict Security Floor
 */

import { DataClassification, RedactionReport, AIRequestEnvelope } from './types';
import { DataClassifier } from './dataClassifier';

export class RedactionLayer {
  private static readonly EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  private static readonly PHONE_REGEX = /(?:\+?90\s?)?(?:\(?0?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}|\(?0?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4})|(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  private static readonly URL_TOKEN_REGEX = /(?:token|access_token|secret|key|api_key|auth)=([a-zA-Z0-9_%-]+)/gi;
  private static readonly BEARER_REGEX = /Bearer\s+[a-zA-Z0-9._-]+/gi;
  private static readonly API_KEY_REGEX = /(?:sec_[a-zA-Z0-9_-]{16,}|sk-[a-zA-Z0-9_-]{20,}|dsk-[a-zA-Z0-9_-]{20,}|AIzaSy[a-zA-Z0-9_-]{33})/g;
  private static readonly IBAN_REGEX = /\b(?:TR\d{2}\s?(?:\d{4}\s?){5}\d{2}|[A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/gi;
  private static readonly TCKN_REGEX = /(?:tckn|tc_kimlik|kimlik_no|identity_no|tckimlik)[\s:=_-]*\b([1-9]\d{10})\b/gi;

  private static readonly PROHIBITED_FIELDS = new Set([
    'encrypted_name_payload',
    'encrypted_email_payload',
    'encrypted_phone_payload',
    'fullName',
    'full_name',
    'email',
    'phone',
    'phoneNumber',
    'phone_number',
    'address',
    'raw_pii',
    'masterSecret',
    'VELNAR_MASTER_KMS_SECRET',
    'velnar_master_kms_secret',
    'apiKey',
    'api_key',
    'token',
    'password',
    'cvv',
    'credit_card',
    'creditcard',
    'ssn',
    'tckn',
    'identity_vault_plaintext',
    'identity_vault_record',
    'identityvault',
  ]);

  /**
   * Sanitizes an AIRequestEnvelope and produces a canonical report.
   */
  public static redactEnvelope(envelope: AIRequestEnvelope): RedactionReport & { sanitizedEnvelope: AIRequestEnvelope } {
    const { sanitized, report } = this.sanitize(envelope, envelope.dataClassification);
    return {
      ...report,
      sanitizedEnvelope: sanitized as AIRequestEnvelope,
    };
  }

  /**
   * Sanitizes a string or structured object and produces a RedactionReport.
   * Enforces security floor: declared classification cannot be downgraded.
   */
  public static sanitize<T = any>(
    input: T,
    declaredClassification?: DataClassification
  ): { sanitized: T; report: RedactionReport } {
    let patternsRedacted = 0;
    const fieldsRemoved: string[] = [];
    const declared: DataClassification = 
      declaredClassification ||
      ((typeof input === 'object' && input !== null && (input as any).dataClassification) ? (input as any).dataClassification : 'PUBLIC_BUSINESS');

    const detectedClassificationBefore = DataClassifier.classify(input as any);

    const sanitizeValue = (val: any): any => {
      if (val === null || val === undefined) return val;
      if (typeof val === 'string') {
        let clean = val;
        // Mask emails
        clean = clean.replace(this.EMAIL_REGEX, (match) => {
          patternsRedacted++;
          const parts = match.split('@');
          return `${parts[0].charAt(0)}***@${parts[1]}`;
        });
        // Mask phone numbers
        clean = clean.replace(this.PHONE_REGEX, () => {
          patternsRedacted++;
          return '[REDACTED_PHONE]';
        });
        // Mask IBANs
        clean = clean.replace(this.IBAN_REGEX, () => {
          patternsRedacted++;
          return '[REDACTED_IBAN]';
        });
        // Mask TCKN
        clean = clean.replace(this.TCKN_REGEX, () => {
          patternsRedacted++;
          return '[REDACTED_TCKN]';
        });
        // Redact URL tokens
        clean = clean.replace(this.URL_TOKEN_REGEX, (match, p1) => {
          patternsRedacted++;
          return match.replace(p1, '[REDACTED_TOKEN]');
        });
        // Redact Bearer auth
        clean = clean.replace(this.BEARER_REGEX, () => {
          patternsRedacted++;
          return 'Bearer [REDACTED_TOKEN]';
        });
        // Redact API keys
        clean = clean.replace(this.API_KEY_REGEX, () => {
          patternsRedacted++;
          return '[REDACTED_API_KEY]';
        });
        return clean;
      }
      if (Array.isArray(val)) {
        return val.map((item) => sanitizeValue(item));
      }
      if (typeof val === 'object') {
        const result: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
          const normalizedKey = DataClassifier.normalizeKey(k);
          if (DataClassifier.FORBIDDEN_OBJECT_KEYS.has(normalizedKey)) {
            fieldsRemoved.push(k);
            patternsRedacted++;
            continue; // Drop prohibited PII / Secret fields entirely
          }
          result[k] = sanitizeValue(v);
        }
        return result;
      }
      return val;
    };

    const sanitized = sanitizeValue(input);
    const detectedClassificationAfter = DataClassifier.classify(sanitized as any);
    
    // Canonical effective classification:
    // Enforces security floor: declared classification cannot be downgraded, and any post-redaction classification is respected.
    const effectiveClassification = DataClassifier.maxSeverity(
      declared,
      detectedClassificationAfter
    );

    // safeForExternalProcessing derives from effectiveClassification.
    const safeForExternalProcessing = DataClassifier.isSafeForExternalAI(effectiveClassification);

    return {
      sanitized,
      report: {
        fieldsRemoved,
        patternsRedacted,
        dataClassBefore: detectedClassificationBefore,
        dataClassAfter: effectiveClassification,
        declaredClassification: declared,
        detectedClassificationBefore,
        detectedClassificationAfter,
        effectiveClassification,
        safeForExternalProcessing,
      },
    };
  }
}
