# VELNAR V1-M2 execution report

Status: three human-review blockers repaired; ready for SECOND M2 HUMAN REVIEW. All changes remain uncommitted. Benchmark evidence is PRE-SEAL / NOT FINAL: the captured fixture bytes have no truthful analyzed Git commit yet. No commit-bound M1 artifacts are emitted by the current recorder. Final local commit-binding validation is a separate post-commit seal step, after human review and a human-authorized commit. No production exploit-verification or accuracy claim is made.

## 1. Sealed baseline and scope

- Repository: `kayrastos/updated-velnaar`.
- Worktree: `C:/Users/kayra/Downloads/velnar-v1-contracts`.
- Branch: `feat/v1-m2-executable-sqli-ingestion`.
- Sealed baseline and current HEAD: `1eda1d6bc087c3cff2f4046327dab1eb04a91eda`.
- Independently verified at the closing-session startup: `git rev-parse --show-toplevel` returned the worktree above; branch and HEAD matched the values above. `git status --short` reported only `?? V1_M2_EXECUTION_REPORT.md`, `?? tests/intelligence/m2/`, and `?? worker/intelligence/ingestion/`. The dirty M2 additions were preserved. `git diff --stat` was empty because all 24 additions were untracked. The earlier session's clean-start and test claims were not used as validation evidence.
- No sealed M0/M1 defect was found requiring a change. Existing tracked files, including contracts, benchmark metadata, AI, security, routing, canary, dependency manifests and offline guard, are unchanged.
- No commit, staging, push, merge, deployment, live network/provider/model call, package installation or M3 work occurred. No other repository was modified.

## 2. Exact added files

27 new files; zero existing tracked files modified. The repair adds three files to the 24 preserved M2 additions:

```text
V1_M2_EXECUTION_REPORT.md
worker/intelligence/ingestion/snapshot.ts
worker/intelligence/ingestion/express.ts
tests/intelligence/m2/.gitattributes
tests/intelligence/m2/execution.test.ts
tests/intelligence/m2/ingestion.test.ts
tests/intelligence/m2/oracleIsolation.test.ts
tests/intelligence/m2/commitBinding.test.ts
tests/intelligence/m2/recordBenchmarks.ts
tests/intelligence/m2/sealBenchmarks.ts
tests/intelligence/m2/support/catalog.ts
tests/intelligence/m2/support/loadFixture.ts
tests/intelligence/m2/support/execute.ts
tests/intelligence/m2/support/integrate.ts
tests/intelligence/m2/support/evaluate.ts
tests/intelligence/m2/support/oracleGuard.ts
tests/intelligence/m2/support/gitCodeState.ts
tests/intelligence/m2/fixtures/f01/src/routes.ts
tests/intelligence/m2/fixtures/f02/src/routes.ts
tests/intelligence/m2/fixtures/f03/src/routes.ts
tests/intelligence/m2/fixtures/f04/src/routes.ts
tests/intelligence/m2/fixtures/f05/src/routes.ts
tests/intelligence/m2/fixtures/f06/src/routes.ts
tests/intelligence/m2/fixtures/f07/src/routes.ts
tests/intelligence/m2/fixtures/f07/src/service.ts
tests/intelligence/m2/fixtures/f07/src/repository.ts
tests/intelligence/m2/fixtures/f08/src/routes.ts
```

Generated, ignored local validation artifacts reside in `node_modules/.cache/`: `v1-m2-focused.json`, `v1-m2-intelligence.json`, `v1-m2-full.json`, `v1-m2-recordings.json`, and `v1-m2-repair-recording-first.json`. The old `v1-m2-closing-recording-first.json` was preserved only to independently compare the ten fixture files against their previous raw SHA256 digests; its old M1 artifacts are superseded and are not valid commit-seal evidence. No `v1-m2-sealed-recordings.json` was created. The production build also regenerates ignored `dist/` outputs. These are not proposed tracked changes.

The closing session changed only six of the already-existing untracked M2 additions: this report, `support/loadFixture.ts`, `ingestion.test.ts`, `execution.test.ts`, `support/oracleGuard.ts`, and `oracleIsolation.test.ts` under the paths listed above. It added a streamed, fixture-wide directory-entry budget; two directory-budget regressions; guard rejection of constructor/aliased/ambient execution access with three negative controls; and explicit per-fixture sealed entrypoint/language/class/completion comparisons. No fixture bytes, expected answers, sealed files, dependencies or application runtime wiring changed.

