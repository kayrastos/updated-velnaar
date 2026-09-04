# VELNAR V1-M0/M1 execution report

Human-review repair validation: PASS (2026-09-04, Europe/Istanbul).
Both reported human-review blockers are closed by this repair, subject to second
human review. Delivery status: repaired M0/M1 working tree ready for that review;
repair changes are uncommitted, and HEAD remains the reviewed feature commit
`1435edf73bded7f4503463163c0f4bd37700b72c` on
`feat/v1-canonical-security-contracts`.
V1-M2 has not started. No push, merge, deployment or live provider call occurred
during this repair. No existing AI/provider/routing/canary/platform-security runtime
behavior, dependency declaration, lockfile or Git identity setting was changed.

## Delivery chronology (historical author block, not current status)

1. Original M0/M1 implementation and validation completed. The first commit attempt
   failed with `Author identity unknown`, leaving the 18 original reviewed files
   staged. That was the correct delivery blocker at that time.
2. After the user supplied repository-local author identity, feature commit
   `1435edf73bded7f4503463163c0f4bd37700b72c` was subsequently created with message
   `feat(intelligence): establish V1 canonical security contracts`. Its existence,
   branch and clean starting worktree were verified for this repair. Missing author
   identity is no longer a blocker; saying no feature commit exists would be false.
3. Human review identified a missing exact candidate-semantic binding and the stale
   execution report. This repair addresses those two findings only.
4. Required candidate-content bindings now close the same-ID/same-snapshot replay
   gap, and this report records the actual chronology and new validation evidence.
   No new commit was created or staged by this repair; second human review is next.

## Human-review repair: exact files changed

New file:

- `tests/intelligence/candidateSemanticBinding.test.ts` (34 new tests).

Modified files:

- `worker/intelligence/contracts/types.ts`: mandatory candidateBinding on request,
  evidence and result wire types.
- `worker/intelligence/contracts/validators.ts`: deterministic complete-candidate
  binding helper and independent equality checks at every chain boundary.
- `worker/intelligence/contracts/index.ts`: exports computeCandidateBinding.
- `tests/intelligence/fixtures.ts`: exact candidate binding on synthetic messages.
- `tests/intelligence/stateMachine.test.ts`: UNREACHABLE test rebinds its changed
  candidate and rehashes evidence so it still exercises the reachability gate;
  its rejection assertion now names that gate explicitly.
- `tests/intelligence/tenantBinding.test.ts`: Commit B replay test rebinds the
  candidate/request/result so it continues testing rejection of Commit A evidence.
- `docs/v1/CONTRACT_PROTOCOL.md`: complete canonical representation, integrity-only
  semantics, required field behavior, compatibility, size and sensitivity limits.
- `V1_M0_M1_EXECUTION_REPORT.md`: chronology, repair evidence and actual results.

No state-machine implementation change was needed: its existing BEGIN/COMPLETE
boundaries call the strengthened validators. No files under `worker/ai`,
`worker/security`, platform runtime or benchmark metadata changed during this repair.

## Human-review repair design and evidence

`candidateBinding` is the exact domain-prefixed canonical text of the complete
validated FindingCandidate, not candidateId and not a hash of selected fields.
Its representation is `velnar-intelligence-contract-v1:FindingCandidate`, one LF,
then recursively UTF-16-key-sorted ECMAScript JSON, preserving arrays and all
optional-field presence. Every accepted field is covered, including tenant/code
state, source/sink/context, sensor identity and evidence, reachability and timestamps.
No whitelist projection or caller-selected omission is used. Insertion order of
object keys is not semantic; sensor ordering and metadata edits are conservative
identity changes requiring a newly bound chain.

The binding is independently recomputed from the validated candidate at request,
evidence and result boundaries. Merely making the three wire labels agree does not
suffice. Evidence SHA256 includes the binding, so relabeling an old artifact keeps
neither its valid hash nor its authority to complete a different pending candidate.
The helper validates expected tenant and returns an immutable string; validators
continue to detach/deeply freeze outputs before asynchronous evidence hashing.

