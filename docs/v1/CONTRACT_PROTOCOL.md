# Intelligence contract v1 protocol

Version: `velnar-intelligence-contract-v1`. TypeScript wire interfaces describe
data, not authority. Runtime validators are mandatory on every inbound boundary;
all failures throw `INTELLIGENCE_PROTOCOL_ERROR:` without echoing payload data.
No API route, AI consumer, database or executor is wired to this module in M1.

## Representation and validation

Root messages (including sensor evidence) carry the exact contract version and
organization ID. Nested locations, budgets, profiles and execution/environment
values inherit the root's tenant; they are not independently authoritative.
Benchmark manifests are public synthetic fixture definitions, not tenant evidence.

Unknown keys, symbols, accessors, non-plain objects, sparse/decorated arrays,
coercions and unknown enums are rejected. Validators return detached, deeply
frozen data. IDs are 1-128 ASCII letters/digits/period/underscore/colon/hyphen,
starting with a letter or digit. General text has no control characters or outer
whitespace; normal fields are bounded to 256 characters, relative paths to 512,
and untrusted sensor summaries to 1000. Relative paths use forward slashes and
exclude empty, dot, dot-dot, drive and absolute components. Symbols are mandatory;
line (1-10,000,000), column (1-1,000,000, requiring line) and semantic ID are optional.
No canonical finding fingerprint is claimed. Sensor fingerprints are raw-input
SHA256 references and do not establish semantic identity or vulnerability truth.

Commit IDs are full lowercase 40- or 64-hex Git object IDs, excluding all-zero IDs.
Timestamps must round-trip exactly as `YYYY-MM-DDTHH:mm:ss.sssZ`, with valid calendar
dates. Snapshot <= candidate <= request <= execution start <= completion. An
execution's elapsed milliseconds must fit the request time budget and equal the
result's wall-time usage. These are protocol ordering constraints, not a trusted
clock implementation.

## Mandatory bindings

Request/evidence/result validation requires a caller-supplied expected tenant and
revalidates the entire candidate/request chain. Candidate, nested snapshot and
sensors must agree on organization. Every request, artifact and result must match
candidate ID, organization, snapshot ID, full commit and vulnerability class.
Evidence also matches repository ID, request ID, versioned verification profile,
expected assertion and environment runtime/type/version. Its reproduction metadata
must match its profile, assertion and environment. Result and evidence must agree
on evidence ID, assertion outcome, observation, execution/environment identities,
and start/completion timestamps. A coherent foreign-tenant set still fails the
expected-tenant boundary. A proof for commit A cannot be reused for commit B.

## Evidence gate and limits of proof

`PASSED` pairs only with `VIOLATION_OBSERVED`; `FAILED` with
`NO_VIOLATION_OBSERVED`; `NOT_EVALUATED` with `EXECUTION_INCOMPLETE`. A VERIFIED
result requires PASSED plus a valid, exact-bound, hash-checked evidence artifact.
NOT_VERIFIED also requires an artifact and FAILED; it is not a global assertion
that the repository is safe. INCONCLUSIVE requires NOT_EVALUATED and can omit
evidence only with `evidenceId: null`. Supplying inconsistent/malformed evidence
never downgrades a result silently. VERIFIED contradicting an explicit
UNREACHABLE candidate is rejected. UNKNOWN/INCONCLUSIVE reachability may be
superseded by a later successful verification; M1 does not calculate reachability.

Observations contain closed machine outcome codes and a digest of redacted output,
not model prose, raw source, credentials or shell commands. Producers must redact
sensitive content before hashing or emitting sensor summaries; a schema cannot
detect every secret hidden in an otherwise valid string. Reproduction is a bounded
profile/version/fixture/test identifier reference. It is NOT an executable command.