The subsequent human-review repair modified 12 existing M2 additions: this report; `worker/intelligence/ingestion/snapshot.ts`; and `execution.test.ts`, `ingestion.test.ts`, `oracleIsolation.test.ts`, `recordBenchmarks.ts`, `support/catalog.ts`, `support/loadFixture.ts`, `support/execute.ts`, `support/integrate.ts`, `support/evaluate.ts`, `support/oracleGuard.ts` under `tests/intelligence/m2/`. It added `commitBinding.test.ts`, `sealBenchmarks.ts`, and `support/gitCodeState.ts`. The ten canonical fixture source files, Express parser, sealed files, dependencies and runtime wiring remain unchanged.

## 3. Architecture and oracle separation

```text
Opaque input-only case catalog + captured source bytes (no commit claim)
  -> canonical snapshot + TypeScript AST-based Express ingestion
  -> bounded test-only AST interpreter + in-memory SQLite
  -> immutable recorded observations + PRE_SEAL status (no M1 artifacts)
  -> downstream evaluator alone attaches reviewed identities and answers

Separate post-commit HOST command:
  captured observations -> fixed local Git manifest/blob checks
  -> checked analyzedCodeCommitSha -> unchanged M1 contract gate
```

The ingestion foundation is not wired into the application runtime. It describes repository/opaque-case/tenant/snapshot identity, source files and imports, app/router ownership, ordered registrations, HTTP method, declared/effective path, mount information, handler identity and source locations. It uses the already installed TypeScript compiler API without loading a project configuration, resolving host packages or executing source modules. It does not infer dataflow or production reachability.

BLOCKER 1 REPAIR: `catalog.ts` and the fixture loader now use only `m2-case-001` through `m2-case-008` and neutral `f01` through `f08` directories. Snapshot validation accepts only that opaque ID form; passing a semantic reviewed fixture ID fails closed before interpretation. The sole runtime opaque-to-reviewed mapping is private to downstream `evaluate.ts`, which requires executor-minted immutable records before reading sealed answers. No semantic mapping is imported by ingestion, execution, integration, the normal recorder, or the trusted Git profile. Input/snapshot/record scans, exact one-to-one mapping assertions, relabeling invariance and semantic-ID rejection tests cover this boundary. Human-readable scenario names below are report/evaluator data only.

`oracleGuard.ts` traverses static imports/exports transitively from both ingestion modules and the execution/integration SUT, including their sealed contract dependencies. It rejects benchmark/evaluator/assertion/catalog/fixture imports in that closure, ground-truth identifiers/literals, semantic `fixture-sqli-express-` literals, dynamic import, require, eval, Function and ambient process/global/globalThis/fetch access. Forbidden execution identifiers are rejected even when aliased or used as constructors. External SUT imports remain restricted to TypeScript and node:sqlite. The existing negative controls are retained, with an additional semantic-literal control. The new Git profile is trusted host orchestration outside this SUT closure; the SUT cannot import filesystem or subprocess APIs.

This dependency audit protects the checked architecture; it is not an OS sandbox or a defense against an attacker changing trusted test code. No benchmark accuracy score is reported.

## 4. Exact eight-case mapping and observed results

All fixtures declare `src/routes.ts` / `searchRoute`. Each exact reviewed `snapshotFixtureId` maps to one versioned directory; there is no ninth case. Expected security states and all sealed benchmark metadata remain unchanged. The test also pins the sealed benchmark source, with line endings normalized to LF, to SHA256 `d6c6b06836ef01c37e3778b457ab6837be882d81d76fdc4f60a05903ccaade15`.

| Directory / opaque case | Reviewed snapshotFixtureId (evaluator only) | Reviewed scenario | Attack returned IDs | Oracle expected completion AFTER seal |
| --- | --- | --- | --- | --- |
| f01 / m2-case-001 | fixture-sqli-express-obvious-vulnerable-v1 | OBVIOUS_VULNERABLE | 1, 2 | VERIFIED |
| f02 / m2-case-002 | fixture-sqli-express-safe-twin-v1 | SAFE_TWIN | none | NOT_VERIFIED |
| f03 / m2-case-003 | fixture-sqli-express-refactored-vulnerable-v1 | REFACTORED_VULNERABLE | 1, 2 | VERIFIED |
| f04 / m2-case-004 | fixture-sqli-express-unreachable-vulnerable-code-v1 | UNREACHABLE_VULNERABLE_CODE | none | NOT_VERIFIED |
| f05 / m2-case-005 | fixture-sqli-express-parameterized-safe-v1 | PARAMETERIZED_SAFE | none | NOT_VERIFIED |
| f06 / m2-case-006 | fixture-sqli-express-multi-function-flow-v1 | MULTI_FUNCTION_FLOW | 1, 2 | VERIFIED |
| f07 / m2-case-007 | fixture-sqli-express-multi-file-flow-v1 | MULTI_FILE_FLOW | 1, 2 | VERIFIED |
| f08 / m2-case-008 | fixture-sqli-express-express-route-flow-v1 | EXPRESS_ROUTE_FLOW | 1, 2 | VERIFIED |

