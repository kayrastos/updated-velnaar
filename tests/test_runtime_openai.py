from __future__ import annotations

import io
import json
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.runtime import ChatMessage, GenerationRequest, GenerationSettings, build_backend, load_runtime_config
from kayra_ai.runtime.config import RuntimeConfig, resolve_backend_config
from kayra_ai.runtime.errors import (
    CapabilityUnavailableFailure,
    ConnectionFailure,
    HTTPStatusFailure,
    MalformedResponseFailure,
    ModelUnavailableFailure,
    RequestTimeoutFailure,
)
from kayra_ai.runtime.http_transport import TransportResponse, UrllibTransport
from kayra_ai.runtime.backends.llama_cpp import LlamaCppBackend


API_KEY_CANARY = "API-KEY-CANARY-2ae7f7"
RAW_BODY_CANARY = "RAW-BODY-CANARY-d129a1"
EXCEPTION_CANARY = "EXCEPTION-REPR-CANARY-77ea4c"


class RecordingTransport:
    def __init__(self, response: TransportResponse | None = None, failure: Exception | None = None) -> None:
        self.response = response
        self.failure = failure
        self.calls: list[dict[str, object]] = []

    def request(self, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(kwargs)
        if self.failure is not None:
            raise self.failure
        if self.response is None:
            raise AssertionError("test transport response missing")
        return self.response


class FakeSocket:
    def __init__(self) -> None:
        self.timeouts: list[float] = []

    def settimeout(self, timeout: float) -> None:
        self.timeouts.append(timeout)


class FakeHTTPResponse:
    status = 200

    def read(self, _limit: int) -> bytes:
        return b"{}"

    def getheaders(self) -> list[tuple[str, str]]:
        return [("Content-Type", "application/json")]


class FakeHTTPConnection:
    instances: list["FakeHTTPConnection"] = []

    def __init__(self, host: str, *, port: int | None, timeout: float) -> None:
        self.host = host
        self.port = port
        self.connect_timeout = timeout
        self.sock = FakeSocket()
        self.request_args: tuple[object, ...] | None = None
        self.closed = False
        self.__class__.instances.append(self)

    def request(self, method: str, target: str, *, body: bytes | None, headers: dict[str, str]) -> None:
        self.request_args = (method, target, body, headers)

    def getresponse(self) -> FakeHTTPResponse:
        return FakeHTTPResponse()

    def close(self) -> None:
        self.closed = True


def json_response(data: object, *, status: int = 200, content_type: str = "application/json") -> TransportResponse:
    return TransportResponse(
        status_code=status,
        headers={"Content-Type": content_type},
        body=json.dumps(data, ensure_ascii=False).encode("utf-8"),
    )


class OpenAIBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        base = load_runtime_config(ROOT / "configs" / "runtime.yaml")
        data = base.model_dump(mode="python")
        data["active_backend"] = "lm_studio"
        data["backends"]["lm_studio"]["enabled"] = True
        self.config = RuntimeConfig.model_validate(data)
        self.environment = {
            "KAYRA_LM_STUDIO_BASE_URL": "http://localhost:1234/v1///",
            "KAYRA_LM_STUDIO_MODEL": "configured-model",
        }
        self.request = GenerationRequest(
            messages=[ChatMessage(role="user", content="Merhaba")],
            settings=GenerationSettings(
                context_length=4096,
                temperature=0.4,
                top_p=0.9,
                max_output_tokens=77,
            ),
            requested_profile="thinking",
        )

    def with_fallback(self) -> RuntimeConfig:
        data = self.config.model_dump(mode="python")
        data["profiles"]["thinking"]["unsupported_capability"] = "backend_default"
        return RuntimeConfig.model_validate(data)

    def backend(self, transport: RecordingTransport, *, config: RuntimeConfig | None = None, environment=None):
        factory_calls: list[object] = []

        def factory(network):  # type: ignore[no-untyped-def]
            factory_calls.append(network)
            return transport

        backend = build_backend(
            config or self.config,
            environ=self.environment if environment is None else environment,
            transport_factory=factory,
            clock=iter((10.0, 10.125)).__next__,
        )
        self.assertEqual(1, len(factory_calls))
        return backend

    def test_unknown_profile_capability_fails_before_http(self) -> None:
        transport = RecordingTransport(json_response({}))
        backend = self.backend(transport)
        with self.assertRaises(CapabilityUnavailableFailure):
            backend.generate(self.request)
        self.assertEqual([], transport.calls)

    def test_portable_payload_and_normalized_endpoint(self) -> None:
        response = json_response(
            {
                "choices": [
                    {"message": {"role": "assistant", "content": "Selam"}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3},
            }
        )
        transport = RecordingTransport(response)
        backend = self.backend(transport, config=self.with_fallback())
        generated = backend.generate(self.request)

        self.assertEqual("Selam", generated.content)
        self.assertEqual(125.0, generated.timing.total_ms)
        self.assertEqual("backend_default", generated.effective_profile)
        call = transport.calls[0]
        self.assertEqual("http://localhost:1234/v1/chat/completions", call["url"])
        payload = json.loads(call["body"])
        self.assertEqual(
            {"model", "messages", "temperature", "top_p", "max_tokens", "stream"},
            set(payload),
        )
        self.assertNotIn("top_k", payload)
        self.assertNotIn("context_length", payload)
        self.assertNotIn("thinking", payload)
        self.assertNotIn("chat_template", payload)

    def test_unset_optional_key_sends_no_authorization_header(self) -> None:
        transport = RecordingTransport(json_response({"data": [{"id": "configured-model"}]}))
        result = self.backend(transport).preflight()
        self.assertTrue(result.ok)
        self.assertNotIn("Authorization", transport.calls[0]["headers"])
        self.assertEqual("http://localhost:1234/v1/models", transport.calls[0]["url"])

    def test_set_key_is_bearer_only_at_transport_boundary(self) -> None:
        environment = dict(self.environment, KAYRA_LM_STUDIO_API_KEY=API_KEY_CANARY)
        transport = RecordingTransport(json_response({"data": [{"id": "configured-model"}]}))
        backend = self.backend(transport, environment=environment)
        result = backend.preflight()
        self.assertEqual(f"Bearer {API_KEY_CANARY}", transport.calls[0]["headers"]["Authorization"])

        outside_transport = " ".join(
            (
                repr(backend),
                result.model_dump_json(),
                repr(result),
            )
        )
        self.assertNotIn(API_KEY_CANARY, outside_transport)

    def test_api_key_and_exception_repr_never_reach_errors_or_output(self) -> None:
        environment = dict(self.environment, KAYRA_LM_STUDIO_API_KEY=API_KEY_CANARY)
        transport = RecordingTransport(failure=RuntimeError(EXCEPTION_CANARY))
        backend = self.backend(transport, environment=environment)
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr), self.assertRaises(ConnectionFailure) as caught:
            backend.preflight()
        exposed = " ".join((str(caught.exception), repr(caught.exception), stdout.getvalue(), stderr.getvalue()))
        self.assertNotIn(API_KEY_CANARY, exposed)
        self.assertNotIn(EXCEPTION_CANARY, exposed)
        self.assertNotIn("Authorization", exposed)

    def test_raw_error_body_is_discarded(self) -> None:
        response = TransportResponse(
            status_code=500,
            headers={"Content-Type": "application/json"},
            body=RAW_BODY_CANARY.encode("utf-8"),
        )
        backend = self.backend(RecordingTransport(response))
        with self.assertRaises(HTTPStatusFailure) as caught:
            backend.preflight()
        self.assertEqual(500, caught.exception.info.status_code)
        self.assertNotIn(RAW_BODY_CANARY, str(caught.exception))
        self.assertNotIn(RAW_BODY_CANARY, caught.exception.info.model_dump_json())

    def test_timeout_is_typed_without_exception_text(self) -> None:
        backend = self.backend(RecordingTransport(failure=TimeoutError(EXCEPTION_CANARY)))
        with self.assertRaises(RequestTimeoutFailure) as caught:
            backend.preflight()
        self.assertNotIn(EXCEPTION_CANARY, str(caught.exception))

    def test_malformed_json_content_type_and_shape_are_typed(self) -> None:
        responses = (
            TransportResponse(200, {"Content-Type": "application/json"}, RAW_BODY_CANARY.encode()),
            json_response({"data": []}, content_type="text/plain"),
            json_response({"data": []}, content_type="application/jsonp"),
        )
        for response in responses:
            with self.subTest(response=response), self.assertRaises(MalformedResponseFailure) as caught:
                self.backend(RecordingTransport(response)).preflight()
            self.assertNotIn(RAW_BODY_CANARY, str(caught.exception))

        malformed_chat = RecordingTransport(json_response({"choices": [{"message": {}}]}))
        with self.assertRaises(MalformedResponseFailure):
            self.backend(malformed_chat, config=self.with_fallback()).generate(self.request)

    def test_json_content_type_allows_charset_parameter(self) -> None:
        transport = RecordingTransport(
            json_response(
                {"data": [{"id": "configured-model"}]},
                content_type="application/json; charset=utf-8",
            )
        )
        self.assertTrue(self.backend(transport).preflight().ok)

    def test_preflight_requires_exact_configured_model(self) -> None:
        transport = RecordingTransport(json_response({"data": [{"id": "some-other-model"}]}))
        with self.assertRaises(ModelUnavailableFailure) as caught:
            self.backend(transport).preflight()
        self.assertNotIn("some-other-model", str(caught.exception))
        self.assertNotIn("configured-model", str(caught.exception))

    def test_resolved_secret_is_excluded_from_serialization(self) -> None:
        resolved = resolve_backend_config(
            self.config,
            environ=dict(self.environment, KAYRA_LM_STUDIO_API_KEY=API_KEY_CANARY),
        )
        self.assertNotIn(API_KEY_CANARY, repr(resolved))
        self.assertNotIn(API_KEY_CANARY, resolved.model_dump_json())

    def test_llama_cpp_uses_the_shared_openai_backend_without_network(self) -> None:
        data = load_runtime_config(ROOT / "configs" / "runtime.yaml").model_dump(mode="python")
        data["active_backend"] = "llama_cpp"
        data["backends"]["llama_cpp"]["enabled"] = True
        config = RuntimeConfig.model_validate(data)
        environment = {
            "KAYRA_LLAMA_CPP_BASE_URL": "http://localhost:8080/v1/",
            "KAYRA_LLAMA_CPP_MODEL": "configured-llama-model",
        }
        transport = RecordingTransport(
            json_response({"data": [{"id": "configured-llama-model"}]})
        )

        backend = build_backend(
            config,
            environ=environment,
            transport_factory=lambda _network: transport,
        )
        self.assertIsInstance(backend, LlamaCppBackend)
        self.assertEqual("llama_cpp", backend.runtime_name)
        self.assertTrue(backend.preflight().ok)
        self.assertEqual("http://localhost:8080/v1/models", transport.calls[0]["url"])
        self.assertNotIn("Authorization", transport.calls[0]["headers"])

    def test_direct_transport_applies_separate_connect_and_request_timeouts_without_network(self) -> None:
        FakeHTTPConnection.instances.clear()
        with patch(
            "kayra_ai.runtime.http_transport.http.client.HTTPConnection",
            FakeHTTPConnection,
        ):
            response = UrllibTransport().request(
                method="GET",
                url="http://localhost:1234/v1/models",
                headers={"Accept": "application/json"},
                body=None,
                connect_timeout_seconds=3.0,
                request_timeout_seconds=180.0,
            )

        self.assertEqual(200, response.status_code)
        self.assertEqual(1, len(FakeHTTPConnection.instances))
        connection = FakeHTTPConnection.instances[0]
        self.assertEqual("localhost", connection.host)
        self.assertEqual(1234, connection.port)
        self.assertEqual(3.0, connection.connect_timeout)
        self.assertEqual([180.0], connection.sock.timeouts)
        self.assertEqual(("GET", "/v1/models", None, {"Accept": "application/json"}), connection.request_args)
        self.assertTrue(connection.closed)


if __name__ == "__main__":
    unittest.main()
