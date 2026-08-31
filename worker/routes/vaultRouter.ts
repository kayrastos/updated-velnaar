/**
 * @file vaultRouter.ts
 * @description Server-Side Identity Vault AES-GCM Encrypted / Decrypted Resolver
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { IdentityVaultRepository } from '../repositories/identityVaultRepository';
import { VaultCryptoService } from '../crypto/vaultCrypto';

export async function handleVaultRoute(
  req: Request,
  user: AuthenticatedUser | null,
  url: URL,
  db?: D1Database,
  masterSecret?: string,
  environment: string = 'production'
): Promise<Response> {
  const orgId = url.searchParams.get('orgId')?.trim() || req.headers.get('X-Tenant-Id')?.trim();
  if (!orgId) {
    return Response.json({
      error: 'TENANT_ID_REQUIRED',
      message: 'Organization ID is required and must be explicitly specified.',
    }, { status: 400 });
  }

  // POST /api/vault/dev-demo (Worker executes server-side Web Crypto for the UI demo)
  if (url.pathname === '/api/vault/dev-demo' && req.method === 'POST') {
    // Strictly disabled in production
    if (environment === 'production') {
      return Response.json({
        error: 'DEV_ENDPOINT_DISABLED',
        message: 'Dev demo endpoint is disabled in production.',
      }, { status: 404 });
    }

    const auth = TenantGuard.authorize(user, orgId, 'identity_vault.write');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'INVALID_JSON', message: 'Request body must be valid JSON.' }, { status: 400 });
    }

    if (!body || typeof body.plaintext !== 'string' || !body.plaintext.trim()) {
      return Response.json({
        error: 'PLAINTEXT_REQUIRED',
        message: 'Synthetic plaintext is required for development demo.',
      }, { status: 400 });
    }

    // Tenant isolation: Always use authorized orgId, do not allow body.orgId override
    const plaintext = body.plaintext.trim();

    try {
      const encrypted = await VaultCryptoService.encrypt(plaintext, orgId, environment, masterSecret);
      const decrypted = await VaultCryptoService.decrypt(encrypted, orgId, environment, masterSecret);

      return Response.json({
        data: {
          pseudonymId: `cus_${Date.now().toString(36)}`,
          algorithm: encrypted.algorithm,
          keyVersion: encrypted.keyVersion,
          createdAt: new Date().toISOString(),
          decryptedVerification: decrypted,
        },
        orgId,
      });
    } catch (err: any) {
      return Response.json({
        error: 'VAULT_OPERATION_FAILED',
        message: environment === 'production' ? 'Vault operation failed' : (err.message || 'Vault operation failed'),
      }, { status: 500 });
    }
  }

  // GET /api/vault (Only OWNER has identity_vault.read permission)
  if (req.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'identity_vault.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const pseudonymId = url.searchParams.get('pseudonymId');
    if (!pseudonymId) {
      // Return ciphertext metadata list (no raw PII)
      const records = await IdentityVaultRepository.listCiphertextRecords(db, orgId, environment);
      return Response.json({ data: records, orgId });
    }

    try {
      const decrypted = await IdentityVaultRepository.getDecryptedIdentity(db, pseudonymId, orgId, environment, masterSecret);
      if (!decrypted) {
        return Response.json({
          error: 'VAULT_RECORD_NOT_FOUND',
          message: 'Identity not found for this pseudonym in this tenant.',
        }, { status: 404 });
      }
      return Response.json({ data: decrypted, orgId });
    } catch (err: any) {
      return Response.json({
        error: 'VAULT_DECRYPTION_DENIED',
        message: environment === 'production' ? 'Decryption failed or denied' : (err.message || 'Decryption failed'),
      }, { status: 403 });
    }
  }

  // POST /api/vault (or /api/vault/store) - Store encrypted identity
  if (req.method === 'POST') {
    const auth = TenantGuard.authorize(user, orgId, 'identity_vault.write');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    try {
      const body = await req.json() as { fullName: string; email: string; phone: string; pseudonymId?: string };
      const record = await IdentityVaultRepository.storeIdentity(db, body, orgId, environment, masterSecret);
      return Response.json({
        data: {
          pseudonymId: record.pseudonymId,
          keyVersion: record.keyVersion,
          algorithm: 'AES-GCM-256',
          createdAt: record.createdAt,
        },
        orgId,
      }, { status: 201 });
    } catch (err: any) {
      return Response.json({
        error: 'VAULT_OPERATION_FAILED',
        message: environment === 'production' ? 'Failed to store encrypted vault record' : (err.message || 'Failed to store encrypted vault record'),
      }, { status: 500 });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