All eight CURRENT integrations are PRE_SEAL. The last column is unchanged oracle expectation and modeled protocol-test behavior, not a completed Git-bound seal.

All benign `alice` requests return only ID 1. The same fixed attack string, `' OR 1=1 --`, is passed to every fixture. Unsafe source concatenation produces a real SQLite result-set violation. Safe source uses SQLite bound parameters, including through a helper. The unreachable fixture contains unsafe SQL in an unregistered function; only its safe registered handler appears in execution traces. Multi-function and multi-file calls are interpreted from the captured AST, not answered by a scenario lookup. The router fixture mounts `/search` under `/api`.

The fixtures are valid TypeScript/Express-shaped programs. Express creation, registration, mounting and response are implemented by a narrowly bounded adapter; no real Express HTTP server or middleware stack runs. SQL execution itself is real SQLite, not a simulated SQL answer table. The repaired execution profile is `m2-local-bounded-sqlite-v2`.

## 5. Snapshot integrity

Canonical version: `velnar-local-source-snapshot-v2`. Input objects contain exactly fixtureId (opaque), repositoryId, organizationId and files; source entries contain exactly path and content. There is no inbound commitSha. Extra commit/engine/verifier authority fields are refused. Data properties and dense arrays only are accepted; accessors, extra fields, unknown metadata, invalid encoding and mismatched tenant are refused. Inputs are detached before asynchronous hashing; validated outputs are deeply frozen.

Accepted paths are bounded ASCII, repository-relative and slash-separated. Dot/empty components, traversal, absolute/drive/UNC/backslash paths, Windows device names and trailing dots are refused. Case-insensitive duplicate paths are rejected. File contents are exact UTF-8, preserving BOM and newline differences. The fixture-local .gitattributes fixes future checkout line endings to LF rather than silently normalizing captured content.

For each sorted path, contentDigest remains raw SHA256 of the exact bytes. fileIdentity remains SHA256 of `velnar-source-file-v1` + LF + canonical JSON of path, byteLength and contentDigest. snapshotId is SHA256 of version + LF + canonical JSON of version, opaque fixtureId, repositoryId, organizationId and ordered file descriptors including fileIdentity. Canonical JSON recursively sorts object keys and preserves array order. Raw contents are covered by their digests. No timestamp, engine commit, machine path or enumeration order enters identity. The version and snapshot/record digests changed intentionally because the identity schema changed; file bytes and their digests did not. Validation reconstructs all derived identities and the complete ingestion output.

The fixture loader refuses links/junctions in every checked path component and regular files with multiple hard links. It uses bounded reads and checks opened file identity/size and observed modification metadata. Directory enumeration streams with a one-entry buffer and a shared limit of 256 entries across the entire fixture, including empty directories; handles close on success or rejection. This closes the earlier gap where file-byte/count limits and directory depth did not bound wide empty directory trees. Execution uses the detached captured contents, not a later reread of source files. This is not a race-proof production filesystem capture facility against a concurrently hostile OS; that stronger facility is out of scope.

BLOCKER 3 REPAIR: `SEALED_COMMIT` was removed from the loader and from source/record identity. `engineBaselineSha` appears only as a separate recorder-envelope field and never as fixture `commitSha`. Current envelopes and integration statuses have `analyzedCodeCommitSha: null`; no M1 candidate/request/evidence/result is minted before a trusted Git check. The old report's explanation that a fixture commit could represent engine context was incorrect and is withdrawn. Snapshot hashes identify captured bytes, not a Git commit, producer authentication, signature or Fulgor attestation.

