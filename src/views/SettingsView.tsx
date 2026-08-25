import React, { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { useTheme, Theme } from '../context/ThemeContext';
import { UserRole } from '../types/database';
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
  Laptop
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

  const d1SqlSchema = `-- Cloudflare D1 Multi-Tenant B2B Production Schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('starter', 'scale', 'enterprise')) DEFAULT 'scale',
  default_market TEXT NOT NULL CHECK (default_market IN ('TR', 'GLOBAL')) DEFAULT 'GLOBAL',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role_global TEXT NOT NULL DEFAULT 'user',
  avatar_url TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER')),
  status TEXT NOT NULL CHECK (status IN ('active', 'invited', 'suspended')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  industry TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  annual_revenue_run_rate_minor INTEGER NOT NULL DEFAULT 0,
  baseline_margin_pct REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')) DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS identity_vault (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  pseudonym_id TEXT UNIQUE NOT NULL,
  encrypted_name_payload TEXT NOT NULL,
  encrypted_email_payload TEXT NOT NULL,
  encrypted_phone_payload TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  algorithm TEXT NOT NULL DEFAULT 'AES-GCM-256',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  pseudonymous_customer_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  intent_score INTEGER NOT NULL CHECK (intent_score BETWEEN 0 AND 100) DEFAULT 50,
  estimated_deal_value_minor INTEGER NOT NULL DEFAULT 0,
  funnel_stage TEXT NOT NULL CHECK (funnel_stage IN ('captured', 'qualifying', 'proposal_sent', 'negotiation', 'stalled')),
  leak_risk_factor TEXT NOT NULL CHECK (leak_risk_factor IN ('high_decay', 'unassigned', 'underpriced', 'normal')) DEFAULT 'normal',
  status TEXT NOT NULL CHECK (status IN ('open', 'contacted', 'recovered', 'lost')) DEFAULT 'open',
  response_latency_minutes INTEGER NOT NULL DEFAULT 0,
  assigned_to_user_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  pseudonymous_customer_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  service_category TEXT NOT NULL,
  resource_staff_id TEXT,
  resource_staff_name TEXT NOT NULL,
  scheduled_start DATETIME NOT NULL,
  scheduled_end DATETIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  expected_value_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled')) DEFAULT 'scheduled',
  source TEXT NOT NULL CHECK (source IN ('velnar_manual', 'google_calendar', 'external_provider', 'opentable', 'pos', 'api', 'web_booking_widget')) DEFAULT 'velnar_manual',
  external_reference_id TEXT,
  cancellation_reason TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  pseudonymous_customer_id TEXT,
  payload_json TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'user', 'ai_gateway', 'connector')),
  actor_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS revenue_leaks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('lead_decay', 'pricing_friction', 'follow_up_bottleneck', 'call_decay', 'no_show_decay', 'unused_capacity', 'funnel_friction', 'aging_inventory', 'checkout_abandonment')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  root_cause TEXT NOT NULL,
  estimated_monthly_loss_minor INTEGER NOT NULL DEFAULT 0,
  affected_funnel_stage TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0) DEFAULT 0.85,
  status TEXT NOT NULL CHECK (status IN ('active', 'mitigated', 'ignored', 'investigating')) DEFAULT 'active',
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS growth_actions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  leak_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TR', 'GLOBAL')),
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('workflow_automation', 'pricing_adjustment', 'high_intent_sla_dispatch', 're_engagement_sequence', 'churn_prevention_trigger')),
  execution_payload_json TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 1 CHECK (requires_approval IN (0, 1)),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('pending_approval', 'approved', 'rejected', 'deferred')) DEFAULT 'pending_approval',
  approved_by_user_id TEXT,
  approved_at DATETIME,
  guardrails_passed INTEGER NOT NULL DEFAULT 1 CHECK (guardrails_passed IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (leak_id) REFERENCES revenue_leaks(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_results (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  growth_action_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'in_progress', 'failed')) DEFAULT 'in_progress',
  revenue_recovered_amount_minor INTEGER NOT NULL DEFAULT 0,
  metric_delta_json TEXT NOT NULL,
  verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proof_notes TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (growth_action_id) REFERENCES growth_actions(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attribution_results (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  revenue_type TEXT NOT NULL CHECK (revenue_type IN ('ATTRIBUTED_REVENUE', 'INFLUENCED_REVENUE', 'UNATTRIBUTED')),
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT')),
  attribution_method TEXT NOT NULL,
  gross_amount_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('TRY', 'USD', 'EUR')),
  evidence_summary TEXT NOT NULL,
  data_sources_json TEXT NOT NULL,
  time_window_description TEXT NOT NULL,
  touchpoints_breakdown_json TEXT NOT NULL,
  calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER')),
  action TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  payload_diff_json TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(d1SqlSchema);
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
                <span className="text-theme-primary font-bold">{currentOrg.id}</span>
              </div>
              <div className="bg-theme-surface-elevated p-3 rounded-lg border border-theme-border">
                <span className="text-theme-muted block">Tier Level</span>
                <span className="text-theme-accent font-bold uppercase">{currentOrg.tier}</span>
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
          <div className="bg-theme-surface border border-theme-border rounded-xl p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-mono uppercase tracking-wider font-semibold text-theme-primary">
                  {t.settings.d1.title}
                </h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  {t.settings.d1.description}
                </p>
              </div>

              <button
                id="btn-copy-d1-sql"
                onClick={handleCopySql}
                className="flex items-center space-x-2 bg-theme-surface-elevated hover:bg-theme-surface-muted text-theme-primary px-3.5 py-1.5 rounded-lg border border-theme-border text-xs font-mono transition-all cursor-pointer shrink-0"
              >
                {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-theme-accent" />}
                <span>{copiedSql ? t.settings.d1.copied : t.settings.d1.copySql}</span>
              </button>
            </div>

            <div className="bg-theme-surface-elevated p-4 rounded-xl border border-theme-border font-mono text-xs text-theme-secondary max-h-[500px] overflow-y-auto">
              <pre className="text-[11px] leading-relaxed">{d1SqlSchema}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Provider-Neutral AI Gateway */}
      {activeTab === 'aiGateway' && (
        <div className="space-y-6">
          <div className="bg-theme-surface border border-theme-border rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-mono uppercase tracking-wider font-semibold text-theme-primary">
                {t.settings.aiGateway.title}
              </h3>
              <p className="text-xs text-theme-muted mt-1">
                {t.settings.aiGateway.description}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
              <div className="bg-theme-surface-elevated p-4 rounded-xl border border-theme-border space-y-1">
                <span className="text-theme-muted">Reasoning Core Adapter</span>
                <div className="text-sm font-bold text-theme-primary">gateway-engine-alpha</div>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Latency: 380ms · Health: 100%</span>
              </div>

              <div className="bg-theme-surface-elevated p-4 rounded-xl border border-theme-border space-y-1">
                <span className="text-theme-muted">Fast Heuristic Engine</span>
                <div className="text-sm font-bold text-theme-primary">gateway-engine-beta</div>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Latency: 135ms · Health: 100%</span>
              </div>

              <div className="bg-theme-surface-elevated p-4 rounded-xl border border-theme-border space-y-1">
                <span className="text-theme-muted">Deterministic Guard Sentinel</span>
                <div className="text-sm font-bold text-theme-primary">gateway-guard-sentinel</div>
                <span className="text-[10px] text-theme-accent">Enforcing 100% Approval Policy</span>
              </div>
            </div>
          </div>

          {/* AI Inference Telemetry Table */}
          <div className="bg-theme-surface border border-theme-border rounded-xl overflow-hidden">
            <div className="p-4 border-b border-theme-border">
              <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-theme-primary">
                {t.settings.aiGateway.tokenTelemetry}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-theme-surface-elevated text-theme-muted uppercase text-[10px] border-b border-theme-border">
                  <tr>
                    <th className="px-4 py-3">Run ID</th>
                    <th className="px-4 py-3">Purpose</th>
                    <th className="px-4 py-3">Tokens (In / Out)</th>
                    <th className="px-4 py-3">Latency</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-border">
                  {aiRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-theme-surface-elevated">
                      <td className="px-4 py-3 font-bold text-theme-primary">{run.id}</td>
                      <td className="px-4 py-3 text-theme-secondary font-sans">{run.purpose}</td>
                      <td className="px-4 py-3 text-theme-accent font-bold">
                        {run.prompt_tokens} / {run.completion_tokens}
                      </td>
                      <td className="px-4 py-3 text-theme-secondary">{run.latency_ms} ms</td>
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
