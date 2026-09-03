import { 
  MarketType, 
  UserRole, 
  RevenueLeakRow, 
  GrowthActionRow, 
  BusinessTwinFactRow, 
  LeadRow, 
  ActionResultRow, 
  AuditLogRow, 
  OrganizationRow, 
  BusinessRow,
  AIRunRow
} from './database';

export type AppRoute = 
  | '/dashboard' 
  | '/onboarding' 
  | '/leaks' 
  | '/actions' 
  | '/appointments'
  | '/attribution'
  | '/proof' 
  | '/leads' 
  | '/business-twin' 
  | '/security'
  | '/settings';

export type Language = 'en' | 'tr';

export interface MarketMetrics {
  revenueAtRisk: number;
  growthOpportunities: number;
  actionsWaitingApproval: number;
  revenueInfluenced: number;
  currencySymbol: string;
  currencyCode: 'TRY' | 'USD';
  leaksCount: {
    critical: number;
    high: number;
    medium: number;
  };
  twinConfidenceScore: number; // e.g. 94%
  productLoopStep: 'CONNECT' | 'UNDERSTAND' | 'DETECT' | 'RECOMMEND' | 'APPROVE' | 'MEASURE' | 'LEARN';
}

export interface PlatformState {
  currentRoute: AppRoute;
  currentMarket: MarketType;
  currentOrg: OrganizationRow | null;
  currentBusiness: BusinessRow | null;
  currentRole: UserRole | null;
  language: Language;
  leaks: RevenueLeakRow[];
  actions: GrowthActionRow[];
  actionResults: ActionResultRow[];
  leads: LeadRow[];
  facts: BusinessTwinFactRow[];
  auditLogs: AuditLogRow[];
  aiRuns: AIRunRow[];
}

export interface AIGatewayModelConfig {
  id: string;
  providerType: 'tier_1_reasoning' | 'fast_inference' | 'custom_slm';
  name: string;
  contextWindow: number;
  active: boolean;
  averageLatencyMs: number;
  costPer1kTokens: number;
}
