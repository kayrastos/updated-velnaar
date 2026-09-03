/**
 * Cloudflare D1 Database Schema Types
 * Multi-Tenant B2B Revenue Intelligence Engine - Sprint 3.4 Canonical Schema Agreement
 * 
 * Rules:
 * 1. Financial/monetary values use integer minor units (e.g. *_minor) canonically.
 * 2. PII is stored exclusively in encrypted identity_vault records.
 * 3. Leads and Appointments reference pseudonymous customer identifiers.
 */

export type UserRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF' | 'VIEWER';
export type MarketType = 'TR' | 'GLOBAL';
export type CurrencyCode = 'TRY' | 'USD' | 'EUR';
export type LeakSeverity = 'critical' | 'high' | 'medium' | 'low';
export type LeakCategory = 
  | 'lead_decay' 
  | 'pricing_friction' 
  | 'follow_up_bottleneck' 
  | 'call_decay'
  | 'no_show_decay'
  | 'unused_capacity'
  | 'funnel_friction'
  | 'aging_inventory'
  | 'checkout_abandonment';
export type LeakStatus = 'active' | 'mitigated' | 'ignored' | 'investigating';
export type ActionType = 
  | 'workflow_automation' 
  | 'pricing_adjustment' 
  | 'high_intent_sla_dispatch' 
  | 're_engagement_sequence' 
  | 'churn_prevention_trigger';
export type ActionApprovalStatus = 'pending_approval' | 'approved' | 'rejected' | 'deferred';
export type FactCategory = 
  | 'unit_economics' 
  | 'operating_constraints' 
  | 'ideal_customer_profile' 
  | 'pricing_matrix' 
  | 'regulatory_compliance';

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  tier: 'starter' | 'scale' | 'enterprise';
  default_market: MarketType;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role_global: string;
  avatar_url?: string;
  created_at: string;
}

export interface OrganizationMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRole;
  status: 'active' | 'invited' | 'suspended';
  created_at: string;
}

export interface BusinessRow {
  id: string;
  organization_id: string;
  name: string;
  market: MarketType;
  industry: string;
  currency: CurrencyCode;
  annual_revenue_run_rate_minor: number;
  baseline_margin_pct: number;
  status: 'active' | 'archived';
  created_at: string;
}

export interface LeadRow {
  id: string;
  business_id: string;
  organization_id: string;
  market: MarketType;
  pseudonymous_customer_id: string;
  company_name: string;
  intent_score: number; // 0 - 100
  estimated_deal_value_minor: number; // Canonical integer minor units (e.g. cents / kuruş)
  funnel_stage: 'captured' | 'qualifying' | 'proposal_sent' | 'negotiation' | 'stalled';
  leak_risk_factor: 'high_decay' | 'unassigned' | 'underpriced' | 'normal';
  status: 'open' | 'contacted' | 'recovered' | 'lost';
  response_latency_minutes: number;
  assigned_to_user_id?: string;
  proposal_sent_at?: string;
  last_follow_up_at?: string;
  last_activity_at?: string;
  created_at: string;
}

export interface EventRow {
  id: string;
  business_id: string;
  organization_id: string;
  event_type: string;
  pseudonymous_customer_id?: string;
  payload_json: string;
  actor_type: 'system' | 'user' | 'ai_gateway' | 'connector';
  actor_id?: string;
  created_at: string;
}

export interface RevenueLeakRow {
  id: string;
  business_id: string;
  organization_id: string;
  market: MarketType;
  title: string;
  category: LeakCategory;
  severity: LeakSeverity;
  root_cause: string;
  estimated_monthly_loss_minor: number; // Canonical integer minor units
  affected_funnel_stage: string;
  confidence_score: number; // 0.0 - 1.0
  confidence_level?: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  status: LeakStatus;
  detected_at: string;
}

export interface GrowthActionRow {
  id: string;
  leak_id: string;
  business_id: string;
  organization_id: string;
  market: MarketType;
  title: string;
  hypothesis: string;
  action_type: ActionType;
  execution_payload_json: string;
  requires_approval: number; // 1 = true
  approval_status: ActionApprovalStatus;
  approved_by_user_id?: string;
  approved_at?: string;
  guardrails_passed: number; // 1 = true (legacy)
  guardrail_status: 'PASSED' | 'FAILED' | 'NOT_EVALUATED';
  created_at: string;
}

export interface OrganizationActionPolicyRow {
  id?: string;
  organization_id: string;
  business_id?: string | null;
  maximum_discount_percent: number | null;
  maximum_ad_budget_minor: number | null;
  allowed_channels_json: string | null;
  prohibited_actions_json: string | null;
  requires_approval_for_outbound_messaging: number;
  requires_approval_for_price_changes: number;
  human_approval_required: number;
  auto_execution_enabled: number;
  created_at?: string;
  updated_at?: string;
}

export interface ActionResultRow {
  id: string;
  growth_action_id: string;
  business_id: string;
  organization_id: string;
  status: 'success' | 'in_progress' | 'failed';
  revenue_recovered_amount_minor: number; // Canonical integer minor units
  metric_delta_json: string;
  verified_at: string;
  proof_notes: string;
}

export type AIRunStatus = 'completed' | 'failed' | 'throttled' | 'blocked_by_policy' | 'budget_exceeded';

export type AIRunTaskType = 
  | 'LEAD_INTENT_CLASSIFICATION'
  | 'LEAK_EXPLANATION'
  | 'GROWTH_ACTION_DRAFT'
  | 'BUSINESS_TWIN_SUMMARY'
  | 'FUNNEL_DIAGNOSTIC_EXPLANATION'
  | 'SEO_CONTENT_SUGGESTION'
  | 'ANOMALY_TRIAGE';

export type AIRunDataClassification = 
  | 'PUBLIC_BUSINESS'
  | 'PSEUDONYMOUS_OPERATIONAL'
  | 'PERSONAL'
  | 'SENSITIVE'
  | 'SECRET';

export interface AIRunRow {
  id: string;
  organization_id: string;
  business_id: string;
  task_type: AIRunTaskType;
  gateway_provider_id: string;
  model_identifier: string;
  data_classification: AIRunDataClassification;
  prompt_version: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  estimated_cost_microusd: number;
  redaction_count: number;
  status: AIRunStatus;
  error_code?: string | null;
  input_fingerprint?: string | null;
  purpose: string;
  created_at: string;
  isMock?: boolean;
}

export interface BusinessTwinFactRow {
  id: string;
  business_id: string;
  market: MarketType;
  fact_category: FactCategory;
  fact_key: string;
  fact_value_json: string;
  confidence_score: number;
  verified_by_human: number; // 1 = true
  source: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  organization_id: string;
  business_id: string;
  actor_id: string;
  actor_role: UserRole;
  action: string;
  target_entity_type: string;
  target_entity_id: string;
  payload_diff_json: string;
  ip_hash: string;
  created_at: string;
}