| Fixture | Files | Exact snapshotId |
| --- | --- | --- |
| f01 | 1 | sha256:f4d3d7de095cd65f796dabb2a20d3822cf8c12b41536f352874d88753b4a1a7e |
| f02 | 1 | sha256:06f5cf7aa6c6f8c0815cae02df6b5f75e5c97d35f2b86af3443a83dd7e7e9df8 |
| f03 | 1 | sha256:2b44d3f012c0eac251e54e4d054045f44fc6a04a95124c1db48778700918cf37 |
| f04 | 1 | sha256:4f2db690bef8e8bc2d97e952830f683b1de4df13145f20814efb1bc5abad54ea |
| f05 | 1 | sha256:9bc47eb5fb6716157591946baba5d348cb31874367adcf453361cca4cd208678 |
| f06 | 1 | sha256:c5245d8527549c8d42174eb5ceb6258edc6721f751f5cca2bca127bf9438c068 |
| f07 | 3 | sha256:b39afd191c54b6d29503bb43c8d77d823c2a4ae0639605d58298299140bdb058 |
| f08 | 1 | sha256:c873eb67cc9f6d32017d09939f133a84ae1f71876678071ae7fe983efecaf7fd |

## 6. Limits and execution boundary

| Boundary | Fixed limit / policy |
| --- | --- |
| Source files | 1-32 per snapshot |
| File / total bytes | 16,384 / 65,536 UTF-8 bytes |
| Paths | 512 characters; lowercase .ts or .js extension, not .d.ts |
| Fixture-loader directory depth | 8; only fixed catalog fixture roots |
| Fixture-loader directory entries | 256 total across the fixture, including directories; streamed enumeration |
| AST | 12,000 nodes per parsed unit |
| Registrations | 32; literal paths, unambiguous named handlers, explicit app/router ownership |
| Derived metadata | depth 16, 16,000 nodes, 1,048,576 string characters |
| Execution | 4,096 interpreter steps; call depth 32 |
| Queries | EXACTLY ONE in each benign and attack observation; second query rejected before SQLite; zero queries refused |
| SQL / argument length | 512 / 128 characters; SQL restricted to the bounded ASCII read-only SELECT grammar |
| SQLite data | two fixed local rows in a newly created in-memory database |
| Network | existing offline guard; no fixture network capability or sockets |
| Trusted post-commit Git reads | fixed executable/argument profile, no shell, 5 seconds and 73,728 output bytes per call; remote protocols/lazy fetch disabled |

The interpreter supports only the expressions/statements and explicit capabilities needed by these fixtures. It never evals, transpiles-and-runs or imports fixture code into Node. It has no ambient JS globals, prototype lookup, filesystem, shell, network, source-selected subprocess command, or configurable authority. Unknown syntax/capabilities fail closed. Functions/imports/registrations and query locations come from parsed source. Execution step and call budgets bound recursion; SQL excludes arbitrary functions, subqueries, writes and multiple statements. SQLite is always closed in finally.

BLOCKER 2 REPAIR: the executor enforces exactly one query in each observation, checks response IDs against that query's result IDs, and checks cardinality again before minting a record. Integration independently repeats the shared cardinality assertion before taking the sole attack query as its sink. Safe-first/unsafe-second, unsafe-first/safe-second, zero-attack-query and cached-setup-row adversarial cases fail closed. Every canonical fixture still produces exactly one query in both observations; modeled M1 tests check that candidate sink coordinates match that sole observed SQL location.

The test orchestration and loader are trusted host code. The unchanged offline guard blocks process-level HTTP(S), fetch, TCP/TLS, UDP and DNS lookup APIs; it is not claimed to provide kernel isolation. No fixture-originated subprocess is needed or launched. Only the separately invoked trusted seal command uses fixed read-only local Git subprocesses.

## 7. Sealed contract integration

An execution record covers snapshot, ingestion, route, opaque fixture, tenant and repository identities, benign/attack query observations and source call traces. It contains no commitSha. It is immutable and domain-hashed with `velnar-m2-recorded-execution-v2`. A module-private WeakSet restricts the bridge and evaluator to records minted by the local executor; raw JSON, casts or spread copies cannot become authoritative records.

Stage 1 (CURRENT): `integrateExecution` validates the execution/snapshot binding and single-query rule, then returns only PRE_SEAL, a null analyzedCodeCommitSha, snapshot/record references and a reason. It does not fabricate placeholder commit values or mint M1 wire artifacts. `recordBenchmarks.ts` uses this path exclusively.

Stage 2 (PENDING HUMAN COMMIT): `sealBenchmarks.ts` configures `createSealedIntegrator` with the fixed `verifyCommittedFixture` HOST function. That function revalidates the snapshot, rereads the fixed catalog fixture through the bounded loader, checks unchanged captured identity, verifies the worktree and current full HEAD commit, reads the exact fixture manifest with local `git ls-tree`, refuses missing/extra/duplicate/nonregular entries, and compares every committed blob byte-for-byte with captured UTF-8 bytes via `git cat-file blob`. It checks HEAD again and refuses changes during the check. All eight final records must reference the same checked commit; the output file is written only after every case succeeds.

