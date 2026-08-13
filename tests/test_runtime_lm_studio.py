from __future__ import annotations

import copy
import json
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.runtime import (
    ChatMessage,
    GenerationRequest,
    GenerationSettings,
    build_backend,
    load_runtime_config,
)
from kayra_ai.runtime.errors import (
    CapabilityUnavailableFailure,
    MalformedResponseFailure,
    ModelUnavailableFailure,
)
from kayra_ai.runtime.http_transport import TransportResponse


MODEL_KEY = "qwen3.5-9b-kayra-v1"
INSTANCE_ID = "qwen3.5-9b-kayra-v1"


def json_response(data: object) -> TransportResponse:
    return TransportResponse(
        status_code=200,
        headers={"Content-Type": "application/json; charset=utf-8"},
        body=json.dumps(data, ensure_ascii=False).encode("utf-8"),
    )


def valid_models_payload() -> dict[str, object]:
    return {
        "models": [
            {
                "key": MODEL_KEY,
                "format": "gguf",
                "size_bytes": 5629108576,
                "quantization": {"name": "Q4_K_M", "bits_per_weight": 4.83},
                "capabilities": {
                    "reasoning": {
                        "allowed_options": ["off", "on", "low", "medium", "high"],
                        "default": "on",
                    }
                },
                "loaded_instances": [
                    {
                        "id": INSTANCE_ID,
                        "config": {
                            "context_length": 4096,
                            "parallel": 1,
                            "offload_kv_cache_to_gpu": False,
                        },
                    }
                ],
            }
        ]
    }


def valid_chat_payload(*, reasoning: bool) -> dict[str, object]:
    output: list[dict[str, str]] = []
    if reasoning:
        output.append({"type": "reasoning", "content": "Saklanmayan düşünme içeriği"})
    output.append({"type": "message", "content": "Kısa yanıt"})
    return {
        "model_instance_id": INSTANCE_ID,
        "output": output,
        "stats": {
            "input_tokens": 12,
            "total_output_tokens": 3,
            # Deliberately greater than total_output_tokens in thinking mode:
            # the published schema does not define an inclusion relationship.
            "reasoning_output_tokens": 7 if reasoning else 0,
            "tokens_per_second": 9.5,
            "time_to_first_token_seconds": 0.05,
        },
    }


