/**
 * Cloudflare D1 Database Schema Types
 * Multi-Tenant B2B Revenue Intelligence Engine - Sprint 3.1 Hardening
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
  contact_name: string;
  company_name: string;
  email: string;
  phone?: string;
  intent_score: number; // 0 - 100
  estimated_deal_value: number; // In standard major units for UI, minor in DB
  estimated_deal_value_minor?: number;
  funnel_stage: 'captured' | 'qualifying' | 'proposal_sent' | 'negotiation' | 'stalled';
  leak_risk_factor: 'high_decay' | 'unassigned' | 'underpriced' | 'normal';
  status: 'open' | 'contacted' | 'recovered' | 'lost';
  response_latency_minutes: number;
  assigned_to_user_id?: string;
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
  estimated_monthly_loss: number; // In standard major units for display
  estimated_monthly_loss_minor?: number;
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
  guardrails_passed: number; // 1 = true
  created_at: string;
}

export interface ActionResultRow {
  id: string;
  growth_action_id: string;
  business_id: string;
  organization_id: string;
  status: 'success' | 'in_progress' | 'failed';
  revenue_recovered_amount: number;
  revenue_recovered_amount_minor?: number;
  metric_delta_json: string;
  verified_at: string;
  proof_notes: string;
}

export interface AIRunRow {
  id: string;
  business_id: string;
  gateway_provider_id: string;
  model_identifier: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  status: 'completed' | 'failed' | 'throttled';
  purpose: string;
  created_at: string;
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
