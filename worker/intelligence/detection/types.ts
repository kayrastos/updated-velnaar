import type { SourceLocation } from '../ingestion/express';

export const DETECTOR_VERSION = 'velnar-m3-sqli-source-v1' as const;
export const RULE_ID = 'express-request-to-sql-text-v1' as const;
export const ANALYSIS_LIMITS = Object.freeze({ nodes: 2048, steps: 4096, callDepth: 16, calls: 128,
  flowLength: 64, totalFlowNodes: 256, findings: 8 });
export type FlowKind = 'SOURCE' | 'VARIABLE' | 'CALL' | 'ARGUMENT' | 'RETURN' | 'CONCAT' | 'SINK';
export interface FlowStep { readonly id: string; readonly kind: FlowKind; readonly location: SourceLocation }
export interface SqlFinding {
  readonly findingId: string; readonly routeIdentity: string; readonly vulnerabilityClass: 'SQL_INJECTION';
  readonly source: SourceLocation; readonly sink: SourceLocation; readonly flow: readonly FlowStep[];
}
export type LimitationCode = 'NODE_BUDGET' | 'STEP_BUDGET' | 'CALL_BUDGET' | 'CALL_DEPTH' | 'CALL_CYCLE'
  | 'IMPORT_CYCLE' | 'FLOW_BUDGET' | 'FINDING_BUDGET' | 'MULTIPLE_SOURCES' | 'UNSUPPORTED_STATEMENT'
  | 'UNSUPPORTED_EXPRESSION' | 'UNSUPPORTED_CALL' | 'UNSUPPORTED_FUNCTION' | 'UNSUPPORTED_IMPORT'
  | 'UNBOUND_NAME' | 'DUPLICATE_BINDING' | 'ROUTE_MISMATCH' | 'FACTORY_PROFILE';
export interface AnalysisLimitation { readonly code: LimitationCode; readonly location: SourceLocation | null }
export interface SqlAnalysis {
  readonly version: typeof DETECTOR_VERSION; readonly ruleId: typeof RULE_ID;
  readonly organizationId: string; readonly repositoryId: string; readonly snapshotId: string;
  readonly ingestionIdentity: string; readonly routeIdentities: readonly string[];
  readonly status: 'DETECTED' | 'NOT_DETECTED' | 'ANALYSIS_INCONCLUSIVE';
  readonly findings: readonly SqlFinding[]; readonly limitations: readonly AnalysisLimitation[];
  readonly resultFingerprint: string;
}
