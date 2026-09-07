"""Durably retain and bind an A234 v6 launch-gate receipt.

Additive successor to the v5 receipt wrapper. Binds the exact SHA256 of the
A234 v6 runner, stage_contract_prompts_v4, semantic_patch_intent_v2,
candidate_host_binding_v1, context_budget_v2, canonical A1 input,
adapter config/weights, candidate v6 final seal, E2E synthetic smoke summary,
and preserved v2/v3/v5 evidence.

Enforces a fail-closed pre-delegation gate that re-reads runner bytes and
asserts marker/output non-existence immediately before execution.
Never executes inference or loads model weights during receipt creation.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any, Callable, Mapping
import uuid

SCHEMA = "fulgor.a234_launch_receipt.v6"
GATE_SCHEMA = "fulgor.a234_gpu_launch_preflight.v6"

RUNNER_NAME = "run_fulgor_v3_0_a234_dev30_inference_v6.py"
RUNNER_SHA256 = "5dacaef8f7d9f1c0658cfe4abe5c024fb9d38db84a4c8392fd2a984421d9395b"

STAGE_CONTRACT_PROMPTS_V4_NAME = "training/fulgor_ray_v3/stage_contract_prompts_v4.py"
STAGE_CONTRACT_PROMPTS_V4_SHA256 = "a66bf49189e7c2857fe495ec36119bea119ac1caf2f965883336eb86916adf9b"

SEMANTIC_PATCH_INTENT_V2_NAME = "training/fulgor_ray_v3/semantic_patch_intent_v2.py"
SEMANTIC_PATCH_INTENT_V2_SHA256 = "31a6f04f87a37e240ac1bb85692f61b8c26e44221ff39035697e5c70d01a1709"

CANDIDATE_HOST_BINDING_V1_NAME = "training/fulgor_ray_v3/candidate_host_binding_v1.py"
CANDIDATE_HOST_BINDING_V1_SHA256 = "b5a7fc331798892bbd14bdad443e9203e3a1596b5f6cc69209f300359eb2386c"

CONTEXT_BUDGET_V2_NAME = "training/fulgor_ray_v3/context_budget_v2.py"
CONTEXT_BUDGET_V2_SHA256 = "da9ae0af2ed057287660abf820d31b4bed869b89d97a38db53ba9d9680f3374c"

CANONICAL_A1_INPUT_NAME = "training/eval/fulgor_ray_v3/dev30_v1/a1_repository_prep_v1/canonical_a1_input.jsonl"
CANONICAL_A1_INPUT_SHA256 = "78024804618ba6d5997f1aba8928ad4e33f4bf8cbc03e845de57077f7f366d0a"

ADAPTER_CONFIG_NAME = "training/runs/fulgor_ray_v2_9_stability_closure_replay24_gemma12b_lr5e7_1ep_run1/final_adapter/adapter_config.json"
ADAPTER_CONFIG_SHA256 = "3fd41b547e513bbdcde1bf961cd912963ed9f2be30e6c10964145bf1e0120a02"

ADAPTER_WEIGHTS_NAME = "training/runs/fulgor_ray_v2_9_stability_closure_replay24_gemma12b_lr5e7_1ep_run1/final_adapter/adapter_model.safetensors"
ADAPTER_WEIGHTS_SHA256 = "4586bdcd92e84cb88f5d4bc911a69a60b2460d59b3322bd90bf9d96d52e9ea6e"

CANDIDATE_V6_SEAL_NAME = "training/reports/fulgor_ray_v3_0_a234_candidate_v6_final_seal.txt"
CANDIDATE_V6_SEAL_SHA256 = "bb68569cdbafacd737d4efe48e2fadc8de1c740fbde74b2498551661ac136fb3"

E2E_SYNTHETIC_SMOKE_SUMMARY_NAME = "training/synthetic_smoke/fulgor_ray_v3/a234_v6_e2e/summary.json"
E2E_SYNTHETIC_SMOKE_SUMMARY_SHA256 = "ed09f5313d0ddf7754ad913579773282ec01622f75e5fb9f1fe4270a8e0c1f01"

V5_ATTEMPT_MARKER_NAME = "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v5/.CANONICAL_V3_A234_DEV30_INFERENCE_V5_ATTEMPTED"
V5_ATTEMPT_MARKER_SHA256 = "4b0d575ef1db040fd0b149b2b286b43dad334dac259111e7f5ae12274ce748b9"

V5_RESULTS_NAME = "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v5/a234_hardened_v2_9_v5/results.jsonl"
V5_RESULTS_SHA256 = "40bbaf72edf7856aa015ec55cbf25f32ef0bbc3b8e3226939a5256cdaaea568d"

V3_ATTEMPT_MARKER_NAME = "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v3/.CANONICAL_V3_A234_DEV30_INFERENCE_V3_ATTEMPTED"
V3_ATTEMPT_MARKER_SHA256 = "ba7ece51a8404c16db68dc9eaea8c29c074b219ce84ee9c25ba00e64b49ae849"

V3_RESULTS_NAME = "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v3/a234_hardened_v2_9_v3/results.jsonl"
V3_RESULTS_SHA256 = "4b3ec53f406375d54e8aa2f5c7eaa04d2ba1b9dd87eb21430db89f13688dba18"

V2_ATTEMPT_MARKER_NAME = "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v2/.CANONICAL_V3_A234_DEV30_INFERENCE_V2_ATTEMPTED"
V2_ATTEMPT_MARKER_SHA256 = "98636f5d53597d74f7a8da520daf94545f1edea3d41714d94e3cf3525cdaa170"

V2_RESULTS_NAME = "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v2/a234_hardened_v2_9_v2/results.jsonl"
V2_RESULTS_SHA256 = "95c65877ed3137f8b840d7e0dc2dd3efad62b608f124ac6f1baa4237d0a96520"

BASE_MODEL = "google/gemma-4-12B-it"
MODEL_REVISION = "707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7"

RECEIPT_DIR_RELATIVE = Path(
    "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/launch_receipts_v6"
)
V6_MARKER_RELATIVE = Path(
    "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/.CANONICAL_V3_A234_DEV30_INFERENCE_V6_ATTEMPTED"
)
V6_OUTPUT_RELATIVE = Path(
    "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/a234_hardened_v2_9_v6"
)
V6_RESULTS_RELATIVE = Path(
    "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/a234_hardened_v2_9_v6/results.jsonl"
)

MIN_GPU_MEMORY_BYTES = 30 * 1024**3
MIN_DISK_FREE_BYTES = 10 * 1024**3


class LaunchReceiptError(RuntimeError):
    """A launch receipt cannot safely be written, reused, or executed."""


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _cache_root() -> Path:
    base = os.environ.get("HF_HUB_CACHE")
    if base:
        return Path(base)
    xdg = os.environ.get("HF_HOME")
    if xdg:
        return Path(xdg) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _model_snapshot() -> Path:
    return (
        _cache_root()
        / f"models--{BASE_MODEL.replace('/', '--')}"
        / "snapshots"
        / MODEL_REVISION
    )


def _regular_resolved_file(path: Path) -> bool:
    try:
        return path.exists() and path.resolve(strict=True).is_file()
    except (OSError, RuntimeError):
        return False


def _safe_directory_chain(root: Path, directory: Path) -> None:
    try:
        relative = directory.relative_to(root)
    except ValueError as exc:
        raise LaunchReceiptError("receipt directory escapes repository root") from exc
    if root.is_symlink() or not root.is_dir():
        raise LaunchReceiptError("unsafe repository root")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            raise LaunchReceiptError("unsafe receipt directory ancestry")


def _runner_digest(root: Path) -> str:
    runner = root / RUNNER_NAME
    if runner.is_symlink() or not runner.is_file():
        raise LaunchReceiptError("sealed v6 runner is unavailable")
    digest = _sha_file(runner)
    if digest != RUNNER_SHA256:
        raise LaunchReceiptError("sealed runner digest does not match the pinned v6 runner")
    return digest


def probe_environment() -> dict:
    env = {
        "python_version": sys.version.split()[0],
        "import_ok": False,
        "torch_version": None,
        "transformers_version": None,
        "peft_version": None,
        "cuda_available": False,
        "device_count": 0,
        "device_name": None,
        "bf16_supported": False,
        "gpu_0_total_bytes": 0,
    }
    try:
        import torch
        env["torch_version"] = torch.__version__
        env["cuda_available"] = bool(torch.cuda.is_available())
        if env["cuda_available"]:
            env["device_count"] = int(torch.cuda.device_count())
            env["device_name"] = str(torch.cuda.get_device_name(0))
            env["bf16_supported"] = bool(torch.cuda.is_bf16_supported())
            env["gpu_0_total_bytes"] = int(torch.cuda.get_device_properties(0).total_memory)
        env["import_ok"] = True
    except Exception as exc:
        env["error_torch"] = type(exc).__name__

    try:
        import transformers
        env["transformers_version"] = transformers.__version__
    except Exception as exc:
        env["error_transformers"] = type(exc).__name__

    try:
        import peft
        env["peft_version"] = peft.__version__
    except Exception as exc:
        env["error_peft"] = type(exc).__name__

    return env


def probe_tokenizer_accounting(local_files_only: bool = True) -> dict:
    """Tokenizer-only safety verification without loading model weights."""
    try:
        from transformers import AutoTokenizer
        from training.fulgor_ray_v3.context_budget_v2 import tokenize_chat_prompt, hash_token_ids
    except Exception as exc:
        return {"probe_passed": False, "error": str(exc)}

    try:
        tok = AutoTokenizer.from_pretrained(
            BASE_MODEL, revision=MODEL_REVISION, local_files_only=local_files_only
        )
        synthetic_messages = [
            {"role": "system", "content": "Return only strict JSON matching fulgor.diagnosis.v1; no diff."},
            {"role": "user", "content": json.dumps({"problem": "receipt safety probe", "repository_files": ["a.py"]}, sort_keys=True)},
        ]
        batch_canon, budget_tokens, budget_hash = tokenize_chat_prompt(tok, synthetic_messages)
        batch_prod = tok.apply_chat_template(
            synthetic_messages,
            tokenize=True,
            add_generation_prompt=True,
            enable_thinking=False,
            return_tensors="pt",
            return_dict=True,
        )
        prod_tokens = int(batch_prod["input_ids"].shape[-1])
        prod_hash = hash_token_ids(batch_prod["input_ids"])

        plain = tok.apply_chat_template(
            synthetic_messages,
            tokenize=True,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        naive_len = len(plain)
        is_batchencoding = type(plain).__name__ == "BatchEncoding"

        passed = (
            budget_tokens == prod_tokens
            and budget_hash == prod_hash
            and is_batchencoding
            and naive_len == 2
            and budget_tokens > 2
        )

        return {
            "probe_passed": passed,
            "batchencoding_detected": is_batchencoding,
            "naive_len_batch": naive_len,
            "canonical_budget_tokens": budget_tokens,
            "production_tensor_tokens": prod_tokens,
            "token_ids_sha256": budget_hash,
            "tokens_match": budget_tokens == prod_tokens,
            "hashes_match": budget_hash == prod_hash,
        }
    except Exception as exc:
        return {"probe_passed": False, "error": str(exc)}


def probe_candidate_seal(root: Path) -> dict:
    seal_path = root / CANDIDATE_V6_SEAL_NAME
    if not seal_path.is_file() or seal_path.is_symlink():
        return {"probe_passed": False, "error": "seal_missing_or_symlink"}
    actual_seal_hash = _sha_file(seal_path)
    if actual_seal_hash != CANDIDATE_V6_SEAL_SHA256:
        return {"probe_passed": False, "error": f"seal_hash_mismatch: {actual_seal_hash}"}

    verified = 0
    total_members = 0
    with seal_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("["):
                continue
            if " = " in line:
                total_members += 1
                rel_path_str, exp_sha = line.split(" = ", 1)
                rel_path_str = rel_path_str.strip()
                exp_sha = exp_sha.strip()
                target_path = root / rel_path_str
                if not target_path.is_file() or target_path.is_symlink():
                    return {"probe_passed": False, "error": f"missing_member: {rel_path_str}"}
                member_sha = _sha_file(target_path)
                if member_sha != exp_sha:
                    return {"probe_passed": False, "error": f"member_sha_mismatch: {rel_path_str}"}
                verified += 1

    if total_members != 21 or verified != 21:
        return {"probe_passed": False, "error": f"expected_21_members_got_{verified}"}

    return {
        "probe_passed": True,
        "seal_sha256": actual_seal_hash,
        "members_verified": verified,
    }


def probe_synthetic_smoke(root: Path) -> dict:
    smoke_path = root / E2E_SYNTHETIC_SMOKE_SUMMARY_NAME
    if not smoke_path.is_file() or smoke_path.is_symlink():
        return {"probe_passed": False, "error": "missing_or_symlink"}
    actual_hash = _sha_file(smoke_path)
    if actual_hash != E2E_SYNTHETIC_SMOKE_SUMMARY_SHA256:
        return {"probe_passed": False, "error": f"hash_mismatch: {actual_hash}"}
    try:
        data = json.loads(smoke_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"probe_passed": False, "error": f"json_error: {exc}"}

    if data.get("status") != "PASS_A234_V6_E2E_SYNTHETIC_SMOKE":
        return {"probe_passed": False, "error": f"status_not_pass: {data.get('status')}"}

    conds = data.get("conditions", {})
    counts = data.get("counts", {})

    if conds.get("dev30_accessed") is not False:
        return {"probe_passed": False, "error": "dev30_accessed_not_false"}
    if conds.get("training_started") is not False:
        return {"probe_passed": False, "error": "training_started_not_false"}
    if conds.get("a4_executed") is not False:
        return {"probe_passed": False, "error": "a4_executed_not_false"}
    if data.get("calls_made", 0) > 8:
        return {"probe_passed": False, "error": f"calls_made_exceeded: {data.get('calls_made')}"}
    if conds.get("diagnosis_strict_parse") is not True:
        return {"probe_passed": False, "error": "diagnosis_strict_parse_not_true"}
    if conds.get("diagnosis_target_membership") is not True:
        return {"probe_passed": False, "error": "diagnosis_target_membership_not_true"}
    if conds.get("plan_strict_parse") is not True:
        return {"probe_passed": False, "error": "plan_strict_parse_not_true"}
    if counts.get("selectable_count") != 3 or conds.get("candidate_intents_parsed_count") != 3:
        return {"probe_passed": False, "error": "candidate_intents_not_3"}
    if counts.get("host_bound_count", 0) < 1:
        return {"probe_passed": False, "error": "host_bound_count_zero"}
    if counts.get("serialized_count", 0) < 1:
        return {"probe_passed": False, "error": "serialized_count_zero"}
    if counts.get("gate_evaluated_count", 0) < 1:
        return {"probe_passed": False, "error": "gate_evaluated_count_zero"}
    if counts.get("gate_accepted_count", 0) < 1:
        return {"probe_passed": False, "error": "gate_accepted_count_zero"}
    if counts.get("verifier_invoked_count", 0) < 1:
        return {"probe_passed": False, "error": "verifier_invoked_count_zero"}
    if counts.get("verifier_parse_count", 0) < 1:
        return {"probe_passed": False, "error": "verifier_parse_count_zero"}
    if conds.get("selected_primary_not_none") is not True:
        return {"probe_passed": False, "error": "selected_primary_not_none_false"}

    return {
        "probe_passed": True,
        "summary_sha256": actual_hash,
        "status": data.get("status"),
        "calls_made": data.get("calls_made"),
        "selectable_count": counts.get("selectable_count"),
        "gate_accepted_count": counts.get("gate_accepted_count"),
        "primary_selected": conds.get("selected_primary_not_none"),
    }


def evaluate_gate(
    root: Path,
    *,
    env_probe: Callable[[], dict] = probe_environment,
    tok_probe: Callable[[], dict] = probe_tokenizer_accounting,
    seal_probe: Callable[[Path], dict] = probe_candidate_seal,
    smoke_probe: Callable[[Path], dict] = probe_synthetic_smoke,
) -> dict:
    root = Path(root).resolve()
    runner = root / RUNNER_NAME
    stage_prompts_v4 = root / STAGE_CONTRACT_PROMPTS_V4_NAME
    semantic_intent_v2 = root / SEMANTIC_PATCH_INTENT_V2_NAME
    host_binding_v1 = root / CANDIDATE_HOST_BINDING_V1_NAME
    budget_v2 = root / CONTEXT_BUDGET_V2_NAME
    a1_input = root / CANONICAL_A1_INPUT_NAME
    adapter_cfg = root / ADAPTER_CONFIG_NAME
    adapter_wts = root / ADAPTER_WEIGHTS_NAME
    v5_marker = root / V5_ATTEMPT_MARKER_NAME
    v5_results = root / V5_RESULTS_NAME
    v3_marker = root / V3_ATTEMPT_MARKER_NAME
    v3_results = root / V3_RESULTS_NAME
    v2_marker = root / V2_ATTEMPT_MARKER_NAME
    v2_results = root / V2_RESULTS_NAME
    v6_marker = root / V6_MARKER_RELATIVE
    v6_output = root / V6_OUTPUT_RELATIVE
    v6_results = root / V6_RESULTS_RELATIVE

    snapshot = _model_snapshot()
    model_files = (
        "config.json",
        "generation_config.json",
        "model.safetensors",
        "tokenizer.json",
        "tokenizer_config.json",
    )

    env = env_probe()
    tok = tok_probe()
    seal_info = seal_probe(root)
    smoke_info = smoke_probe(root)

    try:
        disk_free = shutil.disk_usage(root).free
    except OSError:
        disk_free = 0

    checks = {
        "workspace_root_safe": root.is_dir() and not root.is_symlink(),
        "runner_v6_hash": runner.is_file() and not runner.is_symlink() and _sha_file(runner) == RUNNER_SHA256,
        "stage_contract_prompts_v4_hash": stage_prompts_v4.is_file() and not stage_prompts_v4.is_symlink() and _sha_file(stage_prompts_v4) == STAGE_CONTRACT_PROMPTS_V4_SHA256,
        "semantic_patch_intent_v2_hash": semantic_intent_v2.is_file() and not semantic_intent_v2.is_symlink() and _sha_file(semantic_intent_v2) == SEMANTIC_PATCH_INTENT_V2_SHA256,
        "candidate_host_binding_v1_hash": host_binding_v1.is_file() and not host_binding_v1.is_symlink() and _sha_file(host_binding_v1) == CANDIDATE_HOST_BINDING_V1_SHA256,
        "context_budget_v2_hash": budget_v2.is_file() and not budget_v2.is_symlink() and _sha_file(budget_v2) == CONTEXT_BUDGET_V2_SHA256,
        "canonical_a1_input_hash": a1_input.is_file() and not a1_input.is_symlink() and _sha_file(a1_input) == CANONICAL_A1_INPUT_SHA256,
        "adapter_config_hash": adapter_cfg.is_file() and not adapter_cfg.is_symlink() and _sha_file(adapter_cfg) == ADAPTER_CONFIG_SHA256,
        "adapter_weights_hash": adapter_wts.is_file() and not adapter_wts.is_symlink() and _sha_file(adapter_wts) == ADAPTER_WEIGHTS_SHA256,
        "candidate_v6_seal_verified": seal_info.get("probe_passed") is True,
        "e2e_synthetic_smoke_summary_verified": smoke_info.get("probe_passed") is True,
        "v5_marker_preserved": v5_marker.is_file() and not v5_marker.is_symlink() and _sha_file(v5_marker) == V5_ATTEMPT_MARKER_SHA256,
        "v5_results_preserved": v5_results.is_file() and not v5_results.is_symlink() and _sha_file(v5_results) == V5_RESULTS_SHA256,
        "v3_marker_preserved": v3_marker.is_file() and not v3_marker.is_symlink() and _sha_file(v3_marker) == V3_ATTEMPT_MARKER_SHA256,
        "v3_results_preserved": v3_results.is_file() and not v3_results.is_symlink() and _sha_file(v3_results) == V3_RESULTS_SHA256,
        "v2_marker_preserved": v2_marker.is_file() and not v2_marker.is_symlink() and _sha_file(v2_marker) == V2_ATTEMPT_MARKER_SHA256,
        "v2_results_preserved": v2_results.is_file() and not v2_results.is_symlink() and _sha_file(v2_results) == V2_RESULTS_SHA256,
        "v6_marker_absent": not v6_marker.exists() and not v6_marker.is_symlink(),
        "v6_output_absent": not v6_output.exists() and not v6_output.is_symlink(),
        "v6_results_absent": not v6_results.exists() and not v6_results.is_symlink(),
        "output_parent_safe": True,
        "pinned_model_snapshot_complete": snapshot.is_dir() and not snapshot.is_symlink() and all(
            _regular_resolved_file(snapshot / name) for name in model_files
        ),
        "cuda_available": env.get("cuda_available") is True,
        "bf16_supported": env.get("bf16_supported") is True,
        "gpu_memory_sufficient": type(env.get("gpu_0_total_bytes")) is int and env["gpu_0_total_bytes"] >= MIN_GPU_MEMORY_BYTES,
        "disk_free_sufficient": disk_free >= MIN_DISK_FREE_BYTES,
        "tokenizer_accounting_passed": tok.get("probe_passed") is True,
    }

    try:
        check_parent = v6_marker.parent if v6_marker.parent.exists() else v6_marker.parent.parent
        _safe_directory_chain(root, check_parent)
    except LaunchReceiptError:
        checks["output_parent_safe"] = False

    ready = all(checks.values())
    body = {
        "schema": GATE_SCHEMA,
        "status": "READY" if ready else "NOT_READY",
        "checks": checks,
        "environment": env,
        "tokenizer_probe": tok,
        "candidate_v6_seal_probe": seal_info,
        "synthetic_smoke_probe": smoke_info,
        "model_revision": MODEL_REVISION,
        "model_snapshot": str(snapshot),
        "runner_name": RUNNER_NAME,
        "runner_sha256": RUNNER_SHA256,
        "stage_contract_prompts_v4_sha256": STAGE_CONTRACT_PROMPTS_V4_SHA256,
        "semantic_patch_intent_v2_sha256": SEMANTIC_PATCH_INTENT_V2_SHA256,
        "candidate_host_binding_v1_sha256": CANDIDATE_HOST_BINDING_V1_SHA256,
        "context_budget_v2_sha256": CONTEXT_BUDGET_V2_SHA256,
        "candidate_v6_seal_sha256": CANDIDATE_V6_SEAL_SHA256,
        "e2e_synthetic_smoke_summary_sha256": E2E_SYNTHETIC_SMOKE_SUMMARY_SHA256,
        "v6_marker_path": str(V6_MARKER_RELATIVE),
        "v6_output_path": str(V6_OUTPUT_RELATIVE),
        "v6_results_path": str(V6_RESULTS_RELATIVE),
        "disk_free_bytes": disk_free,
        "inference_executed": False,
        "marker_written": False,
        "training_started": False,
        "dev30_only": True,
        "next_command": (
            "python3 run_fulgor_v3_0_a234_launch_receipt_v6.py --run" if ready else None
        ),
    }
    return {**body, "receipt_sha256": _sha_bytes(_canonical(body))}


def make_record(root: Path, gate_receipt: Mapping[str, object], nonce: str | None = None) -> dict:
    root = Path(root).resolve()
    stated_gate_hash = gate_receipt.get("receipt_sha256")
    body_gate = dict(gate_receipt)
    body_gate.pop("receipt_sha256", None)
    calc_gate_hash = _sha_bytes(_canonical(body_gate))
    if stated_gate_hash != calc_gate_hash:
        raise LaunchReceiptError("gate receipt hash mismatch")
    if gate_receipt.get("inference_executed") is not False or gate_receipt.get("marker_written") is not False:
        raise LaunchReceiptError("gate receipt has unsafe side-effect flags")

    runner_sha256 = _runner_digest(root)
    receipt_id = nonce if nonce is not None else str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()

    body = {
        "schema": SCHEMA,
        "gate_schema": GATE_SCHEMA,
        "status": gate_receipt["status"],
        "timestamp_utc": ts,
        "receipt_id": receipt_id,
        "gate_receipt": dict(gate_receipt),
        "gate_receipt_sha256": stated_gate_hash,
        "runner_name": RUNNER_NAME,
        "runner_v6_sha256": runner_sha256,
        "stage_contract_prompts_v4_sha256": STAGE_CONTRACT_PROMPTS_V4_SHA256,
        "semantic_patch_intent_v2_sha256": SEMANTIC_PATCH_INTENT_V2_SHA256,
        "candidate_host_binding_v1_sha256": CANDIDATE_HOST_BINDING_V1_SHA256,
        "context_budget_v2_sha256": CONTEXT_BUDGET_V2_SHA256,
        "canonical_a1_input_sha256": CANONICAL_A1_INPUT_SHA256,
        "adapter_config_sha256": ADAPTER_CONFIG_SHA256,
        "adapter_weights_sha256": ADAPTER_WEIGHTS_SHA256,
        "candidate_v6_seal_sha256": CANDIDATE_V6_SEAL_SHA256,
        "e2e_synthetic_smoke_summary_sha256": E2E_SYNTHETIC_SMOKE_SUMMARY_SHA256,
        "v5_marker_sha256": V5_ATTEMPT_MARKER_SHA256,
        "v5_results_sha256": V5_RESULTS_SHA256,
        "v3_marker_sha256": V3_ATTEMPT_MARKER_SHA256,
        "v3_results_sha256": V3_RESULTS_SHA256,
        "v2_marker_sha256": V2_ATTEMPT_MARKER_SHA256,
        "v2_results_sha256": V2_RESULTS_SHA256,
        "base_model": BASE_MODEL,
        "base_revision": MODEL_REVISION,
        "model_snapshot_path": str(_model_snapshot()),
        "v6_marker_path": str(V6_MARKER_RELATIVE),
        "v6_output_path": str(V6_OUTPUT_RELATIVE),
        "v6_results_path": str(V6_RESULTS_RELATIVE),
        "inference_started_by_wrapper": False,
        "marker_written_by_wrapper": False,
        "training_started": False,
        "dev30_only": True,
        "candidate_budget": 3,
        "feedback_budget": 1,
    }
    return {**body, "record_sha256": _sha_bytes(_canonical(body))}


def validate_record(record: Mapping[str, object], *, require_ready: bool = False) -> dict:
    if record.get("schema") != SCHEMA or record.get("gate_schema") != GATE_SCHEMA:
        raise LaunchReceiptError("unexpected launch receipt schema")
    body = dict(record)
    stated_hash = body.pop("record_sha256", None)
    if not isinstance(stated_hash, str) or stated_hash != _sha_bytes(_canonical(body)):
        raise LaunchReceiptError("launch receipt record hash mismatch")

    gate_receipt = record.get("gate_receipt")
    if not isinstance(gate_receipt, Mapping):
        raise LaunchReceiptError("launch receipt lacks gate receipt")
    stated_gate_hash = gate_receipt.get("receipt_sha256")
    body_gate = dict(gate_receipt)
    body_gate.pop("receipt_sha256", None)
    calc_gate_hash = _sha_bytes(_canonical(body_gate))
    if stated_gate_hash != calc_gate_hash:
        raise LaunchReceiptError("launch receipt embedded gate hash mismatch")

    if record.get("gate_receipt_sha256") != stated_gate_hash:
        raise LaunchReceiptError("launch receipt gate binding mismatch")
    if record.get("status") != gate_receipt.get("status"):
        raise LaunchReceiptError("launch receipt status binding mismatch")
    if record.get("runner_name") != RUNNER_NAME or record.get("runner_v6_sha256") != RUNNER_SHA256:
        raise LaunchReceiptError("launch receipt runner binding mismatch")
    if record.get("stage_contract_prompts_v4_sha256") != STAGE_CONTRACT_PROMPTS_V4_SHA256:
        raise LaunchReceiptError("launch receipt stage contract binding mismatch")
    if record.get("semantic_patch_intent_v2_sha256") != SEMANTIC_PATCH_INTENT_V2_SHA256:
        raise LaunchReceiptError("launch receipt semantic intent binding mismatch")
    if record.get("candidate_host_binding_v1_sha256") != CANDIDATE_HOST_BINDING_V1_SHA256:
        raise LaunchReceiptError("launch receipt host binding mismatch")
    if record.get("context_budget_v2_sha256") != CONTEXT_BUDGET_V2_SHA256:
        raise LaunchReceiptError("launch receipt context budget binding mismatch")
    if record.get("canonical_a1_input_sha256") != CANONICAL_A1_INPUT_SHA256:
        raise LaunchReceiptError("launch receipt canonical input binding mismatch")
    if record.get("adapter_config_sha256") != ADAPTER_CONFIG_SHA256:
        raise LaunchReceiptError("launch receipt adapter config binding mismatch")
    if record.get("adapter_weights_sha256") != ADAPTER_WEIGHTS_SHA256:
        raise LaunchReceiptError("launch receipt adapter weights binding mismatch")
    if record.get("candidate_v6_seal_sha256") != CANDIDATE_V6_SEAL_SHA256:
        raise LaunchReceiptError("launch receipt candidate seal binding mismatch")
    if record.get("e2e_synthetic_smoke_summary_sha256") != E2E_SYNTHETIC_SMOKE_SUMMARY_SHA256:
        raise LaunchReceiptError("launch receipt synthetic smoke binding mismatch")
    if record.get("v5_marker_sha256") != V5_ATTEMPT_MARKER_SHA256 or record.get("v5_results_sha256") != V5_RESULTS_SHA256:
        raise LaunchReceiptError("launch receipt v5 evidence binding mismatch")
    if record.get("v3_marker_sha256") != V3_ATTEMPT_MARKER_SHA256 or record.get("v3_results_sha256") != V3_RESULTS_SHA256:
        raise LaunchReceiptError("launch receipt v3 evidence binding mismatch")
    if record.get("v2_marker_sha256") != V2_ATTEMPT_MARKER_SHA256 or record.get("v2_results_sha256") != V2_RESULTS_SHA256:
        raise LaunchReceiptError("launch receipt v2 evidence binding mismatch")
    if record.get("inference_started_by_wrapper") is not False or record.get("marker_written_by_wrapper") is not False:
        raise LaunchReceiptError("launch receipt has unsafe wrapper flags")
    if require_ready and record["status"] != "READY":
        raise LaunchReceiptError("launch receipt is not READY")
    return dict(record)


def persist_record(
    root: Path, record: Mapping[str, object], *, receipt_dir: Path | None = None
) -> Path:
    root = Path(root).resolve()
    target_dir = Path(receipt_dir) if receipt_dir is not None else root / RECEIPT_DIR_RELATIVE
    _safe_directory_chain(root, target_dir.parent)
    validate_record(record)
    target_dir.mkdir(parents=True, exist_ok=True)
    _safe_directory_chain(root, target_dir)

    payload = _canonical(dict(record)) + b"\n"
    target = target_dir / ("launch-receipt-" + record["record_sha256"] + ".json")
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_file() or target.read_bytes() != payload:
            raise LaunchReceiptError("existing receipt path conflicts with immutable evidence")
        return target

    fd = None
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb", closefd=True) as handle:
            fd = None
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        directory_fd = os.open(target_dir, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except FileExistsError:
        if target.is_file() and not target.is_symlink() and target.read_bytes() == payload:
            return target
        raise LaunchReceiptError("receipt publication raced with conflicting evidence")
    finally:
        if fd is not None:
            os.close(fd)
    return target


def read_record(path: Path, *, require_ready: bool = False) -> dict:
    if path.is_symlink() or not path.is_file():
        raise LaunchReceiptError("unsafe receipt file")
    try:
        value = json.loads(path.read_bytes())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LaunchReceiptError("invalid receipt JSON") from exc
    if not isinstance(value, Mapping):
        raise LaunchReceiptError("receipt is not an object")
    return validate_record(value, require_ready=require_ready)


def record_gate(
    root: Path,
    *,
    gate_fn: Callable[[Path], dict] = evaluate_gate,
    receipt_dir: Path | None = None,
) -> tuple[dict, Path]:
    root = Path(root).resolve()
    record = make_record(root, gate_fn(root))
    return record, persist_record(root, record, receipt_dir=receipt_dir)


def launch_after_record(
    root: Path,
    record_path: Path,
    executor: Callable[[list[str]], int] | None = None,
) -> int:
    """Delegate only after verifying durable READY record and immediate pre-run state."""
    root = Path(root).resolve()
    record_path = Path(record_path)
    expected_parent = root / RECEIPT_DIR_RELATIVE
    _safe_directory_chain(root, expected_parent)
    try:
        record_path.relative_to(expected_parent)
    except ValueError as exc:
        raise LaunchReceiptError("receipt path escapes controlled receipt directory") from exc

    # 1. Validate the persisted record from disk
    read_record(record_path, require_ready=True)

    # 2. Immediate pre-delegation rechecks:
    # A. Runner bytes rechecked
    _runner_digest(root)

    # B. Stage contract prompts v4 bytes rechecked
    stage_prompts_path = root / STAGE_CONTRACT_PROMPTS_V4_NAME
    if not stage_prompts_path.is_file() or _sha_file(stage_prompts_path) != STAGE_CONTRACT_PROMPTS_V4_SHA256:
        raise LaunchReceiptError("stage_contract_prompts_v4 digest changed before delegation")

    # C. Semantic patch intent v2 bytes rechecked
    semantic_intent_path = root / SEMANTIC_PATCH_INTENT_V2_NAME
    if not semantic_intent_path.is_file() or _sha_file(semantic_intent_path) != SEMANTIC_PATCH_INTENT_V2_SHA256:
        raise LaunchReceiptError("semantic_patch_intent_v2 digest changed before delegation")

    # D. Candidate host binding v1 bytes rechecked
    host_binding_path = root / CANDIDATE_HOST_BINDING_V1_NAME
    if not host_binding_path.is_file() or _sha_file(host_binding_path) != CANDIDATE_HOST_BINDING_V1_SHA256:
        raise LaunchReceiptError("candidate_host_binding_v1 digest changed before delegation")

    # E. Context budget v2 bytes rechecked
    budget_path = root / CONTEXT_BUDGET_V2_NAME
    if not budget_path.is_file() or _sha_file(budget_path) != CONTEXT_BUDGET_V2_SHA256:
        raise LaunchReceiptError("context_budget_v2 digest changed before delegation")

    # F. Canonical input bytes rechecked
    input_path = root / CANONICAL_A1_INPUT_NAME
    if not input_path.is_file() or _sha_file(input_path) != CANONICAL_A1_INPUT_SHA256:
        raise LaunchReceiptError("canonical_a1_input digest changed before delegation")

    # G. Adapter config & weights rechecked
    cfg_path = root / ADAPTER_CONFIG_NAME
    if not cfg_path.is_file() or _sha_file(cfg_path) != ADAPTER_CONFIG_SHA256:
        raise LaunchReceiptError("adapter_config digest changed before delegation")
    wts_path = root / ADAPTER_WEIGHTS_NAME
    if not wts_path.is_file() or _sha_file(wts_path) != ADAPTER_WEIGHTS_SHA256:
        raise LaunchReceiptError("adapter_weights digest changed before delegation")

    # H. Candidate seal bytes rechecked
    seal_path = root / CANDIDATE_V6_SEAL_NAME
    if not seal_path.is_file() or _sha_file(seal_path) != CANDIDATE_V6_SEAL_SHA256:
        raise LaunchReceiptError("candidate_v6_seal digest changed before delegation")

    # I. E2E synthetic smoke summary bytes rechecked
    smoke_path = root / E2E_SYNTHETIC_SMOKE_SUMMARY_NAME
    if not smoke_path.is_file() or _sha_file(smoke_path) != E2E_SYNTHETIC_SMOKE_SUMMARY_SHA256:
        raise LaunchReceiptError("e2e_synthetic_smoke summary digest changed before delegation")

    # 8. Recheck historical evidence hashes
    for hist_path_rel, exp_sha in [
        (V5_ATTEMPT_MARKER_NAME, V5_ATTEMPT_MARKER_SHA256),
        (V5_RESULTS_NAME, V5_RESULTS_SHA256),
        (V3_ATTEMPT_MARKER_NAME, V3_ATTEMPT_MARKER_SHA256),
        (V3_RESULTS_NAME, V3_RESULTS_SHA256),
        (V2_ATTEMPT_MARKER_NAME, V2_ATTEMPT_MARKER_SHA256),
        (V2_RESULTS_NAME, V2_RESULTS_SHA256),
    ]:
        hp = root / hist_path_rel
        if not hp.is_file() or _sha_file(hp) != exp_sha:
            raise LaunchReceiptError(f"historical evidence {hist_path_rel} changed before delegation")

    # 9. Recheck V6 marker/output/results absence
    marker_path = root / V6_MARKER_RELATIVE
    if marker_path.exists() or marker_path.is_symlink():
        raise LaunchReceiptError("v6 attempt marker appeared before delegation")

    results_path = root / V6_RESULTS_RELATIVE
    if results_path.exists() or results_path.is_symlink():
        raise LaunchReceiptError("v6 results file appeared before delegation")

    output_path = root / V6_OUTPUT_RELATIVE
    if output_path.exists() or output_path.is_symlink():
        raise LaunchReceiptError("v6 output directory appeared before delegation")

    # 10. Recheck candidate seal manifest
    seal_res = probe_candidate_seal(root)
    if seal_res.get("probe_passed") is not True:
        raise LaunchReceiptError("candidate_v6_seal members changed before delegation")

    # 11. Recheck E2E summary structure
    smoke_res = probe_synthetic_smoke(root)
    if smoke_res.get("probe_passed") is not True:
        raise LaunchReceiptError("e2e_synthetic_smoke summary structure changed before delegation")

    command = [sys.executable, str(root / RUNNER_NAME), "--run"]
    if executor is not None:
        return executor(command)
    return subprocess.run(command, check=False).returncode

