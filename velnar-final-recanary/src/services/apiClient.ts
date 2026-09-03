/**
 * @file apiClient.ts
 * @description Frontend API Client for communicating with Cloudflare Worker API Boundary
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Starts strictly empty (authToken = null, activeTenantId = null).
 * 2. Stored token is raw token string only. Never store 'Bearer <token>'.
 * 3. All authenticated requests use getAuthenticatedHeaders() -> exactly one 'Bearer '.
 * 4. Tenant-scoped requests with no tenant fail before fetch (TENANT_ID_REQUIRED).
 * 5. Authenticated requests with no auth token fail before fetch (AUTHENTICATION_REQUIRED).
 * ============================================================================
 */

import { SecurityTestResult, SecurityEvent } from '../types/security';
import { AuditLogRow, OrganizationRow, BusinessRow } from '../types/database';

export interface AuthSession {
  token: string;
  userId: string;
  organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF' | 'VIEWER';
  expiresAt?: string;
}

export interface AuthProvider {
  getSession(): Promise<AuthSession | null>;
  login?(credentials: any): Promise<AuthSession>;
  logout(): Promise<void>;
}

export interface HealthResponse {
  status: 'HEALTHY';
  version: string;
  environment: string;
  securityArchitecture?: string;
  cryptoCapability?: string;
  vaultCryptoCapability?: string;
  vaultConfigured?: boolean;
  databaseConfigured?: boolean;
  d1Status?: string;
  productionAuthProvider: 'CONFIGURED' | 'NOT_CONFIGURED';
  productionExternalAi: 'ENABLED' | 'DISABLED' | 'NOT_CONFIGURED';
  roles?: string[];
  fulgorRay?: { status: string; mode: string };
}

export class ApiClient {
  private static authToken: string | null = null;
  private static activeTenantId: string | null = null;

  public static setAuthToken(token: string | null): void {
    if (token) {
      let clean = token.trim();
      while (clean.toLowerCase().startsWith('bearer ')) {
        clean = clean.slice(7).trim();
      }
      this.authToken = clean || null;
    } else {
      this.authToken = null;
    }
  }

  public static clearAuthToken(): void {
    this.authToken = null;
  }

  public static getAuthToken(): string | null {
    return this.authToken;
  }

  public static isAuthenticated(): boolean {
    return this.authToken !== null && this.authToken.trim().length > 0;
  }

  public static setActiveTenantId(orgId: string | null): void {
    this.activeTenantId = orgId ? orgId.trim() : null;
  }

  public static clearActiveTenant(): void {
    this.activeTenantId = null;
  }

  public static getActiveTenantId(): string | null {
    return this.activeTenantId;
  }

  public static formatAuthHeader(rawToken: string): string {
    let clean = rawToken.trim();
    while (clean.toLowerCase().startsWith('bearer ')) {
      clean = clean.slice(7).trim();
    }
    return `Bearer ${clean}`;
  }

