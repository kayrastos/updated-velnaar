import { describe, it, expect, vi } from 'vitest';
import { SafeLogger } from '../../worker/security/safeLogger';
import worker from '../../worker/index';

describe('SafeLogger & Worker Error Sanitization Regressions', () => {
  describe('SafeLogger.sanitizeMessage', () => {
    it('redacts Bearer tokens from raw log strings', () => {
      const msg = 'User login failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID';
      const sanitized = SafeLogger.sanitizeMessage(msg);
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID');
      expect(sanitized).toContain('[REDACTED_TOKEN]');
    });

    it('redacts JWT tokens from raw log strings', () => {
      const msg = 'Received token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozGz6ePqT1xWmk';
      const sanitized = SafeLogger.sanitizeMessage(msg);
      expect(sanitized).not.toContain('eyJzdWIiOiIxMjM0NTY3ODkwIn0');
      expect(sanitized).toContain('[REDACTED_JWT]');
    });

    it('redacts explicit secret / password / apiKey patterns', () => {
      const msg = 'Failed to connect: apiKey: secret_api_key_123456789 and password=SuperSecretPassword123!';
      const sanitized = SafeLogger.sanitizeMessage(msg);
      expect(sanitized).not.toContain('secret_api_key_123456789');
      expect(sanitized).not.toContain('SuperSecretPassword123!');
      expect(sanitized).toContain('[REDACTED_SECRET]');
    });

    it('masks email addresses in raw message strings', () => {
      const msg = 'Customer email registered: john.doe@enterprise.com and al@x.com';
      const sanitized = SafeLogger.sanitizeMessage(msg);
      expect(sanitized).not.toContain('john.doe@enterprise.com');
      expect(sanitized).toContain('j***e@enterprise.com');
      expect(sanitized).toContain('a***@x.com');
    });

    it('masks international phone numbers in raw message strings', () => {
      const msg = 'SMS notification sent to +905321234567';
      const sanitized = SafeLogger.sanitizeMessage(msg);
      expect(sanitized).not.toContain('+905321234567');
      expect(sanitized).toContain('+905 *** **67');
    });
  });

  describe('SafeLogger.redactData (Structured Context)', () => {
    it('redacts sensitive keys and masks PII in nested structured objects', () => {
      const rawContext = {
        userId: 'usr_123',
        customer_email: 'clara.vance@blackmesa.gov',
        customer_phone: '+905329998877',
        api_key: 'sk_live_very_secret_token_123',
        nested: {
          authorization: 'Bearer secret_token_xyz',
          password: 'myPassword!',
          safeField: 'harmless_metric',
        },
        items: [
          { token: 'secret_item_token', email: 'alice@example.com' }
        ]
      };

      const redacted = SafeLogger.redactData(rawContext) as any;

      expect(redacted.userId).toBe('usr_123');
      expect(redacted.customer_email).toBe('c***e@blackmesa.gov');
      expect(redacted.customer_phone).toContain('***');
      expect(redacted.customer_phone).not.toContain('9998877');
      expect(redacted.api_key).toBe('[REDACTED_SECRET]');
      expect(redacted.nested.authorization).toBe('[REDACTED_SECRET]');
      expect(redacted.nested.password).toBe('[REDACTED_SECRET]');
      expect(redacted.nested.safeField).toBe('harmless_metric');
      expect(redacted.items[0].token).toBe('[REDACTED_SECRET]');
      expect(redacted.items[0].email).toBe('a***e@example.com');
    });
  });

  describe('Worker Fatal Error Handling in Production vs Development', () => {
    it('in production, fatal server errors return generic INTERNAL_ERROR without leaking raw error message or stack', async () => {
      const spy = vi.spyOn(SafeLogger, 'error');

      // Create a request with an Authorization header that throws when accessed, simulating an unexpected runtime fault
      const throwingHeaders = new Headers();
      Object.defineProperty(throwingHeaders, 'get', {
        value: (name: string) => {
          if (name.toLowerCase() === 'authorization') {
            throw new Error('Fatal SQL/Crypto internal fault: SELECT master_secret FROM keys WHERE tenant="org_secret"');
          }
          return null;
        }
      });

      const req = new Request('https://app.velnar.studio/api/auth/me');
      Object.defineProperty(req, 'headers', {
        value: throwingHeaders,
      });

      const res = await worker.fetch(req, {
        ENVIRONMENT: 'production',
        DB: {} as any,
      });

      expect(res.status).toBe(500);

      const json = await res.json() as any;
      expect(json.error).toBe('INTERNAL_ERROR');
      // Must NOT leak internal error message, query strings, or stack trace in production response
      expect(json.message).toBeUndefined();
      expect(json.stack).toBeUndefined();

      // SafeLogger in production was called with structured error without raw string interpolation
      expect(spy).toHaveBeenCalled();
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
      expect(lastCall[0]).toBe('[WORKER_FATAL_ERROR]');
      expect(lastCall[1]?.safeErrorCode).toBe('ERR_WORKER_INTERNAL');

      spy.mockRestore();
    });

    it('in development, fatal server errors include message for debugging', async () => {
      const throwingHeaders = new Headers();
      Object.defineProperty(throwingHeaders, 'get', {
        value: (name: string) => {
          if (name.toLowerCase() === 'authorization') {
            throw new Error('Dev Debug Internal Fault');
          }
          return null;
        }
      });

      const req = new Request('https://app.velnar.studio/api/auth/me');
      Object.defineProperty(req, 'headers', {
        value: throwingHeaders,
      });

      const res = await worker.fetch(req, {
        ENVIRONMENT: 'development',
        DB: {} as any,
      });

      expect(res.status).toBe(500);
      const json = await res.json() as any;
      expect(json.error).toBe('INTERNAL_ERROR');
      expect(json.message).toBe('Dev Debug Internal Fault');
    });
  });

  describe('Frontend Health vaultConfigured parsing logic', () => {
    function parseVaultStatus(health: any) {
      return {
        capability: health?.vaultCryptoCapability || 'AES-GCM-256',
        configured: typeof health?.vaultConfigured === 'boolean' ? health.vaultConfigured : null,
      };
    }

    it('boolean true returns CONFIGURED (true)', () => {
      const res = parseVaultStatus({ vaultConfigured: true, vaultCryptoCapability: 'AES-GCM-256' });
      expect(res.configured).toBe(true);
    });

    it('boolean false returns NOT CONFIGURED (false)', () => {
      const res = parseVaultStatus({ vaultConfigured: false, vaultCryptoCapability: 'AES-GCM-256' });
      expect(res.configured).toBe(false);
    });

    it('missing property returns UNKNOWN (null) and must NOT default to true', () => {
      const res = parseVaultStatus({ vaultCryptoCapability: 'AES-GCM-256' });
      expect(res.configured).toBeNull();
      expect(res.configured).not.toBe(true);
    });

    it('malformed non-boolean string returns UNKNOWN (null) and must NOT default to true', () => {
      const res = parseVaultStatus({ vaultConfigured: 'yes', vaultCryptoCapability: 'AES-GCM-256' });
      expect(res.configured).toBeNull();
      expect(res.configured).not.toBe(true);
    });

    it('null/undefined health payload returns UNKNOWN (null)', () => {
      const res = parseVaultStatus(null);
      expect(res.configured).toBeNull();
      expect(res.capability).toBe('AES-GCM-256');
    });
  });
});
