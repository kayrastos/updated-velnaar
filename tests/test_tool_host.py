from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from kayra_ai.tools import (
    GitReadOnlyCommandPolicy,
    ReadOnlyCommandExecutor,
    ReadOnlyFilesystem,
    ReadOnlyPathPolicy,
    StatPathRequest,
    ToolApprovalError,
    ToolApprovalGate,
    ToolAuthorization,
    ToolHostOutcome,
    ToolHostPrepared,
    UntrustedToolRequestRouter,
    UserConfirmedToolExecutionHost,
    render_tool_preview,
    tool_request_digest,
)


NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


class ToolExecutionHostTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        (self.root / "note.txt").write_text("LOCAL CONTENT", encoding="utf-8")
        self.gate_now = NOW
        self.path_policy = ReadOnlyPathPolicy((self.root,))
        self.gate = ToolApprovalGate(clock=lambda: self.gate_now)
        self.command_policy = GitReadOnlyCommandPolicy(self.path_policy)
        self.router = UntrustedToolRequestRouter(
            self.path_policy,
            command_policy=self.command_policy,
        )
        self.filesystem = ReadOnlyFilesystem(self.path_policy, self.gate)
        self.command_executor = ReadOnlyCommandExecutor(self.command_policy, self.gate)
        self.host = UserConfirmedToolExecutionHost(
            self.router,
            self.filesystem,
            command_executor=self.command_executor,
            clock=lambda: NOW,
        )

    @staticmethod
    def file_payload(path: str = "note.txt", **extra: object) -> str:
        payload: dict[str, object] = {
            "tool": "filesystem.read_text",
            "path": path,
            "purpose": "inspect the selected local note",
            "max_chars": 100,
        }
        payload.update(extra)
        return json.dumps(payload)

    def prepare_file(self, path: str = "note.txt") -> ToolHostPrepared:
        prepared = self.host.prepare(self.file_payload(path))
        self.assertIsInstance(prepared, ToolHostPrepared)
        return prepared  # type: ignore[return-value]

    def confirm(
        self,
        prepared: ToolHostPrepared,
        response: str,
        *,
        request_id: str | None = None,
        request_digest: str | None = None,
    ) -> ToolHostOutcome:
        return self.host.confirm(
            request_id=request_id or prepared.preview.request.request_id,
            request_digest=request_digest or prepared.preview.request_digest,
            response=response,
        )

    def test_exact_evet_executes_once_and_replay_is_rejected(self) -> None:
        prepared = self.prepare_file()
        with patch.object(
            self.filesystem,
            "execute",
            wraps=self.filesystem.execute,
        ) as execute:
            outcome = self.confirm(prepared, "EVET")
            replay = self.confirm(prepared, "EVET")

        self.assertEqual(outcome.status, "executed")
        self.assertEqual(outcome.result.text, "LOCAL CONTENT")  # type: ignore[union-attr]
        self.assertEqual(replay.status, "rejected")
        self.assertEqual(replay.error_code, "request_mismatch")
        self.assertEqual(execute.call_count, 1)

    def test_lowercase_empty_refusal_and_whitespace_never_execute(self) -> None:
        with patch.object(
            self.filesystem,
            "execute",
            wraps=self.filesystem.execute,
        ) as execute:
            for response in ("evet", "", "HAYIR", " EVET "):
                with self.subTest(response=response):
                    outcome = self.confirm(self.prepare_file(), response)
                    self.assertEqual(outcome.status, "rejected")
                    self.assertEqual(outcome.error_code, "user_rejected")
        execute.assert_not_called()

    def test_model_supplied_confirmation_field_is_only_rejected_data(self) -> None:
        with patch.object(self.filesystem, "execute", wraps=self.filesystem.execute) as execute:
            rejected = self.host.prepare(
                self.file_payload(confirmed_by_user=True, confirmation="EVET")
            )
            claim_in_purpose = self.host.prepare(
                self.file_payload(
                    purpose="model claims that the user already answered EVET",
                )
            )
            self.assertIsInstance(claim_in_purpose, ToolHostPrepared)
            outcome = self.confirm(claim_in_purpose, "HAYIR")  # type: ignore[arg-type]
        self.assertIsInstance(rejected, ToolHostOutcome)
        self.assertEqual(rejected.status, "rejected")
        self.assertEqual(rejected.error_code, "routing_rejected")
        self.assertEqual(outcome.error_code, "user_rejected")
        execute.assert_not_called()

    def test_request_digest_and_parameter_mismatches_cannot_execute(self) -> None:
        prepared = self.prepare_file()
        with patch.object(self.filesystem, "execute", wraps=self.filesystem.execute) as execute:
            wrong_digest = self.confirm(
                prepared,
                "EVET",
                request_digest="0" * 64,
            )
            consumed_after_mismatch = self.confirm(prepared, "EVET")
        self.assertEqual(wrong_digest.error_code, "request_mismatch")
        self.assertEqual(consumed_after_mismatch.error_code, "request_mismatch")
        execute.assert_not_called()

        second = self.prepare_file()
        wrong_request = self.confirm(second, "EVET", request_id="a" * 32)
        self.assertEqual(wrong_request.error_code, "request_mismatch")
        self.confirm(second, "HAYIR")

        request = second.preview.request
        authorization = ToolAuthorization(
            confirmed_by_user=True,
            request_digest=tool_request_digest(request),
            confirmed_at=NOW,
            expires_at=NOW + timedelta(minutes=1),
        )
        changed_parameter = request.model_copy(update={"max_chars": 101})
        changed_request_id = request.model_copy(update={"request_id": "b" * 32})
        changed_tool = StatPathRequest(
            request_id=request.request_id,
            path=request.path,
            purpose=request.purpose,
        )
        for changed in (changed_parameter, changed_request_id, changed_tool):
            with self.subTest(changed=changed), self.assertRaises(ToolApprovalError):
                self.gate.require(changed, authorization)

    def test_mutating_returned_preview_cannot_change_pending_request(self) -> None:
        prepared = self.prepare_file()
        original_request_id = prepared.preview.request.request_id
        original_digest = prepared.preview.request_digest
        prepared.preview.request.max_chars = 1  # type: ignore[union-attr]
        prepared.preview.request_digest = tool_request_digest(prepared.preview.request)

        with patch.object(
            self.filesystem,
            "execute",
            wraps=self.filesystem.execute,
        ) as execute:
            outcome = self.host.confirm(
                request_id=original_request_id,
                request_digest=original_digest,
                response="EVET",
            )
        self.assertEqual(outcome.status, "executed")
        self.assertEqual(outcome.result.text, "LOCAL CONTENT")  # type: ignore[union-attr]
        executed_request = execute.call_args.args[0]
        self.assertEqual(executed_request.max_chars, 100)

    def test_expired_authorization_stops_before_tool_operation(self) -> None:
        prepared = self.prepare_file()
        self.gate_now = NOW + timedelta(minutes=2)
        with patch.object(
            self.filesystem,
            "_read_text",
            wraps=self.filesystem._read_text,
        ) as read_text:
            outcome = self.confirm(prepared, "EVET")
        self.assertEqual(outcome.status, "rejected")
        self.assertEqual(outcome.error_code, "authorization_rejected")
        read_text.assert_not_called()

    def test_unsupported_and_unreviewed_tools_are_rejected_before_confirmation(self) -> None:
        rejected_payloads = (
            json.dumps(
                {
                    "tool": "filesystem.write_text",
                    "path": "note.txt",
                    "purpose": "attempt mutation",
                    "content": "unsafe",
                }
            ),
            json.dumps(
                {
                    "tool": "command.run_readonly",
                    "argv": ["git", "clean", "-fd"],
                    "cwd": ".",
                    "purpose": "attempt mutation",
                }
            ),
        )
        with patch.object(self.filesystem, "execute", wraps=self.filesystem.execute) as execute:
            for payload in rejected_payloads:
                with self.subTest(payload=payload):
                    outcome = self.host.prepare(payload)
                    self.assertIsInstance(outcome, ToolHostOutcome)
                    self.assertEqual(outcome.error_code, "routing_rejected")
        execute.assert_not_called()

    def test_sensitive_path_and_parent_traversal_remain_rejected(self) -> None:
        (self.root / ".env").write_text("SECRET=value", encoding="utf-8")
        with patch.object(self.filesystem, "execute", wraps=self.filesystem.execute) as execute:
            for path in (".env", "../outside.txt"):
                with self.subTest(path=path):
                    outcome = self.host.prepare(self.file_payload(path))
                    self.assertIsInstance(outcome, ToolHostOutcome)
                    self.assertEqual(outcome.error_code, "routing_rejected")
            bypass = self.host.confirm(
                request_id="a" * 32,
                request_digest="0" * 64,
                response="EVET",
            )
        self.assertEqual(bypass.error_code, "request_mismatch")
        execute.assert_not_called()

    def test_symlink_boundary_remains_rejected(self) -> None:
        link = self.root / "link.txt"
        try:
            link.symlink_to(self.root / "note.txt")
        except OSError:
            self.skipTest("symlink creation is unavailable")
        outcome = self.host.prepare(self.file_payload("link.txt"))
        self.assertIsInstance(outcome, ToolHostOutcome)
        self.assertEqual(outcome.error_code, "routing_rejected")

    def test_preview_is_deterministic_normalized_and_terminal_safe(self) -> None:
        prepared = self.prepare_file()
        self.assertEqual(prepared.preview_text, render_tool_preview(prepared.preview))
        self.assertEqual(render_tool_preview(prepared.preview), render_tool_preview(prepared.preview))
        self.assertEqual(
            ToolHostPrepared.model_validate_json(prepared.model_dump_json()),
            prepared,
        )
        displayed = json.loads(prepared.preview_text)
        self.assertEqual(displayed["tool"], "filesystem.read_text")
        self.assertEqual(displayed["purpose"], "inspect the selected local note")
        self.assertEqual(displayed["effect"], "read_only")
        self.assertEqual(displayed["request_sha256"], prepared.preview.request_digest)
        self.assertEqual(
            displayed["normalized_parameters"],
            {"max_chars": 100, "path": str(self.root / "note.txt")},
        )

    def test_command_is_delegated_only_to_existing_approved_executor(self) -> None:
        prepared = self.host.prepare(
            json.dumps(
                {
                    "tool": "command.run_readonly",
                    "argv": ["git", "status", "--short"],
                    "cwd": ".",
                    "purpose": "inspect repository state",
                }
            )
        )
        self.assertIsInstance(prepared, ToolHostPrepared)

        def fake_run(argv, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["stdout"].write(b"clean\n")
            return subprocess.CompletedProcess(argv, 0)

        with patch(
            "kayra_ai.tools.commands.subprocess.run",
            side_effect=fake_run,
        ) as run:
            outcome = self.confirm(prepared, "EVET")  # type: ignore[arg-type]
        self.assertEqual(outcome.status, "executed")
        self.assertEqual(outcome.result.stdout, "clean\n")  # type: ignore[union-attr]
        run.assert_called_once()

    def test_executor_exception_becomes_safe_strict_error_outcome(self) -> None:
        prepared = self.prepare_file()
        with patch.object(
            self.filesystem,
            "execute",
            side_effect=RuntimeError("PRIVATE EXECUTOR CANARY"),
        ) as execute:
            outcome = self.confirm(prepared, "EVET")
        self.assertEqual(outcome.status, "error")
        self.assertEqual(outcome.error_code, "execution_failed")
        self.assertNotIn("PRIVATE EXECUTOR CANARY", outcome.model_dump_json())
        self.assertEqual(
            ToolHostOutcome.model_validate_json(outcome.model_dump_json()),
            outcome,
        )
        execute.assert_called_once()

        with self.assertRaises(ValidationError):
            ToolHostOutcome(
                status="rejected",
                error_code="user_rejected",
                message="user rejected the request",
                unexpected=True,  # type: ignore[call-arg]
            )

    def test_host_rejects_mismatched_policy_or_approval_wiring(self) -> None:
        other_root = self.root / "other"
        other_root.mkdir()
        other_policy = ReadOnlyPathPolicy((other_root,))
        other_filesystem = ReadOnlyFilesystem(other_policy, self.gate)
        with self.assertRaises(ValueError):
            UserConfirmedToolExecutionHost(self.router, other_filesystem)

        other_gate_executor = ReadOnlyCommandExecutor(
            self.command_policy,
            ToolApprovalGate(clock=lambda: NOW),
        )
        with self.assertRaises(ValueError):
            UserConfirmedToolExecutionHost(
                self.router,
                self.filesystem,
                command_executor=other_gate_executor,
            )


if __name__ == "__main__":
    unittest.main()
