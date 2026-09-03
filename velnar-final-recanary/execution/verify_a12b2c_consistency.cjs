const fs = require("fs");

const summary = JSON.parse(fs.readFileSync("execution/a12b2b_full_v121_candidate_summary.json", "utf8"));
const draft = JSON.parse(fs.readFileSync("execution/a12b2c_routing_policy_draft.json", "utf8"));
const report = fs.readFileSync("A12B2C_DECISION_REPORT.md", "utf8");

let jsonMismatches = 0;
let mdMismatches = 0;

function checkJson(label, actual, expected) {
  if (actual !== expected) {
    console.error(`[JSON MISMATCH] ${label}: actual=${actual}, expected=${expected}`);
    jsonMismatches++;
  }
}

function checkMd(label, condition, detail) {
  if (!condition) {
    console.error(`[MD MISMATCH] ${label} failed. ${detail || ""}`);
    mdMismatches++;
  }
}

// 1. CANONICAL JSON CHECKS
const dsSummary = summary.summaries["deepseek-v4-flash-offpeak-low"];
const gemSummary = summary.summaries["gemini-3.5-flash-lite-flex-low"];

// Aggregate JSON checks
checkJson("DS Aggregate totalInvocations", draft.aggregateEvidence.deepseek.totalInvocations, dsSummary.totalInvocations);
checkJson("DS Aggregate passRateBps", draft.aggregateEvidence.deepseek.passRateBps, dsSummary.passRateBps);
checkJson("DS Aggregate hardFailRateBps", draft.aggregateEvidence.deepseek.hardFailRateBps, dsSummary.hardFailRateBps);
checkJson("DS Aggregate meanScoreBps", draft.aggregateEvidence.deepseek.meanScoreBps, dsSummary.meanScoreBps);
checkJson("DS Aggregate medianScoreBps", draft.aggregateEvidence.deepseek.medianScoreBps, dsSummary.medianScoreBps);
checkJson("DS Aggregate p50LatencyMs", draft.aggregateEvidence.deepseek.p50LatencyMs, dsSummary.p50LatencyMs);
checkJson("DS Aggregate p95LatencyMs", draft.aggregateEvidence.deepseek.p95LatencyMs, dsSummary.p95LatencyMs);
checkJson("DS Aggregate actualTotalCostMicroUsd", draft.aggregateEvidence.deepseek.actualTotalCostMicroUsd, dsSummary.actualTotalCostMicroUsd);
checkJson("DS Aggregate normalizedTotalCostMicroUsd", draft.aggregateEvidence.deepseek.normalizedTotalCostMicroUsd, dsSummary.normalizedTotalCostMicroUsd);
checkJson("DS Aggregate costPerPassingCaseMicroUsd", draft.aggregateEvidence.deepseek.costPerPassingCaseMicroUsd, dsSummary.costPerPassingCaseMicroUsd);

checkJson("GEM Aggregate totalInvocations", draft.aggregateEvidence.gemini.totalInvocations, gemSummary.totalInvocations);
checkJson("GEM Aggregate passRateBps", draft.aggregateEvidence.gemini.passRateBps, gemSummary.passRateBps);
checkJson("GEM Aggregate hardFailRateBps", draft.aggregateEvidence.gemini.hardFailRateBps, gemSummary.hardFailRateBps);
checkJson("GEM Aggregate meanScoreBps", draft.aggregateEvidence.gemini.meanScoreBps, gemSummary.meanScoreBps);
checkJson("GEM Aggregate medianScoreBps", draft.aggregateEvidence.gemini.medianScoreBps, gemSummary.medianScoreBps);
checkJson("GEM Aggregate p50LatencyMs", draft.aggregateEvidence.gemini.p50LatencyMs, gemSummary.p50LatencyMs);
checkJson("GEM Aggregate p95LatencyMs", draft.aggregateEvidence.gemini.p95LatencyMs, gemSummary.p95LatencyMs);
checkJson("GEM Aggregate actualTotalCostMicroUsd", draft.aggregateEvidence.gemini.actualTotalCostMicroUsd, gemSummary.actualTotalCostMicroUsd);
checkJson("GEM Aggregate normalizedTotalCostMicroUsd", draft.aggregateEvidence.gemini.normalizedTotalCostMicroUsd, gemSummary.normalizedTotalCostMicroUsd);
checkJson("GEM Aggregate costPerPassingCaseMicroUsd", draft.aggregateEvidence.gemini.costPerPassingCaseMicroUsd, gemSummary.costPerPassingCaseMicroUsd);