class RecordingTransport:
    def __init__(self, *responses: TransportResponse) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, object]] = []

    def request(self, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(kwargs)
        if not self.responses:
            raise AssertionError("unexpected fake transport request")
        return self.responses.pop(0)


class LMStudioNativeV1Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_runtime_config(
            ROOT / "configs" / "runtime.kayra-v1.lm-studio.yaml"
        )
        self.environment = {
            "KAYRA_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1///",
            "KAYRA_LM_STUDIO_MODEL": MODEL_KEY,
        }
        self.request = GenerationRequest(
            messages=[
                ChatMessage(role="system", content="Kısa ve doğrudan yanıt ver."),
                ChatMessage(role="user", content="İki artı iki kaçtır?"),
            ],
            settings=GenerationSettings(
                context_length=4096,
                temperature=0.4,
                top_p=0.9,
                max_output_tokens=77,
                stream=False,
            ),
            requested_profile="thinking",
        )
        self.socket_patcher = patch.object(
            socket,
            "socket",
            side_effect=AssertionError("native runtime test attempted socket.socket"),
        )
        self.create_connection_patcher = patch.object(
            socket,
            "create_connection",
            side_effect=AssertionError("native runtime test attempted socket.create_connection"),
        )
        self.socket_constructor = self.socket_patcher.start()
        self.create_connection = self.create_connection_patcher.start()
        self.addCleanup(self.socket_patcher.stop)
        self.addCleanup(self.create_connection_patcher.stop)

    def tearDown(self) -> None:
        self.socket_constructor.assert_not_called()
        self.create_connection.assert_not_called()

    def backend(self, transport: RecordingTransport):  # type: ignore[no-untyped-def]
        factory_calls: list[object] = []

        def factory(network):  # type: ignore[no-untyped-def]
            factory_calls.append(network)
            return transport

        backend = build_backend(
            self.config,
            environ=self.environment,
            transport_factory=factory,
            clock=iter((10.0, 10.5)).__next__,
        )
        self.assertEqual(1, len(factory_calls))
        return backend

    def test_thinking_request_uses_only_fake_transport_and_maps_native_metrics(self) -> None:
        chat = valid_chat_payload(reasoning=True)
        chat["stats"]["model_load_time_seconds"] = 0.1  # type: ignore[index]
        transport = RecordingTransport(
            json_response(valid_models_payload()),
            json_response(chat),
        )
        backend = self.backend(transport)

        preflight = backend.preflight()
        response = backend.generate(self.request)

        self.assertTrue(preflight.ok)
        self.assertEqual(
            ("off", "on", "low", "medium", "high"),
            preflight.capabilities.advertised_reasoning_options,
        )
        self.assertEqual("on", preflight.capabilities.advertised_reasoning_default)
        self.assertEqual(2, len(transport.calls))
        self.assertEqual("GET", transport.calls[0]["method"])
        self.assertEqual(
            "http://127.0.0.1:1234/api/v1/models",
            transport.calls[0]["url"],
        )

        call = transport.calls[1]
        self.assertEqual("POST", call["method"])
        self.assertEqual("http://127.0.0.1:1234/api/v1/chat", call["url"])
        payload = json.loads(call["body"])
        self.assertEqual(
            {
                "model",
                "input",
                "system_prompt",
                "reasoning",
                "temperature",
                "top_p",
                "max_output_tokens",
                "store",
                "stream",
            },
            set(payload),
        )
        self.assertEqual("on", payload["reasoning"])
        self.assertIs(payload["store"], False)
        self.assertIs(payload["stream"], False)
        self.assertNotIn("context_length", payload)
        self.assertNotIn("messages", payload)
        self.assertNotIn("chat_template", payload)
        self.assertNotIn("/think", json.dumps(payload, ensure_ascii=False))
        self.assertNotIn("/no_think", json.dumps(payload, ensure_ascii=False))

        self.assertEqual("unknown", response.effective_profile)
        self.assertEqual("lm_studio_native_v1", response.usage.source)
        self.assertEqual(12, response.usage.prompt_tokens)
        self.assertEqual(3, response.usage.completion_tokens)
        self.assertIsNone(response.usage.total_tokens)
        self.assertEqual(7, response.usage.reasoning_tokens)
        self.assertEqual("lm_studio_native_v1", response.timing.ttft_ms_source)
        self.assertEqual(50.0, response.timing.ttft_ms)
        self.assertEqual("lm_studio_native_v1", response.timing.tokens_per_second_source)
        self.assertEqual("lm_studio_native_v1", response.timing.model_load_ms_source)
        self.assertEqual(100.0, response.timing.model_load_ms)
        self.assertEqual("client_measured", response.timing.total_ms_source)
        self.assertEqual(500.0, response.timing.total_ms)
        self.assertIsNotNone(response.profile_state)
        assert response.profile_state is not None
        self.assertEqual("on", response.profile_state.requested_reasoning)
        self.assertEqual("present", response.profile_state.observed_reasoning_output)
        self.assertEqual("unknown", response.profile_state.resolved_reasoning_state)
        self.assertEqual("behaviorally_consistent", response.profile_state.verification_status)

    def test_non_thinking_request_is_explicit_and_keeps_resolved_state_unknown(self) -> None:
        transport = RecordingTransport(
            json_response(valid_models_payload()),
            json_response(valid_chat_payload(reasoning=False)),
        )
        backend = self.backend(transport)
        backend.preflight()
        request = self.request.model_copy(update={"requested_profile": "non_thinking"})

        response = backend.generate(request)

        payload = json.loads(transport.calls[1]["body"])
        self.assertEqual("off", payload["reasoning"])
        self.assertEqual(0, response.usage.reasoning_tokens)
        self.assertIsNone(response.usage.total_tokens)
        self.assertIsNone(response.timing.model_load_ms)
        self.assertEqual("unavailable", response.timing.model_load_ms_source)
        self.assertEqual("unknown", response.effective_profile)
        assert response.profile_state is not None
        self.assertEqual("absent", response.profile_state.observed_reasoning_output)
        self.assertEqual("unknown", response.profile_state.resolved_reasoning_state)
        self.assertEqual("behaviorally_consistent", response.profile_state.verification_status)

    def test_missing_safety_or_reasoning_capability_blocks_chat(self) -> None:
        mutations = {
            "context_length": lambda payload: payload["models"][0]["loaded_instances"][0][
                "config"
            ].pop("context_length"),
            "parallel": lambda payload: payload["models"][0]["loaded_instances"][0][
                "config"
            ].pop("parallel"),
            "kv_offload": lambda payload: payload["models"][0]["loaded_instances"][0][
                "config"
            ].pop("offload_kv_cache_to_gpu"),
            "allowed_options": lambda payload: payload["models"][0]["capabilities"][
                "reasoning"
            ].pop("allowed_options"),
        }
        for label, mutate in mutations.items():
            payload = valid_models_payload()
            mutate(payload)  # type: ignore[arg-type]
            transport = RecordingTransport(json_response(payload))
            backend = self.backend(transport)
            with self.subTest(label=label), self.assertRaises(CapabilityUnavailableFailure):
                backend.preflight()
            with self.subTest(label=label), self.assertRaises(CapabilityUnavailableFailure):
                backend.generate(self.request)
            self.assertEqual(1, len(transport.calls))

    def test_exact_artifact_and_instance_values_are_required(self) -> None:
        mutations = {
            "format": lambda model: model.update(format="mlx"),
            "size": lambda model: model.update(size_bytes=5629108575),
            "quantization": lambda model: model["quantization"].update(name="Q3_K_M"),
            "context": lambda model: model["loaded_instances"][0]["config"].update(
                context_length=8192
            ),
            "parallel": lambda model: model["loaded_instances"][0]["config"].update(
                parallel=2
            ),
            "kv": lambda model: model["loaded_instances"][0]["config"].update(
                offload_kv_cache_to_gpu=True
            ),
        }
        for label, mutate in mutations.items():
            payload = valid_models_payload()
            mutate(payload["models"][0])  # type: ignore[index,arg-type]
            backend = self.backend(RecordingTransport(json_response(payload)))
            with self.subTest(label=label), self.assertRaises(ModelUnavailableFailure):
                backend.preflight()

    def test_failed_recheck_revokes_an_earlier_successful_preflight(self) -> None:
        missing_capability = valid_models_payload()
        missing_capability["models"][0]["capabilities"]["reasoning"].pop(  # type: ignore[index]
            "allowed_options"
        )
        transport = RecordingTransport(
            json_response(valid_models_payload()),
            json_response(missing_capability),
        )
        backend = self.backend(transport)
        self.assertTrue(backend.preflight().ok)
        with self.assertRaises(CapabilityUnavailableFailure):
            backend.preflight()
        with self.assertRaises(CapabilityUnavailableFailure):
            backend.generate(self.request)
        self.assertEqual(2, len(transport.calls))

    def test_template_markers_history_stream_and_context_drift_fail_before_chat(self) -> None:
        requests = (
            self.request.model_copy(
                update={
                    "messages": [
                        ChatMessage(role="system", content="/think kullan"),
                        ChatMessage(role="user", content="Merhaba"),
                    ]
                }
            ),
            self.request.model_copy(
                update={
                    "messages": [
                        ChatMessage(role="system", content="Yardım et"),
                        ChatMessage(role="user", content="Bir"),
                        ChatMessage(role="assistant", content="İki"),
                    ]
                }
            ),
            self.request.model_copy(
                update={"settings": self.request.settings.model_copy(update={"stream": True})}
            ),
            self.request.model_copy(
                update={
                    "settings": self.request.settings.model_copy(
                        update={"context_length": 8192}
                    )
                }
            ),
        )
        for request in requests:
            transport = RecordingTransport(json_response(valid_models_payload()))
            backend = self.backend(transport)
            backend.preflight()
            with self.subTest(request=request), self.assertRaises(CapabilityUnavailableFailure):
                backend.generate(request)
            self.assertEqual(1, len(transport.calls))

    def test_response_id_and_missing_native_stats_are_rejected(self) -> None:
        response_with_id = valid_chat_payload(reasoning=True)
        response_with_id["response_id"] = None
        mandatory_stats = (
            "input_tokens",
            "total_output_tokens",
            "reasoning_output_tokens",
            "tokens_per_second",
            "time_to_first_token_seconds",
        )
        responses = [("response_id", response_with_id)]
        for field in mandatory_stats:
            response = valid_chat_payload(reasoning=True)
            response["stats"].pop(field)  # type: ignore[union-attr]
            responses.append((field, response))

        for label, response in responses:
            transport = RecordingTransport(
                json_response(valid_models_payload()),
                json_response(response),
            )
            backend = self.backend(transport)
            backend.preflight()
            with self.subTest(label=label), self.assertRaises(MalformedResponseFailure):
                backend.generate(self.request)

    def test_contradictory_reasoning_observation_fails_closed(self) -> None:
        transport = RecordingTransport(
            json_response(valid_models_payload()),
            json_response(valid_chat_payload(reasoning=False)),
        )
        backend = self.backend(transport)
        backend.preflight()

        with self.assertRaises(CapabilityUnavailableFailure) as caught:
            backend.generate(self.request)

        self.assertNotIn("Kısa yanıt", str(caught.exception))
        self.assertEqual(2, len(transport.calls))

    def test_empty_reasoning_output_is_not_behavioral_evidence(self) -> None:
        response = valid_chat_payload(reasoning=True)
        response["output"][0]["content"] = ""  # type: ignore[index]
        transport = RecordingTransport(
            json_response(valid_models_payload()),
            json_response(response),
        )
        backend = self.backend(transport)
        backend.preflight()

        with self.assertRaises(MalformedResponseFailure):
            backend.generate(self.request)

        self.assertEqual(2, len(transport.calls))


if __name__ == "__main__":
    unittest.main()
