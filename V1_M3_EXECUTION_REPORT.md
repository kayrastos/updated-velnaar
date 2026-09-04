# VELNAR V1-M3 execution report

Status: human-review repair and offline validation complete; uncommitted working tree returned for SECOND M3 HUMAN REVIEW. M3 is not sealed. This is a deterministic SQLi source-analysis foundation for the closed controlled fixture subset. It produces hypotheses, not exploit verification or production accuracy evidence.

## 1. Sealed baseline, analyzed commit and startup gate

- Authorized workspace: `C:/Users/kayra/Downloads/velnar-v1-contracts`.
- Repository: `kayrastos/updated-velnaar`.
- Branch: `feat/v1-m3-sqli-detection-foundation`.
- SEALED M2 BASELINE: `ea522f844a4a7b3d68af0215bcba756ee7977622`. This identifies the reviewed ancestry on which M3 was implemented; it is not a permanently assigned candidate commit.
- CURRENT ANALYZED CODE COMMIT: the commit returned by the trusted M2 `currentCodeCommit()`/committed-byte verification path. During this uncommitted human-review phase it resolves to `ea522f844a4a7b3d68af0215bcba756ee7977622`, because HEAD is still the sealed M2 baseline and the exact fixture bytes are present there.
- Startup `git rev-parse --show-toplevel` returned the authorized workspace.
- Startup `git branch --show-current` returned the branch above.
- Startup `git rev-parse HEAD` and `git merge-base HEAD ea522f844a4a7b3d68af0215bcba756ee7977622` both returned the exact sealed SHA.
- Startup `git status --short` was empty. Implementation began only after these checks.

M0/M1 and M2 remain sealed. No blocking defect requiring a sealed change was found. All tracked files, including contracts, M2 fixture bytes, executable harness, oracle guard, expected answers, dependency manifests, worker/ai, worker/security, provider and canary behavior, remain unchanged. M3 is not imported into application runtime entrypoints.

## 2. Exact files added or modified

Ten new untracked files; zero existing tracked files modified:

```text
V1_M3_EXECUTION_REPORT.md
worker/intelligence/detection/types.ts
worker/intelligence/detection/sqlInjection.ts
worker/intelligence/detection/candidate.ts
tests/intelligence/m3/detection.test.ts
tests/intelligence/m3/limitations.test.ts
tests/intelligence/m3/candidate.test.ts
tests/intelligence/m3/oracleIsolation.test.ts
tests/intelligence/m3/support/inputs.ts
tests/intelligence/m3/support/oracleGuard.ts
```

Ignored local test artifacts: `node_modules/.cache/v1-m3-focused.json`, `v1-m3-m2-regression.json`, `v1-m3-intelligence.json`, and `v1-m3-full.json`. The build regenerates ignored `dist/` files. No package installation or dependency change was needed.

## 3. Detector architecture and result model

```text
Captured SourceSnapshot + ExpressIngestion
  -> sealed validation of both inputs and exact snapshot match
  -> bounded abstract source analysis over freshly derived TypeScript ASTs
  -> deterministic SqlAnalysis and source-to-sink flow findings
  -> optional separately configured FindingCandidate bridge

Separately, only after source detection completes:
  sealed M2 executable harness -> recorded observations -> test comparison
```

Entry API: `detectSqlInjection(snapshot, ingestion, expectedOrganizationId)`.

The detector imports only the installed TypeScript parser and sealed pure ingestion/contract helpers. It does not import the fixture catalog, filesystem loader, evaluator, SQLite, M2 execution or Git profile. It has no model, network, shell or source-module execution capability. AST interpretation is abstract: request values, database objects, statements and response rows are analysis markers, not live objects or executed query results.

`SqlAnalysis` is separate from M1 verification state. It contains version, rule identity, organization/repository/snapshot/ingestion identities, input route identities, status, findings, structured limitations and a result fingerprint. Status is one of:

- `DETECTED`: supported reachable source-to-SQL-text flow(s) were found.
- `NOT_DETECTED`: no such flow was found in the analyzed closed subset. This does not assert that the application is SAFE.
- `ANALYSIS_INCONCLUSIVE`: supported reasoning could not complete. Findings are empty; partial detections are discarded rather than promoted through an incomplete analysis.

Each finding contains `findingId`, `routeIdentity`, `vulnerabilityClass: SQL_INJECTION`, source/sink locations and an ordered flow. No detector result contains M1 verification evidence, an assertion result or completion authority.

