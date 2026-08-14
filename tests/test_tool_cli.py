from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

from kayra_ai.tools.cli import main


NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


class Answers:
    def __init__(self, *values: str) -> None:
        self.values = iter(values)

    def __call__(self, prompt: str) -> str:
        return next(self.values)


class ToolCliTests(unittest.TestCase):
    def test_read_without_exact_confirmation_does_not_expose_content(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            secret = "THIS MUST NOT BE PRINTED"
            (root / "note.txt").write_text(secret, encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--root", str(root), "read", "note.txt"],
                    input_fn=Answers("evet"),
                    clock=lambda: NOW,
                )
            self.assertEqual(code, 2)
            self.assertIn("IPTAL", output.getvalue())
            self.assertNotIn(secret, output.getvalue())

    def test_list_shows_preview_and_hides_sensitive_names(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "public.txt").write_text("public", encoding="utf-8")
            (root / ".env").write_text("SECRET=value", encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--root", str(root), "list", "."],
                    input_fn=Answers("EVET"),
                    clock=lambda: NOW,
                )
            rendered = output.getvalue()
            self.assertEqual(code, 0)
            self.assertIn("ARAC ONIZLEMESI", rendered)
            self.assertIn("Istek SHA256", rendered)
            self.assertIn("public.txt", rendered)
            self.assertNotIn(".env", rendered)

    def test_read_escapes_terminal_control_characters(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "note.txt").write_text("safe\x1b[31mred", encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--root", str(root), "read", "note.txt"],
                    input_fn=Answers("EVET"),
                    clock=lambda: NOW,
                )
            self.assertEqual(code, 0)
            self.assertNotIn("\x1b", output.getvalue())
            self.assertIn("\\u001b[31mred", output.getvalue())

    def test_parent_traversal_is_rejected_before_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            root = base / "allowed"
            root.mkdir()
            (base / "outside.txt").write_text("outside", encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--root", str(root), "read", "../outside.txt"],
                    input_fn=Answers(),
                    clock=lambda: NOW,
                )
            self.assertEqual(code, 1)
            self.assertIn("HATA:", output.getvalue())
            self.assertNotIn("outside\n", output.getvalue())

    def test_symlink_root_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            real_root = base / "real"
            real_root.mkdir()
            linked_root = base / "linked"
            try:
                linked_root.symlink_to(real_root, target_is_directory=True)
            except OSError:
                self.skipTest("symlink creation is unavailable")
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--root", str(linked_root), "list", "."],
                    input_fn=Answers(),
                    clock=lambda: NOW,
                )
            self.assertEqual(code, 1)
            self.assertIn("symlink olamaz", output.getvalue())

    def test_git_status_runs_only_after_confirmation(self) -> None:
        git = shutil.which("git")
        if git is None:
            self.skipTest("git executable is unavailable")
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            subprocess.run(
                (git, "init", "-q"),
                cwd=root,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                shell=False,
            )
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--root", str(root), "git-status", "--tracked-only"],
                    input_fn=Answers("EVET"),
                    clock=lambda: NOW,
                )
            self.assertEqual(code, 0)
            self.assertIn("git status --short --branch --untracked-files=no", output.getvalue())
            self.assertIn("returncode=0", output.getvalue())


if __name__ == "__main__":
    unittest.main()
