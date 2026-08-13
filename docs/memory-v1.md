# KayraAI local memory v1

This milestone adds a local-only encrypted memory core.

- Persistent writes and deletes require an explicit `WriteAuthorization`.
- Memory content, source, tags, and authorization purposes are encrypted with
  AES-256-GCM. A key is derived from the user passphrase with scrypt; neither the
  passphrase nor the derived key is persisted.
- The SQLite database defaults outside the repository and can be configured with
  `KAYRA_MEMORY_DB`.
- Passing `repository_root` makes the store reject database paths inside the Git
  repository.
- Retrieval decrypts records only in process memory and performs deterministic
  lexical matching. It requires no network, model, or embedding download.
- Retrieved memories are emitted as an explicitly untrusted data-only system
  message. Stored markup is escaped before prompt insertion.
- Personal content must never be committed to Git or copied into training/eval
  data.

Semantic embeddings, encryption-at-rest integration, and automatic LM Studio
request augmentation are intentionally deferred to later reviewed milestones.
