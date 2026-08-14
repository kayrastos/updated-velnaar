from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from .commands import GitReadOnlyCommandPolicy
from .contracts import (
    TOOL_REQUEST_ADAPTER,
    ListDirectoryRequest,
    ReadOnlyCommandRequest,
    ReadTextRequest,
    StatPathRequest,
    ToolPreview,
    ToolRequest,
    build_tool_preview,
)
from .policy import ReadOnlyPathPolicy, ToolPolicyError


class ToolRequestRoutingError(ValueError):
    pass


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ToolRequestRoutingError("JSON nesnesinde tekrar eden alan var")
        result[key] = value
    return result


def _reject_non_finite(value: str) -> None:
    raise ToolRequestRoutingError(f"JSON sonlu olmayan sayi iceremez: {value}")


class UntrustedToolRequestRouter:
    """Validate model-produced JSON and return a preview, never execution."""

    def __init__(
        self,
        path_policy: ReadOnlyPathPolicy,
        *,
        command_policy: GitReadOnlyCommandPolicy | None = None,
        max_input_bytes: int = 16_384,
    ) -> None:
        if max_input_bytes < 1:
            raise ValueError("max_input_bytes pozitif olmali")
        if command_policy is not None and command_policy.path_policy is not path_policy:
            raise ValueError("router ve komut politikasi ayni path policy kullanmali")
        self.path_policy = path_policy
        self.command_policy = command_policy
        self.max_input_bytes = max_input_bytes

    def route(self, raw_json: str) -> ToolPreview:
        if not isinstance(raw_json, str):
            raise ToolRequestRoutingError("tool istegi metin olmali")
        if len(raw_json) > self.max_input_bytes:
            raise ToolRequestRoutingError("tool istegi boyut sinirini asiyor")
        try:
            encoded_size = len(raw_json.encode("utf-8"))
        except UnicodeEncodeError:
            raise ToolRequestRoutingError("tool istegi gecerli Unicode metni degil") from None
        if encoded_size > self.max_input_bytes:
            raise ToolRequestRoutingError("tool istegi boyut sinirini asiyor")

        try:
            payload = json.loads(
                raw_json,
                object_pairs_hook=_unique_object,
                parse_constant=_reject_non_finite,
            )
        except ToolRequestRoutingError:
            raise
        except (json.JSONDecodeError, UnicodeError, TypeError, RecursionError):
            raise ToolRequestRoutingError(
                "tool istegi yalnizca tek ve gecerli bir JSON nesnesi olmali"
            ) from None
        if not isinstance(payload, dict):
            raise ToolRequestRoutingError("tool isteginin kok degeri JSON nesnesi olmali")

        try:
            request = TOOL_REQUEST_ADAPTER.validate_python(payload)
        except (ValidationError, RecursionError) as exc:
            raise ToolRequestRoutingError("tool istegi katı sozlesmeyle eslesmiyor") from exc

        request = request.model_copy(update={"request_id": uuid4().hex})
        canonical = self._canonicalize(request)
        return build_tool_preview(canonical, summary=self._summary(canonical))

    def _canonicalize(self, request: ToolRequest) -> ToolRequest:
        if isinstance(request, (ListDirectoryRequest, StatPathRequest, ReadTextRequest)):
            try:
                resolved = self.path_policy.resolve(request.path)
            except ToolPolicyError as exc:
                raise ToolRequestRoutingError(
                    "dosya istegi politika tarafindan reddedildi"
                ) from exc
            return request.model_copy(update={"path": str(resolved)})
        if not isinstance(request, ReadOnlyCommandRequest):
            raise ToolRequestRoutingError("desteklenmeyen tool istegi")
        if self.command_policy is None:
            raise ToolRequestRoutingError("model kaynakli komut istekleri devre disi")
        try:
            prepared = self.command_policy.prepare(request)
        except ToolPolicyError as exc:
            raise ToolRequestRoutingError("komut istegi politika tarafindan reddedildi") from exc
        return request.model_copy(update={"cwd": str(prepared.cwd)})

    @staticmethod
    def _summary(request: ToolRequest) -> str:
        if isinstance(request, ReadOnlyCommandRequest):
            return f"Model Git sorgusu: {' '.join(request.argv)} | cwd={request.cwd}"
        return f"Model dosya sorgusu: {request.tool} | path={request.path}"