The synthetic tests prove protocol acceptance/rejection, not actual execution.
SHA256 is integrity, NOT signing, executor authentication, replay protection or
proof that an assertion actually ran. A caller able to fabricate an entire
consistent transcript can also calculate its hash. Future trusted execution
adapters MUST authenticate their producer, enforce approved versioned profiles
and derive observations/assertions from actual execution before passing data to
this gate. Raw model output must never be connected directly to that adapter.
M1 deliberately provides no live evidence-ingestion endpoint or production trust
claim. Arbitrary malicious co-resident JavaScript is outside the in-process type
boundary; this is not an execution sandbox.

## Evidence hash protocol

`evidenceHash` is `sha256:` followed by 64 lowercase hexadecimal digits. It covers
EVERY validated EvidenceArtifact field except itself, including tenant, repository,
code state, request, profile, identities, observations, timestamps and reproduction.
No caller-supplied key omission is supported.

Canonicalization recursively sorts object keys by UTF-16 code units, retains array
order, and uses ECMAScript `JSON.stringify` for strings/primitive values, with no
whitespace between JSON tokens. Accepted numeric fields are bounded safe integers,
never negative zero, non-finite values or floats. Undefined/unknown fields cannot
enter an artifact. No Unicode normalization occurs. Hash bytes are UTF-8 encoding
of `velnar-intelligence-contract-v1:EvidenceArtifact`, one LF, then the canonical
JSON. The implementation uses Web Crypto SHA-256; tests cross-check Node SHA-256
and independently constructed canonical JSON. Hash creation and validation both
validate the entire binding chain. Objects are detached before awaiting hashing.

## State transitions

Inbound FindingCandidate has `verificationState: CANDIDATE` only. Its hypothesis
remains immutable even when its separate workflow state changes.

| Current state | Command | Next state / condition |
| --- | --- | --- |
| CANDIDATE | BEGIN | PENDING_VERIFICATION, fully bound request |
| PENDING_VERIFICATION | COMPLETE | VERIFIED / NOT_VERIFIED / INCONCLUSIVE, validated result and evidence rules |
| NOT_VERIFIED / INCONCLUSIVE | BEGIN | PENDING_VERIFICATION, new request ID, not before previous completion |
| VERIFIED | RESOLVE | RESOLVED, workflow closure only |
| Any other pair | Any command | Reject |

Only `createVerificationState` and `transitionVerificationState` mint deeply frozen
handles. A module-private nominal brand and WeakSet reject structural/spread/JSON/
cast forgeries at runtime. There is one VERIFIED transition path. The transition
function never runs a verifier or grants execution authority. RESOLVED does not
prove a fix, and cannot transfer proof to a new snapshot. State handles are
process-local: durable restoration, concurrency control, request deduplication and
exactly-once execution are deferred, not simulated with a mutable global ledger.

## Execution policy declarations

Network mode is always DEFAULT_DENY. A required empty destination list with zero
network budget is the safe initial request. Explicit future destinations are at
most eight unique lowercase exact DNS hostnames, HTTPS port 443 only (no wildcard,
URL, IP literal, credential, path or implicit allow-all). Nonempty lists require a
positive bounded network budget. This is NOT network enforcement: future adapters
must authorize these declarations against trusted policy and handle DNS resolution,
private addresses, redirects, rebinding and actual egress enforcement themselves.

All four budget fields are mandatory. CPU and wall time: 1-300,000 ms; memory:
1-4096 MiB; requests: 0-100. `timeBudgetMs` is 1..maxWallTimeMs. Reported usage is
nonnegative, integral and <= each request limit. These are schema ceilings, not
selected production resource allocations. Environment/profile identifiers are
bounded declarations, not a registry implementation or proof of isolation.

## Benchmark integrity

`velnar-sqli-express-benchmark-v1` contains exactly eight metadata-only cases, one
per required scenario. Each has fixture-controlled ground truth and a separately
pinned expected-answer test. The manifest is deeply frozen; its closed validator
rejects missing/duplicate IDs, unknown fields and deviations from the reviewed
version (case order is not semantic). A changed expectation requires a new version
and review; do not edit expected answers to improve scores. The unreachable case
contains unsafe SQL but is SAFE relative to its declared external entrypoint,
UNREACHABLE and NOT_VERIFIED. No fixture exists or benchmark score is claimed yet.
