# V1 orchestration foundation

orchestrator.ts remains a pure, synchronous evidence state machine. It provides no
CLI, subprocess, filesystem writer, enqueue, verifier, signer, or promotion capability.
Injected adapters are caller-controlled functions returning bounded JSON evidence;
they are not a sandbox for arbitrary caller code. Live adapters are supplied in liveAgentAdapters.ts and liveOrchestrationRuntime.ts.

Order: Scout findings → Codex candidate → optional single Antigravity fallback →
reviewer advisory → FULGOR handoff eligibility. Missing fallback leaves eligibility
pending; exceptions, blockers, malformed envelopes and binding mismatches halt.
Live CODEX TIMEOUT and OUTPUT_LIMIT are eligible for the single bounded
Antigravity fallback, as is MALFORMED_RESPONSE from a successful Codex process.
NON_ZERO_EXIT, SPAWN_FAILURE and INVALID_CONFIG fail closed without fallback.
Authorization, security, refusal and production-boundary blockers never qualify.
Malformed state-machine envelopes halt because their identity and security
classification cannot be established. These differ from a successful live Codex
process whose malformed model protocol is classified as MALFORMED_RESPONSE.

Every response has exactly schemaVersion, requestId, stage, artifactSha256,
disposition, failure and candidate. The artifact hash binds the pinned baseline
before candidate creation, and JSON.stringify(candidate) after creation. Scout
returns FINDINGS; builders return CANDIDATE or FAILED with a closed failure code;
the live reviewer returns advisory PASS or FINDINGS. NO_BLOCKERS is retained only
by the pure state machine for legacy/DI compatibility; the live reviewer never
emits it. BLOCKED halts any stage. Each accepted envelope is hashed into frozen session evidence. Sessions are in-memory only;
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
  and authorize their executable and environment. Live adapters use this bounded transport.
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


Operator Runner V1 (`operatorMain.ts`) is a one-shot entrypoint. It reads exactly
one private regular JSON request file (mode 0600, current-user owned, no symlink),
by default `$HOME/.local/state/velnar/operator/request.json`. Only
`VELNAR_OPERATOR_REQUEST_FILE` overrides that path. The exact keys are
`schemaVersion: "VELNAR_OPERATOR_JOB_V1"`, `requestId`, `baseline`, and `task`.
Request IDs contain 1–128 ASCII letters, digits, dots, underscores or hyphens;
baseline is the exact 40-hex HEAD; task is nonempty UTF-8, at most 8192 bytes,
without NUL. The whole file is at most 16384 bytes.

Before agents run, `/usr/bin/git` proves a canonical repository root, main branch,
clean worktree including untracked files, and exact baseline commit. The default
repository is `$HOME/updated-velnaar`; only `VELNAR_REPO_ROOT` overrides it.
All three executable environment variables in the env example must point to real,
executable regular files, without symlinks. Model environments contain only HOME,
PATH, LANG, LC_ALL, TMPDIR and XDG_CONFIG_HOME; limits are fixed and bounded.

The runner produces immutable evidence under `$HOME/.local/state/velnar/agent-runs`
and optionally a bounded review bundle in the existing `$HOME/VELNAR-Review-Bundles`
directory. Temporary state uses `$HOME/.local/state/velnar/operator-tmp`.
Created state directories are private. Request IDs map deterministically to SHA-256
run IDs to fit the existing store contract; duplicate requests fail without retry
or overwrite. This supports one new tests/ snapshot, not arbitrary patch automation.

FULGOR remains the independent verification/controller/promotion authority.
Handoff eligibility is not verification. Human approval remains required; there
is no automatic commit/push/merge/deploy/promotion. stdout contains only bounded
operational metadata; failures exit nonzero without printing raw errors.
The runner accepts a Codex TIMEOUT or OUTPUT_LIMIT as recovered only when validated
immutable stage metadata proves a later ANTIGRAVITY stage with transportOutcome OK.
All other non-OK process transport outcomes remain fatal. Malformed or unreadable
metadata fails closed. Successful fallback transport can still yield semantic
NEEDS_REVIEW; MALFORMED_RESPONSE retains its existing state-machine behavior.

The user service template in `deploy/systemd/user/velnar-live-orchestrator.service`
is oneshot, has no restart loop, and is not auto-enabled or started by repository
code. Its private environment file is `%h/.config/velnar/live-orchestrator.env`;
the example contains executable paths only, never credentials. Operators must
prepare the private request file and existing review-bundle directory before
manually invoking the runner/service.
