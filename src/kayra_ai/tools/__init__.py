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
from .host import (
    ToolHostOutcome,
    ToolHostPrepared,
    UserConfirmedToolExecutionHost,
    render_tool_preview,
)
from .model_loop import (
    AssistantResponseProposal,
    GuardedModelToolLoop,
    GuardedModelToolLoopOutcome,
    ModelOutputParseError,
    StrictModelOutputParser,
    ToolRequestProposal,
    ToolResultDataEnvelope,
    canonical_tool_request_json,
    render_tool_result_for_model,
)
from .policy import ReadOnlyPathPolicy, ToolPolicyError
from .router import ToolRequestRoutingError, UntrustedToolRequestRouter

__all__ = [
    "AssistantResponseProposal",
    "DirectoryEntry",
    "GuardedModelToolLoop",
    "GuardedModelToolLoopOutcome",
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
    "StrictModelOutputParser",
    "TOOL_REQUEST_ADAPTER",
    "ToolApprovalError",
    "ToolApprovalGate",
    "ToolAuthorization",
    "ToolHostOutcome",
    "ToolHostPrepared",
    "ModelOutputParseError",
    "ToolPreview",
    "ToolPolicyError",
    "ToolRequest",
    "ToolRequestRoutingError",
    "ToolRequestProposal",
    "ToolResultDataEnvelope",
    "UntrustedToolRequestRouter",
    "UserConfirmedToolExecutionHost",
    "build_tool_preview",
    "canonical_tool_request_json",
    "render_tool_preview",
    "render_tool_result_for_model",
    "tool_request_digest",
]
