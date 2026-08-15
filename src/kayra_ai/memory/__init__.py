"""User-controlled, local-only memory primitives for Fulgor AI."""

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
from .store import (
    MemoryAuthorizationError,
    MemoryDecryptionError,
    MemoryStore,
    UnencryptedMemoryDatabaseError,
    UnsafeMemoryPathError,
)

__all__ = [
    "LexicalMemoryRetriever",
    "MemoryAugmentationError",
    "MemoryAuthorizationError",
    "MemoryDecryptionError",
    "MemoryAwareBackend",
    "MemoryDraft",
    "MemoryQuery",
    "MemoryRecord",
    "MemoryStore",
    "RetrievedMemory",
    "UnencryptedMemoryDatabaseError",
    "UnsafeMemoryPathError",
    "WriteAuthorization",
    "build_memory_context",
]
