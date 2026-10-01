# FULGOR QLoRA training executor preflight V1

This container surface is separate from the existing L4 inference worker.

Current authority boundary:

- exact model: `Qwen/Qwen3.8-27B`
- exact immutable revision:
  `1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0`
- HF safetensors only
- `trust_remote_code=false`
- NF4 4-bit only
- 3-bit forbidden
- BF16 compute
- exactly one NVIDIA L4
- minimum CUDA compute capability 8.9
- text language-model LoRA targets only
- exact TRAIN and DEV SHA-256 verification
- final-holdout path/content forbidden
- PEFT adapter-only output
- base-model merge forbidden
- Hub push forbidden
- cloud provisioning is not performed
- production training is not started
- promotion/deployment authority is not granted

`dry-run` performs contract/data validation only.

`container-preflight` additionally checks the installed training stack and
the exact CUDA/GPU runtime.

`execute` intentionally fails closed with:

`PRODUCTION_EXECUTION_GATE_NOT_WIRED`

Production execution must remain unreachable until a verified single-use
launch capability is consumed at the trusted runtime boundary.

The training base image must be supplied by immutable image digest.
Canonical production evidence must not depend on floating image tags or
runtime package installation.