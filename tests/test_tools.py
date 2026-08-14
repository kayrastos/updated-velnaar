from __future__ import annotations

import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from kayra_ai.tools import (
    TOOL_REQUEST_ADAPTER,
    GitReadOnlyCommandPolicy,
    ListDirectoryRequest,
    ReadOnlyCommandExecutor,
    ReadOnlyCommandRequest,
    ReadOnlyFilesystem,
    ReadOnlyPathPolicy,
    ReadTextRequest,
    StatPathRequest,
    ToolApprovalError,
    ToolApprovalGate,
    ToolAuthorization,
    ToolPolicyError,
    build_tool_preview,
    tool_request_digest,
)


NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


def request(path: str = "docs") -> ListDirectoryRequest:
    return ListDirectoryRequest(path=path, purpose="inspect project documentation")


def authorization_for(
    tool_request: ListDirectoryRequest,
    *,
    confirmed_at: datetime = NOW,
    expires_at: datetime | None = None,
) -> ToolAuthorization:
    return ToolAuthorization(
        confirmed_by_user=True,
        request_digest=tool_request_digest(tool_request),
        confirmed_at=confirmed_at,
        expires_at=expires_at or confirmed_at + timedelta(minutes=1),
    )


class ToolContractTests(unittest.TestCase):
    def test_only_declared_read_only_tool_names_are_accepted(self) -> None:
        with self.assertRaises(ValidationError):
            TOOL_REQUEST_ADAPTER.validate_python(
                {
                    "tool": "filesystem.write_text",
                    "path": "README.md",
                    "purpose": "modify project readme",
                    "content": "unsafe",
                }
            )

    def test_unknown_fields_are_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            ListDirectoryRequest(
                path="docs",
                purpose="inspect documentation",
                recursive=True,  # type: ignore[call-arg]
            )

    def test_request_digest_is_stable_and_binds_arguments(self) -> None:
        first = ListDirectoryRequest(
            request_id="a" * 32,
            path="docs",
            purpose="inspect documentation",
        )
        same = ListDirectoryRequest(
            request_id="a" * 32,
            path="docs",
            purpose="inspect documentation",
        )
        changed = ListDirectoryRequest(
            request_id="a" * 32,
            path="src",
            purpose="inspect documentation",
        )
        self.assertEqual(tool_request_digest(first), tool_request_digest(same))
        self.assertNotEqual(tool_request_digest(first), tool_request_digest(changed))

    def test_preview_is_read_only_and_always_requires_confirmation(self) -> None:
        tool_request = request()
        preview = build_tool_preview(tool_request, summary="List project documentation")
        self.assertEqual(preview.effect, "read_only")
        self.assertTrue(preview.requires_user_confirmation)
        self.assertEqual(preview.request_digest, tool_request_digest(tool_request))

    def test_preview_rejects_digest_mismatch(self) -> None:
        tool_request = request()
        with self.assertRaises(ValidationError):
            type(build_tool_preview(tool_request, summary="List documentation"))(
                request=tool_request,
                request_digest="0" * 64,
                summary="List documentation",
            )

    def test_command_request_uses_explicit_argv_and_forbids_shell_field(self) -> None:
        command = ReadOnlyCommandRequest(
            argv=("git", "status", "--short"),
            cwd="/project",
            purpose="inspect repository state",
        )
        self.assertEqual(command.argv, ("git", "status", "--short"))
        with self.assertRaises(ValidationError):
            ReadOnlyCommandRequest(
                argv=("git", "status"),
                cwd="/project",
                purpose="inspect repository state",
                shell=True,  # type: ignore[call-arg]
            )

    def test_nul_is_rejected_from_file_and_command_inputs(self) -> None:
        with self.assertRaises(ValidationError):
            ReadTextRequest(path="bad\x00path", purpose="read a text file")
        with self.assertRaises(ValidationError):
            ReadOnlyCommandRequest(
                argv=("git", "status\x00"),
                cwd="/project",
                purpose="inspect repository state",
            )


class ToolApprovalGateTests(unittest.TestCase):
    def gate(self) -> ToolApprovalGate:
        return ToolApprovalGate(clock=lambda: NOW)

    def test_missing_authorization_is_rejected(self) -> None:
        with self.assertRaises(ToolApprovalError):
            self.gate().require(request(), None)

    def test_authorization_is_bound_to_exact_request(self) -> None:
        approved = request("docs")
        changed = request("src")
        with self.assertRaises(ToolApprovalError):
            self.gate().require(changed, authorization_for(approved))

    def test_expired_authorization_is_rejected(self) -> None:
        tool_request = request()
        auth = authorization_for(
            tool_request,
            confirmed_at=NOW - timedelta(minutes=2),
            expires_at=NOW - timedelta(minutes=1),
        )
        with self.assertRaises(ToolApprovalError):
            self.gate().require(tool_request, auth)

    def test_authorization_is_single_use(self) -> None:
        tool_request = request()
        auth = authorization_for(tool_request)
        gate = self.gate()
        self.assertEqual(gate.require(tool_request, auth), tool_request_digest(tool_request))
        with self.assertRaises(ToolApprovalError):
            gate.require(tool_request, auth)

    def test_authorization_window_cannot_exceed_five_minutes(self) -> None:
        tool_request = request()
        with self.assertRaises(ValidationError):
            authorization_for(
                tool_request,
                expires_at=NOW + timedelta(minutes=6),
            )

    def test_naive_authorization_timestamp_is_rejected(self) -> None:
        tool_request = request()
        with self.assertRaises(ValidationError):
            authorization_for(
                tool_request,
                confirmed_at=datetime(2026, 8, 14, 12, 0),
            )


class ReadOnlyFilesystemTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.gate = ToolApprovalGate(clock=lambda: NOW)
        self.filesystem = ReadOnlyFilesystem(
            ReadOnlyPathPolicy((self.root,), max_file_bytes=32),
            self.gate,
        )

    @staticmethod
    def authorize(tool_request):  # type: ignore[no-untyped-def]
        return ToolAuthorization(
            confirmed_by_user=True,
            request_digest=tool_request_digest(tool_request),
            confirmed_at=NOW,
            expires_at=NOW + timedelta(minutes=1),
        )

    def test_read_text_requires_approval_and_does_not_modify_file(self) -> None:
        path = self.root / "note.txt"
        path.write_text("local only", encoding="utf-8")
        tool_request = ReadTextRequest(path="note.txt", purpose="read local note")
        with self.assertRaises(ToolApprovalError):
            self.filesystem.execute(tool_request, None)
        before = path.read_bytes()
        result = self.filesystem.execute(tool_request, self.authorize(tool_request))
        self.assertEqual(result.text, "local only")
        self.assertEqual(path.read_bytes(), before)

    def test_read_text_is_truncated_by_character_limit(self) -> None:
        (self.root / "note.txt").write_text("abcdef", encoding="utf-8")
        tool_request = ReadTextRequest(
            path="note.txt",
            purpose="read local note",
            max_chars=3,
        )
        result = self.filesystem.execute(tool_request, self.authorize(tool_request))
        self.assertEqual(result.text, "abc")
        self.assertTrue(result.truncated)

    def test_binary_and_oversized_files_are_rejected(self) -> None:
        (self.root / "binary.bin").write_bytes(b"abc\x00def")
        binary_request = ReadTextRequest(path="binary.bin", purpose="inspect binary")
        with self.assertRaises(ToolPolicyError):
            self.filesystem.execute(binary_request, self.authorize(binary_request))

        (self.root / "large.txt").write_text("x" * 33, encoding="utf-8")
        large_request = ReadTextRequest(path="large.txt", purpose="inspect large text")
        with self.assertRaises(ToolPolicyError):
            self.filesystem.execute(large_request, self.authorize(large_request))

    def test_directory_listing_is_sorted_bounded_and_non_recursive(self) -> None:
        (self.root / "b.txt").write_text("b", encoding="utf-8")
        (self.root / "A.txt").write_text("a", encoding="utf-8")
        (self.root / "nested").mkdir()
        (self.root / "nested" / "hidden.txt").write_text("hidden", encoding="utf-8")
        tool_request = ListDirectoryRequest(
            path=".",
            purpose="list selected root",
            max_entries=2,
        )
        result = self.filesystem.execute(tool_request, self.authorize(tool_request))
        self.assertEqual([entry.name for entry in result.entries], ["A.txt", "b.txt"])
        self.assertTrue(result.truncated)

    def test_stat_returns_metadata_without_content(self) -> None:
        (self.root / "note.txt").write_text("hello", encoding="utf-8")
        tool_request = StatPathRequest(path="note.txt", purpose="inspect file metadata")
        result = self.filesystem.execute(tool_request, self.authorize(tool_request))
        self.assertEqual(result.kind, "file")
        self.assertEqual(result.size_bytes, 5)

    def test_parent_traversal_and_outside_absolute_path_are_rejected(self) -> None:
        outside = self.root.parent / "outside.txt"
        outside.write_text("outside", encoding="utf-8")
        for path in ("../outside.txt", str(outside)):
            tool_request = ReadTextRequest(path=path, purpose="attempt outside read")
            with self.assertRaises(ToolPolicyError):
                self.filesystem.execute(tool_request, self.authorize(tool_request))

    def test_sensitive_paths_are_rejected(self) -> None:
        (self.root / ".env").write_text("SECRET=value", encoding="utf-8")
        tool_request = ReadTextRequest(path=".env", purpose="attempt secret read")
        with self.assertRaises(ToolPolicyError):
            self.filesystem.execute(tool_request, self.authorize(tool_request))

    def test_sensitive_names_are_hidden_from_directory_listing(self) -> None:
        (self.root / ".env").write_text("SECRET=value", encoding="utf-8")
        (self.root / "public.txt").write_text("public", encoding="utf-8")
        tool_request = ListDirectoryRequest(path=".", purpose="list selected root")
        result = self.filesystem.execute(tool_request, self.authorize(tool_request))
        self.assertEqual([entry.name for entry in result.entries], ["public.txt"])

    def test_symlink_is_rejected_even_when_target_is_inside_root(self) -> None:
        target = self.root / "target.txt"
        target.write_text("target", encoding="utf-8")
        link = self.root / "link.txt"
        try:
            link.symlink_to(target)
        except OSError:
            self.skipTest("symlink creation is unavailable")
        tool_request = ReadTextRequest(path="link.txt", purpose="attempt symlink read")
        with self.assertRaises(ToolPolicyError):
            self.filesystem.execute(tool_request, self.authorize(tool_request))

    def test_command_request_cannot_enter_filesystem_executor(self) -> None:
        tool_request = ReadOnlyCommandRequest(
            argv=("git", "status"),
            cwd=str(self.root),
            purpose="inspect repository state",
        )
        with self.assertRaises(ToolPolicyError):
            self.filesystem.execute(tool_request, self.authorize(tool_request))


class ReadOnlyCommandExecutorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        path_policy = ReadOnlyPathPolicy((self.root,))
        self.gate = ToolApprovalGate(clock=lambda: NOW)
        self.policy = GitReadOnlyCommandPolicy(path_policy)
        self.executor = ReadOnlyCommandExecutor(self.policy, self.gate)

    @staticmethod
    def authorize(tool_request):  # type: ignore[no-untyped-def]
        return ToolAuthorization(
            confirmed_by_user=True,
            request_digest=tool_request_digest(tool_request),
            confirmed_at=NOW,
            expires_at=NOW + timedelta(minutes=1),
        )

    def command(self, argv=("git", "status", "--short"), **kwargs):  # type: ignore[no-untyped-def]
        return ReadOnlyCommandRequest(
            argv=argv,
            cwd=str(self.root),
            purpose="inspect repository state",
            **kwargs,
        )

    def test_command_requires_explicit_user_approval(self) -> None:
        with self.assertRaises(ToolApprovalError):
            self.executor.execute(self.command(), None)

    def test_non_git_and_unreviewed_git_arguments_are_rejected(self) -> None:
        rejected = (
            ("rm", "-rf", "."),
            ("git", "status", ";", "touch", "owned"),
            ("git", "diff", "--output=owned.txt"),
            ("git", "clean", "-fd"),
        )
        for argv in rejected:
            tool_request = self.command(argv)
            with self.subTest(argv=argv), self.assertRaises(ToolPolicyError):
                self.executor.execute(tool_request, self.authorize(tool_request))

    def test_working_directory_must_remain_inside_allowed_root(self) -> None:
        outside = self.root.parent
        tool_request = ReadOnlyCommandRequest(
            argv=("git", "status", "--short"),
            cwd=str(outside),
            purpose="attempt outside command",
        )
        with self.assertRaises(ToolPolicyError):
            self.executor.execute(tool_request, self.authorize(tool_request))

    def test_executor_uses_no_shell_minimum_environment_and_git_safety_flags(self) -> None:
        tool_request = self.command(("git", "diff", "--check"))

        def fake_run(argv, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["stdout"].write(b"clean\n")
            self.assertFalse(kwargs["shell"])
            self.assertIs(kwargs["stdin"], subprocess.DEVNULL)
            self.assertNotIn("HOME", kwargs["env"])
            self.assertEqual(kwargs["env"]["GIT_OPTIONAL_LOCKS"], "0")
            self.assertEqual(kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")
            self.assertIn("--no-pager", argv)
            self.assertIn("--no-ext-diff", argv)
            self.assertIn("--no-textconv", argv)
            return subprocess.CompletedProcess(argv, 0)

        with patch("kayra_ai.tools.commands.subprocess.run", side_effect=fake_run):
            result = self.executor.execute(tool_request, self.authorize(tool_request))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "clean\n")
        self.assertFalse(result.timed_out)

    def test_reviewed_git_status_runs_in_temporary_repository(self) -> None:
        subprocess.run(
            (str(self.policy.git_executable), "init", "-q"),
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            shell=False,
        )
        tool_request = self.command()
        result = self.executor.execute(tool_request, self.authorize(tool_request))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertFalse(result.timed_out)

    def test_output_is_bounded_and_reported_as_truncated(self) -> None:
        tool_request = self.command(max_output_chars=5)

        def fake_run(argv, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["stdout"].write(b"0123456789")
            kwargs["stderr"].write(b"abcdefghij")
            return subprocess.CompletedProcess(argv, 0)

        with patch("kayra_ai.tools.commands.subprocess.run", side_effect=fake_run):
            result = self.executor.execute(tool_request, self.authorize(tool_request))
        self.assertEqual(result.stdout, "01234")
        self.assertEqual(result.stderr, "abcde")
        self.assertTrue(result.stdout_truncated)
        self.assertTrue(result.stderr_truncated)

    def test_timeout_is_structured_result(self) -> None:
        tool_request = self.command(timeout_seconds=0.1)
        with patch(
            "kayra_ai.tools.commands.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd=("git", "status"), timeout=0.1),
        ):
            result = self.executor.execute(tool_request, self.authorize(tool_request))
        self.assertTrue(result.timed_out)
        self.assertIsNone(result.returncode)


if __name__ == "__main__":
    unittest.main()