// Per-task JSON checks
for (const tp of draft.taskPolicies) {
  const dsTask = dsSummary.perTaskBreakdown[tp.taskType];
  const gemTask = gemSummary.perTaskBreakdown[tp.taskType];

  checkJson(`${tp.taskType} DS casesTotal`, tp.evidence.deepseek.casesTotal, dsTask.casesTotal);
  checkJson(`${tp.taskType} DS casesPassed`, tp.evidence.deepseek.casesPassed, dsTask.casesPassed);
  checkJson(`${tp.taskType} DS hardFails`, tp.evidence.deepseek.hardFails, dsTask.hardFails);
  checkJson(`${tp.taskType} DS passRateBps`, tp.evidence.deepseek.passRateBps, dsTask.passRateBps);
  checkJson(`${tp.taskType} DS meanScoreBps`, tp.evidence.deepseek.meanScoreBps, dsTask.meanScoreBps);
  checkJson(`${tp.taskType} DS medianScoreBps`, tp.evidence.deepseek.medianScoreBps, dsTask.medianScoreBps);
  checkJson(`${tp.taskType} DS p50LatencyMs`, tp.evidence.deepseek.p50LatencyMs, dsTask.p50LatencyMs);
  checkJson(`${tp.taskType} DS p95LatencyMs`, tp.evidence.deepseek.p95LatencyMs, dsTask.p95LatencyMs);
  checkJson(`${tp.taskType} DS actualCostMicroUsd`, tp.evidence.deepseek.actualCostMicroUsd, dsTask.actualCostMicroUsd);
  checkJson(`${tp.taskType} DS normalizedCostMicroUsd`, tp.evidence.deepseek.normalizedCostMicroUsd, dsTask.normalizedCostMicroUsd);

  checkJson(`${tp.taskType} GEM casesTotal`, tp.evidence.gemini.casesTotal, gemTask.casesTotal);
  checkJson(`${tp.taskType} GEM casesPassed`, tp.evidence.gemini.casesPassed, gemTask.casesPassed);
  checkJson(`${tp.taskType} GEM hardFails`, tp.evidence.gemini.hardFails, gemTask.hardFails);
  checkJson(`${tp.taskType} GEM passRateBps`, tp.evidence.gemini.passRateBps, gemTask.passRateBps);
  checkJson(`${tp.taskType} GEM meanScoreBps`, tp.evidence.gemini.meanScoreBps, gemTask.meanScoreBps);
  checkJson(`${tp.taskType} GEM medianScoreBps`, tp.evidence.gemini.medianScoreBps, gemTask.medianScoreBps);
  checkJson(`${tp.taskType} GEM p50LatencyMs`, tp.evidence.gemini.p50LatencyMs, gemTask.p50LatencyMs);
  checkJson(`${tp.taskType} GEM p95LatencyMs`, tp.evidence.gemini.p95LatencyMs, gemTask.p95LatencyMs);
  checkJson(`${tp.taskType} GEM actualCostMicroUsd`, tp.evidence.gemini.actualCostMicroUsd, gemTask.actualCostMicroUsd);
  checkJson(`${tp.taskType} GEM normalizedCostMicroUsd`, tp.evidence.gemini.normalizedCostMicroUsd, gemTask.normalizedCostMicroUsd);
}

