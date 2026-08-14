from __future__ import annotations

import os
import stat
from pathlib import Path

from .approval import ToolApprovalGate
from .contracts import (
    DirectoryEntry,
    ListDirectoryRequest,
    ListDirectoryResult,
    ReadTextRequest,
    ReadTextResult,
    StatPathRequest,
    StatPathResult,
    ToolAuthorization,
    ToolRequest,
)
from .policy import ReadOnlyPathPolicy, ToolPolicyError


class ReadOnlyFilesystem:
    """Execute only the three declared read-only filesystem operations."""

    def __init__(self, policy: ReadOnlyPathPolicy, approval_gate: ToolApprovalGate) -> None:
        self.policy = policy
        self.approval_gate = approval_gate

    def execute(
        self,
        request: ToolRequest,
        authorization: ToolAuthorization | None,
    ) -> ListDirectoryResult | StatPathResult | ReadTextResult:
        if not isinstance(request, (ListDirectoryRequest, StatPathRequest, ReadTextRequest)):
            raise ToolPolicyError("filesystem yurutucusu bu arac turunu desteklemiyor")

        self.approval_gate.require(request, authorization)
        path = self.policy.resolve(request.path)
        if isinstance(request, ListDirectoryRequest):
            return self._list_directory(request, path)
        if isinstance(request, StatPathRequest):
            return self._stat_path(request, path)
        return self._read_text(request, path)

    @staticmethod
    def _kind(path: Path) -> str:
        if path.is_file():
            return "file"
        if path.is_dir():
            return "directory"
        return "other"

    def _list_directory(
        self,
        request: ListDirectoryRequest,
        path: Path,
    ) -> ListDirectoryResult:
        if not path.is_dir():
            raise ToolPolicyError("list_directory hedefi bir dizin olmali")

        children = sorted(
            (
                child
                for child in path.iterdir()
                if not self.policy.is_sensitive_name(child.name)
            ),
            key=lambda item: (item.name.casefold(), item.name),
        )
        selected = children[: request.max_entries]
        entries = tuple(
            DirectoryEntry(
                name=child.name,
                kind="symlink" if child.is_symlink() else self._kind(child),
                size_bytes=child.stat(follow_symlinks=False).st_size,
            )
            for child in selected
        )
        return ListDirectoryResult(
            request_id=request.request_id,
            path=str(path),
            entries=entries,
            truncated=len(children) > len(selected),
        )

    def _stat_path(self, request: StatPathRequest, path: Path) -> StatPathResult:
        stat = path.stat(follow_symlinks=False)
        return StatPathResult(
            request_id=request.request_id,
            path=str(path),
            kind=self._kind(path),
            size_bytes=stat.st_size,
        )

    def _read_text(self, request: ReadTextRequest, path: Path) -> ReadTextResult:
        if not path.is_file():
            raise ToolPolicyError("read_text hedefi normal bir dosya olmali")
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags)
        except OSError as exc:
            raise ToolPolicyError("dosya guvenli bicimde acilamadi") from exc
        with os.fdopen(descriptor, "rb") as handle:
            opened_stat = os.fstat(handle.fileno())
            if not stat.S_ISREG(opened_stat.st_mode):
                raise ToolPolicyError("read_text hedefi normal bir dosya olmali")
            if opened_stat.st_size > self.policy.max_file_bytes:
                raise ToolPolicyError("dosya politika boyut sinirini asiyor")
            data = handle.read(self.policy.max_file_bytes + 1)
        if len(data) > self.policy.max_file_bytes:
            raise ToolPolicyError("dosya politika boyut sinirini asiyor")
        if b"\x00" in data:
            raise ToolPolicyError("binary dosya metin araci ile okunamaz")
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise ToolPolicyError("dosya gecerli UTF-8 metni degil") from None

        truncated = len(text) > request.max_chars
        return ReadTextResult(
            request_id=request.request_id,
            path=str(path),
            text=text[: request.max_chars],
            truncated=truncated,
            size_bytes=len(data),
        )