The subprocess profile has a fixed Git executable, fixed argument families, `shell: false`, hidden Windows child processes, per-call timeout/output bounds, sanitized Git environment, disabled replace objects, disabled lazy fetch and disabled remote protocols. Only verified hexadecimal object IDs and fixed catalog paths enter argument positions. Fixture/source text cannot choose commands, callbacks, execution policy or Git paths. This is a trusted host profile, not an interpreter capability. `createSealedIntegrator` accepts trusted host configuration as code, never from snapshot fields; a malicious replacement verifier is outside the trusted-host boundary. The provided seal command always selects the real fixed Git checker.

Only after this check returns a truthful analyzedCodeCommitSha does the bridge create TEST_FIXTURE hypotheses with the sole SQL sink, UNKNOWN reachability and the recorded fingerprint. It copies that checked SHA into candidate/request/evidence/result, computes the unchanged M1 candidateBinding and evidenceHash, and uses CANDIDATE -> PENDING_VERIFICATION -> validated completion. Commit A/B replay, same-ID semantic replay, missing/tampered evidence, direct completion, foreign tenants and model-authority substitution remain rejected.

Protocol regression tests explicitly use modeled verifier/Git responses, not actual committed fixture code. They exercise all eight bridge paths and the unchanged M1 gates without creating Git commits. Their modeled SHA values and artifacts are unit-test data only, never final benchmark evidence and never emitted by the normal recorder. The real seal command was also invoked against the current actual baseline as a negative check: it exited 1 with `committed fixture manifest mismatch`, and no sealed artifact was created.

After human review and a separately authorized human commit, run from this worktree with the same offline preload:

```powershell
node --import tsx tests/intelligence/m2/sealBenchmarks.ts
```

Successful validation will write ignored `node_modules/.cache/v1-m2-sealed-recordings.json` with separate engineBaselineSha and checked analyzedCodeCommitSha. Successful post-commit validation has NOT occurred in this pre-commit repair session and remains an explicit handoff requirement.

Post-seal/modeled protocol artifacts remain explicitly local: runner `m2-test-only-bounded-interpreter`, environment `m2-local-synthetic`, LOCAL_FIXTURE provenance, local reproduction profile and a non-production sensor summary. Logical timestamps and zero CPU/memory/wall-time resource values are placeholders, not measured performance or host resource quotas. The image digest is a synthetic profile/snapshot identifier, not a measured image. Runtime 24.18.0 describes this local run. Even a future successful COMMIT_BOUND_LOCAL seal would prove local Git byte binding and fixture behavior only, not authenticated production execution.

## 8. Exact new test inventory

121 executed M2 tests in four files: the prior 93 plus 28 human-review repair cases. Parameterized rows count separately. The JSON reports preserve expanded assertion names and individual pass/fail results. Existing protocol assertions remain enforced; their positive M1 path is now explicitly a modeled post-seal unit test instead of claiming current benchmark commit-bound evidence.

### execution.test.ts: 38 tests

Suite: `M2 executable fixture behavior and modeled post-seal contract integration`.

| Test title / exact parameter expansion | Count |
| --- | --- |
| records all eight results before the independent ground-truth evaluator reads answers | 1 |
| has exactly eight unique fixture IDs and refuses a duplicate or silent ninth fixture | 1 |
| fixture index {0, 2, 5, 6, 7} demonstrates an actual SQLite result-set violation | 5 |
| parameterized fixture index {1, 4} remains safe with the same injection input | 2 |
| unreachable unsafe SQL exists but is not called through the declared entrypoint | 1 |
| records multi-function, multi-file and mounted Express router paths from execution | 1 |
| fixture {m2-case-001 through m2-case-008} integrates only through sealed pending completion (modeled Git authority; checks sole sink and all four commit fields) | 8 |
| rejects direct CANDIDATE -> VERIFIED, raw/spread execution records and changed snapshots | 1 |
| M2 Commit A proof cannot verify Commit B after rebinding candidate/request/result | 1 |
| M2 same-ID/same-commit semantic replay is rejected | 1 |
| M2 {missing, hash, observation, binding, model} evidence cannot authorize VERIFIED | 5 |
| records deterministic outputs without using fixture identity labels to derive the result | 1 |
| all eight pre-seal runs have opaque identities and cannot mint commit-bound M1 artifacts | 1 |
| rejects semantic identity at snapshot and execution boundaries: reviewed obvious-vulnerable, safe-twin, unreachable-vulnerable-code and parameterized-safe IDs | 4 |
| rejects multiple SQL sinks: safe-then-unsafe, unsafe-then-safe | 2 |
| rejects zero attack queries at the shared execution/integration assertion gate | 1 |
| rejects cached setup rows returned without an observed route query | 1 |
| rejects injected commit authority in snapshot data and propagates a failed trusted Git check | 1 |

