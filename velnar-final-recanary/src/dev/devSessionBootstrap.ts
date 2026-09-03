/**
 * @file src/dev/devSessionBootstrap.ts
 * @description Synthetic Dev Session Initializer for Development & Preview Mode
 * 
 * ============================================================================
 * PRINCIPLES:
 * 1. Loaded ONLY when import.meta.env.DEV is true.
 * 2. Installs synthetic demo tenant and dev test token into ApiClient.
 * 3. Never bundled or executed in production.
 * ============================================================================
 */

import { ApiClient } from '../services/apiClient';

export function bootstrapDevSession(): void {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    // RAW TOKEN ONLY (No 'Bearer ' prefix)
    ApiClient.setAuthToken('test_user:usr_dev_owner:org_apex_holding:OWNER');
    ApiClient.setActiveTenantId('org_apex_holding');
  }
}
