from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from .contracts import ToolAuthorization, ToolRequest, tool_request_digest


class ToolApprovalError(PermissionError):
    pass


class ToolApprovalGate:
    """Bind a short-lived, single-use user approval to one exact request."""

    def __init__(
        self,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._consumed_authorization_ids: set[str] = set()

    def require(
        self,
        request: ToolRequest,
        authorization: ToolAuthorization | None,
    ) -> str:
        if authorization is None:
            raise ToolApprovalError("arac calistirmak icin acik kullanici onayi gerekli")

        now = self._clock()
        if now.tzinfo is None or now.utcoffset() is None:
            raise RuntimeError("tool approval clock timezone bilgisi icermeli")
        now = now.astimezone(timezone.utc)

        if authorization.authorization_id in self._consumed_authorization_ids:
            raise ToolApprovalError("arac onayi daha once kullanilmis")
        if authorization.confirmed_at > now + timedelta(seconds=30):
            raise ToolApprovalError("arac onay zamani gelecekte")
        if now >= authorization.expires_at:
            raise ToolApprovalError("arac onayinin suresi dolmus")

        digest = tool_request_digest(request)
        if authorization.request_digest != digest:
            raise ToolApprovalError("arac onayi bu istekle eslesmiyor")

        self._consumed_authorization_ids.add(authorization.authorization_id)
        return digest