This is an integrity identifier, NOT producer authentication/signing or proof of
real execution. It is deliberately canonical text rather than a compact digest:
no runtime dependency, bespoke SHA256 implementation, or asynchronous request API
was needed. A party able to fabricate/relabel and rehash an entire consistent
transcript still requires future authenticated producer enforcement, as already
documented for M1. Model output gains no authority from this helper.

### Exact new tests and invariant mapping

The new file has 34 executed tests. All 23 tests in the following parameterized
case use the exact title template:

`Candidate A proof cannot verify Candidate B with same IDs/commit but different %s`

Its 23 `%s` values are: `source path`, `source symbol`, `source line`,
`source column`, `source semantic ID`, `sink path`, `sink symbol`, `sink semantic ID`,
`entrypoint`, `route context`, `sensor identity`, `sensor type`, `sensor rule`,
`sensor summary`, `sensor source`, `sensor sink`, `sensor evidence fingerprint`,
`sensor array content`, `reachability`, `candidate timestamp`, `snapshot ref`,
`snapshot provider`, `snapshot timestamp`.

Each case asserts unchanged tenant/candidateId/repository/snapshot/commit/class,
rejects BEGIN with A's binding, then creates a legitimate pending request for B and
rejects A's evidence at COMPLETE. Even changing request/result/artifact binding to
B cannot reuse A's original evidence hash; the failure leaves the workflow pending.

| Exact additional test title | Count | Invariant / adversarial evidence |
| --- | ---: | --- |
| `rejects missing, malformed or tampered %s binding` (`request`, `evidence`, `result`) | 3 | Seven bad/missing values per boundary, including model prose, digest-shaped substitute and noncanonical trailing whitespace; all fail closed |
| `matches independent canonical encoding and ignores recursive object key insertion order` | 1 | Independent canonical encoder agrees; reordered keys bind identically; independent Node SHA256 proves evidenceHash covers candidateBinding |
| `binds sensor ordering and optional field presence without normalization` | 1 | Array reorder and absent route metadata change identity |
| `validates the candidate and required expected tenant before computing its binding` | 1 | Invalid/foreign expected tenant, accessor-backed fields and VERIFIED-as-candidate rejected; getter is never invoked |
| `preserves the exact-candidate three-state path and prohibits direct completion` | 1 | Exact candidate follows CANDIDATE -> PENDING_VERIFICATION -> VERIFIED; direct COMPLETE still fails |
| `retains Commit A to Commit B replay protection after rebinding the new request/result` | 1 | Actual pending Commit B rejects Commit A evidence with commitSha mismatch |
| `retains tenant isolation even for an internally consistent newly bound foreign chain` | 1 | Fully coherent and rehashed foreign-tenant chain still fails caller tenant boundary |
| `detaches and deeply freezes candidate-bound outputs before the async evidence hash boundary` | 1 | Mutating candidate, request, evidence and result after validation starts cannot change validated outputs or nested frozen objects |
| `rejects hash creation against a different candidate instead of laundering an old artifact` | 1 | Public evidence-hash helper itself rejects old binding under a new candidate |

Existing 162 focused tests are retained, including tenant mismatch matrices,
same-commit/foreign-repository checks, no model/cast/serialized state authority,
mandatory evidence, UNREACHABLE and resource/profile/time enforcement. Two existing
tests were adapted to retain their original distinct security coverage, not removed
or bypassed. New 34 + original 162 = 196 focused tests.

### Actual repair validation results (all offline)

All commands ran with the unchanged existing process guard:

```powershell
$env:NODE_OPTIONS = '--require=C:/Users/kayra/Downloads/velnar-v1-contracts/tests/intelligence/offlineGuard.cjs'
npm.cmd test -- tests/intelligence --reporter=json --outputFile=node_modules/.cache/v1-human-review-focused.json
npm.cmd test -- --reporter=json --outputFile=node_modules/.cache/v1-human-review-full.json
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

| Validation | Actual result | Exit / failures |
| --- | --- | --- |
| Focused V1 intelligence suite | 5 files; 196 passed; 0 skipped/pending | Exit 0; 0 failures |
| Complete test suite | 46 files; 960 passed; 0 skipped/pending | Exit 0; 0 failures |
| Typecheck | `tsc --noEmit` | Exit 0 |
| Lint | Repository script is `tsc --noEmit`, not a separate ESLint pass | Exit 0 |
| Production build | Vite 6.4.3; 1702 modules; built in 5.28s | Exit 0 |

Focused counts: candidateSemanticBinding 34; contracts 103; tenantBinding 25;
stateMachine 21; sqlInjectionBenchmarkContract 13. Full total is original 926 + 34
= 960. JSON captures are ignored local validation artifacts under node_modules,
not new tracked source files. No dependency installation or network access was
needed. Typecheck and lint completed successfully even though they initially
returned running-process handles.

Production outputs: `dist/index.html` 1.93 kB (gzip 0.89 kB),
`dist/assets/index-_68ELEki.css` 46.20 kB (gzip 8.37 kB),
`dist/assets/index-CL2n2YV7.js` 469.70 kB (gzip 122.06 kB). The filenames and sizes
match the original build; no existing application runtime was changed.

### Remaining repair limitations / closure decision

- Binding is exact-content integrity, not authentication. Fabricated complete
  transcripts, authenticated producers, durable replay ledgers and actual execution
  remain outside M0/M1; no production verification claim is made.
- Canonical text repeats candidate metadata and is not a redacted digest. Account
  for bounded payload overhead, avoid logging it, and treat even metadata-only
  edits/array reordering as a new reviewed identity.
- The added field intentionally rejects old unbound pre-review wire messages.
  There is no compatibility fallback that could reopen the finding replay gap.
- Original dependency-lock portability and process-only offline-guard limitations
  below remain unchanged. No new dependency or trust authority was introduced.

Blocker 1 (candidate semantic evidence binding): CLOSED by exact-content binding
and the above passing adversarial regressions, within the documented M1 integrity
boundary. Blocker 2 (stale report): CLOSED by the verified chronology and current
repair results. Second human review is still required. V1-M2 remains NOT STARTED.

## Original M0/M1 delivery record (historical context below)

The remaining sections record the original implementation and validation, not the
current repair's file list, test counts, dependency/network activity or commit status.

## Baseline and isolation

- Repository: `kayrastos/updated-velnaar`.
- Verified remote: `https://github.com/kayrastos/updated-velnaar.git`.
- Authorized fetch: `git fetch origin --prune`.
- Verified baseline: `adfcdd678463d119fd627d9a51f0fb0bbb8c51e2`.
- Worktree: `C:/Users/kayra/Downloads/velnar-v1-contracts`.
- Feature branch: `feat/v1-canonical-security-contracts`, created from fetched origin/main.
- Required AI validator and tests were verified in origin/main and re-read in the
  clean worktree before implementation. No implementation uses the stale baseline.
- The original `velnar-sync` checkout/main was not reset, modified, merged or
  committed. Its untracked README was not copied, staged or overwritten. Its SHA256
  remains `8B27471D2F5A8905DE3559AC8880F826FC9AC1D55A9FD186A56A4452D4B5206F`.
- No push, deployment, production mutation or live model/provider call occurred.

## Scope

Implemented the versioned V1 scope lock, separate AppSec contracts domain, strict
runtime validators, controlled evidence-gated state transitions, and an immutable
eight-case TypeScript/Express SQLi metadata manifest. Added synthetic protocol
fixtures and negative tests. No existing AI/provider/routing/budget/canary or
platform-security runtime source was changed. No runtime dependencies were added.

## Exact files added