Boundary failures such as foreign tenants, malformed snapshots, extra execution/oracle fields and mismatched ingestion are rejected. Unsupported reachable syntax within valid M2 ingestion becomes a structured analysis limitation. The detector does not expand syntax that the sealed ingestion layer already refuses.

## 4. Explicit supported syntax subset

The initial factory profile is the sealed fixtures' named exported `createApp(db)` convention, using a default Express import and the validated app/router registrations.

| Supported syntax | Analysis behavior |
| --- | --- |
| `req.query.<identifier>` | Creates a request-origin taint source at that exact AST location |
| `const x = expression`; `const y = x` | Propagates abstract values and adds variable provenance for tainted values |
| String literals, no-substitution string templates, parentheses | Literal abstract values; no runtime evaluation |
| String `+` concatenation in either operand direction | Carries request taint into SQL construction and records concatenation steps |
| Named synchronous function declarations and lexical closures | Resolves captured names and analyzes calls with supplied abstract arguments |
| Function parameters and local returns | Propagates taint across call, argument and return steps |
| Local named function imports, including aliases | Resolves only captured sibling source units through sealed import rules |
| `db.prepare(expression)` | Reports a hypothesis when the SQL-text argument carries request taint |
| `db.prepare(literal).all(value)` | Bound argument taint is separate from SQL-text taint; one bound argument is supported |
| App/router registrations and literal mounts | Cross-checks declared/effective route and actual handler identity against validated M2 ingestion |
| `res.json(rows)` | Abstract response continuation only; no HTTP server runs |

Mutable variables, assignments, branches, loops, destructuring, dynamic/computed property access, arrow functions, async/generator execution, interpolated templates, casts in relevant expressions, unmodeled methods, ambient APIs, arbitrary imports and unknown calls are unsupported. They cannot become a NOT_DETECTED conclusion through silent skipping of reachable statements. Uncalled function bodies do not create reachable findings. Type annotations on supported declarations do not supply analysis authority.

This is not a general TypeScript interpreter or general SQL grammar. Literal placeholder counting is deliberately narrow; ambiguous syntax can become inconclusive. No SQL is parsed or executed by this detector.

## 5. Source and taint model

Abstract data carries a bounded optional literal value and an ordered provenance trace. A request query property introduces the trace. Const aliases, function arguments, returns and concatenation preserve it. A database marker must originate from the modeled factory parameter or its explicit aliases/arguments; an arbitrary object named `db` does not automatically become a database capability.

The SQL-text argument to `prepare` is the sink input. Values passed separately to `all` do not taint the SQL text. A helper returning a literal instead of its tainted argument drops that argument's taint according to the supported source semantics. Unknown transformations are inconclusive, not assumed sanitizers.

One source per flow is supported. A join of distinct source locations is explicitly `MULTIPLE_SOURCES`, not an invented merged provenance. No raw model prose, scenario name or benchmark answer selects taint state or detector outcome.

## 6. Narrow reachability model

The analyzer models factory construction and registration without invoking fixture code. It checks each registered method, effective path and exact handler location against the sealed ingestion output. It then analyzes only those route handlers and their statically resolved calls. Imported functions are followed only through captured named-import bindings; lexical function values retain their defining scope.

Disconnected unsafe code remains outside a reachable route traversal. The router fixture retains `/api/search` and the exact routeIdentity from M2. Registration behavior that cannot be reconciled with the closed model yields `ROUTE_MISMATCH`; for example, the current adapter does not support mounting a router before subsequently adding its routes.

The candidate bridge uses `reachabilityState: REACHABLE` only after a DETECTED result has been independently recomputed in this supported route model. This is not a general control-flow graph, middleware analysis, production dispatch model or proof of real deployment reachability.

## 7. Flow provenance, integrity and bounds

Flow steps use these closed kinds: SOURCE, VARIABLE, CALL, ARGUMENT, RETURN, CONCAT and SINK. Every step has a source-file path, symbol, UTF-16 string offset, one-based line/column and a deterministic node ID. Offsets are TypeScript/JavaScript string offsets, not UTF-8 byte offsets. Ordering follows data propagation rather than sorting locations numerically. Identical steps are deduplicated within each flow; different findings may reference the same stable source node identity.

Node IDs are domain-hashed from snapshot identity, route identity, step kind and location. Finding IDs bind snapshot identity and the complete finding body. `resultFingerprint` hashes the complete result body, excluding only the fingerprint itself, under `velnar-m3-sqli-source-v1`. Sealed canonical JSON and Web Crypto SHA256 are reused; a test independently cross-checks the result hash with Node SHA256. File bytes remain bound by sealed M2 snapshot hashing.

