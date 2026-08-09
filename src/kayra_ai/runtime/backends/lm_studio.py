from __future__ import annotations

import json
import math
from typing import cast

from pydantic import ValidationError

from ..config import build_lm_studio_native_api_url
from ..contracts import (
    BackendCapabilities,
    GenerationRequest,
    GenerationResponse,
    PreflightResult,
    ProfileExecutionState,
    ReasoningOption,
    TimingMetrics,
    TokenUsage,
)
from ..errors import (
    CapabilityUnavailableFailure,
    ConfigurationFailure,
    ConnectionFailure,
    HTTPStatusFailure,
    MalformedResponseFailure,
    ModelUnavailableFailure,
    RequestTimeoutFailure,
    RuntimeFailure,
)
from .openai_compatible import OpenAICompatibleBackend


_TEMPLATE_MARKERS = (
    "<|im_start|>",
    "<|im_end|>",
    "<|endoftext|>",
    "<|assistant|>",
    "<|system|>",
    "<|user|>",
    "/think",
    "/no_think",
)


class LMStudioBackend(OpenAICompatibleBackend):
    """LM Studio adapter with a strict native-v1 path and legacy OpenAI compatibility."""

    def __init__(self, **kwargs) -> None:  # type: ignore[no-untyped-def]
        super().__init__(**kwargs)
        self._native_model_instance_id: str | None = None

    @property
    def _uses_native_v1(self) -> bool:
        return self._config.api_mode == "native_v1"

    def _native_json_request(
        self,
        method: str,
        endpoint: str,
        payload: dict[str, object] | None = None,
    ) -> dict[str, object]:
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        try:
            response = self._transport.request(
                method=method,
                url=build_lm_studio_native_api_url(self._config.api_root, endpoint),
                headers=self._headers(has_body=body is not None),
                body=body,
                connect_timeout_seconds=self._execution.connect_timeout_seconds,
                request_timeout_seconds=self._execution.request_timeout_seconds,
            )
        except (HTTPStatusFailure, RequestTimeoutFailure, ConnectionFailure, MalformedResponseFailure):
            raise
        except RuntimeFailure:
            raise
        except TimeoutError:
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
    def _non_bool_int(value: object) -> int | None:
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    @staticmethod
    def _non_negative_number(value: object) -> float | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        converted = float(value)
        return converted if math.isfinite(converted) and converted >= 0 else None

    def _native_capabilities(self, model: dict[str, object]) -> BackendCapabilities:
        capabilities = model.get("capabilities")
        if capabilities is not None and not isinstance(capabilities, dict):
            raise MalformedResponseFailure()
        reasoning = capabilities.get("reasoning") if isinstance(capabilities, dict) else None
        if reasoning is not None and not isinstance(reasoning, dict):
            raise MalformedResponseFailure()

        allowed_options: tuple[ReasoningOption, ...] | None = None
        advertised_default: ReasoningOption | None = None
        documented_options = {"off", "on", "low", "medium", "high"}
        if isinstance(reasoning, dict):
            if "allowed_options" in reasoning:
                raw_allowed = reasoning.get("allowed_options")
                if (
                    not isinstance(raw_allowed, list)
                    or any(
                        not isinstance(item, str) or item not in documented_options
                        for item in raw_allowed
                    )
                    or len(raw_allowed) != len(set(raw_allowed))
                ):
                    raise MalformedResponseFailure()
                allowed_options = tuple(
                    cast(ReasoningOption, item) for item in raw_allowed
                )
            if "default" in reasoning and reasoning.get("default") is not None:
                raw_default = reasoning.get("default")
                if not isinstance(raw_default, str) or raw_default not in documented_options:
                    raise MalformedResponseFailure()
                advertised_default = cast(ReasoningOption, raw_default)

        thinking = (
            "unknown"
            if allowed_options is None
            else "supported" if "on" in allowed_options else "unsupported"
        )
        non_thinking = (
            "unknown"
            if allowed_options is None
            else "supported" if "off" in allowed_options else "unsupported"
        )
        try:
            return BackendCapabilities(
                thinking=thinking,
                non_thinking=non_thinking,
                streaming="unsupported",
                token_usage="supported",
                model_listing="supported",
                source="lm_studio_native_v1_models",
                advertised_reasoning_options=allowed_options,
                advertised_reasoning_default=advertised_default,
            )
        except ValidationError:
            raise MalformedResponseFailure() from None

    def preflight(self) -> PreflightResult:
        if not self._uses_native_v1:
            return super().preflight()

        # A failed re-check must revoke any earlier permission to send chat.
        self._native_model_instance_id = None
        self._capabilities = BackendCapabilities(
            thinking="unknown",
            non_thinking="unknown",
            streaming="unsupported",
            token_usage="unknown",
            model_listing="supported",
            source="lm_studio_native_v1_models",
        )
        expectations = self._config.native_v1
        if expectations is None or self._config.model_manifest is None:
            raise ConfigurationFailure("LM Studio native v1 yapılandırması eksik.")

        data = self._native_json_request("GET", "models")
        models = data.get("models")
        if not isinstance(models, list):
            raise MalformedResponseFailure()
        matches = [
            item
            for item in models
            if isinstance(item, dict) and item.get("key") == self.model_id
        ]
        if len(matches) != 1:
            raise ModelUnavailableFailure()
        model = matches[0]

        quantization = model.get("quantization")
        if (
            model.get("format") != expectations.model_format
            or self._non_bool_int(model.get("size_bytes")) != expectations.size_bytes
            or not isinstance(quantization, dict)
            or quantization.get("name") != expectations.quantization
        ):
            raise ModelUnavailableFailure(
                "Yüklü LM Studio modeli beklenen artifact kimliğiyle eşleşmiyor."
            )

        if "loaded_instances" not in model:
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 yüklü model örneği bilgisini bildirmedi."
            )
        instances = model.get("loaded_instances")
        if not isinstance(instances, list):
            raise MalformedResponseFailure()
        if not instances:
            raise ModelUnavailableFailure("Beklenen LM Studio model örneği yüklü değil.")
        if len(instances) != 1:
            raise ModelUnavailableFailure("Tam olarak bir LM Studio model örneği yüklü olmalı.")
        instance = instances[0]
        if not isinstance(instance, dict):
            raise MalformedResponseFailure()
        instance_id = instance.get("id")
        if not isinstance(instance_id, str) or not instance_id:
            raise MalformedResponseFailure()
        instance_config = instance.get("config")
        if not isinstance(instance_config, dict):
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 güvenli yükleme yapılandırmasını bildirmedi."
            )
        required_safety_fields = {
            "context_length",
            "parallel",
            "offload_kv_cache_to_gpu",
        }
        if not required_safety_fields.issubset(instance_config):
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 gerekli güvenli yükleme alanlarını bildirmedi."
            )
        if (
            self._non_bool_int(instance_config.get("context_length"))
            != expectations.context_length
            or self._non_bool_int(instance_config.get("parallel")) != expectations.parallel
            or instance_config.get("offload_kv_cache_to_gpu")
            is not expectations.offload_kv_cache_to_gpu
        ):
            raise ModelUnavailableFailure(
                "Yüklü LM Studio model örneği güvenli başlangıç profiliyle eşleşmiyor."
            )

        self._capabilities = self._native_capabilities(model)
        if (
            self._capabilities.thinking != "supported"
            or self._capabilities.non_thinking != "supported"
        ):
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 hem reasoning on hem reasoning off desteğini bildirmedi."
            )
        self._native_model_instance_id = instance_id
        return PreflightResult(
            ok=True,
            backend_name="lm_studio",
            model_available=True,
            capabilities=self.capabilities,
        )

    @staticmethod
    def _single_turn_messages(request: GenerationRequest) -> tuple[str, str]:
        if len(request.messages) != 2:
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 başlangıç yolu yalnız tek turlu system ve user mesajını destekler."
            )
        system, user = request.messages
        if system.role != "system" or user.role != "user":
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 başlangıç yolu system ve ardından tek user mesajı gerektirir."
            )
        for content in (system.content, user.content):
            lowered = content.casefold()
            if any(marker in lowered for marker in _TEMPLATE_MARKERS):
                raise CapabilityUnavailableFailure(
                    "Chat template işaretleri uygulama mesajlarında kullanılamaz."
                )
        return system.content, user.content

    @staticmethod
    def _strict_stats(stats: object) -> tuple[int, int, int, float, float, float | None]:
        if not isinstance(stats, dict):
            raise MalformedResponseFailure()
        allowed_fields = {
            "input_tokens",
            "total_output_tokens",
            "reasoning_output_tokens",
            "tokens_per_second",
            "time_to_first_token_seconds",
            "model_load_time_seconds",
        }
        if not set(stats).issubset(allowed_fields):
            raise MalformedResponseFailure()

        input_tokens = LMStudioBackend._non_bool_int(stats.get("input_tokens"))
        output_tokens = LMStudioBackend._non_bool_int(stats.get("total_output_tokens"))
        reasoning_tokens = LMStudioBackend._non_bool_int(stats.get("reasoning_output_tokens"))
        tokens_per_second = LMStudioBackend._non_negative_number(stats.get("tokens_per_second"))
        ttft_seconds = LMStudioBackend._non_negative_number(
            stats.get("time_to_first_token_seconds")
        )
        if (
            input_tokens is None
            or input_tokens < 0
            or output_tokens is None
            or output_tokens < 0
            or reasoning_tokens is None
            or reasoning_tokens < 0
            or tokens_per_second is None
            or ttft_seconds is None
        ):
            raise MalformedResponseFailure()

        model_load_seconds = None
        if "model_load_time_seconds" in stats:
            model_load_seconds = LMStudioBackend._non_negative_number(
                stats.get("model_load_time_seconds")
            )
            if model_load_seconds is None:
                raise MalformedResponseFailure()
        return (
            input_tokens,
            output_tokens,
            reasoning_tokens,
            tokens_per_second,
            ttft_seconds,
            model_load_seconds,
        )

    def _parse_native_response(
        self,
        *,
        data: dict[str, object],
        request: GenerationRequest,
        requested_reasoning: str,
        total_ms: float,
    ) -> GenerationResponse:
        allowed_top_level = {"model_instance_id", "output", "stats", "response_id"}
        if not set(data).issubset(allowed_top_level):
            raise MalformedResponseFailure()
        model_instance_id = data.get("model_instance_id")
        if (
            not isinstance(model_instance_id, str)
            or model_instance_id != self._native_model_instance_id
        ):
            raise MalformedResponseFailure()
        if "response_id" in data:
            # store=false is a hard privacy boundary; a persisted-response id is
            # therefore inconsistent with the request and is never retained.
            raise MalformedResponseFailure()

        output = data.get("output")
        if not isinstance(output, list) or not output:
            raise MalformedResponseFailure()
        message_contents: list[str] = []
        reasoning_present = False
        for item in output:
            if not isinstance(item, dict) or set(item) != {"type", "content"}:
                raise MalformedResponseFailure()
            output_type = item.get("type")
            content = item.get("content")
            if output_type not in {"message", "reasoning"} or not isinstance(content, str):
                raise MalformedResponseFailure()
            if output_type == "message":
                if not content:
                    raise MalformedResponseFailure()
                message_contents.append(content)
            else:
                if not content:
                    raise MalformedResponseFailure()
                reasoning_present = True
        if len(message_contents) != 1:
            raise MalformedResponseFailure()

        (
            input_tokens,
            output_tokens,
            reasoning_tokens,
            tokens_per_second,
            ttft_seconds,
            model_load_seconds,
        ) = self._strict_stats(data.get("stats"))
        behaviorally_consistent = (
            requested_reasoning == "on" and reasoning_present and reasoning_tokens > 0
        ) or (
            requested_reasoning == "off" and not reasoning_present and reasoning_tokens == 0
        )
        if not behaviorally_consistent:
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 reasoning gözlemi istenen profille uyuşmuyor."
            )
        advertised_options = self._capabilities.advertised_reasoning_options
        if advertised_options is None:
            raise CapabilityUnavailableFailure()
        try:
            return GenerationResponse(
                content=message_contents[0],
                usage=TokenUsage(
                    source="lm_studio_native_v1",
                    prompt_tokens=input_tokens,
                    completion_tokens=output_tokens,
                    total_tokens=None,
                    reasoning_tokens=reasoning_tokens,
                ),
                timing=TimingMetrics(
                    total_ms=total_ms,
                    total_ms_source="client_measured",
                    ttft_ms=ttft_seconds * 1000,
                    ttft_ms_source="lm_studio_native_v1",
                    tokens_per_second=tokens_per_second,
                    tokens_per_second_source="lm_studio_native_v1",
                    model_load_ms=(
                        model_load_seconds * 1000 if model_load_seconds is not None else None
                    ),
                    model_load_ms_source=(
                        "lm_studio_native_v1"
                        if model_load_seconds is not None
                        else "unavailable"
                    ),
                ),
                effective_profile="unknown",
                finish_reason=None,
                model_instance_id=model_instance_id,
                response_id=None,
                profile_state=ProfileExecutionState(
                    capability_status=self._capabilities.status_for_profile(
                        request.requested_profile
                    ),
                    requested_profile=request.requested_profile,
                    requested_reasoning=requested_reasoning,
                    advertised_reasoning_options=advertised_options,
                    advertised_reasoning_default=(
                        self._capabilities.advertised_reasoning_default
                    ),
                    observed_reasoning_output=(
                        "present" if reasoning_present else "absent"
                    ),
                    resolved_reasoning_state="unknown",
                    verification_status="behaviorally_consistent",
                    source="lm_studio_native_v1_response",
                ),
            )
        except (ValidationError, ValueError):
            raise MalformedResponseFailure() from None

    def generate(self, request: GenerationRequest) -> GenerationResponse:
        if not self._uses_native_v1:
            return super().generate(request)
        if self._native_model_instance_id is None:
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 isteğinden önce başarılı preflight gerekli."
            )
        status = self._capabilities.status_for_profile(request.requested_profile)
        if status != "supported":
            raise CapabilityUnavailableFailure()
        if request.settings.stream:
            raise CapabilityUnavailableFailure(
                "LM Studio native v1 başlangıç yolu streaming desteklemiyor."
            )
        expectations = self._config.native_v1
        if expectations is None or request.settings.context_length != expectations.context_length:
            raise CapabilityUnavailableFailure(
                "İstek context değeri doğrulanmış LM Studio yükleme profiliyle eşleşmiyor."
            )

        system_prompt, user_input = self._single_turn_messages(request)
        requested_reasoning = "on" if request.requested_profile == "thinking" else "off"
        payload: dict[str, object] = {
            "model": self.model_id,
            "input": user_input,
            "system_prompt": system_prompt,
            "reasoning": requested_reasoning,
            "temperature": request.settings.temperature,
            "top_p": request.settings.top_p,
            "max_output_tokens": request.settings.max_output_tokens,
            "store": False,
            "stream": False,
        }
        started = self._clock()
        data = self._native_json_request("POST", "chat", payload)
        total_ms = max(0.0, (self._clock() - started) * 1000)
        return self._parse_native_response(
            data=data,
            request=request,
            requested_reasoning=requested_reasoning,
            total_ms=total_ms,
        )
