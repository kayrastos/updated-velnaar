/**
 * @file sessionClient.ts
 * @description Client-side Session State Management & Server-Authoritative Verification
 */

import { PlatformRole } from '../types/security';
import { ApiClient } from './apiClient';

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
  isSuperAdmin?: boolean;
  memberships: Array<{
    organizationId: string;
    role: PlatformRole;
    status: 'active' | 'suspended' | 'invited';
  }>;
}

export type SessionState =
  | { status: 'LOADING' }
  | { status: 'AUTH_PROVIDER_NOT_CONFIGURED' }
  | { status: 'UNAUTHENTICATED'; reason?: string }
  | { status: 'AUTHENTICATED'; user: SessionUser; activeTenantId: string | null; role: PlatformRole | null }
  | { status: 'ERROR'; error: string };

export class SessionClient {
  private static currentState: SessionState = { status: 'LOADING' };
  private static listeners: Set<(state: SessionState) => void> = new Set();

  public static getState(): SessionState {
    return this.currentState;
  }

  public static subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private static setState(state: SessionState): void {
    this.currentState = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[SessionClient] Listener error:', err);
      }
    }
  }

  /**
   * Initializes session against the server /api/session endpoint
   */
  public static async initializeSession(requestedOrgId?: string | null): Promise<SessionState> {
    this.setState({ status: 'LOADING' });

    // 1. Check health FIRST - fail immediately on network/operational error
    let health: any;
    try {
      health = await ApiClient.getHealth();
    } catch {
      const errState: SessionState = { status: 'ERROR', error: 'SESSION_UNAVAILABLE' };
      this.setState(errState);
      return errState;
    }

    if (!health || typeof health !== 'object' || health.status !== 'HEALTHY') {
      const errState: SessionState = { status: 'ERROR', error: 'SESSION_UNAVAILABLE' };
      this.setState(errState);
      return errState;
    }

    // 2. If production auth provider is not configured, report AUTH_PROVIDER_NOT_CONFIGURED
    if (health.productionAuthProvider === 'NOT_CONFIGURED') {
      const notConfigState: SessionState = { status: 'AUTH_PROVIDER_NOT_CONFIGURED' };
      this.setState(notConfigState);
      return notConfigState;
    }

    // 3. Auth provider is configured: check if client has auth token
    const token = ApiClient.getAuthToken();
    if (!token) {
      const unauthState: SessionState = { status: 'UNAUTHENTICATED', reason: 'No authentication token provided.' };
      this.setState(unauthState);
      return unauthState;
    }

    try {
      const headers: Record<string, string> = {
        'Authorization': ApiClient.formatAuthHeader(token),
      };
      if (requestedOrgId) {
        headers['X-Tenant-Id'] = requestedOrgId;
      }

      const url = requestedOrgId
        ? `/api/session?orgId=${encodeURIComponent(requestedOrgId)}`
        : '/api/session';

      const res = await fetch(url, { headers });

      if (res.status === 401) {
        ApiClient.clearAuthToken();
        const unauthState: SessionState = { status: 'UNAUTHENTICATED', reason: 'SESSION_UNAUTHORIZED' };
        this.setState(unauthState);
        return unauthState;
      }

      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        const errMessage = (errJson as any)?.message || (errJson as any)?.error || 'CROSS_TENANT_ACCESS_DENIED: Access to organization denied.';
        const errState: SessionState = {
          status: 'ERROR',
          error: errMessage,
        };
        this.setState(errState);
        return errState;
      }

      if (!res.ok) {
        const errState: SessionState = {
          status: 'ERROR',
          error: 'SESSION_UNAVAILABLE',
        };
        this.setState(errState);
        return errState;
      }

      const json = (await res.json()) as any;
      const data = json.data;
      if (!data || !data.userId) {
        const errState: SessionState = { status: 'ERROR', error: 'SESSION_UNAVAILABLE' };
        this.setState(errState);
        return errState;
      }

      const user: SessionUser = {
        userId: data.userId,
        email: data.email || '',
        fullName: data.fullName || '',
        isSuperAdmin: Boolean(data.isSuperAdmin),
        memberships: data.memberships || [],
      };

      const activeTenantId: string | null = data.activeOrganizationId || null;
      const role: PlatformRole | null = activeTenantId ? (data.role || null) : null;

      ApiClient.setActiveTenantId(activeTenantId);

      const authState: SessionState = {
        status: 'AUTHENTICATED',
        user,
        activeTenantId,
        role,
      };

      this.setState(authState);
      return authState;
    } catch {
      const errState: SessionState = {
        status: 'ERROR',
        error: 'SESSION_UNAVAILABLE',
      };
      this.setState(errState);
      return errState;
    }
  }

  /**
   * Switch active tenant
   */
  public static async switchTenant(orgId: string): Promise<SessionState> {
    return await this.initializeSession(orgId);
  }

  /**
   * Clear session
   */
  public static logout(): void {
    ApiClient.clearAuthToken();
    ApiClient.clearActiveTenant();
    const unauthState: SessionState = { status: 'UNAUTHENTICATED', reason: 'User logged out.' };
    this.setState(unauthState);
  }

  public static clearSession(): void {
    this.logout();
  }
}
