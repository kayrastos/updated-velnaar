from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Literal

from pydantic import ValidationError

from ..config import ExecutionConfig, NetworkConfig, ProfilesConfig, ResolvedBackendConfig, build_api_url
from ..contracts import (
    BackendCapabilities,
    GenerationRequest,
    GenerationResponse,
    PreflightResult,
    TimingMetrics,
    TokenUsage,
)
from ..errors import (
    CapabilityUnavailableFailure,
    ConnectionFailure,
    HTTPStatusFailure,
    MalformedResponseFailure,
    ModelUnavailableFailure,
    RequestTimeoutFailure,
    RuntimeFailure,
)
from ..http_transport import HTTPTransport, TransportFactory, TransportResponse, create_urllib_transport


Clock = Callable[[], float]


class OpenAICompatibleBackend:
    """Shared, conservative client for the OpenAI-compatible local API surface."""

    def __init__(
        self,
        *,
        config: ResolvedBackendConfig,
        execution: ExecutionConfig,
        network: NetworkConfig,
        profiles: ProfilesConfig,
        transport_factory: TransportFactory | None = None,
        clock: Clock = time.monotonic,
    ) -> None:
        self._config = config
        self._execution = execution
        self._profiles = profiles
        self._clock = clock
        factory = transport_factory or create_urllib_transport
        self._transport: HTTPTransport = factory(network)
        self._capabilities = BackendCapabilities(
            thinking="unknown",
            non_thinking="unknown",
            streaming="unsupported",
            token_usage="unknown",
            model_listing="supported",
        )

    @property
    def runtime_name(self) -> Literal["lm_studio", "llama_cpp"]:
        return self._config.kind

    @property
    def runtime_version(self) -> None:
        return None

    @property
    def model_id(self) -> str:
        return self._config.model_id

    @property
    def model_revision(self) -> str | None:
        return self._config.model_revision

    @property
    def capabilities(self) -> BackendCapabilities:
        return self._capabilities.model_copy(deep=True)

    def probe(self) -> BackendCapabilities:
        return self.capabilities

    def _headers(self, *, has_body: bool) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if has_body:
            headers["Content-Type"] = "application/json"
        if self._config.api_key is not None:
            headers["Authorization"] = f"Bearer {self._config.api_key.get_secret_value()}"
        return headers

    def _json_request(self, method: str, endpoint: str, payload: dict[str, object] | None = None) -> dict[str, object]:
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        try:
            response = self._transport.request(
                method=method,
                url=build_api_url(self._config.api_root, endpoint),
                headers=self._headers(has_body=body is not None),
                body=body,
                connect_timeout_seconds=self._execution.connect_timeout_seconds,
                request_timeout_seconds=self._execution.request_timeout_seconds,
            )
        except (HTTPStatusFailure, RequestTimeoutFailure, ConnectionFailure, MalformedResponseFailure):
            raise
        except RuntimeFailure:
            raise
        except (TimeoutError,):
            raise RequestTimeoutFailure() from None
        except Exception:
            raise ConnectionFailure() from None
        try:
            return self._decode_json(response)
        except RuntimeFailure:
            raise
        except Exception:
            raise MalformedResponseFailure() from None

    @staticmethod
    def _decode_json(response: TransportResponse) -> dict[str, object]:
        if isinstance(response.status_code, bool) or not isinstance(response.status_code, int):
            raise MalformedResponseFailure()
        if response.status_code < 200 or response.status_code >= 300:
            retryable = response.status_code == 429 or response.status_code >= 500
            raise HTTPStatusFailure(status_code=response.status_code, retryable=retryable)
        content_type = next(
            (value for key, value in response.headers.items() if key.lower() == "content-type"),
            "",
        )
        media_type = content_type.split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            raise MalformedResponseFailure("Yerel çalışma zamanı JSON içerik türü döndürmedi.")
        try:
            data = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise MalformedResponseFailure() from None
        if not isinstance(data, dict):
            raise MalformedResponseFailure()
        return data

    def preflight(self) -> PreflightResult:
        data = self._json_request("GET", "models")
        models = data.get("data")
        if not isinstance(models, list):
            raise MalformedResponseFailure()
        available_ids = {
            item.get("id")
            for item in models
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
        if self.model_id not in available_ids:
            raise ModelUnavailableFailure()
        return PreflightResult(
            ok=True,
            backend_name=self.runtime_name,
            model_available=True,
            capabilities=self.capabilities,
        )

    def _effective_profile(self, request: GenerationRequest) -> Literal["thinking", "non_thinking", "backend_default"]:
        status = self._capabilities.status_for_profile(request.requested_profile)
        if status == "supported":
            return request.requested_profile
        policy = self._profiles.get(request.requested_profile).unsupported_capability
        if policy == "backend_default":
            return "backend_default"
        raise CapabilityUnavailableFailure()

    def generate(self, request: GenerationRequest) -> GenerationResponse:
        effective_profile = self._effective_profile(request)
        if request.settings.stream:
            raise CapabilityUnavailableFailure("Streaming bu Aşama 1 istemcisinde desteklenmiyor.")

        payload: dict[str, object] = {
            "model": self.model_id,
            "messages": [message.model_dump(mode="json") for message in request.messages],
            "temperature": request.settings.temperature,
            "top_p": request.settings.top_p,
            "max_tokens": request.settings.max_output_tokens,
            "stream": False,
        }
        started = self._clock()
        data = self._json_request("POST", "chat/completions", payload)
        total_ms = max(0.0, (self._clock() - started) * 1000)
        try:
            choices = data["choices"]
            if not isinstance(choices, list) or not choices:
                raise TypeError
            first = choices[0]
            if not isinstance(first, dict):
                raise TypeError
            message = first["message"]
            if not isinstance(message, dict) or not isinstance(message.get("content"), str):
                raise TypeError
            finish_reason = first.get("finish_reason")
            if finish_reason is not None and not isinstance(finish_reason, str):
                raise TypeError
            usage_data = data.get("usage")
            usage = self._parse_usage(usage_data)
            return GenerationResponse(
                content=message["content"],
                usage=usage,
                timing=TimingMetrics(total_ms=total_ms, ttft_ms=None),
                effective_profile=effective_profile,
                finish_reason=finish_reason,
            )
        except (KeyError, TypeError, ValidationError, ValueError):
            raise MalformedResponseFailure() from None

    @staticmethod
    def _parse_usage(value: object) -> TokenUsage:
        if value is None:
            return TokenUsage()
        if not isinstance(value, dict):
            raise TypeError

        def optional_int(name: str) -> int | None:
            item = value.get(name)
            if item is None:
                return None
            if isinstance(item, bool) or not isinstance(item, int):
                raise TypeError
            return item

        return TokenUsage(
            prompt_tokens=optional_int("prompt_tokens"),
            completion_tokens=optional_int("completion_tokens"),
            total_tokens=optional_int("total_tokens"),
        )
