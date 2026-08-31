import React, { useState } from 'react';
import { usePlatform } from '../../context/PlatformContext';
import { Shield, Building2, AlertTriangle, Lock, RefreshCw, LogIn, ArrowRight } from 'lucide-react';

export const SessionBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    sessionStatus,
    sessionUser,
    memberships,
    activeOrganizationId,
    activeBusinessId,
    currentBusiness,
    businesses,
    businessLoadStatus,
    selectOrganization,
    selectBusiness,
    t
  } = usePlatform();

  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isSelectingBiz, setIsSelectingBiz] = useState<boolean>(false);
  const [bizSelectError, setBizSelectError] = useState<string | null>(null);

  // In DEV, bypass session gates unless explicitly unauthenticated
  if (import.meta.env.DEV) {
    return <>{children}</>;
  }

  // 1. Loading State
  if (sessionStatus === 'LOADING') {
    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center space-y-4 max-w-sm text-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#D4AF37] via-[#BFA15F] to-[#8E7538] flex items-center justify-center shadow-md animate-pulse">
            <span className="font-editorial text-black font-bold text-xl leading-none">V</span>
          </div>
          <div>
            <h2 className="font-editorial text-lg font-bold text-theme-primary tracking-wide">VELNAR PLATFORM</h2>
            <p className="text-xs font-mono text-theme-muted mt-1">Verifying server-authoritative session...</p>
          </div>
          <div className="flex items-center space-x-2 text-xs font-mono text-theme-accent pt-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Establishing Secure Context</span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Auth Provider Not Configured State
  if (sessionStatus === 'AUTH_PROVIDER_NOT_CONFIGURED') {
    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-theme-surface border border-theme-border rounded-xl p-8 shadow-lg text-center space-y-5">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30 font-semibold">
              Production Security Invariant
            </span>
            <h2 className="font-editorial text-xl font-bold text-theme-primary mt-2">
              Authentication Provider Not Configured
            </h2>
            <p className="text-xs text-theme-secondary mt-2 leading-relaxed">
              The production identity provider is not yet configured on this Cloudflare Worker instance. In accordance with zero-trust invariants, operational workspaces cannot be loaded without verified identity.
            </p>
          </div>
          <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border text-left font-mono text-[11px] space-y-1 text-theme-muted">
            <div className="flex justify-between">
              <span>Health Status:</span>
              <span className="text-emerald-500">OK</span>
            </div>
            <div className="flex justify-between">
              <span>Auth Provider:</span>
              <span className="text-amber-500">NOT_CONFIGURED</span>
            </div>
            <div className="flex justify-between">
              <span>Security Guard:</span>
              <span className="text-emerald-500">FAIL_CLOSED</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Unauthenticated State
  if (sessionStatus === 'UNAUTHENTICATED') {
    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-theme-surface border border-theme-border rounded-xl p-8 shadow-lg text-center space-y-5">
          <div className="w-12 h-12 mx-auto rounded-full bg-theme-surface-elevated border border-theme-border flex items-center justify-center text-theme-accent">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-editorial text-xl font-bold text-theme-primary">
              Authentication Required
            </h2>
            <p className="text-xs text-theme-secondary mt-2 leading-relaxed">
              Please provide a valid bearer token to access this organization’s revenue leak intelligence and growth action ledger.
            </p>
          </div>
          <div className="text-xs text-theme-muted font-mono">
            Authorization: Bearer &lt;valid_session_token&gt;
          </div>
        </div>
      </div>
    );
  }

  // 4. Session Error State
  if (sessionStatus === 'ERROR') {
    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-theme-surface border border-red-500/30 rounded-xl p-8 shadow-lg text-center space-y-5">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-editorial text-xl font-bold text-theme-primary">
              Session Verification Failed
            </h2>
            <p className="text-xs text-red-400 mt-2 leading-relaxed font-mono">
              Access to the requested organization was denied or the session is invalid.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 5. Authenticated but No Explicit Organization Selected State
  if (sessionStatus === 'AUTHENTICATED' && !activeOrganizationId) {
    const handleSelectOrg = async (orgId: string) => {
      setIsSwitching(true);
      setSwitchError(null);
      try {
        await selectOrganization(orgId);
      } catch (err: any) {
        setSwitchError(err?.message || 'Failed to select organization.');
      } finally {
        setIsSwitching(false);
      }
    };

    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-theme-surface border border-theme-border rounded-xl p-8 shadow-lg space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 mx-auto rounded-xl bg-theme-surface-elevated border border-theme-border flex items-center justify-center text-theme-accent">
              <Building2 className="w-6 h-6" />
            </div>
            <h2 className="font-editorial text-xl font-bold text-theme-primary">
              Select Organization Workspace
            </h2>
            <p className="text-xs text-theme-secondary">
              Logged in as <strong className="text-theme-primary">{sessionUser?.email || 'User'}</strong>. Select an authorized tenant organization to enter.
            </p>
          </div>

          {switchError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs font-mono text-red-400">
              {switchError}
            </div>
          )}

          <div className="space-y-2">
            {memberships.length === 0 ? (
              <div className="p-4 bg-theme-surface-elevated border border-theme-border rounded-lg text-center text-xs text-theme-muted font-mono">
                No active organization memberships found for this account.
              </div>
            ) : (
              memberships.map(mem => (
                <button
                  key={mem.organizationId}
                  onClick={() => handleSelectOrg(mem.organizationId)}
                  disabled={isSwitching || mem.status !== 'active'}
                  className="w-full flex items-center justify-between p-3.5 rounded-lg bg-theme-surface-elevated hover:bg-theme-surface-muted border border-theme-border text-left transition-all cursor-pointer group disabled:opacity-50"
                >
                  <div>
                    <div className="font-mono font-medium text-xs text-theme-primary group-hover:text-theme-accent flex items-center space-x-2">
                      <span>{mem.organizationId}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-theme-surface border border-theme-border text-theme-muted uppercase">
                        {mem.role}
                      </span>
                    </div>
                    <div className="text-[10px] text-theme-secondary mt-0.5">Status: {mem.status}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-theme-muted group-hover:text-theme-accent transition-transform group-hover:translate-x-0.5" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // 6. Organization Active & Data Loading
  if (businessLoadStatus === 'LOADING') {
    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center space-y-4 max-w-sm text-center">
          <div className="w-10 h-10 rounded-lg bg-theme-surface-elevated border border-theme-border flex items-center justify-center text-theme-accent">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
          <div>
            <h3 className="font-editorial text-base font-bold text-theme-primary tracking-wide">Hydrating Workspace</h3>
            <p className="text-xs font-mono text-theme-muted mt-1">Loading canonical operational ledgers...</p>
          </div>
        </div>
      </div>
    );
  }

  // 6.5 Business Load Error State
  if (businessLoadStatus === 'ERROR') {
    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-theme-surface border border-red-500/30 rounded-xl p-8 shadow-lg text-center space-y-5">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/30 font-semibold">
              Workspace Ingestion Failure
            </span>
            <h2 className="font-editorial text-xl font-bold text-theme-primary mt-2">
              Failed to Hydrate Workspace
            </h2>
            <p className="text-xs text-theme-secondary mt-2 leading-relaxed">
              One or more critical operational datasets failed to load from the canonical ledger for organization <strong className="text-theme-primary font-mono">{activeOrganizationId}</strong>.
            </p>
          </div>
          {activeOrganizationId && (
            <button
              onClick={() => selectOrganization(activeOrganizationId)}
              className="px-4 py-2 bg-theme-accent text-black font-semibold text-xs rounded-lg hover:bg-theme-accent/90 transition-colors inline-flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Ingestion</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // 7. Authenticated & Organization Active but No Business Available in Database
  if (sessionStatus === 'AUTHENTICATED' && activeOrganizationId && businesses.length === 0) {
    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-theme-surface border border-theme-border rounded-xl p-8 shadow-lg text-center space-y-5">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30 font-semibold">
              Organization Scoped
            </span>
            <h2 className="font-editorial text-xl font-bold text-theme-primary mt-2">
              No Active Business Unit Found
            </h2>
            <p className="text-xs text-theme-secondary mt-2 leading-relaxed">
              Organization <strong className="text-theme-primary font-mono">{activeOrganizationId}</strong> does not have an active business configured in the canonical ledger. Operational intelligence workspaces require a verified business context.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 8. Multi-Business Tenant: User Must Explicitly Select a Business Unit
  if (sessionStatus === 'AUTHENTICATED' && activeOrganizationId && businesses.length > 1 && !activeBusinessId) {
    const handleSelectBiz = async (bizId: string) => {
      setIsSelectingBiz(true);
      setBizSelectError(null);
      try {
        await selectBusiness(bizId);
      } catch (err: any) {
        setBizSelectError(err?.message || 'Failed to select business unit.');
      } finally {
        setIsSelectingBiz(false);
      }
    };

    return (
      <div className="min-h-screen bg-theme-bg text-theme-primary flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-theme-surface border border-theme-border rounded-xl p-8 shadow-lg space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 mx-auto rounded-xl bg-theme-surface-elevated border border-theme-border flex items-center justify-center text-theme-accent">
              <Building2 className="w-6 h-6" />
            </div>
            <h2 className="font-editorial text-xl font-bold text-theme-primary">
              Select Business Unit
            </h2>
            <p className="text-xs text-theme-secondary">
              Organization <strong className="text-theme-primary font-mono">{activeOrganizationId}</strong> manages multiple business units. Select a unit to open its operational workspace.
            </p>
          </div>

          {bizSelectError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs font-mono text-red-400">
              {bizSelectError}
            </div>
          )}

          <div className="space-y-2">
            {businesses.map(biz => (
              <button
                key={biz.id}
                onClick={() => handleSelectBiz(biz.id)}
                disabled={isSelectingBiz || biz.status !== 'active'}
                className="w-full flex items-center justify-between p-3.5 rounded-lg bg-theme-surface-elevated hover:bg-theme-surface-muted border border-theme-border text-left transition-all cursor-pointer group disabled:opacity-50"
              >
                <div>
                  <div className="font-sans font-semibold text-xs text-theme-primary group-hover:text-theme-accent flex items-center space-x-2">
                    <span>{biz.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-theme-surface border border-theme-border text-theme-muted uppercase font-mono">
                      {biz.currency}
                    </span>
                  </div>
                  <div className="text-[10px] text-theme-secondary mt-0.5 font-mono">
                    ID: {biz.id} • {biz.industry_vertical}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-theme-muted group-hover:text-theme-accent transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 9. Authenticated, Organization Active & Business Verified -> Render Workspace
  return <>{children}</>;
};