`validateSqlAnalysis` detaches accessor-free bounded data and recomputes the entire analysis from the supplied validated sources. A caller cannot substitute a different flow, source, sink, rule or status merely by calculating a new self-consistent hash. The candidate bridge always uses this validator before constructing a candidate or calling a trusted commit verifier. Outputs are deeply immutable.

| Bound | Limit |
| --- | --- |
| AST nodes across the snapshot analyzed by M3 | 2,048 |
| Abstract analysis steps | 4,096 |
| Active function-call depth | 16 |
| Total function/capability calls | 128 |
| Flow steps per finding | 64 |
| Flow steps summed across findings | 256 |
| Findings per result | 8 |
| Routes | Existing sealed maximum of 32 |
| Literal concatenation length | 1,024 characters |
| Source files, bytes, paths and metadata | Unchanged sealed M2 bounds |

Direct/mutual call cycles and cyclic import graphs are explicitly detected. Acyclic depth, node, step, call, finding and flow limits are separately exercised. These are deterministic analysis bounds, not operating-system CPU/memory quotas. The sealed parser still runs under its own unchanged file/AST limits before the tighter M3 analysis budget.

## 8. Oracle isolation design

`tests/intelligence/m3/support/oracleGuard.ts` calls the existing sealed M2 `assertOracleIsolation` on every M3 production root and its complete local dependency closure, then performs additional M3 checks. The sealed M2 guard and its tests were not edited.

All three production roots are discovered from the detector directory. The extension refuses dependencies under tests or benchmark modules, unreviewed external modules, SQLite, semantic reviewed IDs and all eight scenario literals, expected-answer fields, `RecordedExecution`, `violationObserved`, benign/attack data and execution outcome labels. It also rejects proof-construction types/functions/fields in new detector code. Existing sealed contract definitions necessarily contain their own protocol tokens; that does not authorize new detector code to import or mint proof objects.

Negative controls cover direct and transitive access. A fresh detector import with contradictory downstream benchmark/evaluator module mocks produces identical output and never loads either mocked oracle. Separate tests reject semantic IDs and extra execution/oracle data at the runtime input boundary.

Opaque case relabeling changes snapshot-bound identities and fingerprints, as it should, while preserving the source decision and flow locations. Changing downstream oracle metadata leaves the entire detector result unchanged. Neither condition is used as a substitute for the other.

This is an architecture guard for reviewed trusted code, not an OS sandbox or a defense against arbitrary malicious replacement of the host implementation.

## 9. FindingCandidate hypothesis bridge

`createSqlCandidateBridge(verifyCommittedCode)` configures trusted host commit checking separately from source detection. The returned bridge consumes analysis, snapshot, ingestion and expected tenant. It detaches inputs, revalidates their exact binding and recomputes the detector result.

NOT_DETECTED and ANALYSIS_INCONCLUSIVE return an empty candidate list without invoking the commit verifier. DETECTED results require a trusted verifier to confirm the captured bytes' actual Git commit. Real-Git tests independently obtain the current checked commit through the unchanged M2 fixed-host `currentCodeCommit()` helper, then require every produced candidate to carry that same commit and recompute its candidateBinding. During uncommitted review this commit happens to equal the sealed M2 baseline. After the authorized M3 implementation commit, these tests and the committed-byte verifier must resolve dynamically to the new M3 HEAD. A mutated in-memory fixture can be analyzed but cannot be mislabeled as code in the verified commit.

The verifier is trusted host configuration, never a field from fixture/source data. A modeled-host regression proves that an arbitrary valid nonzero checked SHA is propagated into the candidate and its binding; separate regressions reject empty, malformed/non-hex and all-zero verifier identities. Replacing the verifier with dishonest host code is outside this in-process boundary, as in M2. The detector itself never calls it and never requires Git or executable verification. Neither `SourceSnapshot` nor `SqlAnalysis` accepts a commit SHA.

For each finding, the bridge constructs one validated M1 FindingCandidate with:

- Exact organization, repository, snapshot and checked code commit.
- Source/sink from validated detector flow; entrypoint/route from validated ingestion.
- `VELNAR_STRUCTURAL` sensor type, fixed detector/rule identity and detector fingerprint.
- Narrow proven `REACHABLE` and mandatory `verificationState: CANDIDATE`.
- A deterministic candidate ID and unchanged exact M1 candidateBinding.

