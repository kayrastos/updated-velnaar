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
- `kayra-memory add` and `kayra-memory delete` require an exact interactive
  `EVET` confirmation. Content and search questions are entered interactively so
  they do not become shell-history arguments.
- `kayra-memory-chat` performs a fresh LM Studio preflight, retrieves only
  relevant active records, marks them as untrusted data, and sends a single
  non-persistent (`store=false`) request to the loopback-only runtime.
- The chat command defaults to the separately pinned Kayra v1 profile at
  `configs/runtime.kayra-v1.lm-studio.yaml`. The earlier Qwen3-14B profile is
  retained for historical evaluation reproducibility.
- When the CLI runs inside WSL while LM Studio runs on Windows, WSL mirrored
  networking is required so the fail-closed `127.0.0.1` boundary remains
  usable. The runtime must not be changed to a LAN or dynamic host address.
- The Kayra v1 runtime expects `KAYRA_LM_STUDIO_BASE_URL` to be
  `http://127.0.0.1:1234/api/v1` and `KAYRA_LM_STUDIO_MODEL` to be
  `qwen3.5-9b-kayra-v1`.
- `ask` is read-only with respect to persistent memory. A model response can
  never create, update, or delete a memory record.

The first retrieval implementation is deliberately lexical and offline.
Semantic embeddings and multi-turn conversation history remain deferred to a
later reviewed milestone.
