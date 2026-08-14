from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

from kayra_ai.tools import (
    TOOL_REQUEST_ADAPTER,
    ListDirectoryRequest,
    ReadOnlyCommandRequest,
    ReadTextRequest,
    ToolApprovalError,
    ToolApprovalGate,
    ToolAuthorization,
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


if __name__ == "__main__":
    unittest.main()
