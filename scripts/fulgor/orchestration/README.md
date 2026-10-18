# V1 orchestration foundation

orchestrator.ts remains a pure, synchronous evidence state machine. It provides no
CLI, subprocess, filesystem writer, enqueue, verifier, signer, or promotion capability.
Injected adapters are caller-controlled functions returning bounded JSON evidence;
they are not a sandbox for arbitrary caller code. No live adapters are supplied.

Order: Scout findings → Codex candidate → optional single Antigravity fallback →
reviewer advisory → FULGOR handoff eligibility. Missing fallback leaves eligibility
pending; exceptions, blockers, malformed envelopes and binding mismatches halt.
Only explicitly classified timeout, process failure or malformed-response evidence
allows fallback. Raw malformed responses halt because their identity and security
classification cannot be established. Security/authorization failures never qualify.

Every response has exactly schemaVersion, requestId, stage, artifactSha256,
disposition, failure and candidate. The artifact hash binds the pinned baseline
before candidate creation, and JSON.stringify(candidate) after creation. Scout
returns FINDINGS; builders return CANDIDATE or FAILED with a closed failure code;
reviewer returns advisory PASS or NO_BLOCKERS. BLOCKED halts any stage. Each accepted
envelope is hashed into frozen session evidence. Sessions are in-memory only;
serialized, forged or modified sessions cannot be resumed. Callers must supply
unique request identities; this module does not provide durable replay prevention.

Candidate eligibility is structural evidence only: one regular new tests/ file,
matching baseline/content hashes, WHITE label, empty tracked patch. WHITE is an
untrusted claim here. The state machine does not emit bundles or create FulgorAutomationJob records.
The unchanged reviewBundleFeeder must independently validate actual files, symlink
safety, White admission, pinned baseline, stability and dry-run application before
any real handoff. Unsupported candidates stop explicitly at UNSUPPORTED_HANDOFF.

FULGOR_HANDOFF_ELIGIBLE never means verified or approved. Actual verification,
provenance validation, signed evidence and evaluateHumanPromotionGate remain the
existing external authority chain. Human approval is always required. All automatic
action capabilities remain false, including after advisory PASS or terminal events.


Infrastructure boundaries:

- agentProcess.ts is an opt-in subprocess transport with an absolute executable,
  explicit absolute cwd, explicit bounded environment, ignored stdin, finite
  deadline and separate byte budgets. It uses no shell or retry. Timeout and
  overflow immediately SIGKILL the process group on POSIX (the direct child on
  Windows); pipe cleanup has an additional 250 ms bound. Results are transport
  evidence only. This is not a sandbox for arbitrary executables; callers choose
  and authorize their executable and environment. No live agent adapter exists.
- reviewBundleProducer.ts emits only one new regular tests/ snapshot and an empty
  tracked patch using the existing admission schema. It copies exact UTF-8 bytes
  and binds their hash and the exact manifest hash. It neither verifies the test
  nor enqueues verification. createdAt uses canonical ISO UTC milliseconds.
- The output root must already exist and be privately controlled by the caller.
  Root/ancestor symlinks and existing destinations are refused. An exclusive
  per-package lock contains private staging; a single same-filesystem rename
  publishes the completed bundle. Cooperative concurrent producers cannot
  overwrite a destination. Standard Node filesystem APIs cannot exclude hostile
  concurrent root replacement; do not share write access with untrusted users.
  No crash durability/fsync guarantee is claimed; ordinary failures clean staging.

Neither transport results nor producer claims automatically advance orchestration.
The feeder retains independent admission, baseline, conflict, stability and dry-run
checks. Production execution remains disabled and human approval remains mandatory.
