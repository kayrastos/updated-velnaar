#!/usr/bin/env python3
"""Fulgor Ray V3.0 A234 DEV30 inference runner v6 (additive successor).

Key additions over v5:
- Integrates model-facing semantic_patch_intent.v2 schema decoupling LLM generation
  from cryptographic preimage hashing and anchor discovery.
- Integrates trusted candidate_host_binding_v1: derives canonical preimage SHA-256 and
  unique anchors directly from immutable repository bytes.
- Enforces closed-world diagnosis inventory validation: target_files MUST strictly belong
  to the supplied repository_files list before any repository file reads occur.
- Raises candidate generation token reserve to 2048 to prevent generation reserve exhaustion.
- Explicit root JSON closing contract (stage_contract_prompts_v4.py).
- Operates in independent inference_v6 namespace:
  training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6/
- Irreversible marker: .CANONICAL_V3_A234_DEV30_INFERENCE_V6_ATTEMPTED.
- Preserves v1/v2/v3/v4/v5 evidence and all existing sealed artifacts byte-for-byte.
- Fail-closed non-inferencing preflight gate.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, replace
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
from typing import Any, Callable, Mapping, Sequence, TypeVar

T = TypeVar("T")

ROOT = Path(__file__).resolve().parent

from training.fulgor_ray_v3.a1_inference import LocalRepositoryProvider
from training.fulgor_ray_v3.a234_inference import (
    A234ContractError,
    CandidateOutcome,
    SLOTS,
    SelectableCandidate,
    blind_id,
    canonical_hash,
    diversity_metrics,
    parse_diagnosis,
    parse_plan,
    parse_verifier,
    select_primary,
)
from training.fulgor_ray_v3.candidate_host_binding_v1 import (
    CandidateAnchorDerivationError,
    CandidateFileMembershipError,
    CandidateHostBindingError,
    CandidateLineSpanError,
    bind_candidate_intent_to_host_patch,
)
from training.fulgor_ray_v3.constants import CANDIDATE_BUDGET, MAX_FEEDBACK_REFINEMENTS
from training.fulgor_ray_v3.context_budget_v2 import (
    balanced_prefix_mapping,
    fit_designated_context_v2,
    prefix_items,
    prefix_text,
    tokenize_chat_prompt,
)
from training.fulgor_ray_v3.patch_serializer import SerializationError, serialize
from training.fulgor_ray_v3.schemas import (
    ContractError,
    DiagnosisV1,
    GateResult,
    NoPrimary,
    RepairPlanV1,
    SemanticPatchV1,
    SerializedPatchV1,
)
from training.fulgor_ray_v3.semantic_patch_intent_v2 import (
    SemanticIntentError,
    SemanticPatchIntentV2,
    parse_semantic_patch_intent,
)
from training.fulgor_ray_v3.stage_contract_prompts_v4 import (
    build_stage_messages,
    get_stage_system_prompt,
)
from training.fulgor_ray_v3.static_gate import evaluate
from training.fulgor_ray_v3.structured_output_recovery import (
    StructuredOutputRecoveryError,
    normalize_single_json_object,
)

SCHEMA = "fulgor.a234_gpu_runner.v6"
BASE = "google/gemma-4-12B-it"
BASE_REVISION = "707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7"
ADAPTER = ROOT / "training/runs/fulgor_ray_v2_9_stability_closure_replay24_gemma12b_lr5e7_1ep_run1/final_adapter"
ADAPTER_CONFIG = ADAPTER / "adapter_config.json"
ADAPTER_WEIGHTS = ADAPTER / "adapter_model.safetensors"
INPUT = ROOT / "training/eval/fulgor_ray_v3/dev30_v1/a1_repository_prep_v1/canonical_a1_input.jsonl"
BASE_OUTPUT = ROOT / "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v6"
OUTPUT = BASE_OUTPUT / "a234_hardened_v2_9_v6"
MARKER = BASE_OUTPUT / ".CANONICAL_V3_A234_DEV30_INFERENCE_V6_ATTEMPTED"
RESULTS = OUTPUT / "results.jsonl"
CONTEXT_WINDOW = 8192

# Existing sealed artifacts for byte-for-byte validation
SEALED_V1_RUNNER = ROOT / "run_fulgor_v3_0_a234_dev30_inference_v1.py"
SEALED_V2_RUNNER = ROOT / "run_fulgor_v3_0_a234_dev30_inference_v2.py"
SEALED_V3_RUNNER = ROOT / "run_fulgor_v3_0_a234_dev30_inference_v3.py"
SEALED_V4_RUNNER = ROOT / "run_fulgor_v3_0_a234_dev30_inference_v4.py"
SEALED_V5_RUNNER = ROOT / "run_fulgor_v3_0_a234_dev30_inference_v5.py"
CONTEXT_BUDGET_V2 = ROOT / "training/fulgor_ray_v3/context_budget_v2.py"
STAGE_PROMPTS_V3 = ROOT / "training/fulgor_ray_v3/stage_contract_prompts_v3.py"
STAGE_PROMPTS_V4 = ROOT / "training/fulgor_ray_v3/stage_contract_prompts_v4.py"
SEMANTIC_INTENT_V2 = ROOT / "training/fulgor_ray_v3/semantic_patch_intent_v2.py"
HOST_BINDING_V1 = ROOT / "training/fulgor_ray_v3/candidate_host_binding_v1.py"

V2_MARKER = ROOT / "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v2/.CANONICAL_V3_A234_DEV30_INFERENCE_V2_ATTEMPTED"
V2_RESULTS = ROOT / "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v2/a234_hardened_v2_9_v2/results.jsonl"
V3_MARKER = ROOT / "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v3/.CANONICAL_V3_A234_DEV30_INFERENCE_V3_ATTEMPTED"
V3_RESULTS = ROOT / "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v3/a234_hardened_v2_9_v3/results.jsonl"
V5_MARKER = ROOT / "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v5/.CANONICAL_V3_A234_DEV30_INFERENCE_V5_ATTEMPTED"
V5_RESULTS = ROOT / "training/eval/fulgor_ray_v3/dev30_v1/a234_runtime/inference_v5/a234_hardened_v2_9_v5/results.jsonl"

EXPECTED_INPUT_SHA256 = "78024804618ba6d5997f1aba8928ad4e33f4bf8cbc03e845de57077f7f366d0a"
EXPECTED_ADAPTER_CONFIG_SHA256 = "3fd41b547e513bbdcde1bf961cd912963ed9f2be30e6c10964145bf1e0120a02"
EXPECTED_ADAPTER_WEIGHTS_SHA256 = "4586bdcd92e84cb88f5d4bc911a69a60b2460d59b3322bd90bf9d96d52e9ea6e"
EXPECTED_SEALED_V1_SHA256 = "801bf806036d223c64310e60fd77edd462af4b986445b2b261298e8e21084c2c"
EXPECTED_SEALED_V2_SHA256 = "d254f331f8563f565454fc9c048b5a5025dd4069281558afb6a6ef34be7169a0"
EXPECTED_SEALED_V3_SHA256 = "ef983492fa025737ad5d648c83cfffda067a474d19e35896f4bb4b704ecf9af3"
EXPECTED_SEALED_V4_RUNNER_SHA256 = "2722c773d0661d0a3e52070a879efced60c6525c5665e4e5f6c01a13beb41dd3"
EXPECTED_SEALED_V5_RUNNER_SHA256 = "1e5998f65d1ad1c974763d4ff86b2f75572aea255a55c766822bea507f949c0c"
EXPECTED_CONTEXT_BUDGET_V2_SHA256 = "da9ae0af2ed057287660abf820d31b4bed869b89d97a38db53ba9d9680f3374c"
EXPECTED_STAGE_PROMPTS_V3_SHA256 = "397abaf5e81da0faf402b9cdcb7ddb4be5dec03808bd94ad3a5375d10b431b63"

EXPECTED_V2_MARKER_SHA256 = "98636f5d53597d74f7a8da520daf94545f1edea3d41714d94e3cf3525cdaa170"
EXPECTED_V2_RESULTS_SHA256 = "95c65877ed3137f8b840d7e0dc2dd3efad62b608f124ac6f1baa4237d0a96520"
EXPECTED_V3_MARKER_SHA256 = "ba7ece51a8404c16db68dc9eaea8c29c074b219ce84ee9c25ba00e64b49ae849"
EXPECTED_V3_RESULTS_SHA256 = "4b3ec53f406375d54e8aa2f5c7eaa04d2ba1b9dd87eb21430db89f13688dba18"
EXPECTED_V5_MARKER_SHA256 = "4b0d575ef1db040fd0b149b2b286b43dad334dac259111e7f5ae12274ce748b9"
EXPECTED_V5_RESULTS_SHA256 = "40bbaf72edf7856aa015ec55cbf25f32ef0bbc3b8e3226939a5256cdaaea568d"

INPUT_FIELDS = frozenset({"instance_id", "problem_statement", "repository_root"})


class DiagnosisTargetMembershipError(ContractError):
    """Raised when diagnosis target_files contains files outside the repository inventory."""


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def preflight() -> dict[str, Any]:
    """Strict fail-closed preflight check without loading weights or executing inference."""
    errors = []

    for name, path, expected in (
        ("input", INPUT, EXPECTED_INPUT_SHA256),
        ("adapter_config", ADAPTER_CONFIG, EXPECTED_ADAPTER_CONFIG_SHA256),
        ("adapter_weights", ADAPTER_WEIGHTS, EXPECTED_ADAPTER_WEIGHTS_SHA256),
        ("sealed_v1_runner", SEALED_V1_RUNNER, EXPECTED_SEALED_V1_SHA256),
        ("sealed_v2_runner", SEALED_V2_RUNNER, EXPECTED_SEALED_V2_SHA256),
        ("sealed_v3_runner", SEALED_V3_RUNNER, EXPECTED_SEALED_V3_SHA256),
        ("sealed_v4_runner", SEALED_V4_RUNNER, EXPECTED_SEALED_V4_RUNNER_SHA256),
        ("sealed_v5_runner", SEALED_V5_RUNNER, EXPECTED_SEALED_V5_RUNNER_SHA256),
        ("context_budget_v2", CONTEXT_BUDGET_V2, EXPECTED_CONTEXT_BUDGET_V2_SHA256),
        ("stage_prompts_v3", STAGE_PROMPTS_V3, EXPECTED_STAGE_PROMPTS_V3_SHA256),
        ("v2_marker", V2_MARKER, EXPECTED_V2_MARKER_SHA256),
        ("v2_results", V2_RESULTS, EXPECTED_V2_RESULTS_SHA256),
        ("v3_marker", V3_MARKER, EXPECTED_V3_MARKER_SHA256),
        ("v3_results", V3_RESULTS, EXPECTED_V3_RESULTS_SHA256),
        ("v5_marker", V5_MARKER, EXPECTED_V5_MARKER_SHA256),
        ("v5_results", V5_RESULTS, EXPECTED_V5_RESULTS_SHA256),
    ):
        if not path.is_file():
            errors.append(f"{name} file missing: {path}")
        else:
            actual = _sha256(path)
            if actual != expected:
                errors.append(f"{name} sha256 mismatch: expected {expected}, got {actual}")

    for name, path in (
        ("stage_prompts_v4", STAGE_PROMPTS_V4),
        ("semantic_intent_v2", SEMANTIC_INTENT_V2),
        ("host_binding_v1", HOST_BINDING_V1),
    ):
        if not path.is_file():
            errors.append(f"{name} file missing: {path}")

    # One-shot safety check
    if MARKER.exists():
        errors.append(f"irreversible v6 attempt marker already exists: {MARKER}")
    if OUTPUT.exists():
        errors.append(f"v6 output directory already exists: {OUTPUT}")

    # Input dataset format validation
    if INPUT.is_file():
        lines = [line for line in INPUT.read_text().splitlines() if line]
        if len(lines) != 30:
            errors.append(f"input lines mismatch: expected 30, got {len(lines)}")
        ids = set()
        for idx, line in enumerate(lines):
            try:
                row = json.loads(line)
                if set(row) != INPUT_FIELDS:
                    errors.append(f"line {idx} fields mismatch: {set(row)} != {INPUT_FIELDS}")
                ids.add(row.get("instance_id"))
            except json.JSONDecodeError as exc:
                errors.append(f"line {idx} is not valid json: {exc}")
        if len(ids) != 30:
            errors.append(f"unique instance ids count mismatch: expected 30, got {len(ids)}")

    if errors:
        raise RuntimeError("A234 v6 preflight failed:\n" + "\n".join(errors))

    return {
        "status": "PASS_A234_V6_GPU_RUNNER_PREFLIGHT",
        "schema": SCHEMA,
        "base_model": BASE,
        "base_revision": BASE_REVISION,
        "adapter_config_sha256": EXPECTED_ADAPTER_CONFIG_SHA256,
        "adapter_weights_sha256": EXPECTED_ADAPTER_WEIGHTS_SHA256,
        "input_rows": 30,
        "context_window": CONTEXT_WINDOW,
        "candidate_reserved_tokens": 2048,
        "closed_world_target_validation": True,
        "model_loaded": False,
        "inference_executed": False,
    }


def _model():
    """Load model and tokenizer lazily when --run is explicitly invoked."""
    import torch
    from peft import PeftModel
    from transformers import AutoModelForMultimodalLM, AutoTokenizer

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for A234 v6 inference")

    tok = AutoTokenizer.from_pretrained(BASE, revision=BASE_REVISION, local_files_only=True)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token
    base = AutoModelForMultimodalLM.from_pretrained(
        BASE, revision=BASE_REVISION, dtype=torch.bfloat16,
        device_map={"": "cuda:0"}, local_files_only=True)
    model = PeftModel.from_pretrained(base, str(ADAPTER), is_trainable=False)
    model.eval()
    eos = base.generation_config.eos_token_id
    eos = [eos] if isinstance(eos, int) else list(eos or [])
    if eos != [1, 106, 50]:
        raise RuntimeError(f"unexpected EOS ids: {eos}")
    return tok, model, base, eos


def _generate(tok, model, base, eos, stage: str, static_payload: dict, context_key: str,
              render_context: Callable[[int], Any], full_units: int, reserve: int, **stage_context: Any):
    def build(context):
        payload = dict(static_payload)
        payload[context_key] = context
        return build_stage_messages(stage, payload, **stage_context)

    fitted = fit_designated_context_v2(
        tok, build, render_context, full_context_units=full_units,
        reserved_generation_tokens=reserve, context_window_tokens=CONTEXT_WINDOW)

    if fitted.tokenized_prompt is not None and hasattr(fitted.tokenized_prompt, "get") and "input_ids" in fitted.tokenized_prompt:
        batch = fitted.tokenized_prompt
    else:
        batch, _, _ = tokenize_chat_prompt(tok, fitted.messages)

    batch = {key: value.to("cuda:0") for key, value in batch.items() if hasattr(value, "to")}
    prompt_tokens = int(batch["input_ids"].shape[-1])
    if prompt_tokens != fitted.metadata["prompt_tokens"]:
        raise RuntimeError("token count changed between budgeting and generation")

    with __import__("torch").inference_mode():
        output = model.generate(
            **batch, max_new_tokens=reserve, do_sample=False, eos_token_id=eos,
            pad_token_id=base.generation_config.pad_token_id)

    generated_tokens = int(output.shape[-1] - prompt_tokens)
    ended_on_eos = bool(output.shape[-1] > prompt_tokens and int(output[0, -1].item()) in eos)
    hit_generation_reserve = bool(generated_tokens >= reserve)

    raw = tok.decode(output[0, prompt_tokens:], skip_special_tokens=True).strip()
    metadata = dict(fitted.metadata)
    metadata.update(
        stage=stage,
        raw_output_sha256=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        generated_tokens=generated_tokens,
        prompt_tokens=prompt_tokens,
        reserved_generation_tokens=reserve,
        ended_on_eos=ended_on_eos,
        hit_generation_reserve=hit_generation_reserve,
    )
    return raw, metadata


def _safe_structural_diagnostics(raw: str, exc: Exception | None = None) -> dict[str, Any]:
    """Capture non-semantic structural diagnostics on malformed JSON without leaking raw values."""
    stripped = raw.strip()
    diag: dict[str, Any] = {
        "raw_character_count": len(raw),
        "first_non_whitespace_character": stripped[:1] if stripped else None,
        "last_non_whitespace_character": stripped[-1:] if stripped else None,
        "brace_balance": raw.count("{") - raw.count("}"),
        "bracket_balance": raw.count("[") - raw.count("]"),
        "double_quote_parity": (raw.count('"') % 2 == 0),
    }
    cause = getattr(exc, "__cause__", None) if exc is not None else None
    decode_exc = exc if isinstance(exc, json.JSONDecodeError) else (cause if isinstance(cause, json.JSONDecodeError) else None)
    if decode_exc is not None:
        diag.update({
            "json_decode_error_type": type(decode_exc).__name__,
            "json_decode_error_position": decode_exc.pos,
            "json_decode_error_line": decode_exc.lineno,
            "json_decode_error_column": decode_exc.colno,
        })
    return diag


def _safe_stage_parse(rec: dict, stage_name: str, raw: str, strict_parser: Callable[[str], T]) -> T:
    """Normalize envelope, record non-semantic recovery provenance & diagnostics, then strict-parse."""
    original_sha = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    try:
        recovery = normalize_single_json_object(raw)
        try:
            val = json.loads(recovery.normalized_json)
            observed_keys = sorted(list(val.keys())) if isinstance(val, dict) else []
        except Exception:
            observed_keys = []
        rec_info = {
            "envelope": recovery.envelope,
            "original_sha256": recovery.original_sha256,
            "normalized_sha256": recovery.normalized_sha256,
            "observed_keys": observed_keys,
        }
        rec["recovery_provenance"][stage_name] = rec_info
        normalized_text = recovery.normalized_json
    except StructuredOutputRecoveryError as exc:
        diagnostics = _safe_structural_diagnostics(raw, exc)
        rec["recovery_provenance"][stage_name] = {
            "envelope": None,
            "original_sha256": original_sha,
            "normalized_sha256": None,
            "observed_keys": [],
            "normalization_failure_code": type(exc).__name__,
            "normalization_failure_message": str(exc),
            "structural_diagnostics": diagnostics,
        }
        raise exc

    return strict_parser(normalized_text)


def process_candidates_v6(
    instance_id: str,
    repository_root: str,
    repository_files: Sequence[str],
    diagnosis: DiagnosisV1,
    plan: RepairPlanV1,
    raw_by_slot: Sequence[str],
    apply_gate,
    verify_generate: Callable[[SemanticPatchV1, SerializedPatchV1, GateResult, str], str],
) -> tuple[tuple[CandidateOutcome, ...], object]:
    """Process candidate intents through host-binding, strict serialization, static gating, and verifier."""
    if len(raw_by_slot) != CANDIDATE_BUDGET:
        raise A234ContractError("exactly K=3 candidate outputs required")

    ids = tuple(
        "candidate-" + hashlib.sha256(f"{instance_id}\0{i}".encode()).hexdigest()[:16]
        for i in range(CANDIDATE_BUDGET)
    )
    outcomes = []
    selectable = []

    for cid, raw in zip(ids, raw_by_slot):
        try:
            intent = parse_semantic_patch_intent(raw, cid, diagnosis, plan)
            candidate, provs = bind_candidate_intent_to_host_patch(
                repository_root, repository_files, intent, diagnosis.target_files
            )
            patch = serialize(repository_root, candidate)
            gate = evaluate(candidate, patch, diagnosis.target_files, apply_gate)
            score = None
            if gate.accepted:
                bid = blind_id(instance_id, cid)
                score = parse_verifier(
                    verify_generate(
                        replace(candidate, candidate_id=bid),
                        replace(patch, candidate_id=bid),
                        gate,
                        bid,
                    ),
                    bid,
                )
                real_score = replace(score, candidate_id=cid)
                selectable.append(SelectableCandidate(real_score, patch.stats))
                score = real_score
            outcomes.append(CandidateOutcome(candidate, patch, gate, score))
        except (A234ContractError, CandidateHostBindingError, SerializationError, SemanticIntentError, ValueError) as exc:
            outcomes.append(CandidateOutcome(None, None, None, None, type(exc).__name__))

    selected = select_primary(selectable)
    return tuple(outcomes), selected


def run():
    """Execute A234 v6 DEV30 inference."""
    preflight()
    rows = [json.loads(line) for line in INPUT.read_text().splitlines() if line]
    if len(rows) != 30 or len({row["instance_id"] for row in rows}) != 30 or any(
            set(row) != INPUT_FIELDS for row in rows):
        raise RuntimeError("DEV30 input contract failed")

    OUTPUT.mkdir(parents=True, exist_ok=False)
    MARKER.write_text("canonical A234 v6 inference attempted; never delete or reset\n")
    tok, model, base, eos = _model()

    with RESULTS.open("x") as output:
        for row in rows:
            rec = {
                "instance_id": row["instance_id"],
                "dev_eval_only": True,
                "gold_patch_read": False,
                "training_started": False,
                "candidate_budget": 3,
                "feedback_budget": 1,
                "generation_metadata": {},
                "recovery_provenance": {},
            }
            try:
                provider = LocalRepositoryProvider(row["repository_root"])
                files = provider.list_files()

                # Stage 1: Diagnosis
                raw_d, meta_d = _generate(
                    tok, model, base, eos, "diagnosis",
                    {"problem": row["problem_statement"]}, "repository_files",
                    lambda n: prefix_items(files, n), len(files), 1024)
                rec["generation_metadata"]["diagnosis"] = meta_d
                diagnosis = _safe_stage_parse(rec, "diagnosis", raw_d, parse_diagnosis)

                # Closed-world inventory check: target_files MUST be in repository_files
                repo_files_set = set(files)
                for target in diagnosis.target_files:
                    if target not in repo_files_set:
                        raise DiagnosisTargetMembershipError(
                            f"diagnosis target file not in repository inventory: {target!r}"
                        )

                # Stage 2: Plan
                contents = provider.read_files(diagnosis.target_files)
                content_bytes = sum(len(value.encode()) for value in contents.values())
                diag_dict = asdict(diagnosis)
                d_hash = canonical_hash(diag_dict)

                raw_p, meta_p = _generate(
                    tok, model, base, eos, "plan",
                    {"problem": row["problem_statement"], "diagnosis": diag_dict, "diagnosis_hash": d_hash},
                    "localized_contents", lambda n: balanced_prefix_mapping(contents, n), content_bytes, 1024,
                    diagnosis_hash=d_hash)
                rec["generation_metadata"]["plan"] = meta_p
                plan = _safe_stage_parse(rec, "plan", raw_p, lambda raw: parse_plan(raw, diagnosis))

                # Stage 3: Candidates (K=3, fulgor.semantic_patch_intent.v2)
                plan_dict = asdict(plan)
                p_hash = canonical_hash(plan_dict)
                ids = ["candidate-" + hashlib.sha256(f"{row['instance_id']}\0{i}".encode()).hexdigest()[:16] for i in range(3)]
                raws, normalized_raws, parsed_intents = [], [], []

                for index, (candidate_id, directive) in enumerate(zip(ids, SLOTS)):
                    raw_c, meta_c = _generate(
                        tok, model, base, eos, "candidate",
                        {"problem": row["problem_statement"], "diagnosis": diag_dict, "plan": plan_dict,
                         "candidate_id": candidate_id, "diversity_directive": directive},
                        "localized_contents", lambda n: balanced_prefix_mapping(contents, n), content_bytes, 2048,
                        candidate_id=candidate_id, diagnosis_hash=d_hash, plan_hash=p_hash)
                    raws.append(raw_c)
                    rec["generation_metadata"][f"candidate_{index}"] = meta_c
                    parsed = _safe_stage_parse(
                        rec, f"candidate_{index}", raw_c,
                        lambda val, cid=candidate_id: parse_semantic_patch_intent(val, cid, diagnosis, plan))
                    parsed_intents.append(parsed)
                    normalized_raws.append(normalize_single_json_object(raw_c).normalized_json)

                # Stage 4: Verifier
                verifier_index = 0
                def verify_generate(candidate, patch, gate, blinded_id):
                    nonlocal verifier_index
                    diff = patch.unified_diff
                    raw_v, meta_v = _generate(
                        tok, model, base, eos, "verifier",
                        {"problem": row["problem_statement"], "diagnosis": diag_dict, "plan": plan_dict,
                         "candidate": asdict(candidate), "gate": asdict(gate), "blinded_id": blinded_id,
                         "canonical_diff_summary": {
                             "files_changed": patch.stats.files_changed,
                             "hunks": patch.stats.hunks,
                             "changed_lines": patch.stats.changed_lines,
                         }},
                        "canonical_diff", lambda n: prefix_text(diff, n), len(diff.encode()), 1024,
                        blinded_id=blinded_id)
                    key = f"verifier_{verifier_index}"
                    rec["generation_metadata"][key] = meta_v
                    score = _safe_stage_parse(rec, key, raw_v, lambda val: parse_verifier(val, blinded_id))
                    verifier_index += 1
                    return json.dumps(asdict(score), sort_keys=True)

                outcomes, selected = process_candidates_v6(
                    row["instance_id"], row["repository_root"], files, diagnosis, plan,
                    normalized_raws, provider, verify_generate)

                rec.update(
                    raw_diagnosis=raw_d,
                    diagnosis=diag_dict,
                    raw_plan=raw_p,
                    plan=plan_dict,
                    raw_candidates=raws,
                    outcomes=[asdict(item) for item in outcomes],
                    selected_candidate=None if isinstance(selected, NoPrimary) else selected.score.candidate_id,
                    no_primary_reasons=selected.reason_codes if isinstance(selected, NoPrimary) else [],
                )
            except Exception as exc:
                rec.update(failure_code=type(exc).__name__, failure_message=str(exc))

            output.write(json.dumps(rec, default=str, sort_keys=True) + "\n")
            output.flush()
            os.fsync(output.fileno())


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--preflight":
        result = preflight()
        print(json.dumps(result, indent=2, sort_keys=True))
    elif len(sys.argv) == 2 and sys.argv[1] == "--run":
        run()
    else:
        print("Usage: python3 run_fulgor_v3_0_a234_dev30_inference_v6.py [--preflight|--run]", file=sys.stderr)
        sys.exit(1)