### commitBinding.test.ts: 17 tests

Suite: `M2 fixed local Git profile with modeled Git responses (not seal evidence)`.

| Test title / exact parameter expansion | Count |
| --- | --- |
| checks exact committed bytes for {m2-case-001 through m2-case-008} before M1 integration | 8 |
| refuses commit binding when the Git profile reports {missing-file, extra-file, link, wrong-path, duplicate-path, changed-bytes, moving-head, read-error} | 8 |
| refuses stale captured bytes before executing Git | 1 |

Every modeled Git call also checks fixed command families, no shell, hidden child processes, timeout/output limits and disabled network/lazy-fetch policy. No Git commit or object is created by these tests.

### ingestion.test.ts: 53 tests

Suite: `M2 canonical source ingestion and hostile boundaries`.

| Test title / exact parameter expansion | Count |
| --- | --- |
| loads exactly eight fixture directories with complete relative source manifests | 1 |
| {modify, add, delete} of any participating file changes snapshot identity | 3 |
| enumeration order is irrelevant and hashes cross-check against independent Node SHA256 | 1 |
| rejects hostile path: `../escape.ts`, `/absolute.ts`, `C:/escape.ts`, `C:\escape.ts`, `\\host\share.ts`, `src/../a.ts`, `src//a.ts`, `src/CON.ts`, `src/a.ts.`, `./src/a.ts` | 10 |
| rejects unsupported extension: src/file.json, src/file.tsx, src/file.py, src/file.d.ts, src/file.TS | 5 |
| rejects duplicate canonical file identity: src/routes.ts, src/ROUTES.ts | 2 |
| rejects oversized {file, total, count} input | 3 |
| refuses an actual symlink/junction escape before opening target source | 1 |
| bounds empty directory entries across {1, 2} listing(s) and closes rejected handles | 2 |
| rejects unknown metadata, source config authority, invalid tenant and invalid encoding | 1 |
| rejects accessors without invoking them and detaches before asynchronous hashing | 1 |
| rejects tampered {snapshotId, fileIdentity, contentDigest, content} snapshot metadata | 4 |
| includes BOM/newline bytes in the identity instead of silently normalizing them | 1 |
| rejects malformed/unsupported registration: dynamic routeName, missing handler, extra handler, computed app['get'], duplicate route, app.listen(3000), /../search path | 7 |
| preserves route registration order and rejects forged output route metadata | 1 |
| refuses conditional registration rather than inventing reachability: if (true) registration; while (false) registration | 2 |
| derived ingestion metadata rejects getters without execution and is detached before awaiting | 1 |
| fixture cannot grant executable capability: fetch('https://example.invalid'), require('node:child_process').exec(req.query.q), process.exit(), db.constructor('return process')(), while (true) {}, eval(req.query.q) | 6 |
| bounds recursive calls and rejects external module/config imports | 1 |

The actual Windows junction negative test ran and passed; it was not skipped. Its temporary link and directories were cleaned up.

### oracleIsolation.test.ts: 13 tests

Suite: `M2 oracle isolation architecture guard`.

| Test title / exact parameter expansion | Count |
| --- | --- |
| production ingestion and test-only SUT dependency closures cannot read benchmark answers | 1 |
| negative control catches an intentional direct ground-truth import | 1 |
| negative control catches transitive ground-truth leakage through an innocent helper | 1 |
| negative control catches indirect/ambient leakage: import('./' + 'answers'), require('./answers'), eval('answer'), globalThis.answers, const x = { expectedSecurityState: 'SAFE' }, import fs from 'node:fs', new Function('return 1'), const indirect = require; indirect('./answers'), global.answers | 9 |
| negative control catches semantic reviewed identity literal: const label = 'fixture-sqli-express-safe-twin-v1' | 1 |

### Required adversarial coverage crosswalk