The stable local logical timestamp is not measured execution time. The bridge returns only candidate and candidateBinding. It creates neither EvidenceArtifact nor VerificationResult and has no completion/state-transition call. The test-only replay tests construct separate synthetic M1 transcripts to exercise unchanged Commit A/B and same-ID semantic protections; those transcripts are not detector output or real exploit proof.

## 10. Controlled eight-case results and separate execution reference

All detection runs complete before the downstream test imports the M2 executable harness. Both analyses then complete independently before comparison. No M2 observations are passed back to the detector.

| Opaque case | Source-analysis result | Candidate hypotheses | Separate M2 probe observed violation |
| --- | --- | --- | --- |
| m2-case-001 | DETECTED | 1 | yes |
| m2-case-002 | NOT_DETECTED | 0 | no |
| m2-case-003 | DETECTED | 1 | yes |
| m2-case-004 | NOT_DETECTED | 0 | no |
| m2-case-005 | NOT_DETECTED | 0 | no |
| m2-case-006 | DETECTED | 1 | yes |
| m2-case-007 | DETECTED | 1 | yes |
| m2-case-008 | DETECTED | 1 | yes |

All five candidate-producing canonical cases passed actual local committed-byte checks against the current analyzed code commit returned by the trusted Git verifier. In this uncommitted review phase that value is `ea522f844a4a7b3d68af0215bcba756ee7977622`; after an authorized M3 commit it must be the new M3 HEAD, provided that commit contains the exact fixture bytes. The table is evidence about these controlled cases only; it is not a production accuracy, recall, precision or false-positive measurement.

## 11. Exact adversarial test inventory

110 new tests in four files. Parameterized entries count individually. Full expanded assertion names and outcomes are preserved in `node_modules/.cache/v1-m3-focused.json`.

### detection.test.ts: 30 tests

| Test/group and exact parameter expansion | Count |
| --- | --- |
| Opaque fixture index/state: 0/DETECTED, 1/NOT_DETECTED, 2/DETECTED, 3/NOT_DETECTED, 4/NOT_DETECTED, 5/DETECTED, 6/DETECTED, 7/DETECTED | 8 |
| Direct request concatenation source/construction/sink provenance and exact source coordinates | 1 |
| Alias chains with tainted prefix/suffix concatenation operand | 2 |
| Helper arguments and query-builder return provenance | 1 |
| Cross-file route/service/repository provenance | 1 |
| Disconnected function exclusion and bound-parameter separation | 1 |
| Mounted router effective identity | 1 |
| Repeated analysis, reversed source enumeration, unique bounded flows and independent fingerprint cross-check | 1 |
| Source mutation changes snapshot/result fingerprint | 1 |
| Opaque case relabeling preserves decision and source-flow locations | 1 |
| Semantic case ID and extra violationObserved/expectedSecurityState/attack/RecordedExecution fields rejected | 1 |
| Rehashed result tampering: duplicate-flow, flow-id, source, sink, rule, route, fingerprint, state | 8 |
| Foreign tenant and mismatched snapshot rejection | 1 |
| Accessor rejection without invocation and metadata detachment before awaiting | 1 |
| Independent M2 execution comparison after detection; actual RecordedExecution rejected as detector input | 1 |

### limitations.test.ts: 25 tests

| Test/group and exact parameter expansion | Count |
| --- | --- |
| Unsupported reachable syntax: if, while, let, computed query property, interpolated template, invoked arrow, string replace method, fetch, process.exit, eval, db.constructor, as-string cast | 12 |
| Later unsupported syntax discards partial findings | 1 |
| Direct call cycle | 1 |
| Mutually recursive helpers | 1 |
| Cyclic named imports | 1 |
| Acyclic call-depth limit | 1 |
| AST node limit | 1 |
| Single-flow limit | 1 |
| Finding count limit | 1 |
| Cumulative flow-node limit | 1 |
| Total call limit | 1 |
| Abstract step limit | 1 |
| Multiple-source join refused | 1 |
| Factory/runtime registration mismatch is inconclusive | 1 |

### candidate.test.ts: 26 tests