// 2. MARKDOWN AUDIT AGAINST CANONICAL EVIDENCE
checkMd("Exact certified DS model identity in MD", report.includes("deepseek-v4-flash"), "Missing deepseek-v4-flash");
checkMd("Exact certified GEM model identity in MD", report.includes("gemini-3.5-flash-lite"), "Missing gemini-3.5-flash-lite");
checkMd("No ambiguous DeepSeek-Chat in MD", !report.includes("DeepSeek-Chat") && !report.includes("deepseek-chat"), "Contains DeepSeek-Chat");
checkMd("No ambiguous Gemini 2.5 in MD", !report.includes("Gemini 2.5") && !report.includes("2.5/3.5"), "Contains 2.5/3.5");

const fmtUsd = (microUsd) => "$" + (microUsd / 1_000_000).toFixed(6);

// Aggregate MD checks
checkMd("Aggregate DS Invocations (66)", report.includes("66"));
checkMd("Aggregate DS Pass Rate", report.includes((dsSummary.passRateBps / 100).toFixed(2) + "% (60/66)"));
checkMd("Aggregate GEM Pass Rate", report.includes((gemSummary.passRateBps / 100).toFixed(2) + "% (57/66)"));
checkMd("Aggregate DS Hard Fails (6)", report.includes("**6**"));
checkMd("Aggregate GEM Hard Fails (9)", report.includes("**9**"));
checkMd("Aggregate DS Mean Score", report.includes((dsSummary.meanScoreBps).toLocaleString("en-US") + " bps"));
checkMd("Aggregate GEM Mean Score", report.includes((gemSummary.meanScoreBps).toLocaleString("en-US") + " bps"));
checkMd("Aggregate DS Median Score", report.includes((dsSummary.medianScoreBps).toLocaleString("en-US") + " bps"));
checkMd("Aggregate GEM Median Score", report.includes((gemSummary.medianScoreBps).toLocaleString("en-US") + " bps"));
checkMd("Aggregate DS p50", report.includes("**" + dsSummary.p50LatencyMs + " ms**"));
checkMd("Aggregate GEM p50", report.includes("**" + gemSummary.p50LatencyMs.toLocaleString("en-US") + " ms**"));
checkMd("Aggregate DS p95", report.includes("**" + dsSummary.p95LatencyMs + " ms**"));
checkMd("Aggregate GEM p95", report.includes("**" + gemSummary.p95LatencyMs.toLocaleString("en-US") + " ms**"));
checkMd("Aggregate DS Actual Cost", report.includes(fmtUsd(dsSummary.actualTotalCostMicroUsd)));
checkMd("Aggregate GEM Actual Cost", report.includes(fmtUsd(gemSummary.actualTotalCostMicroUsd)));
checkMd("Aggregate DS Normalized Cost", report.includes(fmtUsd(dsSummary.normalizedTotalCostMicroUsd)));
checkMd("Aggregate GEM Normalized Cost", report.includes(fmtUsd(gemSummary.normalizedTotalCostMicroUsd)));

// Per-task MD checks
const taskTypes = [
  "LEAD_INTENT_CLASSIFICATION",
  "LEAK_EXPLANATION",
  "GROWTH_ACTION_DRAFT",
  "BUSINESS_TWIN_SUMMARY",
  "FUNNEL_DIAGNOSTIC_EXPLANATION",
  "SEO_CONTENT_SUGGESTION",
  "ANOMALY_TRIAGE"
];

