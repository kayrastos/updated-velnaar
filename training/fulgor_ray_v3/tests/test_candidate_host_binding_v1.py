"""Unit and adversarial tests for candidate_host_binding_v1.py."""

import hashlib
from pathlib import Path
import tempfile
import unittest

from training.fulgor_ray_v3.candidate_host_binding_v1 import (
    CandidateAnchorDerivationError,
    CandidateFileMembershipError,
    CandidateHostBindingError,
    CandidateLineSpanError,
    bind_candidate_intent_to_host_patch,
)
from training.fulgor_ray_v3.patch_serializer import serialize
from training.fulgor_ray_v3.schemas import EditKind
from training.fulgor_ray_v3.semantic_patch_intent_v2 import SemanticEditIntent, SemanticPatchIntentV2
from training.fulgor_ray_v3.static_gate import evaluate


class MockGate:
    def dry_run(self, unified_diff: str):
        return True, "OK"


class TestCandidateHostBindingV1(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.root = Path(self.td.name)
        self.file1 = "pkg/service.py"
        target = self.root / self.file1
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("line1\nline2\nline3\nline4\nline5\n", encoding="utf-8")
        self.repo_files = (self.file1,)
        self.allowed_files = (self.file1,)

    def tearDown(self):
        self.td.cleanup()

    def _make_intent(self, *edits):
        return SemanticPatchIntentV2(
            candidate_id="c-test",
            diagnosis_hash="d" * 64,
            plan_hash="p" * 64,
            edits=tuple(edits),
            rationale="test rationale",
            expected_fail_to_pass_effect="test effect",
            regression_risks=(),
        )

    def test_replace_single_line(self):
        edit = SemanticEditIntent(EditKind.REPLACE, self.file1, 2, 2, "new_line2\n")
        bound_patch, provs = bind_candidate_intent_to_host_patch(
            self.root, self.repo_files, self._make_intent(edit), self.allowed_files
        )
        self.assertEqual(len(bound_patch.edits), 1)
        e = bound_patch.edits[0]
        self.assertEqual(e.expected_preimage_sha256, hashlib.sha256(b"line2\n").hexdigest())
        self.assertEqual(e.anchor, "line2\n")

        # Serializer compatibility
        ser = serialize(self.root, bound_patch)
        self.assertIn("-line2\n+new_line2\n", ser.unified_diff)

    def test_replace_multiple_lines(self):
        edit = SemanticEditIntent(EditKind.REPLACE, self.file1, 2, 4, "replaced_span\n")
        bound_patch, provs = bind_candidate_intent_to_host_patch(
            self.root, self.repo_files, self._make_intent(edit), self.allowed_files
        )
        e = bound_patch.edits[0]
        expected_preimage = "line2\nline3\nline4\n"
        self.assertEqual(e.expected_preimage_sha256, hashlib.sha256(expected_preimage.encode()).hexdigest())

        ser = serialize(self.root, bound_patch)
        self.assertIn("-line2\n-line3\n-line4\n+replaced_span\n", ser.unified_diff)

    def test_delete_single_line(self):
        edit = SemanticEditIntent(EditKind.DELETE, self.file1, 3, 3, "")
        bound_patch, provs = bind_candidate_intent_to_host_patch(
            self.root, self.repo_files, self._make_intent(edit), self.allowed_files
        )
        e = bound_patch.edits[0]
        self.assertEqual(e.kind, EditKind.DELETE)
        self.assertEqual(e.expected_preimage_sha256, hashlib.sha256(b"line3\n").hexdigest())

        ser = serialize(self.root, bound_patch)
        self.assertIn("-line3\n", ser.unified_diff)
        self.assertNotIn("+", [line[0] for line in ser.unified_diff.splitlines() if not line.startswith("+++")])

    def test_delete_multiple_lines(self):
        edit = SemanticEditIntent(EditKind.DELETE, self.file1, 2, 4, "")
        bound_patch, provs = bind_candidate_intent_to_host_patch(
            self.root, self.repo_files, self._make_intent(edit), self.allowed_files
        )
        ser = serialize(self.root, bound_patch)
        self.assertIn("-line2\n-line3\n-line4\n", ser.unified_diff)

    def test_insert_at_beginning(self):
        edit = SemanticEditIntent(EditKind.INSERT, self.file1, 1, 0, "header\n")
        bound_patch, provs = bind_candidate_intent_to_host_patch(
            self.root, self.repo_files, self._make_intent(edit), self.allowed_files
        )
        ser = serialize(self.root, bound_patch)
        self.assertIn("+header\n line1\n", ser.unified_diff)

    def test_insert_in_middle(self):
        edit = SemanticEditIntent(EditKind.INSERT, self.file1, 3, 2, "middle\n")
        bound_patch, provs = bind_candidate_intent_to_host_patch(
            self.root, self.repo_files, self._make_intent(edit), self.allowed_files
        )
        ser = serialize(self.root, bound_patch)
        self.assertIn(" line2\n+middle\n line3\n", ser.unified_diff)

    def test_insert_at_eof(self):
        # File has 5 lines, so insert at EOF is start=6, end=5
        edit = SemanticEditIntent(EditKind.INSERT, self.file1, 6, 5, "footer\n")
        bound_patch, provs = bind_candidate_intent_to_host_patch(
            self.root, self.repo_files, self._make_intent(edit), self.allowed_files
        )
        ser = serialize(self.root, bound_patch)
        self.assertIn(" line5\n+footer\n", ser.unified_diff)

    def test_out_of_inventory_file_rejected(self):
        edit = SemanticEditIntent(EditKind.REPLACE, "pkg/missing.py", 1, 1, "x\n")
        with self.assertRaises(CandidateFileMembershipError):
            bind_candidate_intent_to_host_patch(
                self.root, self.repo_files, self._make_intent(edit), ("pkg/missing.py",)
            )

    def test_out_of_scope_file_rejected(self):
        other_file = "pkg/other.py"
        (self.root / other_file).write_text("hello\n", encoding="utf-8")
        edit = SemanticEditIntent(EditKind.REPLACE, other_file, 1, 1, "x\n")
        with self.assertRaises(CandidateFileMembershipError):
            bind_candidate_intent_to_host_patch(
                self.root, (self.file1, other_file), self._make_intent(edit), self.allowed_files
            )

    def test_line_span_out_of_bounds_rejected(self):
        # File has 5 lines; line 10 is invalid
        edit = SemanticEditIntent(EditKind.REPLACE, self.file1, 10, 11, "x\n")
        with self.assertRaises(CandidateLineSpanError):
            bind_candidate_intent_to_host_patch(
                self.root, self.repo_files, self._make_intent(edit), self.allowed_files
            )

    def test_insert_line_span_out_of_bounds_rejected(self):
        # File has 5 lines; insert start=8, end=7 is out of bounds
        edit = SemanticEditIntent(EditKind.INSERT, self.file1, 8, 7, "x\n")
        with self.assertRaises(CandidateLineSpanError):
            bind_candidate_intent_to_host_patch(
                self.root, self.repo_files, self._make_intent(edit), self.allowed_files
            )

    def test_ambiguous_anchor_rejected(self):
        target = self.root / "pkg/dup.py"
        target.write_text("dup\ndup\ndup\n", encoding="utf-8")
        edit = SemanticEditIntent(EditKind.REPLACE, "pkg/dup.py", 1, 1, "x\n")
        with self.assertRaises(CandidateAnchorDerivationError):
            bind_candidate_intent_to_host_patch(
                self.root, ("pkg/dup.py",), self._make_intent(edit), ("pkg/dup.py",)
            )

    def test_static_gate_evaluation_on_bound_patch(self):
        edit = SemanticEditIntent(EditKind.REPLACE, self.file1, 2, 2, "new_line2\n")
        bound_patch, _ = bind_candidate_intent_to_host_patch(
            self.root, self.repo_files, self._make_intent(edit), self.allowed_files
        )
        ser = serialize(self.root, bound_patch)
        gate_res = evaluate(bound_patch, ser, self.allowed_files, MockGate())
        self.assertTrue(gate_res.accepted)
        self.assertEqual(gate_res.reason_codes, ())


if __name__ == "__main__":
    unittest.main()
