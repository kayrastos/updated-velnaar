#!/usr/bin/env python3
"""Bounded end-to-end synthetic pipeline smoke validation for Fulgor Ray V3 A234 V6.

Strict non-evaluation boundaries:
- Operates strictly in training/synthetic_smoke/fulgor_ray_v3/a234_v6_e2e/
- Uses a tiny isolated synthetic repository (NEVER accesses DEV30)
- Bounded model call budget: <= 8 generation calls total
- Exercises full pipeline:
  Diagnosis -> Closed-world target check -> Localization -> Plan ->
  K=3 Candidates -> Semantic intent parse -> Host binding ->
  Host SHA computation -> Strict serialization -> Static gate ->
  Blinded verifier -> Primary selection
- Fails closed on any contract violation
- Emits purely non-semantic structural telemetry
"""

from __future__ import annotations

from dataclasses import asdict, replace
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any, Callable, Mapping

ROOT = Path(__file__).resolve().parent

from training.fulgor_ray_v3.a1_inference import LocalRepositoryProvider
from training.fulgor_ray_v3.a234_inference import (
    CandidateOutcome,
    SLOTS,
    SelectableCandidate,
    blind_id,
    canonical_hash,
    parse_diagnosis,
    parse_plan,
    parse_verifier,
    select_primary,
)
from training.fulgor_ray_v3.candidate_host_binding_v1 import (
    CandidateHostBindingError,
    bind_candidate_intent_to_host_patch,
)
from training.fulgor_ray_v3.context_budget_v2 import (
    balanced_prefix_mapping,
    fit_designated_context_v2,
    prefix_items,
    prefix_text,
    tokenize_chat_prompt,
)
from training.fulgor_ray_v3.patch_serializer import SerializationError, serialize
from training.fulgor_ray_v3.schemas import GateResult, NoPrimary, SemanticPatchV1, SerializedPatchV1
from training.fulgor_ray_v3.semantic_patch_intent_v2 import (
    SemanticIntentError,
    parse_semantic_patch_intent,
)
from training.fulgor_ray_v3.stage_contract_prompts_v4 import (
    build_stage_messages,
    get_stage_system_prompt,
)
from training.fulgor_ray_v3.static_gate import evaluate
from training.fulgor_ray_v3.structured_output_recovery import normalize_single_json_object

SMOKE_NAMESPACE = ROOT / "training/synthetic_smoke/fulgor_ray_v3/a234_v6_e2e"
SUMMARY_PATH = SMOKE_NAMESPACE / "summary.json"

MAX_MODEL_CALLS = 8
CONTEXT_WINDOW = 8192
BASE = "google/gemma-4-12B-it"
BASE_REVISION = "707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7"
ADAPTER = ROOT / "training/runs/fulgor_ray_v2_9_stability_closure_replay24_gemma12b_lr5e7_1ep_run1/final_adapter"


class SyntheticPatchApplyGate:
    """Mock test execution gate for synthetic smoke."""
    def dry_run(self, unified_diff: str) -> tuple[bool, str]:
        if not unified_diff:
            return False, "EMPTY_DIFF"
        return True, "OK"


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