| Test/group and exact parameter expansion | Count |
| --- | --- |
| Actual local Git check and exact CANDIDATE binding for detected indices 0, 2, 5, 6, 7 | 5 |
| All real-Git candidates in one run share the independently checked current commit and recomputed binding | 1 |
| Modeled trusted verifier propagates an arbitrary valid checked commit into candidate and binding | 1 |
| Invalid trusted verifier identity rejected: empty, malformed/non-hex, all-zero | 3 |
| No candidate or verifier call for non-detected indices 1, 3, 4 | 3 |
| No candidate for inconclusive analysis | 1 |
| Forged result refused before commit verification: state, source, sink, flow, snapshot, authority | 6 |
| Foreign tenant rejection | 1 |
| Uncommitted source cannot receive a committed candidate label | 1 |
| No detector proof artifacts or direct CANDIDATE completion | 1 |
| Same-ID semantic evidence replay rejection | 1 |
| Commit A/B evidence replay rejection after rebinding | 1 |
| Deterministic candidates and exact semantic candidateBinding | 1 |

### oracleIsolation.test.ts: 29 tests

| Test/group and exact parameter expansion | Count |
| --- | --- |
| Every detector root and complete dependency closure passes both guards | 1 |
| Rejected imports/fields/literals: benchmark, evaluator, executor, semantic fixture ID, expectedSecurityState, verificationExpectation, reachabilityExpectation, sinkExpectation, violationObserved, RecordedExecution, attack queries, benign rows, expectedState, node:sqlite, VERIFIED, EvidenceArtifact, VerificationResult, VIOLATION_OBSERVED | 18 |
| Rejected scenario literals: OBVIOUS_VULNERABLE, SAFE_TWIN, REFACTORED_VULNERABLE, UNREACHABLE_VULNERABLE_CODE, PARAMETERIZED_SAFE, MULTI_FUNCTION_FLOW, MULTI_FILE_FLOW, EXPRESS_ROUTE_FLOW | 8 |
| Transitive execution-answer helper rejection | 1 |
| Downstream oracle relabeling leaves output identical and oracle modules unloaded | 1 |

### User requirement H crosswalk

| Requirement numbers | Concrete coverage |
| --- | --- |
| 1-8 | Eight opaque fixture/state rows; source semantics and independent M2 comparison |
| 9-13 | Opaque input scans, semantic-ID/extra-field rejection, complete dependency guard, RecordedExecution rejection, downstream mock isolation |
| 14-20 | Direct/alias/argument/return/cross-file flow tests, bound-parameter separation, disconnected function exclusion |
| 21-26 | Mutation fingerprint, repeat/enumeration tests, duplicate/forged flow and source/sink tampering |
| 27-29 | Tenant/snapshot mismatch and pre-bridge forged-result rejection |
| 30-34 | CANDIDATE-only construction, absent proof artifacts, forbidden direct completion and exact M1 candidateBinding |
| 35-36 | New candidate replay tests plus unchanged M1/M2 regression suites |
| 37-40 | Explicit inconclusive syntax, direct/mutual/import cycles, independent resource budgets and deterministic repeated analysis |

## 12. Offline validation and M2 regression

All test/typecheck/lint/build invocations used the existing network-denial preload:

```powershell
$env:NODE_OPTIONS='--require=C:/Users/kayra/Downloads/velnar-v1-contracts/tests/intelligence/offlineGuard.cjs'
```

| Command | Final actual result |
| --- | --- |
| npx vitest run tests/intelligence/m3 --reporter=json --outputFile=node_modules/.cache/v1-m3-focused.json | PASS: 4 files, 110 tests |
| npx vitest run tests/intelligence/m2 --reporter=json --outputFile=node_modules/.cache/v1-m3-m2-regression.json | PASS: 4 files, 121 tests |
| npx vitest run tests/intelligence --reporter=json --outputFile=node_modules/.cache/v1-m3-intelligence.json | PASS: 13 files, 427 tests |
| npx vitest run --reporter=json --outputFile=node_modules/.cache/v1-m3-full.json | PASS: 54 files, 1,191 tests |
| npm.cmd run typecheck | PASS, exit 0 |
| npm.cmd run lint | PASS, exit 0; existing script is tsc --noEmit |
| npm.cmd run build | PASS, exit 0; 1,702 modules transformed |
| git diff --check | PASS; untracked additions additionally checked separately |

All final test reports contain zero failed, pending/skipped or todo cases. The full suite contains the unchanged 1,081 baseline tests plus 110 M3 tests. Intelligence contains the unchanged 317 plus 110. The M2 oracle controls, committed-byte checks, path/link/directory/size limits, deterministic snapshots, single-query gate and M1 binding/state protections remain green. No sealed assertion, fixture byte or benchmark answer was changed.

