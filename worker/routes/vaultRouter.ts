/**
 * @file vaultRouter.ts
 * @description Server-Side Identity Vault AES-GCM Encrypted / Decrypted Resolver
 */

import { AuthenticatedUser } from '../auth/authContext';
import { TenantGuard } from '../middleware/tenantGuard';
import { IdentityVaultRepository } from '../repositories/identityVaultRepository';

export async function handleVaultRoute(
  req: Request,
  user: AuthenticatedUser,
  url: URL,
  envSecret?: string
): Promise<Response> {
  const orgId = url.searchParams.get('orgId') || 'org_apex_holding';

  // GET /api/vault/decrypt?pseudonymId=... (Only OWNER has identity_vault.read permission)
  if (req.method === 'GET') {
    const auth = TenantGuard.authorize(user, orgId, 'identity_vault.read');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const pseudonymId = url.searchParams.get('pseudonymId');
    if (!pseudonymId) {
      // Return ciphertext metadata list (no raw PII)
      const records = await IdentityVaultRepository.listCiphertextRecords(orgId);
      return Response.json({ data: records, orgId });
    }

    try {
      const decrypted = await IdentityVaultRepository.getDecryptedIdentity(pseudonymId, orgId, envSecret);
      if (!decrypted) {
        return Response.json({ error: 'Identity not found for this pseudonym in this tenant.' }, { status: 404 });
      }
      return Response.json({ data: decrypted, orgId });
    } catch (err: any) {
      return Response.json({ error: err.message || 'Decryption failed' }, { status: 403 });
    }
  }

  // POST /api/vault/store (Store encrypted identity)
  if (req.method === 'POST') {
    const auth = TenantGuard.authorize(user, orgId, 'identity_vault.write');
    if (!auth.authorized) {
      return Response.json({ error: auth.errorMessage }, { status: auth.statusCode });
    }

    const body = await req.json() as { fullName: string; email: string; phone: string; pseudonymId?: string };
    const record = await IdentityVaultRepository.storeIdentity(body, orgId, envSecret);
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
