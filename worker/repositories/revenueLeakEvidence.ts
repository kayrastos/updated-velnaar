/**
 * @file revenueLeakEvidence.ts
 * @description Authoritative Server-Side Revenue Leak Evidence Reference Generator
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Only server-loaded, verified RevenueLeakRow objects can generate evidence IDs.
 * 2. Zero client-supplied evidence IDs.
 * 3. Deterministic evidence citation formatting: REVENUE_LEAK:<leak_id>
 * ============================================================================
 */

import { RevenueLeakRow } from '../../src/types/database';

export class RevenueLeakEvidence {
  /**
   * Deterministically derives authoritative evidence citations from a server-verified RevenueLeakRow
   */
  public static getCanonicalEvidenceReferences(leak: RevenueLeakRow): string[] {
    if (!leak || !leak.id) {
      throw new Error('INVALID_LEAK_RECORD: Cannot derive evidence references from null or invalid RevenueLeakRow.');
    }

    const references: string[] = [
      `REVENUE_LEAK:${leak.id}`,
    ];

    if (leak.affected_funnel_stage) {
      references.push(`FUNNEL_STAGE:${leak.affected_funnel_stage}`);
    }

    if (leak.category) {
      references.push(`LEAK_CATEGORY:${leak.category}`);
    }

    return references;
  }
}