| Reviewed requirement | Concrete evidence |
| --- | --- |
| Exact eight-case mapping | exact catalog/directory set, duplicate/ninth refusal, sealed entrypoint/language/class/completion comparisons and benchmark source SHA pin |
| Oracle isolation | opaque inputs, semantic-ID rejection, downstream-only bijection, relabeling invariance, transitive audit and direct/transitive/ambient/constructor/alias/semantic-literal controls |
| Snapshot identity | modify/add/delete identities and reversed-enumeration independent hash test |
| Hostile paths | ten hostile paths, duplicate/case-colliding paths and five unsupported extensions |
| Filesystem boundaries | file/total/count limits, actual junction refusal and wide/cumulative directory-entry limits |
| Canonical route ingestion | malformed registrations, conditional registrations and registration-order/forged-output tests |
| Local execution | actual SQLite safe/unsafe observations, unreachable trace, multi-function/file/router traces and mandatory single-query sink alignment |
| Fixture authority | rejected fetch, child_process, process, constructor, eval, external imports and config fields |
| M1 integration | PRE_SEAL mints no artifacts; modeled post-seal tests retain candidateBinding, evidenceHash, exact sink, checked-SHA propagation and immutable states |
| Git code identity | modeled manifest/blob/stale-source/HEAD rejection tests plus actual current-baseline seal refusal; successful real post-commit seal remains pending |
| Replay/state gate | Commit A/B replay, same-ID semantic replay and rejected direct completion |
| Evidence integrity | missing/hash/observation/binding/model evidence mutations plus changed snapshot and unminted record refusal |

## 9. Full offline validation and reproducibility

Environment: Node 24.18.0; installed TypeScript 5.8.3, Vitest 4.1.11 and Vite 6.4.3. No dependency changes or downloads.

Before EVERY test/typecheck/lint/build/recording invocation:

```powershell
$env:NODE_OPTIONS='--require=C:/Users/kayra/Downloads/velnar-v1-contracts/tests/intelligence/offlineGuard.cjs'
```

| Command | Final result |
| --- | --- |
| npm.cmd test -- tests/intelligence/m2 --reporter=json --outputFile=node_modules/.cache/v1-m2-focused.json | PASS: 4 files, 121 tests, 0 failed/skipped |
| npm.cmd test -- tests/intelligence --reporter=json --outputFile=node_modules/.cache/v1-m2-intelligence.json | PASS: 9 files, 317 tests, 0 failed/skipped |
| npm.cmd test -- --reporter=json --outputFile=node_modules/.cache/v1-m2-full.json | PASS: 50 files, 1,081 tests, 0 failed/skipped |
| npm.cmd run typecheck | PASS, exit 0 |
| npm.cmd run lint | PASS, exit 0; existing lint script is tsc --noEmit, not an ESLint run |
| npm.cmd run build | PASS, exit 0; 1,702 modules transformed |
| git diff --check | PASS, exit 0; additionally new files checked separately for whitespace errors because untracked files are not covered by git diff |
| node --import tsx tests/intelligence/m2/recordBenchmarks.ts | PASS, 8 recordings; two runs byte-identical |
| node --import tsx tests/intelligence/m2/sealBenchmarks.ts (actual current-baseline negative check) | EXPECTED REFUSAL: exit 1, committed fixture manifest mismatch; no sealed artifact |

The final repair totals comprise the unchanged 960 baseline tests plus 121 M2 tests; intelligence comprises the unchanged 196 plus 121. No benchmark answer or security assertion was weakened to pass. All three JSON reports were reread to verify success, exact assertion counts and zero failed/pending/todo results. Final production build outputs: index.html 1.93 kB, CSS 46.20 kB, JS 469.70 kB (gzip 0.89 / 8.37 / 122.06 kB).

The earlier closing session encountered a sandbox config-loading failure before any assertions; final commands use approved filesystem access with the offline preload. During this repair, typecheck found Buffer typing incompatibilities in the new Git checker. An explicit Node import did not resolve them; the final implementation uses standard Uint8Array, fatal UTF-8 decoding and exact byte comparison instead, preserving checks without compiler/dependency changes. Final test/typecheck/lint/build commands exited 0. The separate real pre-seal Git refusal is intentional and is not presented as a successful seal.

`node_modules/.cache/v1-m2-recordings.json` contains captured source bytes/manifests, ingestion, benign/attack SQL and parameters, returned IDs, call traces, record digests and PRE_SEAL status only. It contains no M1 candidate/request/evidence/result artifacts. Two fresh processes produced eight records each. The first was preserved as `node_modules/.cache/v1-m2-repair-recording-first.json`; Node Buffer.equals confirmed exact byte equality. Both files contain 50,872 bytes and have the SHA256 below. This intentionally differs from the superseded recording because opaque identity, schema version and evidence status changed; all ten source-file hashes still match the old captured bytes:

```text
dc709321e7cb9df3ddbf8f1dccf40655a8fad228e4402dd121e56c4a40246b94
```

Serialized records are inspectable captured-byte observations only; serialization cannot restore executor authority or sealed state handles. Re-run the normal recorder for fresh PRE_SEAL observations. Only the separate successful post-commit Git seal path can produce real local commit-bound M1 artifacts.

## 10. Remaining limitations and claim discipline

| Claim status | Scope |
| --- | --- |
| PROVEN BY M2 | Deterministic eight-fixture observations; tested opaque identity, single-query, path/manifest/order/mutation boundaries; modeled M1 integration/replay tests; actual current-baseline seal refusal |
| IMPLEMENTED BUT NOT PRODUCT-PROVEN | Narrow Express ingestion foundation, local bounded executable benchmark harness, snapshot manifest/integrity mechanisms |
| PENDING POST-COMMIT SEAL | Successful real Git fixture-byte validation and commit-bound M1 artifacts for a human-reviewed M2 commit; no such commit exists yet |
| NOT YET PROVEN / NOT IMPLEMENTED | Real-world AppSec recall/precision; false-positive rate; customer repository ingestion; broad TypeScript/JavaScript parsing/dataflow; FastAPI/Python executable benchmark; Semgrep/CodeQL/OSV integrations; authenticated Fulgor evidence producer; production sandbox/isolation; production reachability engine; Security Memory; remediation; production deployment |

The parser accepts a deliberately small registration/import/function subset, not arbitrary Express semantics. Middleware, async handling, dynamic registrations, arbitrary SQL and full language execution are not supported. Unsupported relevant input is refused; UNKNOWN remains the candidate reachability value. The single fixed injection probe proves only the stated fixture assertion, not absence of other vulnerabilities. The in-memory database is tiny and read-only from fixture capabilities. Interpreter bounds are not production OS CPU/memory quotas. The trusted catalog loader is a local test loader, not a general adversarial repository acquisition service. The test harness requires the current local Node SQLite capability; runtime portability was not established.

No new runtime dependency, application runtime wiring or sealed contract changes were necessary. The bounded fixture adapter choice is within the requested M2 scope; it must not be represented as full Express HTTP execution. There is no production accuracy or authenticated exploit-verification claim.

## 11. Human-review handoff

All 27 files are intentionally uncommitted for SECOND M2 HUMAN REVIEW on the requested branch. No new commit SHA exists; HEAD remains the sealed engine baseline. No M3 was started; no push, merge, deploy or live provider/model call occurred. Review the three repairs and PRE_SEAL observations first. A separately authorized human commit and successful post-commit seal validation remain required before claiming final commit-bound local evidence. Stop here; no commit is authorized by this repair request.

Final tracked and staged diffs are empty. No imports of the new ingestion/execution modules were found outside their M2 implementation/tests; `worker/ai`, `worker/security`, provider, canary and platform-security runtime behavior remain unchanged. `git diff --check` passes; because it omits untracked files, all 27 additions were separately checked against empty Windows `NUL` using `git -c core.autocrlf=false diff --no-index --check`, without staging. Exit 1 merely indicates new file content in no-index mode; whitespace diagnostics or higher error status are treated as failures.

Final `git status --short` (directories collapsed by Git; section 2 lists all 27 files):

```text
?? V1_M2_EXECUTION_REPORT.md
?? tests/intelligence/m2/
?? worker/intelligence/ingestion/
```

## 12. Second M2 Human Review Decision

Second M2 Human Review: PASS WITH NON-BLOCKING FINDING (2026-09-04).

All three blocking findings were independently reviewed and are CLOSED:
1. semantic benchmark identity no longer crosses the SUT boundary;
2. execution/integration requires exactly one SQL query per observation, preserving exact sink binding;
3. pre-seal execution no longer fabricates analyzed commit identity or M1 proof artifacts.

The M2 implementation commit is authorized.

V1-M2 is NOT YET SEALED. Final seal remains conditional on:
- a human-authorized implementation commit;
- a clean post-commit worktree;
- successful offline regression validation on the committed state;
- successful real local Git fixture-byte/commit binding;
- human review of the resulting COMMIT_BOUND_LOCAL seal evidence.

Non-blocking finding:
the current Git fixture verifier does not itself enforce whole-worktree cleanliness.
The human-controlled post-commit seal procedure therefore requires a clean worktree
before validation. This does not weaken fixture byte-to-commit verification.

No M3 work is authorized before final M2 seal.