The first M3 pass had 94 passing tests; initial review added explicit cumulative flow-budget and stronger oracle-label coverage, yielding 105. This human-review repair added five commit-identity regressions, yielding the final 110. No failing assertion was weakened. Directory creation and offline tool execution in this explicitly authorized workspace required filesystem escalation; they did not require any code or security-policy workaround.

Production output remains index.html 1.93 kB, CSS 46.20 kB and JS 469.70 kB, gzip 0.89/8.37/122.06 kB. The detector has no application runtime wiring. No dependency, compiler configuration or build configuration was changed.

## 13. Remaining limitations and claim status

| Claim status | Scope |
| --- | --- |
| PROVEN BY THESE M3 TESTS | Deterministic decisions on eight controlled fixtures; bounded source-to-sink propagation for the implemented subset; tested narrow route reachability; oracle-independent dependency architecture; validated CANDIDATE integration and replay protections |
| IMPLEMENTED BUT NOT PRODUCT-PROVEN | Narrow TypeScript/Express SQLi detector and local bounded flow/reachability analysis |
| NOT YET PROVEN / NOT IMPLEMENTED | Real-world recall/precision; false-positive rate; broad TypeScript/JavaScript coverage; arbitrary Express semantics; framework-general analysis; customer repository ingestion; production exploit verification; authenticated Fulgor evidence; production sandbox; Semgrep; CodeQL; OSV; Security Memory; remediation; customer deployment |

The detector inherits the sealed eight-opaque-case snapshot profile and is not a full repository scanner. Source analysis requires valid M2 ingestion. Unknown syntax cannot be interpreted as an application-wide safety conclusion. There is no general control-flow graph, dynamic call resolution, middleware/async analysis, alias analysis for arbitrary objects, multi-source join model or sanitizer registry. The row/statement abstraction is not a SQL result oracle. Input and AST limits do not supply kernel isolation. The trusted commit callback and host code are not protected against arbitrary malicious co-resident JavaScript.

No claim that VELNAR accurately detects SQL injection in production follows from these eight fixtures. Candidates remain hypotheses even when source flow is detected and code bytes are commit-bound.

## 14. Human-review handoff

HEAD remains `ea522f844a4a7b3d68af0215bcba756ee7977622` on `feat/v1-m3-sqli-detection-foundation`. Tracked and staged diffs are empty; the ten M3 additions remain untracked and uncommitted. Git's normal diff omits untracked files, so each addition was also checked against Windows NUL with `git -c core.autocrlf=false diff --no-index --check`. A no-index exit 1 denotes added content; whitespace diagnostics or higher error codes are rejected.

M3 is not sealed. The post-commit seal/regression handoff is: human review PASS; a human-authorized M3 implementation commit; confirmation of a clean worktree; rerun M3 focused tests; rerun M2 regression tests; rerun intelligence and full suites; rerun typecheck, lint and build; rerun real candidate Git-byte checks against the NEW M3 HEAD; only then perform the final M3 seal.

Final `git status --short`:

```text
?? V1_M3_EXECUTION_REPORT.md
?? tests/intelligence/m3/
?? worker/intelligence/detection/
```

No M4 or later work was started. No commit, staging, push, merge, deploy, live provider/model call, production execution, customer cloning, API ingestion, UI or infrastructure change occurred. Stop here and return the dirty working tree for SECOND M3 HUMAN REVIEW.

## 15. Second M3 Human Review Decision

Second M3 Human Review: PASS (2026-09-05).

The original human-review blocker is CLOSED.

The candidate Git-binding tests no longer hardcode the sealed M2 baseline as the
analyzed code commit. Real-Git candidate tests resolve the current checked commit
dynamically, require all produced candidates to bind to that checked commit, and
recompute the exact M1 candidateBinding.

A modeled trusted verifier regression confirms that a different valid checked
commit SHA propagates into FindingCandidate semantics and candidateBinding.
Empty, malformed/non-hex, and all-zero commit identities fail closed.

The detector remains source-only. SourceSnapshot and SqlAnalysis contain no Git
commit authority. Detection produces no EvidenceArtifact, VerificationResult, or
VERIFIED transition.

The M3 implementation commit is authorized.

V1-M3 is NOT YET SEALED. Final seal remains conditional on:
- the human-authorized M3 implementation commit;
- a clean post-commit worktree;
- successful M3 focused regression;
- successful M2 regression;
- successful intelligence and full-suite regression;
- successful typecheck, lint and build;
- successful real local Git fixture-byte verification against the NEW M3 HEAD;
- final human review of post-commit evidence.

No M4 work is authorized before final M3 seal.
