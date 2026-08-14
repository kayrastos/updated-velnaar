from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .approval import ToolApprovalError
from .commands import ReadOnlyCommandExecutor
from .contracts import (
    ListDirectoryRequest,
    ListDirectoryResult,
    ReadOnlyCommandRequest,
    ReadOnlyCommandResult,
    ReadTextRequest,
    ReadTextResult,
    StatPathRequest,
    StatPathResult,
    ToolAuthorization,
    ToolPreview,
    tool_request_digest,
)
from .filesystem import ReadOnlyFilesystem
from .policy import ToolPolicyError
from .router import ToolRequestRoutingError, UntrustedToolRequestRouter


Clock = Callable[[], datetime]
ToolExecutionResult: TypeAlias = Annotated[
    ListDirectoryResult | StatPathResult | ReadTextResult | ReadOnlyCommandResult,
    Field(discriminator="tool"),
]
ToolHostErrorCode: TypeAlias = Literal[
    "routing_rejected",
    "host_capacity_reached",
    "user_rejected",
    "request_mismatch",
    "authorization_rejected",
    "execution_rejected",
    "execution_failed",
]


class StrictToolHostModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def render_tool_preview(preview: ToolPreview) -> str:
    """Return deterministic, terminal-safe JSON for the trusted confirmation UI."""

    request = preview.request
    parameters = request.model_dump(
        mode="json",
        exclude={"request_id", "tool", "purpose"},
    )
    payload = {
        "effect": preview.effect,
        "normalized_parameters": parameters,
        "purpose": request.purpose,
        "request_id": request.request_id,
        "request_sha256": preview.request_digest,
        "tool": request.tool,
    }
    return json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True)


class ToolHostPrepared(StrictToolHostModel):
    status: Literal["awaiting_confirmation"] = "awaiting_confirmation"
    preview: ToolPreview
    preview_text: str = Field(min_length=3, max_length=32_768)

    @model_validator(mode="after")
    def preview_text_matches_preview(self) -> "ToolHostPrepared":
        if self.preview_text != render_tool_preview(self.preview):
            raise ValueError("host onizleme metni yapilandirilmis istekle eslesmiyor")
        return self


class ToolHostOutcome(StrictToolHostModel):
    status: Literal["executed", "rejected", "error"]
    request_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    request_digest: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    error_code: ToolHostErrorCode | None = None
    message: str = Field(min_length=3, max_length=500)
    result: ToolExecutionResult | None = None

    @model_validator(mode="after")
    def state_is_consistent(self) -> "ToolHostOutcome":
        has_request_id = self.request_id is not None
        has_digest = self.request_digest is not None
        if has_request_id != has_digest:
            raise ValueError("host sonucu request kimligini ve ozetini birlikte tasimali")
        if self.status == "executed":
            if self.error_code is not None or self.result is None:
                raise ValueError("basarili host sonucu yalnizca arac sonucu tasimali")
            if self.request_id != self.result.request_id:
                raise ValueError("host sonucu request_id ile arac sonucu eslesmiyor")
        elif self.error_code is None or self.result is not None:
            raise ValueError("reddedilen veya hatali host sonucu guvenli hata tasimali")
        return self


ToolHostPreparation: TypeAlias = ToolHostPrepared | ToolHostOutcome


