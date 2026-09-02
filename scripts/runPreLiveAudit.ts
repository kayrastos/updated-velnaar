/**
 * @file scripts/runPreLiveAudit.ts
 * @description Offline pre-live audit execution script for Phase A.12B.2C-5A.1.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PreLiveCanaryAuditor } from '../worker/ai/canary/auditExecutor';

async function main() {
  console.log('=== Starting Phase A.12B.2C-5A.1 Pre-Live Canary Safety Audit (100% OFFLINE) ===');
  
  const results = PreLiveCanaryAuditor.runIndependentAudit();

  const outputPath = path.join(process.cwd(), 'execution', 'a12b2c5a1_pre_live_audit_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');

  console.log(`Audit completed with status: ${results.auditStatus}`);
  console.log(`Total Audit Categories: ${results.summary.totalAuditCategories} (Passed: ${results.summary.passedCategories}, Blocked: ${results.summary.blockedCategories})`);
  console.log(`Total Falsification Checks: ${results.summary.totalFalsificationChecks} (Passed: ${results.summary.passedFalsificationChecks})`);
  console.log(`Wrote audit evidence to: ${outputPath}`);
}

main().catch(err => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
