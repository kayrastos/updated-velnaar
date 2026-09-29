# FULGOR Corpus Factory V1 — Final Hardening Checkpoint

Date: 2026-09-29
Branch: $branch
Certified parent HEAD: $expectedHead

## Certification

- TypeScript: PASS
- Corpus Factory test files: 25
- Corpus Factory tests: 170 / 170 PASS
- Final public live dry run: PASS
- Worktree authority at start: clean
- Push performed: no
- Training started: no
- Promotion performed: no
- Deployment performed: no

## Authority invariants

- TRAIN != PROMOTE != DEPLOY.
- Advisory/RAG/context data is untrusted input and never authorization.
- Declared Git SHA/ref is a claim; post-materialization exact identity is authority.
- Corpus-record admission is distinct from training-manifest admission.
- Client state is never authorization or verification authority.
- BLACK/security-memory data is not admitted to the public corpus path.
- Model-generated hard negatives are not authority.
- Hard negatives require a distinct exact materialized public revision plus independent executable/static verification.
- OSV GIT fixed events are range-boundary hypotheses, not automatic patch-commit authority.
- License eligibility derives from materialized license content, not caller-supplied SPDX claims.
- Candidate, draft and verification-receipt digest lineage is recomputed fail-closed.
- createdAtUtc / verifiedAtUtc / registry createdAtUtc use canonical UTC Z timestamps.
- Windows Git timeout handling terminates the Git process tree; POSIX uses a dedicated process group.
- Corpus/source/test/checkpoint text paths are pinned to LF through .gitattributes.

## Certified V1 layers

1. Provenance and source isolation.
2. GHSA / OSV untrusted advisory ingestion.
3. Exact repository identity and license evidence.
4. Bounded bare repository materialization.
5. Direct vulnerable/fixed pair evidence.
6. Corpus review candidates.
7. Public dry-run path.
8. Verification-gated corpus drafts.
9. Independently verified corpus-record admission.
10. Signed corpus registry and derived-entry integrity.
11. Deterministic pair split and final-holdout commitment.
12. Signed single-use training execution authorization.
13. Durable replay protection and production signer trust.
14. Dormant production training runtime boundary.
15. Host Git configuration isolation.
16. Bounded explicit object hydration and object-store growth.
17. Materialized SPDX detection.
18. Bounded Git process-tree termination.
19. Structured OSV GIT fixed-range semantics.
20. Independently verified hard negatives.
21. Candidate -> draft -> receipt semantic digest lineage.
22. Strict canonical UTC timestamps.
23. Repository LF policy for Corpus Factory surfaces.

## Explicit non-authorities

- source advisory metadata
- caller-supplied license labels
- model opinions
- retrieved context
- local Git configuration
- client booleans
- unsigned/untrusted registries
- training manifests without authorization
- training authorization for promotion or deployment

## Remaining operational state

This checkpoint certifies the Corpus Factory V1 hardening boundary.
It does not start candidate training and does not authorize promotion or deployment.

Push remains intentionally separate.
