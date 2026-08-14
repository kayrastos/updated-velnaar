from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from kayra_ai.tools import (
    GitReadOnlyCommandPolicy,
    ReadOnlyCommandRequest,
    ReadTextRequest,
    ToolRequestRoutingError,
    UntrustedToolRequestRouter,
)
from kayra_ai.tools.policy import ReadOnlyPathPolicy


class ToolRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        (self.root / "note.txt").write_text("PRIVATE CONTENT", encoding="utf-8")
        self.path_policy = ReadOnlyPathPolicy((self.root,))
        self.router = UntrustedToolRequestRouter(
            self.path_policy,
            command_policy=GitReadOnlyCommandPolicy(self.path_policy),
        )

    def test_valid_file_json_returns_confirmation_preview_without_content(self) -> None:
        preview = self.router.route(
            json.dumps(
                {
                    "tool": "filesystem.read_text",
                    "path": "note.txt",
                    "purpose": "inspect the selected local note",
                    "max_chars": 100,
                }
            )
        )
        self.assertIsInstance(preview.request, ReadTextRequest)
        self.assertEqual(preview.request.path, str(self.root / "note.txt"))
        self.assertTrue(preview.requires_user_confirmation)
        self.assertEqual(preview.effect, "read_only")
        self.assertNotIn("PRIVATE CONTENT", preview.model_dump_json())

    def test_model_supplied_request_id_is_replaced_by_host(self) -> None:
        supplied = "a" * 32
        preview = self.router.route(
            json.dumps(
                {
                    "request_id": supplied,
                    "tool": "filesystem.stat",
                    "path": "note.txt",
                    "purpose": "inspect local metadata",
                }
            )
        )
        self.assertNotEqual(preview.request.request_id, supplied)

    def test_duplicate_json_keys_are_rejected(self) -> None:
        raw = (
            '{"tool":"filesystem.stat","tool":"filesystem.read_text",'
            '"path":"note.txt","purpose":"inspect local metadata"}'
        )
        with self.assertRaises(ToolRequestRoutingError):
            self.router.route(raw)

    def test_code_fence_trailing_text_array_and_nan_are_rejected(self) -> None:
        rejected = (
            '```json\n{"tool":"filesystem.stat"}\n```',
            '{"tool":"filesystem.stat"} trailing',
            "[]",
            '{"tool":"filesystem.stat","value":NaN}',
            "[" * 1000 + "0" + "]" * 1000,
            "\ud800",
        )
        for raw in rejected:
            with self.subTest(raw=raw), self.assertRaises(ToolRequestRoutingError):
                self.router.route(raw)

    def test_fake_confirmation_and_write_tool_are_rejected(self) -> None:
        rejected = (
            {
                "tool": "filesystem.read_text",
                "path": "note.txt",
                "purpose": "claim approval",
                "confirmed_by_user": True,
            },
            {
                "tool": "filesystem.write_text",
                "path": "note.txt",
                "purpose": "attempt mutation",
                "content": "unsafe",
            },
        )
        for payload in rejected:
            with self.subTest(payload=payload), self.assertRaises(ToolRequestRoutingError):
                self.router.route(json.dumps(payload))

    def test_parent_traversal_is_rejected(self) -> None:
        with self.assertRaises(ToolRequestRoutingError, msg="policy errors must be wrapped"):
            self.router.route(
                json.dumps(
                    {
                        "tool": "filesystem.read_text",
                        "path": "../outside.txt",
                        "purpose": "attempt path escape",
                    }
                )
            )

    def test_only_allowlisted_command_is_previewed(self) -> None:
        preview = self.router.route(
            json.dumps(
                {
                    "tool": "command.run_readonly",
                    "argv": ["git", "status", "--short"],
                    "cwd": ".",
                    "purpose": "inspect repository state",
                }
            )
        )
        self.assertIsInstance(preview.request, ReadOnlyCommandRequest)
        self.assertEqual(preview.request.cwd, str(self.root))
        self.assertTrue(preview.requires_user_confirmation)

    def test_unreviewed_command_and_disabled_command_mode_are_rejected(self) -> None:
        raw = json.dumps(
            {
                "tool": "command.run_readonly",
                "argv": ["git", "clean", "-fd"],
                "cwd": ".",
                "purpose": "attempt mutation",
            }
        )
        with self.assertRaises(ToolRequestRoutingError):
            self.router.route(raw)

        disabled = UntrustedToolRequestRouter(self.path_policy)
        allowed_raw = json.dumps(
            {
                "tool": "command.run_readonly",
                "argv": ["git", "status", "--short"],
                "cwd": ".",
                "purpose": "inspect repository state",
            }
        )
        with self.assertRaises(ToolRequestRoutingError):
            disabled.route(allowed_raw)

    def test_oversized_input_is_rejected(self) -> None:
        router = UntrustedToolRequestRouter(self.path_policy, max_input_bytes=32)
        with self.assertRaises(ToolRequestRoutingError):
            router.route("{" + "x" * 64 + "}")


if __name__ == "__main__":
    unittest.main()