1. `.gitattributes`
2. `docs/v1/V1_SCOPE_LOCK.md`
3. `docs/v1/CONTRACT_PROTOCOL.md`
4. `worker/intelligence/contracts/types.ts`
5. `worker/intelligence/contracts/validators.ts`
6. `worker/intelligence/contracts/stateMachine.ts`
7. `worker/intelligence/contracts/index.ts`
8. `worker/intelligence/benchmarks/types.ts`
9. `worker/intelligence/benchmarks/sqlInjectionBenchmark.ts`
10. `worker/intelligence/benchmarks/index.ts`
11. `tests/intelligence/fixtures.ts`
12. `tests/intelligence/offlineGuard.cjs`
13. `tests/intelligence/contracts.test.ts`
14. `tests/intelligence/tenantBinding.test.ts`
15. `tests/intelligence/stateMachine.test.ts`
16. `tests/intelligence/sqlInjectionBenchmarkContract.test.ts`
17. `V1_M0_M1_EXECUTION_REPORT.md`

## Exact existing file modified

`tests/ai/phaseA12B2C5DDualLaneSpecification.test.ts`: one existing token test now
supplies its existing fixed timestamp through the validator's `now` injection.
The real expiry validation remains enabled. No existing assertion was removed,
relaxed, skipped or deleted.

Five historical JSON files had Windows CRLF formatting converted back to the exact
LF bytes already in Git. Their contents/hashes have no Git diff. `.gitattributes`
pins only these files to LF to prevent repeated checkout-induced checksum failures:

| Historical file in `execution/` | Verified SHA256 (also equals baseline Git blob) |
| --- | --- |
| `a12b2c5b_canary_execution_attempt2_results.json` | `1ef474e7bde9069a2e80acd2791725123b068027550fbb50dd267b8c102423a1` |
| `a12b2c5b_final_recanary_03186e5_results.json` | `cd3318502d5849633b7f075f2849347fb223f6579b02d5f16cfa226e3b0a4795` |
| `a12b2c5c_latency_service_tier_fit_audit.json` | `bc94216b56ec2f25c343882c5a6e6d56432c1fde98410911b1a186f7fd0f6785` |
| `a12b2c5c_latency_service_tier_fit_audit_amendment.json` | `582d62d72b9c93b8fdd46bbbc77b792d3c65d5fa2f328e16f6635dd285b756ca` |
| `a12b2c5d_dual_lane_v12_specification.json` | `0d1ac9a8eaabe131ec8c9685aacdff5a00caa5953c2a6558d8c96efabd8d7e6a` |

## Architectural decisions

- Handwritten fail-closed validators follow current server-side conventions but
  reject all unknown fields in the new security-critical protocol. There is no
  new schema dependency or connection to `worker/security` or the AI router.
- Every root is tenant/version-bound; nested values inherit tenant context.
  Binding validators require an explicit expected tenant and revalidate the chain.
- Candidates are immutable hypotheses. Trusted workflow handles use a private
  nominal brand plus module-private WeakSet; raw JSON/casts/spreads cannot mint them.
- The only VERIFIED transition is pending completion with validated, exact-bound,
  successful synthetic proof-shaped evidence. Invalid VERIFIED is rejected, never
  silently downgraded. NOT_VERIFIED additionally requires a failed-assertion artifact.
- Evidence SHA256 covers all fields except the hash, with domain-separated,
  recursively key-sorted canonical JSON. Web Crypto hashing is checked against
  independent Node hashing. This is integrity, not a signature or producer proof.
- Network defaults to deny with no destinations and zero requests. Future explicit
  destinations are bounded exact HTTPS hostnames. Resource/time budgets are required
  safe integers with schema ceilings; no execution or production limits are selected.
- Reproduction contains bounded versioned profile/test/fixture references, not
  shell commands. Execution profile authorization and enforcement remain future work.
- The benchmark is deeply frozen and versioned, with independent expected-answer
  tests and exact reviewed-manifest validation. The unreachable scenario is safe
  relative to its external entrypoint, not a claim that its disconnected SQL is safe.
- Full representation, state transitions, hash protocol, limits and future trust
  requirements are documented in `docs/v1/CONTRACT_PROTOCOL.md`.

## Dependency setup and offline boundary