  /**
   * Helper that builds standard authenticated headers with single Bearer and X-Tenant-Id
   */
  public static getAuthenticatedHeaders(options?: {
    customToken?: string;
    customTenantId?: string;
    requireTenant?: boolean;
    requireAuth?: boolean;
  }): Record<string, string> {
    const requireTenant = options?.requireTenant !== false; // default true
    const requireAuth = options?.requireAuth !== false; // default true

    const token = options?.customToken ?? this.authToken;
    const tenantId = options?.customTenantId ?? this.activeTenantId;

    if (requireAuth) {
      if (!token || token.trim().length === 0) {
        throw new Error('AUTHENTICATION_REQUIRED: Valid authentication session token is required.');
      }
    }

    if (requireTenant) {
      if (!tenantId || tenantId.trim().length === 0) {
        throw new Error('TENANT_ID_REQUIRED: Active tenant ID is required.');
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (tenantId && tenantId.trim().length > 0) {
      headers['X-Tenant-Id'] = tenantId.trim();
    }

    if (token && token.trim().length > 0) {
      headers['Authorization'] = this.formatAuthHeader(token);
    }

    return headers;
  }

  /**
   * Fetch public health and capability status from Worker API (unauthenticated)
   */
  public static async getHealth(): Promise<HealthResponse> {
    const res = await fetch('/api/health');
    if (!res.ok) {
      throw new Error(`Health check endpoint returned HTTP ${res.status}`);
    }
    return (await res.json()) as HealthResponse;
  }

  /**
   * Run server-side automated security tests (DEV ONLY)
   */
  public static async runSecurityTests(orgId?: string): Promise<SecurityTestResult[]> {
    if (!import.meta.env.DEV) {
      throw new Error('DEV_ENDPOINT_DISABLED: Security test suite is disabled outside development.');
    }

    const headers = this.getAuthenticatedHeaders({ customTenantId: orgId });
    const targetOrgId = orgId || this.activeTenantId;
    const res = await fetch(`/api/security/tests?orgId=${encodeURIComponent(targetOrgId!)}`, {
      method: 'GET',
      headers,
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
  public static async fetchSecurityEvents(orgId?: string): Promise<SecurityEvent[]> {
    const headers = this.getAuthenticatedHeaders({ customTenantId: orgId });
    const targetOrgId = orgId || this.activeTenantId;
    const res = await fetch(`/api/security/events?orgId=${encodeURIComponent(targetOrgId!)}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to fetch security events' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: SecurityEvent[] };
    return json.data || [];
  }

  /**
   * Execute server-side Web Crypto Vault development demo (DEV ONLY)
   */
  public static async executeVaultDevDemo(
    plaintext: string,
    orgId?: string
  ): Promise<{ pseudonymId: string; algorithm: string; keyVersion: number; createdAt: string; decryptedVerification: string }> {
    if (!import.meta.env.DEV) {
      throw new Error('DEV_ENDPOINT_DISABLED: Vault dev demo is disabled outside development.');
    }

    const headers = this.getAuthenticatedHeaders({ customTenantId: orgId });
    const targetOrgId = orgId || this.activeTenantId;
    const res = await fetch(`/api/vault/dev-demo?orgId=${encodeURIComponent(targetOrgId!)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ plaintext, orgId: targetOrgId }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to run server-side vault demo' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data: { pseudonymId: string; algorithm: string; keyVersion: number; createdAt: string; decryptedVerification: string } };
    return json.data;
  }

  /**
   * Store identity into Encrypted Identity Vault via Worker Web Crypto API
   */
  public static async storeVaultIdentity(
    data: { fullName: string; email: string; phone: string; pseudonymId?: string },
    orgId?: string
  ): Promise<{ pseudonymId: string; keyVersion: number; algorithm: string; createdAt: string }> {
    const headers = this.getAuthenticatedHeaders({ customTenantId: orgId });
    const targetOrgId = orgId || this.activeTenantId;
    const res = await fetch(`/api/vault?orgId=${encodeURIComponent(targetOrgId!)}`, {
      method: 'POST',
      headers,
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
   * Decrypt identity from Encrypted Identity Vault via Worker API
   */
  public static async decryptVaultIdentity(
    pseudonymId: string,
    orgId?: string
  ): Promise<{ pseudonymId: string; fullName: string; email: string; phone: string }> {
    const headers = this.getAuthenticatedHeaders({ customTenantId: orgId });
    const targetOrgId = orgId || this.activeTenantId;
    const res = await fetch(`/api/vault?orgId=${encodeURIComponent(targetOrgId!)}&pseudonymId=${encodeURIComponent(pseudonymId)}`, {
      method: 'GET',
      headers,
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
  public static async fetchAuditLogs(orgId?: string): Promise<AuditLogRow[]> {
    const headers = this.getAuthenticatedHeaders({ customTenantId: orgId });
    const targetOrgId = orgId || this.activeTenantId;
    const res = await fetch(`/api/audit?orgId=${encodeURIComponent(targetOrgId!)}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to fetch audit logs' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: AuditLogRow[] };
    return json.data || [];
  }

  /**
   * Fetch bootstrap metadata (OrganizationRow and BusinessRow[]) for active tenant
   */
  public static async fetchBootstrap(orgId?: string): Promise<{ organization: OrganizationRow; businesses: BusinessRow[] }> {
    const headers = this.getAuthenticatedHeaders({ customTenantId: orgId });
    const targetOrgId = orgId || this.activeTenantId;
    const res = await fetch(`/api/bootstrap?orgId=${encodeURIComponent(targetOrgId!)}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Failed to fetch organization bootstrap metadata' }))) as { message?: string };
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data: { organization: OrganizationRow; businesses: BusinessRow[] } };
    return json.data;
  }
}
