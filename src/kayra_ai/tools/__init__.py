"""User-approved, local-only tool-use security primitives for KayraAI."""

from .approval import ToolApprovalError, ToolApprovalGate
from .commands import (
    GitReadOnlyCommandPolicy,
    ReadOnlyCommandExecutor,
)
from .contracts import (
    TOOL_REQUEST_ADAPTER,
    DirectoryEntry,
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
    ToolRequest,
    build_tool_preview,
    tool_request_digest,
)
from .filesystem import ReadOnlyFilesystem
from .policy import ReadOnlyPathPolicy, ToolPolicyError
from .router import ToolRequestRoutingError, UntrustedToolRequestRouter

__all__ = [
    "DirectoryEntry",
    "GitReadOnlyCommandPolicy",
    "ListDirectoryRequest",
    "ListDirectoryResult",
    "ReadOnlyCommandRequest",
    "ReadOnlyCommandExecutor",
    "ReadOnlyCommandResult",
    "ReadOnlyFilesystem",
    "ReadOnlyPathPolicy",
    "ReadTextRequest",
    "ReadTextResult",
    "StatPathRequest",
    "StatPathResult",
    "TOOL_REQUEST_ADAPTER",
    "ToolApprovalError",
    "ToolApprovalGate",
    "ToolAuthorization",
    "ToolPreview",
    "ToolPolicyError",
    "ToolRequest",
    "ToolRequestRoutingError",
    "UntrustedToolRequestRouter",
    "build_tool_preview",
    "tool_request_digest",
]