class UserConfirmedToolExecutionHost:
    """Bridge untrusted router output to one user-confirmed read-only execution."""

    def __init__(
        self,
        router: UntrustedToolRequestRouter,
        filesystem: ReadOnlyFilesystem,
        *,
        command_executor: ReadOnlyCommandExecutor | None = None,
        clock: Clock | None = None,
        max_pending_requests: int = 32,
    ) -> None:
        if not isinstance(router, UntrustedToolRequestRouter):
            raise TypeError("host yalnizca guvenilmeyen istek router'ini kabul eder")
        if not isinstance(filesystem, ReadOnlyFilesystem):
            raise TypeError("host yalnizca mevcut salt-okunur filesystem yurutucusunu kabul eder")
        if filesystem.policy is not router.path_policy:
            raise ValueError("router ve filesystem ayni path policy kullanmali")
        if (router.command_policy is None) != (command_executor is None):
            raise ValueError("router komut politikasi ile komut yurutucusu birlikte yapilandirilmali")
        if command_executor is not None:
            if not isinstance(command_executor, ReadOnlyCommandExecutor):
                raise TypeError("host yalnizca mevcut salt-okunur komut yurutucusunu kabul eder")
            if command_executor.policy is not router.command_policy:
                raise ValueError("router ve komut yurutucusu ayni komut politikasini kullanmali")
            if command_executor.approval_gate is not filesystem.approval_gate:
                raise ValueError("host yurutuculari ayni approval gate kullanmali")
        if max_pending_requests < 1:
            raise ValueError("max_pending_requests pozitif olmali")

        self.router = router
        self.filesystem = filesystem
        self.command_executor = command_executor
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.max_pending_requests = max_pending_requests
        self._pending: dict[str, ToolPreview] = {}
        self._pending_lock = Lock()

    def prepare(self, raw_json: str) -> ToolHostPreparation:
        try:
            preview = self.router.route(raw_json)
        except ToolRequestRoutingError:
            return self._outcome(
                status="rejected",
                error_code="routing_rejected",
                message="Model arac istegi router veya politika tarafindan reddedildi.",
            )
        except Exception:
            return self._outcome(
                status="error",
                error_code="routing_rejected",
                message="Model arac istegi guvenli bicimde hazirlanamadi.",
            )

        prepared = ToolHostPrepared(
            preview=preview,
            preview_text=render_tool_preview(preview),
        )
        stored_preview = preview.model_copy(deep=True)
        with self._pending_lock:
            if len(self._pending) >= self.max_pending_requests:
                return self._outcome(
                    status="rejected",
                    error_code="host_capacity_reached",
                    message="Bekleyen arac istegi sinirina ulasildi.",
                )
            if preview.request.request_id in self._pending:
                return self._outcome(
                    status="error",
                    error_code="request_mismatch",
                    message="Arac istegi kimligi guvenli bicimde kaydedilemedi.",
                )
            self._pending[preview.request.request_id] = stored_preview
        return prepared

    def confirm(
        self,
        *,
        request_id: str,
        request_digest: str,
        response: str,
    ) -> ToolHostOutcome:
        if not isinstance(request_id, str):
            return self._request_mismatch()
        with self._pending_lock:
            preview = self._pending.pop(request_id, None)
        if preview is None:
            return self._request_mismatch()

        if request_digest != preview.request_digest:
            return self._request_mismatch(preview)
        if tool_request_digest(preview.request) != preview.request_digest:
            return self._request_mismatch(preview)
        if response != "EVET":
            return self._outcome(
                status="rejected",
                preview=preview,
                error_code="user_rejected",
                message="Kullanici arac istegini onaylamadi; arac calistirilmadi.",
            )

        try:
            confirmed_at = self.clock()
            authorization = ToolAuthorization(
                confirmed_by_user=True,
                request_digest=preview.request_digest,
                confirmed_at=confirmed_at,
                expires_at=confirmed_at + timedelta(minutes=1),
            )
            result = self._execute(preview, authorization)
        except ToolApprovalError:
            return self._outcome(
                status="rejected",
                preview=preview,
                error_code="authorization_rejected",
                message="Kullanici onayi gecersiz, suresi dolmus veya daha once kullanilmis.",
            )
        except ToolPolicyError:
            return self._outcome(
                status="rejected",
                preview=preview,
                error_code="execution_rejected",
                message="Arac istegi yurutme politikasinda reddedildi; arac calistirilmadi.",
            )
        except Exception:
            return self._outcome(
                status="error",
                preview=preview,
                error_code="execution_failed",
                message="Onayli salt-okunur arac guvenli bicimde calistirilamadi.",
            )

        return ToolHostOutcome(
            status="executed",
            request_id=preview.request.request_id,
            request_digest=preview.request_digest,
            message="Onayli salt-okunur arac bir kez calistirildi.",
            result=result,
        )

    def _execute(
        self,
        preview: ToolPreview,
        authorization: ToolAuthorization,
    ) -> ToolExecutionResult:
        request = preview.request
        if isinstance(request, (ListDirectoryRequest, StatPathRequest, ReadTextRequest)):
            return self.filesystem.execute(request, authorization)
        if isinstance(request, ReadOnlyCommandRequest) and self.command_executor is not None:
            return self.command_executor.execute(request, authorization)
        raise ToolPolicyError("host bu arac turunu desteklemiyor")

    def _request_mismatch(self, preview: ToolPreview | None = None) -> ToolHostOutcome:
        return self._outcome(
            status="rejected",
            preview=preview,
            error_code="request_mismatch",
            message="Onay olayi bekleyen arac istegiyle eslesmiyor; arac calistirilmadi.",
        )

    @staticmethod
    def _outcome(
        *,
        status: Literal["rejected", "error"],
        error_code: ToolHostErrorCode,
        message: str,
        preview: ToolPreview | None = None,
    ) -> ToolHostOutcome:
        return ToolHostOutcome(
            status=status,
            request_id=preview.request.request_id if preview is not None else None,
            request_digest=preview.request_digest if preview is not None else None,
            error_code=error_code,
            message=message,
        )