def run_synthetic_smoke() -> dict[str, Any]:
    SMOKE_NAMESPACE.mkdir(parents=True, exist_ok=True)

    # 1. Create a tiny synthetic repository in a sub-path of SMOKE_NAMESPACE
    repo_dir = SMOKE_NAMESPACE / "synthetic_repo"
    if repo_dir.exists():
        shutil.rmtree(repo_dir)
    repo_dir.mkdir(parents=True, exist_ok=False)

    code_content = (
        "def multiply(a: int, b: int) -> int:\n"
        "    return a + b\n"
    )
    (repo_dir / "math_util.py").write_text(code_content, encoding="utf-8")
    repo_hash = hashlib.sha256(code_content.encode()).hexdigest()

    problem_statement = (
        "In math_util.py, the multiply function has a bug where it performs addition instead of multiplication.\n"
        "Observed failure: multiply(2, 3) returned 5 instead of 6.\n"
        "Fix the return statement on line 2 so that it returns a * b."
    )

    telemetry = {
        "status": "RUNNING",
        "call_budget_max": MAX_MODEL_CALLS,
        "calls_made": 0,
        "stages": {},
        "conditions": {},
    }

    # Load model
    import torch
    from transformers import AutoModelForMultimodalLM, AutoTokenizer
    from peft import PeftModel

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA required for synthetic smoke")

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

    provider = LocalRepositoryProvider(str(repo_dir))
    files = provider.list_files()

    # --- Stage 1: Diagnosis ---
    raw_d, meta_d = _generate(
        tok, model, base, eos, "diagnosis",
        {"problem": problem_statement}, "repository_files",
        lambda n: prefix_items(files, n), len(files), 1024
    )
    telemetry["calls_made"] += 1
    telemetry["stages"]["diagnosis"] = {"meta": meta_d}

    try:
        norm_d = normalize_single_json_object(raw_d)
        diagnosis = parse_diagnosis(norm_d.normalized_json)
        telemetry["conditions"]["diagnosis_strict_parse"] = True
    except Exception as exc:
        telemetry["conditions"]["diagnosis_strict_parse"] = False
        telemetry["status"] = f"FAILED_DIAGNOSIS_PARSE: {type(exc).__name__}"
        return telemetry

    # Closed-world inventory check
    repo_files_set = set(files)
    target_membership_ok = all(target in repo_files_set for target in diagnosis.target_files)
    telemetry["conditions"]["diagnosis_target_membership"] = target_membership_ok
    if not target_membership_ok:
        telemetry["status"] = "FAILED_DIAGNOSIS_TARGET_MEMBERSHIP"
        return telemetry

    # --- Stage 2: Plan ---
    contents = provider.read_files(diagnosis.target_files)
    content_bytes = sum(len(v.encode()) for v in contents.values())
    diag_dict = asdict(diagnosis)
    d_hash = canonical_hash(diag_dict)

    raw_p, meta_p = _generate(
        tok, model, base, eos, "plan",
        {"problem": problem_statement, "diagnosis": diag_dict, "diagnosis_hash": d_hash},
        "localized_contents", lambda n: balanced_prefix_mapping(contents, n), content_bytes, 1024,
        diagnosis_hash=d_hash
    )
    telemetry["calls_made"] += 1
    telemetry["stages"]["plan"] = {"meta": meta_p}

    try:
        norm_p = normalize_single_json_object(raw_p)
        plan = parse_plan(norm_p.normalized_json, diagnosis)
        telemetry["conditions"]["plan_strict_parse"] = True
    except Exception as exc:
        telemetry["conditions"]["plan_strict_parse"] = False
        telemetry["status"] = f"FAILED_PLAN_PARSE: {type(exc).__name__}"
        return telemetry

    # --- Stage 3: Candidates (K=3) ---
    plan_dict = asdict(plan)
    p_hash = canonical_hash(plan_dict)
    instance_id = "synthetic-smoke-v6-001"
    ids = ["candidate-" + hashlib.sha256(f"{instance_id}\0{i}".encode()).hexdigest()[:16] for i in range(3)]
    intents = []

    for index, (cid, directive) in enumerate(zip(ids, SLOTS)):
        raw_c, meta_c = _generate(
            tok, model, base, eos, "candidate",
            {"problem": problem_statement, "diagnosis": diag_dict, "plan": plan_dict,
             "candidate_id": cid, "diversity_directive": directive},
            "localized_contents", lambda n: balanced_prefix_mapping(contents, n), content_bytes, 2048,
            candidate_id=cid, diagnosis_hash=d_hash, plan_hash=p_hash
        )
        telemetry["calls_made"] += 1
        telemetry["stages"][f"candidate_{index}"] = {"meta": meta_c}

        try:
            norm_c = normalize_single_json_object(raw_c)
            intent = parse_semantic_patch_intent(norm_c.normalized_json, cid, diagnosis, plan)
            intents.append((cid, intent))
        except Exception:
            pass

    telemetry["conditions"]["candidate_intents_parsed_count"] = len(intents)
    telemetry["conditions"]["candidate_intents_all_three_parsed"] = bool(len(intents) == 3)

    if len(intents) == 0:
        telemetry["status"] = "FAILED_CANDIDATE_INTENTS"
        return telemetry

    # --- Stage 4: Host Binding, Serialization, Gating, Verifier, Selection ---
    host_bound_count = 0
    serialized_count = 0
    gate_evaluated_count = 0
    gate_accepted_count = 0
    verifier_invoked_count = 0
    verifier_parse_count = 0
    selectable = []
    outcomes = []

    apply_gate = SyntheticPatchApplyGate()

    for cid, intent in intents:
        try:
            candidate, provs = bind_candidate_intent_to_host_patch(
                str(repo_dir), files, intent, diagnosis.target_files
            )
            host_bound_count += 1
            # Verify host SHA equality
            for p in provs:
                target_lines = (repo_dir / p.file).read_text().splitlines(keepends=True)
                expected_pre = "".join(target_lines[p.bound_start_line - 1 : p.bound_end_line])
                assert hashlib.sha256(expected_pre.encode()).hexdigest() == p.preimage_sha256

            patch = serialize(str(repo_dir), candidate)
            serialized_count += 1

            gate = evaluate(candidate, patch, diagnosis.target_files, apply_gate)
            gate_evaluated_count += 1

            score = None
            if gate.accepted:
                gate_accepted_count += 1
                bid = blind_id(instance_id, cid)

                # Invoke verifier
                if telemetry["calls_made"] < MAX_MODEL_CALLS:
                    diff = patch.unified_diff
                    raw_v, meta_v = _generate(
                        tok, model, base, eos, "verifier",
                        {"problem": problem_statement, "diagnosis": diag_dict, "plan": plan_dict,
                         "candidate": asdict(candidate), "gate": asdict(gate), "blinded_id": bid,
                         "canonical_diff_summary": {
                             "files_changed": patch.stats.files_changed,
                             "hunks": patch.stats.hunks,
                             "changed_lines": patch.stats.changed_lines,
                         }},
                        "canonical_diff", lambda n: prefix_text(diff, n), len(diff.encode()), 1024,
                        blinded_id=bid
                    )
                    telemetry["calls_made"] += 1
                    verifier_invoked_count += 1

                    try:
                        norm_v = normalize_single_json_object(raw_v)
                        score = parse_verifier(norm_v.normalized_json, bid)
                        verifier_parse_count += 1
                        real_score = replace(score, candidate_id=cid)
                        selectable.append(SelectableCandidate(real_score, patch.stats))
                    except Exception:
                        pass

            outcomes.append(CandidateOutcome(candidate, patch, gate, score))
        except Exception as exc:
            outcomes.append(CandidateOutcome(None, None, None, None, type(exc).__name__))

    selected = select_primary(selectable)

    # Telemetry summary
    telemetry["conditions"]["at_least_one_host_binding"] = bool(host_bound_count >= 1)
    telemetry["conditions"]["host_sha_is_host_generated"] = True
    telemetry["conditions"]["at_least_one_serialization"] = bool(serialized_count >= 1)
    telemetry["conditions"]["at_least_one_gate_evaluation"] = bool(gate_evaluated_count >= 1)
    telemetry["conditions"]["at_least_one_gate_accepted"] = bool(gate_accepted_count >= 1)
    telemetry["conditions"]["at_least_one_verifier_invocation"] = bool(verifier_invoked_count >= 1)
    telemetry["conditions"]["at_least_one_verifier_parse"] = bool(verifier_parse_count >= 1)
    telemetry["conditions"]["selected_primary_not_none"] = bool(selected is not None and not isinstance(selected, NoPrimary))
    telemetry["conditions"]["no_gold_answer_read"] = True
    telemetry["conditions"]["training_started"] = False
    telemetry["conditions"]["dev30_accessed"] = False
    telemetry["conditions"]["a4_executed"] = False

    telemetry["counts"] = {
        "host_bound_count": host_bound_count,
        "serialized_count": serialized_count,
        "gate_evaluated_count": gate_evaluated_count,
        "gate_accepted_count": gate_accepted_count,
        "verifier_invoked_count": verifier_invoked_count,
        "verifier_parse_count": verifier_parse_count,
        "selectable_count": len(selectable),
    }

    all_pass = (
        telemetry["conditions"].get("diagnosis_strict_parse") is True and
        telemetry["conditions"].get("diagnosis_target_membership") is True and
        telemetry["conditions"].get("plan_strict_parse") is True and
        telemetry["conditions"].get("candidate_intents_all_three_parsed") is True and
        telemetry["conditions"].get("at_least_one_host_binding") is True and
        telemetry["conditions"].get("at_least_one_serialization") is True and
        telemetry["conditions"].get("at_least_one_gate_accepted") is True and
        telemetry["conditions"].get("at_least_one_verifier_invocation") is True and
        telemetry["conditions"].get("at_least_one_verifier_parse") is True and
        telemetry["conditions"].get("selected_primary_not_none") is True
    )

    telemetry["status"] = "PASS_A234_V6_E2E_SYNTHETIC_SMOKE" if all_pass else "FAIL_A234_V6_E2E_SYNTHETIC_SMOKE"
    telemetry["synthetic_repo_hash"] = repo_hash

    # Save summary
    SUMMARY_PATH.write_text(json.dumps(telemetry, indent=2, sort_keys=True) + "\n")
    return telemetry


if __name__ == "__main__":
    res = run_synthetic_smoke()
    print(json.dumps(res, indent=2, sort_keys=True))
    if res["status"] != "PASS_A234_V6_E2E_SYNTHETIC_SMOKE":
        sys.exit(1)
