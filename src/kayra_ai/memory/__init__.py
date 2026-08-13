"""User-controlled, local-only memory primitives for KayraAI."""

from .backend import MemoryAugmentationError, MemoryAwareBackend
from .context import build_memory_context
from .contracts import (
    MemoryDraft,
    MemoryQuery,
    MemoryRecord,
    RetrievedMemory,
    WriteAuthorization,
)
from .retrieval import LexicalMemoryRetriever
from .store import MemoryAuthorizationError, MemoryStore, UnsafeMemoryPathError

__all__ = [
    "LexicalMemoryRetriever",
    "MemoryAugmentationError",
    "MemoryAuthorizationError",
    "MemoryAwareBackend",
    "MemoryDraft",
    "MemoryQuery",
    "MemoryRecord",
    "MemoryStore",
    "RetrievedMemory",
    "UnsafeMemoryPathError",
    "WriteAuthorization",
    "build_memory_context",
]