for (let i = 0; i < taskTypes.length; i++) {
  const taskType = taskTypes[i];
  const dsTask = dsSummary.perTaskBreakdown[taskType];
  const gemTask = gemSummary.perTaskBreakdown[taskType];

  const header = `### Task ${i + 1}: \`${taskType}\``;
  const startIdx = report.indexOf(header);
  checkMd(`${taskType} Header Found`, startIdx !== -1, `Header missing: ${header}`);

  if (startIdx !== -1) {
    const nextHeader = i < taskTypes.length - 1 ? `### Task ${i + 2}:` : `## 5. Operating Constraints`;
    const endIdx = report.indexOf(nextHeader, startIdx);
    const section = report.slice(startIdx, endIdx === -1 ? undefined : endIdx);

    // Pass count
    checkMd(`${taskType} DS Passed (${dsTask.casesPassed})`, section.includes(`${dsTask.casesPassed}`));
    checkMd(`${taskType} GEM Passed (${gemTask.casesPassed})`, section.includes(`${gemTask.casesPassed}`));
    
    // Hard fails
    checkMd(`${taskType} DS Hard Fails (${dsTask.hardFails})`, section.includes(`${dsTask.hardFails}`));
    checkMd(`${taskType} GEM Hard Fails (${gemTask.hardFails})`, section.includes(`${gemTask.hardFails}`));

    // Pass rate
    checkMd(`${taskType} DS Pass Rate (${(dsTask.passRateBps / 100).toFixed(2)}%)`, section.includes((dsTask.passRateBps / 100).toFixed(2) + "%"));
    checkMd(`${taskType} GEM Pass Rate (${(gemTask.passRateBps / 100).toFixed(2)}%)`, section.includes((gemTask.passRateBps / 100).toFixed(2) + "%"));

    // Mean score
    checkMd(`${taskType} DS Mean Score (${dsTask.meanScoreBps.toLocaleString("en-US")} bps)`, section.includes(dsTask.meanScoreBps.toLocaleString("en-US") + " bps"));
    checkMd(`${taskType} GEM Mean Score (${gemTask.meanScoreBps.toLocaleString("en-US")} bps)`, section.includes(gemTask.meanScoreBps.toLocaleString("en-US") + " bps"));

    // Median score
    checkMd(`${taskType} DS Median Score (${dsTask.medianScoreBps.toLocaleString("en-US")} bps)`, section.includes(dsTask.medianScoreBps.toLocaleString("en-US") + " bps"));
    checkMd(`${taskType} GEM Median Score (${gemTask.medianScoreBps.toLocaleString("en-US")} bps)`, section.includes(gemTask.medianScoreBps.toLocaleString("en-US") + " bps"));

    // Latency
    checkMd(`${taskType} DS p50 (${dsTask.p50LatencyMs} ms)`, section.includes(dsTask.p50LatencyMs + " ms"));
    checkMd(`${taskType} GEM p50 (${gemTask.p50LatencyMs.toLocaleString("en-US")} ms)`, section.includes(gemTask.p50LatencyMs.toLocaleString("en-US") + " ms"));
    checkMd(`${taskType} DS p95 (${dsTask.p95LatencyMs.toLocaleString("en-US")} ms)`, section.includes(dsTask.p95LatencyMs.toLocaleString("en-US") + " ms"));
    checkMd(`${taskType} GEM p95 (${gemTask.p95LatencyMs.toLocaleString("en-US")} ms)`, section.includes(gemTask.p95LatencyMs.toLocaleString("en-US") + " ms"));

    // Costs
    checkMd(`${taskType} DS Actual Cost (${fmtUsd(dsTask.actualCostMicroUsd)})`, section.includes(fmtUsd(dsTask.actualCostMicroUsd)));
    checkMd(`${taskType} GEM Actual Cost (${fmtUsd(gemTask.actualCostMicroUsd)})`, section.includes(fmtUsd(gemTask.actualCostMicroUsd)));
    checkMd(`${taskType} DS Normalized Cost (${fmtUsd(dsTask.normalizedCostMicroUsd)})`, section.includes(fmtUsd(dsTask.normalizedCostMicroUsd)));
    checkMd(`${taskType} GEM Normalized Cost (${fmtUsd(gemTask.normalizedCostMicroUsd)})`, section.includes(fmtUsd(gemTask.normalizedCostMicroUsd)));
  }
}

console.log("\n=======================================================");
console.log(`CONSISTENCY SUMMARY:`);
console.log(`canonical JSON mismatches = ${jsonMismatches}`);
console.log(`Markdown metric mismatches = ${mdMismatches}`);
console.log("=======================================================\n");

if (jsonMismatches !== 0 || mdMismatches !== 0) {
  process.exit(1);
} else {
  console.log("ALL OFFLINE CONSISTENCY CHECKS PASSED (0 MISMATCHES).");
}
