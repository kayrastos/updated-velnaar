from __future__ import annotations

import io
import sqlite3
import tempfile
import unittest
from contextlib import closing, redirect_stdout
from pathlib import Path

from kayra_ai.memory.cli import main


PASSPHRASE = "correct horse battery staple"


class Answers:
    def __init__(self, *values: str) -> None:
        self.values = iter(values)

    def __call__(self, prompt: str) -> str:
        return next(self.values)


class MemoryCliTests(unittest.TestCase):
    def test_add_search_delete_flow_and_no_plaintext_at_rest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "memory.sqlite3"
            common = ["--db", str(db_path)]
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    [*common, "add", "--kind", "preference", "--tags", "local,ui"],
                    input_fn=Answers("Kullanici koyu temayi tercih ediyor", "EVET"),
                    password_fn=Answers(PASSPHRASE, PASSPHRASE),
                    working_directory=Path(temp_dir),
                )
            self.assertEqual(code, 0)
            memory_id = output.getvalue().strip().rsplit(" ", 1)[-1]
            self.assertNotIn(b"Kullanici koyu temayi tercih ediyor", db_path.read_bytes())

            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    [*common, "search"],
                    input_fn=Answers("koyu tema"),
                    password_fn=Answers(PASSPHRASE),
                    working_directory=Path(temp_dir),
                )
            self.assertEqual(code, 0)
            self.assertIn(memory_id, output.getvalue())
            self.assertIn("koyu temayi", output.getvalue())

            with redirect_stdout(io.StringIO()):
                code = main(
                    [*common, "delete", memory_id],
                    input_fn=Answers("EVET"),
                    password_fn=Answers(PASSPHRASE),
                    working_directory=Path(temp_dir),
                )
            self.assertEqual(code, 0)

            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    [*common, "search"],
                    input_fn=Answers("koyu tema"),
                    password_fn=Answers(PASSPHRASE),
                    working_directory=Path(temp_dir),
                )
            self.assertEqual(code, 0)
            self.assertIn("bulunamadi", output.getvalue())

    def test_add_without_exact_confirmation_does_not_persist(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "memory.sqlite3"
            with redirect_stdout(io.StringIO()):
                code = main(
                    ["--db", str(db_path), "add", "--kind", "note"],
                    input_fn=Answers("Kaydedilmemeli", "evet"),
                    password_fn=Answers(PASSPHRASE, PASSPHRASE),
                    working_directory=Path(temp_dir),
                )
            self.assertEqual(code, 2)
            with closing(sqlite3.connect(db_path)) as connection:
                count = connection.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
            self.assertEqual(count, 0)

    def test_wrong_passphrase_returns_error_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "memory.sqlite3"
            with redirect_stdout(io.StringIO()):
                main(
                    ["--db", str(db_path), "search"],
                    input_fn=Answers("test"),
                    password_fn=Answers(PASSPHRASE, PASSPHRASE),
                    working_directory=Path(temp_dir),
                )
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--db", str(db_path), "search"],
                    input_fn=Answers("test"),
                    password_fn=Answers("wrong passphrase value"),
                    working_directory=Path(temp_dir),
                )
            self.assertEqual(code, 1)
            self.assertIn("HATA:", output.getvalue())

    def test_database_inside_repository_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            (repo / ".git").mkdir()
            (repo / "pyproject.toml").write_text("[project]\n", encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--db", str(repo / "memory.sqlite3"), "search"],
                    input_fn=Answers("test"),
                    password_fn=Answers(PASSPHRASE, PASSPHRASE),
                    working_directory=repo,
                )
            self.assertEqual(code, 1)
            self.assertIn("Git deposunun disinda", output.getvalue())


if __name__ == "__main__":
    unittest.main()
