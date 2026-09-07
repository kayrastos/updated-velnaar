"""Adversarial and functional test suite for A234 v6 launch receipt layer."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from training.fulgor_ray_v3 import a234_launch_receipt_v6 as receipt_mod
from training.fulgor_ray_v3.a234_launch_receipt_v6 import (
    LaunchReceiptError,
    evaluate_gate,
    launch_after_record,
    make_record,
    persist_record,
    probe_candidate_seal,
    probe_synthetic_smoke,
    read_record,
    record_gate,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


FAST_ENV = lambda: {
    "python_version": "3.10",
    "import_ok": True,
    "torch_version": "2.4.0",
    "transformers_version": "4.44.0",
    "peft_version": "0.12.0",
    "cuda_available": True,
    "device_count": 1,
    "device_name": "NVIDIA RTX PRO 6000",
    "bf16_supported": True,
    "gpu_0_total_bytes": 40 * 1024**3,
}
FAST_TOK = lambda: {"probe_passed": True}


def _fast_gate(root: Path, **kwargs) -> dict:
    kwargs.setdefault("env_probe", FAST_ENV)
    kwargs.setdefault("tok_probe", FAST_TOK)
    return evaluate_gate(root, **kwargs)


def _populate_temp_root(temp_root: Path):
    for rel_name in [
        receipt_mod.RUNNER_NAME,
        receipt_mod.STAGE_CONTRACT_PROMPTS_V4_NAME,
        receipt_mod.SEMANTIC_PATCH_INTENT_V2_NAME,
        receipt_mod.CANDIDATE_HOST_BINDING_V1_NAME,
        receipt_mod.CONTEXT_BUDGET_V2_NAME,
        receipt_mod.CANONICAL_A1_INPUT_NAME,
        receipt_mod.ADAPTER_CONFIG_NAME,
        receipt_mod.ADAPTER_WEIGHTS_NAME,
        receipt_mod.CANDIDATE_V6_SEAL_NAME,
        receipt_mod.E2E_SYNTHETIC_SMOKE_SUMMARY_NAME,
        receipt_mod.V5_ATTEMPT_MARKER_NAME,
        receipt_mod.V5_RESULTS_NAME,
        receipt_mod.V3_ATTEMPT_MARKER_NAME,
        receipt_mod.V3_RESULTS_NAME,
        receipt_mod.V2_ATTEMPT_MARKER_NAME,
        receipt_mod.V2_RESULTS_NAME,
    ]:
        src = REPO_ROOT / rel_name
        dst = temp_root / rel_name
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())


class A234LaunchReceiptV6Tests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(REPO_ROOT.is_dir())

    def test_00_live_gate_is_ready(self):
        """Verify that live repository environment produces READY gate status (full real probes)."""
        gate = evaluate_gate(REPO_ROOT)
        self.assertEqual(gate["status"], "READY")
        self.assertEqual(gate["schema"], receipt_mod.GATE_SCHEMA)
        self.assertTrue(all(gate["checks"].values()))
        self.assertFalse(gate["inference_executed"])
        self.assertFalse(gate["marker_written"])
        self.assertFalse(gate["training_started"])

    def test_01_runner_mismatch_not_ready(self):
        """Test 1: runner mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            runner = temp_root / receipt_mod.RUNNER_NAME
            runner.write_text("tampered runner content")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["runner_v6_hash"])

    def test_02_prompt_mismatch_not_ready(self):
        """Test 2: prompt mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            sp = temp_root / receipt_mod.STAGE_CONTRACT_PROMPTS_V4_NAME
            sp.parent.mkdir(parents=True, exist_ok=True)
            sp.write_text("tampered stage prompts content")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["stage_contract_prompts_v4_hash"])

    def test_03_semantic_intent_mismatch_not_ready(self):
        """Test 3: semantic intent mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            si = temp_root / receipt_mod.SEMANTIC_PATCH_INTENT_V2_NAME
            si.parent.mkdir(parents=True, exist_ok=True)
            si.write_text("tampered semantic intent content")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["semantic_patch_intent_v2_hash"])

    def test_04_host_binder_mismatch_not_ready(self):
        """Test 4: host binder mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            hb = temp_root / receipt_mod.CANDIDATE_HOST_BINDING_V1_NAME
            hb.parent.mkdir(parents=True, exist_ok=True)
            hb.write_text("tampered host binder content")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["candidate_host_binding_v1_hash"])

    def test_05_context_budget_mismatch_not_ready(self):
        """Test 5: context budget mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            cb = temp_root / receipt_mod.CONTEXT_BUDGET_V2_NAME
            cb.parent.mkdir(parents=True, exist_ok=True)
            cb.write_text("tampered context budget content")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["context_budget_v2_hash"])

    def test_06_canonical_input_mismatch_not_ready(self):
        """Test 6: canonical input mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            inp = temp_root / receipt_mod.CANONICAL_A1_INPUT_NAME
            inp.parent.mkdir(parents=True, exist_ok=True)
            inp.write_text("tampered canonical input")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["canonical_a1_input_hash"])

    def test_07_adapter_config_mismatch_not_ready(self):
        """Test 7: adapter config mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            cfg = temp_root / receipt_mod.ADAPTER_CONFIG_NAME
            cfg.parent.mkdir(parents=True, exist_ok=True)
            cfg.write_text("tampered adapter config")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["adapter_config_hash"])

    def test_08_adapter_weights_mismatch_not_ready(self):
        """Test 8: adapter weights mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            wts = temp_root / receipt_mod.ADAPTER_WEIGHTS_NAME
            wts.parent.mkdir(parents=True, exist_ok=True)
            wts.write_bytes(b"tampered weights")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["adapter_weights_hash"])

    def test_09_candidate_seal_mismatch_not_ready(self):
        """Test 9: candidate seal mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            seal = temp_root / receipt_mod.CANDIDATE_V6_SEAL_NAME
            seal.parent.mkdir(parents=True, exist_ok=True)
            seal.write_text("tampered candidate seal")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["candidate_v6_seal_verified"])

    def test_10_candidate_seal_member_mismatch_not_ready(self):
        """Test 10: candidate seal member mismatch => NOT_READY."""
        gate = _fast_gate(
            REPO_ROOT,
            seal_probe=lambda r: {"probe_passed": False, "error": "member_sha_mismatch"}
        )
        self.assertEqual(gate["status"], "NOT_READY")
        self.assertFalse(gate["checks"]["candidate_v6_seal_verified"])

    def test_11_e2e_summary_mismatch_not_ready(self):
        """Test 11: E2E summary mismatch => NOT_READY."""
        gate = _fast_gate(
            REPO_ROOT,
            smoke_probe=lambda r: {"probe_passed": False, "error": "hash_mismatch"}
        )
        self.assertEqual(gate["status"], "NOT_READY")
        self.assertFalse(gate["checks"]["e2e_synthetic_smoke_summary_verified"])

    def test_12_e2e_primary_selected_false_not_ready(self):
        """Test 12: E2E primary_selected false => NOT_READY."""
        gate = _fast_gate(
            REPO_ROOT,
            smoke_probe=lambda r: {"probe_passed": False, "error": "selected_primary_not_none_false"}
        )
        self.assertEqual(gate["status"], "NOT_READY")
        self.assertFalse(gate["checks"]["e2e_synthetic_smoke_summary_verified"])

    def test_13_e2e_verifier_count_zero_not_ready(self):
        """Test 13: E2E verifier count zero => NOT_READY."""
        gate = _fast_gate(
            REPO_ROOT,
            smoke_probe=lambda r: {"probe_passed": False, "error": "verifier_invoked_count_zero"}
        )
        self.assertEqual(gate["status"], "NOT_READY")
        self.assertFalse(gate["checks"]["e2e_synthetic_smoke_summary_verified"])

    def test_14_e2e_serializer_pass_zero_not_ready(self):
        """Test 14: E2E serializer pass zero => NOT_READY."""
        gate = _fast_gate(
            REPO_ROOT,
            smoke_probe=lambda r: {"probe_passed": False, "error": "serialized_count_zero"}
        )
        self.assertEqual(gate["status"], "NOT_READY")
        self.assertFalse(gate["checks"]["e2e_synthetic_smoke_summary_verified"])

    def test_15_e2e_dev30_accessed_true_not_ready(self):
        """Test 15: E2E DEV30 accessed true => NOT_READY."""
        gate = _fast_gate(
            REPO_ROOT,
            smoke_probe=lambda r: {"probe_passed": False, "error": "dev30_accessed_not_false"}
        )
        self.assertEqual(gate["status"], "NOT_READY")
        self.assertFalse(gate["checks"]["e2e_synthetic_smoke_summary_verified"])

    def test_16_v5_evidence_mismatch_not_ready(self):
        """Test 16: V5 evidence mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            m = temp_root / receipt_mod.V5_ATTEMPT_MARKER_NAME
            m.parent.mkdir(parents=True, exist_ok=True)
            m.write_text("tampered v5 marker\n")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["v5_marker_preserved"])

    def test_17_v3_evidence_mismatch_not_ready(self):
        """Test 17: V3 evidence mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            m = temp_root / receipt_mod.V3_ATTEMPT_MARKER_NAME
            m.parent.mkdir(parents=True, exist_ok=True)
            m.write_text("tampered v3 marker\n")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["v3_marker_preserved"])

    def test_18_v2_evidence_mismatch_not_ready(self):
        """Test 18: V2 evidence mismatch => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            m = temp_root / receipt_mod.V2_ATTEMPT_MARKER_NAME
            m.parent.mkdir(parents=True, exist_ok=True)
            m.write_text("tampered v2 marker\n")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["v2_marker_preserved"])

    def test_19_v6_marker_exists_not_ready(self):
        """Test 19: V6 marker exists => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            m = temp_root / receipt_mod.V6_MARKER_RELATIVE
            m.parent.mkdir(parents=True, exist_ok=True)
            m.write_text("marker exists\n")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["v6_marker_absent"])

    def test_20_v6_output_exists_not_ready(self):
        """Test 20: V6 output exists => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            out = temp_root / receipt_mod.V6_OUTPUT_RELATIVE
            out.mkdir(parents=True, exist_ok=True)
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["v6_output_absent"])

    def test_21_v6_results_exists_not_ready(self):
        """Test 21: V6 results exists => NOT_READY."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            res = temp_root / receipt_mod.V6_RESULTS_RELATIVE
            res.parent.mkdir(parents=True, exist_ok=True)
            res.write_text("results\n")
            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["v6_results_absent"])

    def test_22_model_snapshot_missing_not_ready(self):
        """Test 22: model snapshot missing => NOT_READY."""
        with patch.object(receipt_mod, "_model_snapshot", return_value=Path("/nonexistent/snapshot")):
            gate = _fast_gate(REPO_ROOT)
            self.assertEqual(gate["status"], "NOT_READY")
            self.assertFalse(gate["checks"]["pinned_model_snapshot_complete"])

    def test_23_tokenizer_accounting_failure_not_ready(self):
        """Test 23: tokenizer accounting failure => NOT_READY."""
        gate = _fast_gate(
            REPO_ROOT,
            tok_probe=lambda: {"probe_passed": False, "error": "test accounting error"}
        )
        self.assertEqual(gate["status"], "NOT_READY")
        self.assertFalse(gate["checks"]["tokenizer_accounting_passed"])

    def test_24_durable_receipt_validates(self):
        """Test 24: durable receipt validates."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            runner = temp_root / receipt_mod.RUNNER_NAME
            runner.write_bytes((REPO_ROOT / receipt_mod.RUNNER_NAME).read_bytes())
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE

            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            body = dict(record)
            stated = body.pop("record_sha256")
            computed = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
            self.assertEqual(stated, computed)

            path = persist_record(temp_root, record, receipt_dir=receipt_dir)
            self.assertTrue(path.is_file())
            loaded = read_record(path, require_ready=True)
            self.assertEqual(loaded["record_sha256"], stated)

    def test_25_runner_mutation_after_receipt_blocked(self):
        """Test 25: runner mutation after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            (temp_root / receipt_mod.RUNNER_NAME).write_text("mutated runner bytes")
            with self.assertRaisesRegex(LaunchReceiptError, "pinned v6 runner"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_26_prompt_mutation_after_receipt_blocked(self):
        """Test 26: prompt mutation after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            (temp_root / receipt_mod.STAGE_CONTRACT_PROMPTS_V4_NAME).write_text("mutated stage contract prompts")
            with self.assertRaisesRegex(LaunchReceiptError, "stage_contract_prompts_v4 digest changed"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_27_semantic_intent_mutation_after_receipt_blocked(self):
        """Test 27: semantic intent mutation after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            (temp_root / receipt_mod.SEMANTIC_PATCH_INTENT_V2_NAME).write_text("mutated semantic intent")
            with self.assertRaisesRegex(LaunchReceiptError, "semantic_patch_intent_v2 digest changed"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_28_host_binder_mutation_after_receipt_blocked(self):
        """Test 28: host binder mutation after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            (temp_root / receipt_mod.CANDIDATE_HOST_BINDING_V1_NAME).write_text("mutated host binder")
            with self.assertRaisesRegex(LaunchReceiptError, "candidate_host_binding_v1 digest changed"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_29_adapter_mutation_after_receipt_blocked(self):
        """Test 29: adapter mutation after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            (temp_root / receipt_mod.ADAPTER_CONFIG_NAME).write_text("mutated config")
            with self.assertRaisesRegex(LaunchReceiptError, "adapter_config digest changed"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_30_candidate_seal_mutation_after_receipt_blocked(self):
        """Test 30: candidate seal mutation after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            (temp_root / receipt_mod.CANDIDATE_V6_SEAL_NAME).write_text("mutated candidate seal")
            with self.assertRaisesRegex(LaunchReceiptError, "candidate_v6_seal digest changed"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_31_e2e_summary_mutation_after_receipt_blocked(self):
        """Test 31: E2E summary mutation after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            (temp_root / receipt_mod.E2E_SYNTHETIC_SMOKE_SUMMARY_NAME).write_text("mutated summary")
            with self.assertRaisesRegex(LaunchReceiptError, "e2e_synthetic_smoke summary digest changed"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_32_marker_appears_after_receipt_blocked(self):
        """Test 32: marker appears after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            marker = temp_root / receipt_mod.V6_MARKER_RELATIVE
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text("spurious v6 marker\n")

            with self.assertRaisesRegex(LaunchReceiptError, "v6 attempt marker appeared"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_33_output_appears_after_receipt_blocked(self):
        """Test 33: output appears after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            out = temp_root / receipt_mod.V6_OUTPUT_RELATIVE
            out.mkdir(parents=True, exist_ok=True)

            with self.assertRaisesRegex(LaunchReceiptError, "v6 output directory appeared"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_34_results_appears_after_receipt_blocked(self):
        """Test 34: results appears after receipt => blocked."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            _populate_temp_root(temp_root)
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE
            gate = _fast_gate(REPO_ROOT)
            gate["status"] = "READY"
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            res = temp_root / receipt_mod.V6_RESULTS_RELATIVE
            res.parent.mkdir(parents=True, exist_ok=True)
            res.write_text("results\n")

            with self.assertRaisesRegex(LaunchReceiptError, "v6 results file appeared"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_35_not_ready_never_delegates(self):
        """Test 35: NOT_READY never delegates."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            runner = temp_root / receipt_mod.RUNNER_NAME
            runner.write_bytes((REPO_ROOT / receipt_mod.RUNNER_NAME).read_bytes())
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE

            fake_gate = {
                "schema": receipt_mod.GATE_SCHEMA,
                "status": "NOT_READY",
                "checks": {"dummy": False},
                "inference_executed": False,
                "marker_written": False,
            }
            body = dict(fake_gate)
            fake_gate["receipt_sha256"] = hashlib.sha256(
                json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
            record = make_record(temp_root, fake_gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)
            with self.assertRaisesRegex(LaunchReceiptError, "not READY"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_36_consumed_state_never_delegates(self):
        """Test 36: consumed state never delegates."""
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            runner = temp_root / receipt_mod.RUNNER_NAME
            runner.write_bytes((REPO_ROOT / receipt_mod.RUNNER_NAME).read_bytes())
            receipt_dir = temp_root / receipt_mod.RECEIPT_DIR_RELATIVE

            m = temp_root / receipt_mod.V6_MARKER_RELATIVE
            m.parent.mkdir(parents=True, exist_ok=True)
            m.write_text("consumed marker\n")

            gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")
            record = make_record(temp_root, gate)
            path = persist_record(temp_root, record, receipt_dir=receipt_dir)

            with self.assertRaisesRegex(LaunchReceiptError, "not READY"):
                launch_after_record(temp_root, path, executor=lambda cmd: 0)

    def test_37_consumed_state_never_loads_weights_through_wrapper(self):
        """Test 37: consumed state never loads weights through wrapper."""
        import torch
        with tempfile.TemporaryDirectory() as td:
            temp_root = Path(td)
            m = temp_root / receipt_mod.V6_MARKER_RELATIVE
            m.parent.mkdir(parents=True, exist_ok=True)
            m.write_text("consumed\n")

            if torch.cuda.is_available():
                mem_before = torch.cuda.memory_allocated(0)
                gate = _fast_gate(temp_root)
                mem_after = torch.cuda.memory_allocated(0)
                self.assertEqual(mem_before, mem_after)
            else:
                gate = _fast_gate(temp_root)
            self.assertEqual(gate["status"], "NOT_READY")

    def test_38_inspect_zero_inference(self):
        """Test 38: inspect zero inference."""
        gate = _fast_gate(REPO_ROOT)
        self.assertFalse(gate["inference_executed"])

    def test_39_inspect_zero_model_weights(self):
        """Test 39: inspect zero model weights."""
        import torch
        if torch.cuda.is_available():
            mem_before = torch.cuda.memory_allocated(0)
            _fast_gate(REPO_ROOT)
            mem_after = torch.cuda.memory_allocated(0)
            self.assertEqual(mem_before, mem_after)

    def test_40_inspect_zero_marker(self):
        """Test 40: inspect zero marker."""
        marker = REPO_ROOT / receipt_mod.V6_MARKER_RELATIVE
        self.assertFalse(marker.exists())
        _fast_gate(REPO_ROOT)
        self.assertFalse(marker.exists())

    def test_41_inspect_zero_output(self):
        """Test 41: inspect zero output."""
        out = REPO_ROOT / receipt_mod.V6_OUTPUT_RELATIVE
        self.assertFalse(out.exists())
        _fast_gate(REPO_ROOT)
        self.assertFalse(out.exists())

    def test_42_inspect_zero_results(self):
        """Test 42: inspect zero results."""
        res = REPO_ROOT / receipt_mod.V6_RESULTS_RELATIVE
        self.assertFalse(res.exists())
        _fast_gate(REPO_ROOT)
        self.assertFalse(res.exists())

    def test_43_no_a4(self):
        """Test 43: no A4 path is invoked or referenced in v6 receipt."""
        receipt_source = (REPO_ROOT / "training/fulgor_ray_v3/a234_launch_receipt_v6.py").read_text()
        cli_source = (REPO_ROOT / "run_fulgor_v3_0_a234_launch_receipt_v6.py").read_text()
        self.assertNotIn("a4_feedback", receipt_source)
        self.assertNotIn("a4_dev30", receipt_source)
        self.assertNotIn("a4_runtime", receipt_source)
        self.assertNotIn("a4_feedback", cli_source)
        self.assertNotIn("a4_dev30", cli_source)
        self.assertNotIn("a4_runtime", cli_source)

    def test_44_no_training(self):
        """Test 44: no training is started in v6 receipt."""
        gate = _fast_gate(REPO_ROOT)
        self.assertFalse(gate["training_started"])
        receipt_source = (REPO_ROOT / "training/fulgor_ray_v3/a234_launch_receipt_v6.py").read_text()
        self.assertNotIn(".train()", receipt_source)

    def test_45_historical_evidence_unchanged(self):
        """Test 45: historical evidence unchanged."""
        for name, exp_sha in [
            (receipt_mod.V5_ATTEMPT_MARKER_NAME, receipt_mod.V5_ATTEMPT_MARKER_SHA256),
            (receipt_mod.V5_RESULTS_NAME, receipt_mod.V5_RESULTS_SHA256),
            (receipt_mod.V3_ATTEMPT_MARKER_NAME, receipt_mod.V3_ATTEMPT_MARKER_SHA256),
            (receipt_mod.V3_RESULTS_NAME, receipt_mod.V3_RESULTS_SHA256),
            (receipt_mod.V2_ATTEMPT_MARKER_NAME, receipt_mod.V2_ATTEMPT_MARKER_SHA256),
            (receipt_mod.V2_RESULTS_NAME, receipt_mod.V2_RESULTS_SHA256),
        ]:
            hp = REPO_ROOT / name
            self.assertEqual(_sha(hp), exp_sha)
            mtime_before = hp.stat().st_mtime
            _fast_gate(REPO_ROOT)
            self.assertEqual(_sha(hp), exp_sha)
            self.assertEqual(hp.stat().st_mtime, mtime_before)

    def test_46_v6_candidate_evidence_unchanged(self):
        """Test 46: V6 candidate evidence unchanged."""
        runner_v6 = REPO_ROOT / receipt_mod.RUNNER_NAME
        prompts_v4 = REPO_ROOT / receipt_mod.STAGE_CONTRACT_PROMPTS_V4_NAME
        intent_v2 = REPO_ROOT / receipt_mod.SEMANTIC_PATCH_INTENT_V2_NAME
        binding_v1 = REPO_ROOT / receipt_mod.CANDIDATE_HOST_BINDING_V1_NAME
        seal_v6 = REPO_ROOT / receipt_mod.CANDIDATE_V6_SEAL_NAME
        smoke_v6 = REPO_ROOT / receipt_mod.E2E_SYNTHETIC_SMOKE_SUMMARY_NAME

        self.assertEqual(_sha(runner_v6), receipt_mod.RUNNER_SHA256)
        self.assertEqual(_sha(prompts_v4), receipt_mod.STAGE_CONTRACT_PROMPTS_V4_SHA256)
        self.assertEqual(_sha(intent_v2), receipt_mod.SEMANTIC_PATCH_INTENT_V2_SHA256)
        self.assertEqual(_sha(binding_v1), receipt_mod.CANDIDATE_HOST_BINDING_V1_SHA256)
        self.assertEqual(_sha(seal_v6), receipt_mod.CANDIDATE_V6_SEAL_SHA256)
        self.assertEqual(_sha(smoke_v6), receipt_mod.E2E_SYNTHETIC_SMOKE_SUMMARY_SHA256)

        _fast_gate(REPO_ROOT)

        self.assertEqual(_sha(runner_v6), receipt_mod.RUNNER_SHA256)
        self.assertEqual(_sha(prompts_v4), receipt_mod.STAGE_CONTRACT_PROMPTS_V4_SHA256)
        self.assertEqual(_sha(intent_v2), receipt_mod.SEMANTIC_PATCH_INTENT_V2_SHA256)
        self.assertEqual(_sha(binding_v1), receipt_mod.CANDIDATE_HOST_BINDING_V1_SHA256)
        self.assertEqual(_sha(seal_v6), receipt_mod.CANDIDATE_V6_SEAL_SHA256)
        self.assertEqual(_sha(smoke_v6), receipt_mod.E2E_SYNTHETIC_SMOKE_SUMMARY_SHA256)


if __name__ == "__main__":
    unittest.main()

