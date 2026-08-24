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
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';

  // POST /api/vault/dev-demo (Worker executes server-side Web Crypto for the UI demo)
  if (url.pathname === '/api/vault/dev-demo' && req.method === 'POST') {
    const auth = TenantGuard.authorize(user, orgId, 'identity_vault.write');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = await req.json() as { plaintext: string; orgId?: string };
    const targetOrg = body.orgId || orgId;
    const plaintext = body.plaintext || 'Customer Real Name: Ayşe Kaya | Phone: +90 532 999 8877';

    try {
      const encrypted = await VaultCryptoService.encrypt(plaintext, targetOrg, environment, masterSecret);
      const decrypted = await VaultCryptoService.decrypt(encrypted, targetOrg, environment, masterSecret);

      return Response.json({
        data: {
          pseudonymId: `cus_${Date.now().toString(36)}`,
          algorithm: encrypted.algorithm,
          keyVersion: encrypted.keyVersion,
          createdAt: new Date().toISOString(),
          decryptedVerification: decrypted,
        },
        orgId: targetOrg
      });
    } catch (err: any) {
      return Response.json({ error: err.message || 'Vault demo operation failed' }, { status: 500 });
    }
  }

  // GET /api/vault/decrypt?pseudonymId=... (Only OWNER has identity_vault.read permission)
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
        return Response.json({ error: 'Identity not found for this pseudonym in this tenant.' }, { status: 404 });
      }
      return Response.json({ data: decrypted, orgId });
    } catch (err: any) {
      return Response.json({ error: err.message || 'Decryption failed' }, { status: 403 });
    }
  }

  // POST /api/vault (or /api/vault/store) - Store encrypted identity
  if (req.method === 'POST') {
    const auth = TenantGuard.authorize(user, orgId, 'identity_vault.write');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = await req.json() as { fullName: string; email: string; phone: string; pseudonymId?: string };
    const record = await IdentityVaultRepository.storeIdentity(db, body, orgId, environment, masterSecret);
    return Response.json({
      data: {
        pseudonymId: record.pseudonymId,
        keyVersion: record.keyVersion,
        algorithm: 'AES-GCM-256',
        createdAt: record.createdAt,
      },
      orgId
    }, { status: 201 });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