The worktree initially had no node_modules. `npm ci --offline --ignore-scripts
--no-audit --no-fund` failed because the existing lockfile omits platform-specific
optional package entries. No lockfile repair or dependency declaration change was
made. With explicit tool approval under the package-operation exception, existing
declared dependencies were installed using:

```text
npm install --ignore-scripts --no-save --package-lock=false --no-audit --no-fund
added 240 packages in 34s
```

This resolved installed versions within existing ranges, not a reproducible `npm ci`
lockfile install. `package.json`, `package-lock.json` and `bun.lock` are unchanged.
Environment: Windows, Node v24.18.0, npm 11.16.0, TypeScript 5.8.3, Vitest 4.1.11,
Vite 6.4.3. Dependency lock portability remains a separate maintenance concern.

Network use was limited to the explicitly authorized Git fetch and approved npm
package downloads. All tests/build checks ran offline with this process preload:

```powershell
$env:NODE_OPTIONS = '--require=C:/Users/kayra/Downloads/velnar-v1-contracts/tests/intelligence/offlineGuard.cjs'
```

The guard denies real fetch, TCP/TLS, HTTP(S), UDP and DNS lookup entry points;
existing tests may still install their explicit in-process mock transports.
It is test-only and is not imported by application source. No provider credentials
were needed and no live canary was executed. This is a process test guard, not an
OS security sandbox against malicious subprocesses or native code.

## Actual validation results

| Validation | Actual result | Failures |
| --- | --- | --- |
| Focused intelligence tests | 4 files, 162 tests passed | 0 |
| `npm test` | 45 files, 926 tests passed | 0 |
| `npm run typecheck` | `tsc --noEmit`, exit 0 | 0 |
| `npm run lint` | Repository's lint script is `tsc --noEmit`, exit 0 | 0 |
| `npm run build` | Vite production build, exit 0 | 0 |

Focused test file counts (from actual Vitest JSON output):

| File in `tests/intelligence/` | Passed | Failed |
| --- | ---: | ---: |
| `contracts.test.ts` | 103 | 0 |
| `tenantBinding.test.ts` | 25 | 0 |
| `stateMachine.test.ts` | 21 | 0 |
| `sqlInjectionBenchmarkContract.test.ts` | 13 | 0 |

Focused capture command: `npm test -- tests/intelligence --reporter=json
--outputFile=node_modules/.cache/v1-m1-focused.json`. The machine-readable output
is ignored local validation data, not committed source.

Actual final full-suite output:

```text
RUN  v4.1.11 C:/Users/kayra/Downloads/velnar-v1-contracts
Test Files  45 passed (45)
     Tests  926 passed (926)
Start at  03:07:32
Duration  5.43s
```

Actual final production build output:

```text
vite v6.4.3 building for production...
1702 modules transformed.
dist/index.html                   1.93 kB | gzip:   0.89 kB
dist/assets/index-_68ELEki.css   46.20 kB | gzip:   8.37 kB
dist/assets/index-CL2n2YV7.js   469.70 kB | gzip: 122.06 kB
built in 3.61s
```

The first baseline regression run was 761 passed / 3 failed (764 total): two
historical hash checks failed solely from checkout CRLF, and one token fixture
expired against the real clock. Read-only comparison proved all five baseline Git
blobs match the expected hashes. The narrow formatting/clock repairs above leave
all 764 original tests passing, without changing security runtime behavior.
An initial new benchmark test had a syntax typo, fixed before final validation.

## Security invariants mapped to tests

