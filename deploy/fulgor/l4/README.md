# FULGOR Phase 4.2B L4 runtime contract

This container keeps the public Cloud Run ingress and the model runtime separate inside one container:

- Node ingress: `0.0.0.0:$PORT`
- llama.cpp runtime: `127.0.0.1:$FULGOR_L4_RUNTIME_PORT`
- public verification route: exact `POST /v1/verify`
- llama.cpp is never exposed on the Cloud Run ingress port
- runtime uses one inference slot and no built-in tools
- model identity is established by the configured SHA-256 digest, never by model self-report
- Phase 4.1 Cloud Run IAM remains the authorization boundary

Required runtime environment:

- `FULGOR_L4_EXPECTED_MODEL_ID`
- `FULGOR_L4_MODEL_PATH` (absolute GGUF path, expected to come from a read-only Cloud Storage mount)
- `FULGOR_L4_MODEL_SHA256` (64 hex chars)
- `PORT` (Cloud Run supplies this; default 8080 in local tests)

The Docker build requires immutable digest-pinned `NODE_BUILD_IMAGE` and `LLAMA_CPP_IMAGE` build arguments. Do not use mutable tags for canonical deployment evidence.

Recommended initial Cloud Run settings are deliberately conservative:

- NVIDIA L4
- 8 vCPU
- 32 GiB instance memory
- concurrency 1
- min instances 0
- max instances 1 until live capacity evidence exists
- HTTP startup probe `/readyz`
- authenticated invocation only
- service-level `roles/run.invoker` only for the FULGOR controller service account

The model file is not baked into the image. For a 27B 4-bit GGUF, keep the artifact in VELNAR-controlled Cloud Storage and mount it read-only. The worker hashes the exact mounted file before starting llama.cpp.
