/**
 * @file apiClient.ts
 * @description Frontend API Client for communicating with Cloudflare Worker API Boundary
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Frontend NEVER does raw crypto or KMS derivation.
 * 2. All operations route through authenticated /api/* endpoints.
 * 3. Handles session token management and standard error envelopes.
 * ============================================================================
 */

import { SecurityTestResult, SecurityEvent } from '../types/security';
import { AuditLogRow } from '../types/database';

export class ApiClient {
  private static authToken: string = 'Bearer dev_session_token_owner_01';
  private static activeTenantId: string = 'org_apex_holding';

  public static setAuthToken(token: string) {
    this.authToken = token;
  }

  public static setActiveTenantId(orgId: string) {
    this.activeTenantId = orgId;
  }

  private static getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Authorization': this.authToken,
      'X-Tenant-Id': this.activeTenantId,
    };
  }

  /**
   * Run server-side automated security tests
   */
  public static async runSecurityTests(orgId: string = this.activeTenantId): Promise<SecurityTestResult[]> {
    const res = await fetch(`/api/security/tests?orgId=${encodeURIComponent(orgId)}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to run security tests' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: SecurityTestResult[] };
    return json.data || [];
  }

  /**
   * Fetch server-side security event stream
   */
  public static async fetchSecurityEvents(orgId: string = this.activeTenantId): Promise<SecurityEvent[]> {
    const res = await fetch(`/api/security/events?orgId=${encodeURIComponent(orgId)}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to fetch security events' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: SecurityEvent[] };
    return json.data || [];
  }

  /**
   * Store identity into Zero-Trust Identity Vault via Worker Web Crypto API
   */
  public static async storeVaultIdentity(
    data: { fullName: string; email: string; phone: string; pseudonymId?: string },
    orgId: string = this.activeTenantId
  ): Promise<{ pseudonymId: string; keyVersion: number; algorithm: string; createdAt: string }> {
    const res = await fetch(`/api/vault?orgId=${encodeURIComponent(orgId)}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to store encrypted vault record' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data: { pseudonymId: string; keyVersion: number; algorithm: string; createdAt: string } };
    return json.data;
  }

  /**
   * Decrypt identity from Zero-Trust Identity Vault via Worker API
   */
  public static async decryptVaultIdentity(
    pseudonymId: string,
    orgId: string = this.activeTenantId
  ): Promise<{ pseudonymId: string; fullName: string; email: string; phone: string }> {
    const res = await fetch(`/api/vault?orgId=${encodeURIComponent(orgId)}&pseudonymId=${encodeURIComponent(pseudonymId)}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to decrypt vault record' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data: { pseudonymId: string; fullName: string; email: string; phone: string } };
    return json.data;
  }

  /**
   * List Audit logs for tenant
   */
  public static async fetchAuditLogs(orgId: string = this.activeTenantId): Promise<AuditLogRow[]> {
    const res = await fetch(`/api/audit?orgId=${encodeURIComponent(orgId)}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to fetch audit logs' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: AuditLogRow[] };
    return json.data || [];
  }
}