| Invariant | Corresponding test(s) |
| --- | --- |
| Required tenant/repository/commit/version/timestamp | contracts: `rejects missing snapshot %s`, `rejects invalid identity %j`, `rejects noncanonical timestamp %s`, `rejects invalid commit %s` |
| Candidate is not verified; closed vulnerability/reachability enums | contracts: `rejects inbound candidate state %s`, `locks exactly the five V1 vulnerability classes`, `rejects unversioned vulnerability %s`, `rejects confidence/casing as reachability %j` |
| Sensor != verification; bounded locations and summaries | contracts: malformed sensor/line-only/predating snapshot, invalid path, oversized summary/sensor casing tests |
| Unknown fields and executable object tricks have no authority | contracts: authority-smuggling matrix, nonobject matrix, getters/prototypes/symbols/sparse/decorated array test |
| Mandatory finite bounded budgets and default-deny network | contracts: CPU budget matrix, missing budget matrix, time/assertion/environment/profile test, explicit HTTPS/duplicate/wildcard/implicit grant test |
| Candidate/request/evidence/result tenant and exact code-state binding | tenantBinding: candidate/request, request/evidence and result mismatch matrices; foreign nested tenant and coherent foreign-tenant boundary tests |
| Commit A evidence cannot verify Commit B | tenantBinding: `a valid Commit A proof cannot verify a consistent candidate/request/result for Commit B` |
| Missing/malformed/tampered evidence never grants VERIFIED | contracts: missing/malformed evidence, malformed/wrong digest, hash binding tests; stateMachine: missing-evidence gate and evidence mismatch matrix |
| Digest covers canonical full artifact | contracts: independent Node SHA256/key-order test and observation/reproduction tampering test |
| Assertions, resource use, times, request/profile and execution identities agree | contracts: failed assertions/resource/interval test, execution/environment/time/observation equality test, reproduction/profile/unknown authority test |
| No direct candidate -> VERIFIED; no raw or model authority | stateMachine: direct completion rejection, model-like transition matrix, spread/serialized/structural/cast forgery test, immutable state test |
| Only valid pending completion promotes; no silent fallback | stateMachine: valid three-state path, evidence mismatch matrix with unchanged pending state, explicit inconclusive, NOT_VERIFIED artifact, unreachable contradiction tests |
| Controlled retry/resolution lifecycle | stateMachine: new request after completion, RESOLVED closure/no resurrection/no new-commit proof tests |
| No caller mutation race at async hash boundary | contracts: `detaches result and evidence before async hashing to prevent caller mutation races` |
| Exactly eight versioned ground-truth cases; no silent answer rewrite | sqlInjectionBenchmarkContract: exact categories/IDs, profile/version, pinned independent answer matrix, frozen metadata, drift matrix, duplicate/unknown fields and array accessor tests |

## Known limitations / claim status

### PROVEN BY THIS PHASE

Only the protocol invariants exercised by the 162 new tests above, plus the passing
764-test regression suite under the documented environment and fixture repairs.
No real exploit success, security accuracy or performance claim follows.

### IMPLEMENTED BUT NOT PRODUCT-PROVEN

The canonical contract infrastructure, integrity hash, opaque in-process workflow
handles, tenant/code-state binding and metadata-only benchmark. Well-formed data
can be fabricated by a party controlling an entire transcript: hashing is not
authentication. A future trusted adapter must authenticate executor output and
derive assertions from actual execution before using the gate. M1 has no inbound
AI/provider route connected to the gate.

### NOT YET IMPLEMENTED

Repository ingestion; executable benchmark applications; Context Graph; structural
parsing; framework extraction; reachability; Semgrep/CodeQL/OSV adapters; Fulgor
execution/isolation; real SQLi verification; authenticated evidence producers;
profile registry; signatures; persistence/replay protection; Security Memory;
remediation; customer UI; commercial accuracy benchmark; production deployment.

## Bounded deviations

Additional files are protocol documentation, a shared synthetic fixture helper,
the test-only network guard, and narrow LF attributes. One existing test receives
deterministic time through its already-supported injection point; expiry checks
remain active. These address protocol clarity and observed baseline reproducibility,
not product scope expansion. No platform/AI runtime changes or dependency manifest
changes were needed. NOT_VERIFIED requires evidence as a deliberate fail-closed
choice beyond the minimum VERIFIED gate. All execution remains unimplemented.

## Next task (not started)

**V1-M2 — Executable SQLi Benchmark Fixtures + Express Canonical Ingestion Foundation**.
Human review of this feature branch is required before proceeding.
