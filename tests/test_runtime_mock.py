from __future__ import annotations

import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.runtime import ChatMessage, GenerationRequest, GenerationSettings, build_backend, load_runtime_config


class MockBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_runtime_config(ROOT / "configs" / "runtime.yaml")
        self.request = GenerationRequest(
            messages=[ChatMessage(role="user", content="ÖZEL-PROMPT-CANARY")],
            settings=GenerationSettings(),
            requested_profile="thinking",
        )

    def test_factory_and_socket_are_never_touched_in_mock_mode(self) -> None:
        factory_calls = 0

        def forbidden_factory(_network):
            nonlocal factory_calls
            factory_calls += 1
            raise AssertionError("mock must not construct a transport")

        with patch.object(socket, "create_connection", side_effect=AssertionError("network attempted")):
            backend = build_backend(self.config, transport_factory=forbidden_factory)
            preflight = backend.preflight()
            response = backend.generate(self.request)
        self.assertEqual(0, factory_calls)
        self.assertTrue(preflight.ok)
        self.assertIn("pipeline-ok", response.content)

    def test_mock_response_is_deterministic_and_does_not_echo_prompt(self) -> None:
        backend = build_backend(self.config)
        first = backend.generate(self.request)
        second = backend.generate(self.request)
        self.assertEqual(first, second)
        self.assertNotIn("ÖZEL-PROMPT-CANARY", first.content)
        self.assertEqual("thinking", first.effective_profile)
        self.assertIsNone(first.usage.prompt_tokens)

    def test_mock_supports_both_explicit_profiles(self) -> None:
        backend = build_backend(self.config)
        capabilities = backend.probe()
        self.assertEqual("supported", capabilities.thinking)
        self.assertEqual("supported", capabilities.non_thinking)
        non_thinking = self.request.model_copy(update={"requested_profile": "non_thinking"})
        response = backend.generate(non_thinking)
        self.assertEqual("non_thinking", response.effective_profile)
        self.assertNotEqual(backend.generate(self.request).content, response.content)


if __name__ == "__main__":
    unittest.main()
