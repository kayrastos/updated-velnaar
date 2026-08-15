from __future__ import annotations

import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from kayra_ai.memory import MemoryDraft, MemoryStore, WriteAuthorization
from kayra_ai.memory.chat_cli import main
from kayra_ai.runtime.contracts import (
    BackendCapabilities,
    GenerationRequest,
    GenerationResponse,
    PreflightResult,
    TimingMetrics,
)
from kayra_ai.runtime.errors import CapabilityUnavailableFailure


PASSPHRASE = "correct horse battery staple"
ROOT = Path(__file__).resolve().parents[1]


class Answers:
    def __init__(self, *values: str) -> None:
        self.values = iter(values)

    def __call__(self, prompt: str) -> str:
        return next(self.values)


class CapturingBackend:
    runtime_name = "lm_studio"
    runtime_version = "test"
    model_id = "kayra"
    model_revision = None
    capabilities = BackendCapabilities(
        thinking="supported",
        non_thinking="supported",
        streaming="unsupported",
        token_usage="supported",
        model_listing="supported",
        source="unverified",
    )

    def __init__(self, *, fail_preflight: bool = False) -> None:
        self.fail_preflight = fail_preflight
        self.last_request: GenerationRequest | None = None

    def probe(self) -> BackendCapabilities:
        return self.capabilities

    def preflight(self) -> PreflightResult:
        if self.fail_preflight:
            raise CapabilityUnavailableFailure("test preflight failure")
        return PreflightResult(
            ok=True,
            backend_name="lm_studio",
            model_available=True,
            capabilities=self.capabilities,
        )

    def generate(self, request: GenerationRequest) -> GenerationResponse:
        self.last_request = request
        return GenerationResponse(
            content="yerel cevap",
            timing=TimingMetrics(total_ms=10, tokens_per_second=12.34),
            effective_profile="non_thinking",
        )


class MemoryChatCliTests(unittest.TestCase):
    def test_conflicting_memory_environment_fails_before_memory_or_backend(self) -> None:
        legacy_value = "legacy-memory-secret.sqlite3"
        current_value = "current-memory-secret.sqlite3"
        output = io.StringIO()
        with (
            patch.dict(
                os.environ,
                {
                    "KAYRA_MEMORY_DB": legacy_value,
                    "FULGOR_MEMORY_DB": current_value,
                },
                clear=True,
            ),
            patch(
                "kayra_ai.memory.chat_cli.MemoryStore",
                side_effect=AssertionError("memory store must not be opened"),
            ),
            patch(
                "pathlib.Path.open",
                side_effect=AssertionError("file must not be opened"),
            ),
            redirect_stdout(output),
        ):
            code = main(
                ["--db", "explicit-memory.sqlite3"],
                input_fn=lambda _prompt: self.fail("question must not be read"),
                password_fn=lambda _prompt: self.fail("password must not be read"),
                working_directory=ROOT,
                backend_factory=lambda _config: self.fail("backend must not be built"),
            )

        message = output.getvalue()
        self.assertEqual(1, code)
        self.assertIn("FULGOR_MEMORY_DB", message)
        self.assertIn("KAYRA_MEMORY_DB", message)
        self.assertNotIn(legacy_value, message)
        self.assertNotIn(current_value, message)

    def test_relevant_memory_is_injected_and_local_response_is_printed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "memory.sqlite3"
            store = MemoryStore(db_path, passphrase=PASSPHRASE)
            store.add(
                MemoryDraft(
                    content="KayraAI yerel ve cevrimdisi calisir.",
                    kind="project",
                    source="user-explicit",
                ),
                authorization=WriteAuthorization(
                    confirmed_by_user=True,
                    purpose="test memory",
                ),
            )
            backend = CapturingBackend()
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--db", str(db_path)],
                    input_fn=Answers("KayraAI nasil calisir?"),
                    password_fn=Answers(PASSPHRASE),
                    working_directory=ROOT,
                    backend_factory=lambda _config: backend,
                )
            self.assertEqual(code, 0)
            self.assertIn("Fulgor Ray: yerel cevap", output.getvalue())
            self.assertIn("Hiz: 12.34 token/sn", output.getvalue())
            assert backend.last_request is not None
            self.assertEqual(2, len(backend.last_request.messages))
            self.assertIn(
                "KayraAI yerel ve cevrimdisi calisir",
                backend.last_request.messages[0].content,
            )

    def test_missing_database_fails_before_password_or_backend(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--db", str(Path(temp_dir) / "missing.sqlite3")],
                    input_fn=lambda _prompt: self.fail("question must not be read"),
                    password_fn=lambda _prompt: self.fail("password must not be read"),
                    working_directory=ROOT,
                    backend_factory=lambda _config: self.fail("backend must not be built"),
                )
            self.assertEqual(code, 1)
            self.assertIn("hafiza veritabani yok", output.getvalue())

    def test_preflight_failure_happens_before_question_is_read(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "memory.sqlite3"
            MemoryStore(db_path, passphrase=PASSPHRASE)
            backend = CapturingBackend(fail_preflight=True)
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(
                    ["--db", str(db_path)],
                    input_fn=lambda _prompt: self.fail("question must not be read"),
                    password_fn=Answers(PASSPHRASE),
                    working_directory=ROOT,
                    backend_factory=lambda _config: backend,
                )
            self.assertEqual(code, 1)
            self.assertIn("HATA:", output.getvalue())


if __name__ == "__main__":
    unittest.main()
