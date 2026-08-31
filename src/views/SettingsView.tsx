import React, { useState, useEffect } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { useTheme, Theme } from '../context/ThemeContext';
import { UserRole } from '../types/database';
import { AIClient, AIStatusData } from '../services/aiClient';
import { 
  Settings, 
  ShieldCheck, 
  Database, 
  Cpu, 
  Copy, 
  Check, 
  Users, 
  Terminal,
  Palette,
  Moon,
  Sun,
  Laptop,
  Sparkles,
  Lock,
  DollarSign
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { 
    currentOrg, 
    currentRole, 
    setCurrentRole, 
    auditLogs, 
    aiRuns, 
    t 
  } = usePlatform();

  const { theme, setTheme, resolvedTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<'tenant' | 'theme' | 'd1' | 'aiGateway' | 'audit'>('tenant');
  const [copiedSql, setCopiedSql] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatusData | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (currentOrg?.id) {
      AIClient.getStatus(currentOrg.id)
        .then(status => {
          if (isMounted) setAiStatus(status);
        })
        .catch(err => {
          console.warn('AI status fetch warning:', err);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [currentOrg?.id]);

  const migrationsMetadata = [
    { id: '0001', name: '0001_initial_schema.sql', description: 'Canonical multi-tenant tables, integer minor currency fields, identity vault, and integrity constraints.', tables: 23, status: 'Applied' },
    { id: '0002', name: '0002_indexes_and_performance.sql', description: 'Performance indices for tenant isolation, funnel stages, and audit trails.', tables: 0, status: 'Applied' },
    { id: '0003', name: '0003_ai_intelligence_layer.sql', description: 'AI run telemetry, spend tracking, and audit logging tables.', tables: 2, status: 'Applied' },
    { id: '0004', name: '0004_growth_action_policy_hardening.sql', description: 'Tenant action policy configuration, guardrail status column, and unconfigured policy safety.', tables: 1, status: 'Applied' },
  ];

  const handleCopyMigrationsPath = () => {
    navigator.clipboard.writeText('wrangler d1 migrations apply velnar-db --remote');
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  };

  return (
    <div id="settings-view" className="space-y-6">
      
      {/* Header */}
      <div className="bg-theme-surface p-5 rounded-xl border border-theme-border">
        <div className="flex items-center space-x-2.5">
          <Settings className="w-5 h-5 text-theme-accent" />
          <h1 className="text-xl font-editorial font-bold text-theme-primary tracking-wide">
            {t.settings.title}
          </h1>
        </div>
        <p className="text-xs text-theme-muted mt-1 max-w-2xl">
          {t.settings.subtitle}
        </p>
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-theme-border pb-1 text-xs font-mono">
        <button
          id="tab-settings-tenant"
          onClick={() => setActiveTab('tenant')}
          className={`px-4 py-2 rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
            activeTab === 'tenant'
              ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-bold'
              : 'text-theme-muted hover:text-theme-primary'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>{t.settings.tabs.tenant}</span>
        </button>

        <button
          id="tab-settings-theme"
          onClick={() => setActiveTab('theme')}
          className={`px-4 py-2 rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
            activeTab === 'theme'
              ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-bold'
              : 'text-theme-muted hover:text-theme-primary'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Theme & Appearance</span>
        </button>

        <button
          id="tab-settings-d1"
          onClick={() => setActiveTab('d1')}
          className={`px-4 py-2 rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
            activeTab === 'd1'
              ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-bold'
              : 'text-theme-muted hover:text-theme-primary'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>{t.settings.tabs.d1Schema}</span>
        </button>

        <button
          id="tab-settings-ai-gateway"
          onClick={() => setActiveTab('aiGateway')}
          className={`px-4 py-2 rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
            activeTab === 'aiGateway'
              ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-bold'
              : 'text-theme-muted hover:text-theme-primary'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>{t.settings.tabs.aiGateway}</span>
        </button>

        <button
          id="tab-settings-audit"
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 rounded-t-lg transition-all cursor-pointer flex items-center space-x-2 ${
            activeTab === 'audit'
              ? 'bg-theme-surface text-theme-primary border-t border-x border-theme-border font-bold'
              : 'text-theme-muted hover:text-theme-primary'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>{t.settings.tabs.auditLogs}</span>
        </button>
      </div>

      {/* Tab 1: Tenant & RBAC Simulation */}
      {activeTab === 'tenant' && (
        <div className="space-y-6">
          <div className="bg-theme-surface border border-theme-border rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-mono uppercase tracking-wider font-semibold text-theme-primary">
              Tenant Organization Profile
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                <span className="text-theme-muted block">Organization ID</span>
                <span className="text-theme-primary font-bold">{currentOrg?.id || 'NO_SESSION'}</span>
              </div>
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                <span className="text-theme-muted block">Tier Level</span>
                <span className="text-theme-accent font-bold uppercase">{currentOrg?.tier || 'UNSPECIFIED'}</span>
              </div>
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                <span className="text-theme-muted block">Tenant Isolation Mode</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">Cloudflare D1 Segmented</span>
              </div>
            </div>
          </div>

          {/* RBAC Role Simulator */}
          <div className="bg-theme-surface border border-theme-border rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-mono uppercase tracking-wider font-semibold text-theme-primary">
                {t.settings.rbac.title}
              </h3>
              <p className="text-xs text-theme-muted mt-1">
                {t.settings.rbac.switchRoleNotice}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono">
              {(['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'] as UserRole[]).map((role) => (
                <div
                  key={role}
                  id={`role-select-${role}`}
                  onClick={() => setCurrentRole(role)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    currentRole === role
                      ? 'bg-theme-surface-elevated border-theme-accent ring-1 ring-theme-accent/30'
                      : 'bg-theme-surface-elevated border-theme-border hover:border-theme-border-strong'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-theme-primary uppercase tracking-wider">{role}</span>
                    {currentRole === role && <span className="text-[10px] bg-theme-accent text-black font-bold px-1.5 py-0.2 rounded">ACTIVE</span>}
                  </div>
                  <p className="text-[11px] text-theme-secondary font-sans">
                    {role === 'OWNER' && 'Full executive authority, Identity Vault decrypt, and billing configuration.'}
                    {role === 'ADMIN' && 'System configuration, growth action approval, and connector management.'}
                    {role === 'MANAGER' && 'Operational team dispatch, lead inbox review, and appointment overview.'}
                    {role === 'STAFF' && 'Appointment scheduling, physical desk check-in, and customer communication.'}
                    {role === 'VIEWER' && 'Read-only analytics and audit trail monitoring. Action execution blocked.'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Theme & Appearance */}
      {activeTab === 'theme' && (
        <div className="bg-theme-surface border border-theme-border rounded-xl p-5 space-y-5">
          <div>
            <h3 className="text-sm font-mono uppercase tracking-wider font-semibold text-theme-primary">
              Interface Theme & Design System
            </h3>
            <p className="text-xs text-theme-muted mt-1">
              Select between obsidian dark, warm ivory editorial light, or automatic system theme synchronization.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            
            {/* Obsidian Dark */}
            <div
              id="theme-card-dark"
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-xl border transition-all cursor-pointer space-y-3 ${
                theme === 'dark'
                  ? 'bg-theme-surface-elevated border-theme-accent ring-1 ring-theme-accent/30'
                  : 'bg-theme-surface-elevated border-theme-border hover:border-theme-border-strong'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Moon className="w-4 h-4 text-[#D4AF37]" />
                  <span className="font-bold text-theme-primary">Obsidian Dark</span>
                </div>
                {theme === 'dark' && <span className="text-[10px] bg-theme-accent text-black font-bold px-1.5 py-0.2 rounded">SELECTED</span>}
              </div>
              <div className="h-12 rounded-lg bg-[#090A0D] border border-theme-border p-2 flex items-center justify-between">
                <span className="text-[11px] text-[#F5F4F0] font-sans">Velvet Black & Champagne Gold</span>
                <span className="w-3 h-3 rounded-full bg-[#D4AF37]"></span>
              </div>
              <p className="text-[11px] text-theme-muted font-sans">
                Financial terminal depth, high-contrast readability, and low eye fatigue.
              </p>
            </div>

            {/* Warm Ivory Light */}
            <div
              id="theme-card-light"
              onClick={() => setTheme('light')}
              className={`p-4 rounded-xl border transition-all cursor-pointer space-y-3 ${
                theme === 'light'
                  ? 'bg-theme-surface-elevated border-theme-accent ring-1 ring-theme-accent/30'
                  : 'bg-theme-surface-elevated border-theme-border hover:border-theme-border-strong'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sun className="w-4 h-4 text-[#A68234]" />
                  <span className="font-bold text-theme-primary">Warm Ivory</span>
                </div>
                {theme === 'light' && <span className="text-[10px] bg-theme-accent text-black font-bold px-1.5 py-0.2 rounded">SELECTED</span>}
              </div>
              <div className="h-12 rounded-lg bg-[#F9F8F5] border border-[#E5E2D8] p-2 flex items-center justify-between">
                <span className="text-[11px] text-[#1A1B1F] font-sans">Editorial Paper & Gold Accent</span>
                <span className="w-3 h-3 rounded-full bg-[#A68234]"></span>
              </div>
              <p className="text-[11px] text-theme-muted font-sans">
                Warm paper tone, clear charcoal text, no eye-blinding pure white.
              </p>
            </div>

            {/* System Mode */}
            <div
              id="theme-card-system"
              onClick={() => setTheme('system')}
              className={`p-4 rounded-xl border transition-all cursor-pointer space-y-3 ${
                theme === 'system'
                  ? 'bg-theme-surface-elevated border-theme-accent ring-1 ring-theme-accent/30'
                  : 'bg-theme-surface-elevated border-theme-border hover:border-theme-border-strong'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Laptop className="w-4 h-4 text-theme-accent" />
                  <span className="font-bold text-theme-primary">System Match</span>
                </div>
                {theme === 'system' && <span className="text-[10px] bg-theme-accent text-black font-bold px-1.5 py-0.2 rounded">ACTIVE ({resolvedTheme})</span>}
              </div>
              <div className="h-12 rounded-lg bg-theme-surface-muted border border-theme-border p-2 flex items-center justify-between">
                <span className="text-[11px] text-theme-primary font-sans">Syncs with OS Color Scheme</span>
                <span className="text-[10px] font-mono text-theme-accent">AUTO</span>
              </div>
              <p className="text-[11px] text-theme-muted font-sans">
                Automatically adjusts according to your system day/night appearance schedule.
              </p>
            </div>

          </div>
        </div>
      )}

      {/* Tab 3: Cloudflare D1 Schema & Migrations */}
      {activeTab === 'd1' && (
        <div className="space-y-4">
          <div className="bg-theme-surface border border-theme-border rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-mono uppercase tracking-wider font-semibold text-theme-primary">
                  Cloudflare D1 Schema & Canonical Migrations
                </h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  The single source of truth for D1 database schemas is the <code className="text-theme-accent">/migrations</code> directory.
                </p>
              </div>

              <button
                id="btn-copy-d1-sql"
                onClick={handleCopyMigrationsPath}
                className="flex items-center space-x-2 bg-theme-surface-elevated hover:bg-theme-surface-muted text-theme-primary px-3.5 py-1.5 rounded-lg border border-theme-border text-xs font-mono transition-all cursor-pointer shrink-0"
              >
                {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-theme-accent" />}
                <span>{copiedSql ? 'Command Copied' : 'Copy Apply Command'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                <span className="text-theme-muted block">Migration Directory</span>
                <span className="text-theme-primary font-bold">/migrations</span>
              </div>
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                <span className="text-theme-muted block">Canonical Database Binding</span>
                <span className="text-theme-accent font-bold">DB (velnar-db)</span>
              </div>
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                <span className="text-theme-muted block">Active Sequence</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">0001 → 0004</span>
              </div>
            </div>

            <div className="overflow-x-auto border border-theme-border rounded-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-theme-surface-elevated text-theme-muted uppercase text-[10px] border-b border-theme-border">
                  <tr>
                    <th className="px-4 py-3">Sequence</th>
                    <th className="px-4 py-3">Migration File</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border bg-theme-surface">
                  {migrationsMetadata.map((mig) => (
                    <tr key={mig.id} className="hover:bg-theme-surface-elevated">
                      <td className="px-4 py-3 font-bold text-theme-accent">{mig.id}</td>
                      <td className="px-4 py-3 text-theme-primary font-semibold">{mig.name}</td>
                      <td className="px-4 py-3 text-theme-secondary font-sans text-xs">{mig.description}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          {mig.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: VELNAR AI Intelligence Layer */}
      {activeTab === 'aiGateway' && (
        <div className="space-y-6">
          <div className="bg-theme-surface border border-theme-border rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-theme-accent" />
                  <h3 className="text-sm font-mono uppercase tracking-wider font-semibold text-theme-primary">
                    VELNAR AI Intelligence Layer
                  </h3>
                  <span className="text-[10px] bg-theme-accent/20 text-theme-accent border border-theme-accent/30 font-mono font-bold px-2 py-0.5 rounded">
                    SERVER-SIDE GATEWAY
                  </span>
                </div>
                <p className="text-xs text-theme-muted mt-1">
                  Deterministic Systems Find Facts · AI Interprets and Prepares Actions · Humans Approve · Code Enforces
                </p>
              </div>

              <div className="flex items-center space-x-2 bg-theme-surface-elevated px-3 py-1.5 rounded-lg border border-theme-border text-xs font-mono">
                <Lock className="w-3.5 h-3.5 text-theme-accent" />
                <span className="text-theme-secondary">
                  Privacy Gateway: <strong className={
                    aiStatus?.privacyGateway === 'CONFIGURED'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : aiStatus?.privacyGateway === 'NOT_CONFIGURED'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-zinc-500'
                  }>
                    {aiStatus?.privacyGateway || 'UNKNOWN'}
                  </strong>
                </span>
              </div>
            </div>

            {/* VELNAR AI Intelligence Tiers (Provider-Neutral Customer Architecture) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
              <div className="bg-theme-surface-elevated p-4 rounded-xl border border-theme-border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted font-bold">Deterministic Hard Rules</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    {aiStatus?.tiers?.DETERMINISTIC_ONLY?.status || 'CONFIGURED'}
                  </span>
                </div>
                <div className="text-xs font-bold text-theme-primary">Evidence & Fact Finding</div>
                <p className="text-[10px] text-theme-muted font-sans leading-tight">
                  Mathematical proof, revenue loss arithmetic, and deterministic constraint validation. Zero AI hallucination risk.
                </p>
              </div>

              <div className="bg-theme-surface-elevated p-4 rounded-xl border border-theme-border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted font-bold">Fast Telemetry Tier</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    aiStatus?.tiers?.FAST_LOW_COST?.status === 'CONFIGURED'
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : aiStatus?.tiers?.FAST_LOW_COST?.status === 'DISABLED'
                      ? 'bg-zinc-500/20 text-zinc-500'
                      : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  }`}>
                    {aiStatus?.tiers?.FAST_LOW_COST?.status || 'NOT_CONFIGURED'}
                  </span>
                </div>
                <div className="text-xs font-bold text-theme-primary">Speed-to-Lead & Intent</div>
                <p className="text-[10px] text-theme-muted font-sans leading-tight">
                  Real-time funnel classification & SLA response latency evaluation. Pseudonymous telemetry only.
                </p>
              </div>

              <div className="bg-theme-surface-elevated p-4 rounded-xl border border-theme-border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted font-bold">Calibrated Action Synthesis</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    aiStatus?.tiers?.REASONING?.status === 'CONFIGURED'
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : aiStatus?.tiers?.REASONING?.status === 'DISABLED'
                      ? 'bg-zinc-500/20 text-zinc-500'
                      : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  }`}>
                    {aiStatus?.tiers?.REASONING?.status || 'NOT_CONFIGURED'}
                  </span>
                </div>
                <div className="text-xs font-bold text-theme-primary">Growth Action Preparation</div>
                <p className="text-[10px] text-theme-muted font-sans leading-tight">
                  Multi-step hypothesis synthesis grounded in verified Revenue Leak evidence references.
                </p>
              </div>

              <div className="bg-theme-surface-elevated p-4 rounded-xl border border-theme-border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-theme-muted font-bold">Long-Context Synthesis</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    aiStatus?.tiers?.LONG_CONTEXT?.status === 'CONFIGURED'
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : aiStatus?.tiers?.LONG_CONTEXT?.status === 'DISABLED'
                      ? 'bg-zinc-500/20 text-zinc-500'
                      : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  }`}>
                    {aiStatus?.tiers?.LONG_CONTEXT?.status || 'NOT_CONFIGURED'}
                  </span>
                </div>
                <div className="text-xs font-bold text-theme-primary">Business Twin Memory</div>
                <p className="text-[10px] text-theme-muted font-sans leading-tight">
                  Deep context ingestion across operational history, verified facts, and historical performance trends.
                </p>
              </div>
            </div>

            {/* AI Governance Policy Banner */}
            <div className="bg-theme-surface-elevated/70 p-3.5 rounded-xl border border-theme-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-mono">
              <div className="space-y-0.5">
                <div className="text-theme-primary font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-theme-accent" />
                  Deterministic Action Policy Enforcement
                </div>
                <p className="text-[11px] text-theme-muted font-sans">
                  Mandatory human approval enabled. Autonomous external actions strictly prohibited in Sprint 4.
                </p>
              </div>

              <div className="flex items-center space-x-3 shrink-0 text-[11px]">
                <span className="text-theme-muted">
                  Monthly Cap:{' '}
                  <strong className="text-theme-primary">
                    {aiStatus?.policy?.maxMonthlyCostMicroUsd != null
                      ? `$${(aiStatus.policy.maxMonthlyCostMicroUsd / 1_000_000).toFixed(2)} USD`
                      : 'UNKNOWN'}
                  </strong>
                </span>
                <span className={
                  aiStatus?.policy?.humanApprovalRequired === true
                    ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                    : aiStatus?.policy?.humanApprovalRequired === false
                    ? 'text-rose-600 dark:text-rose-400 font-bold'
                    : 'text-zinc-500 font-bold'
                }>
                  Human Gate:{' '}
                  {aiStatus?.policy?.humanApprovalRequired === true
                    ? 'REQUIRED'
                    : aiStatus?.policy?.humanApprovalRequired === false
                    ? 'DISABLED'
                    : 'UNKNOWN'}
                </span>
              </div>
            </div>
          </div>

          {/* AI Inference Telemetry Table */}
          <div className="bg-theme-surface border border-theme-border rounded-xl overflow-hidden">
            <div className="p-4 border-b border-theme-border flex items-center justify-between">
              <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-theme-primary">
                AI Inference & Cost Telemetry (D1 / MicroUSD Ledger)
              </h3>
              <span className="text-[10px] font-mono text-theme-muted">Integer microUSD Currency Model</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-theme-surface-elevated text-theme-muted uppercase text-[10px] border-b border-theme-border">
                  <tr>
                    <th className="px-4 py-3">Run ID</th>
                    <th className="px-4 py-3">Purpose</th>
                    <th className="px-4 py-3">Tier</th>
                    <th className="px-4 py-3">Tokens (In/Out)</th>
                    <th className="px-4 py-3">Latency</th>
                    <th className="px-4 py-3">Cost (μUSD)</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border">
                  {aiRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-theme-surface-elevated">
                      <td className="px-4 py-3 font-bold text-theme-primary">{run.id}</td>
                      <td className="px-4 py-3 text-theme-secondary font-sans">{run.purpose}</td>
                      <td className="px-4 py-3 text-theme-muted text-[11px]">
                        <span className="text-theme-accent">VELNAR AI</span> {run.isMock ? '(Mock Sentinel)' : ''}
                      </td>
                      <td className="px-4 py-3 text-theme-accent font-bold">
                        {run.prompt_tokens} / {run.completion_tokens}
                      </td>
                      <td className="px-4 py-3 text-theme-secondary">{run.latency_ms} ms</td>
                      <td className="px-4 py-3 text-theme-primary font-mono">{run.estimated_cost_microusd?.toLocaleString() || 0}</td>
                      <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 uppercase font-bold text-[10px]">{run.status}</td>
                      <td className="px-4 py-3 text-theme-muted">{new Date(run.created_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Security & Action Audit Logs */}
      {activeTab === 'audit' && (
        <div className="bg-theme-surface border border-theme-border rounded-xl overflow-hidden space-y-2">
          <div className="p-4 border-b border-theme-border flex items-center justify-between">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-theme-primary">
                {t.settings.audit.title}
              </h3>
              <p className="text-[11px] text-theme-muted mt-0.5">
                {t.settings.audit.description}
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <ShieldCheck className="w-4 h-4" /> Integrity Enforced
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-theme-surface-elevated text-theme-muted uppercase text-[10px] border-b border-theme-border">
                <tr>
                  <th className="px-4 py-3">Log ID</th>
                  <th className="px-4 py-3">Action Event</th>
                  <th className="px-4 py-3">Actor Role</th>
                  <th className="px-4 py-3">Target Entity</th>
                  <th className="px-4 py-3">Payload Diff</th>
                  <th className="px-4 py-3">IP Hash</th>
                  <th className="px-4 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-border">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-theme-surface-elevated">
                    <td className="px-4 py-3 font-semibold text-theme-primary">{log.id}</td>
                    <td className="px-4 py-3 text-theme-accent font-bold">{log.action}</td>
                    <td className="px-4 py-3 uppercase text-[10px] text-theme-muted">{log.actor_role}</td>
                    <td className="px-4 py-3 text-theme-secondary">{log.target_entity_type} ({log.target_entity_id})</td>
                    <td className="px-4 py-3 text-theme-muted font-mono text-[10px] max-w-xs truncate">
                      {log.payload_diff_json}
                    </td>
                    <td className="px-4 py-3 text-theme-muted font-mono text-[10px]">
                      <span 
                        className="px-2 py-0.5 rounded bg-theme-surface-elevated border border-theme-border text-[10px] font-mono text-theme-secondary inline-block"
                        title="Cryptographically anonymized HMAC-SHA-256 hash for tenant audit privacy"
                      >
                        {log.ip_hash && log.ip_hash !== 'UNKNOWN' ? `${log.ip_hash.slice(0, 12)}…` : 'UNKNOWN'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-theme-muted">{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
};
