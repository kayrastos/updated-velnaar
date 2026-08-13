# KayraAI local memory v1

This milestone adds a dependency-free, local-only memory core.

- Persistent writes and deletes require an explicit `WriteAuthorization`.
- The SQLite database defaults outside the repository and can be configured with
  `KAYRA_MEMORY_DB`.
- Passing `repository_root` makes the store reject database paths inside the Git
  repository.
- Retrieval is deterministic lexical matching. It requires no network, model, or
  embedding download.
- Retrieved memories are emitted as an explicitly untrusted data-only system
  message. Stored markup is escaped before prompt insertion.
- Personal content must never be committed to Git or copied into training/eval
  data.

Semantic embeddings, encryption-at-rest integration, and automatic LM Studio
request augmentation are intentionally deferred to later reviewed milestones.
