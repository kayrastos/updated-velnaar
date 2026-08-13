from __future__ import annotations

from kayra_ai.runtime.backends.base import Backend
from kayra_ai.runtime.contracts import (
    BackendCapabilities,
    ChatMessage,
    GenerationRequest,
    GenerationResponse,
    PreflightResult,
)

from .context import build_memory_context
from .contracts import MemoryQuery
from .retrieval import LexicalMemoryRetriever


class MemoryAugmentationError(ValueError):
    pass


class MemoryAwareBackend:
    """Read-only memory augmentation around an existing runtime backend.

    This wrapper never creates, updates, or deletes persistent memories. When no
    relevant memory is found, the original request object is forwarded unchanged.
    """

    def __init__(
        self,
        backend: Backend,
        retriever: LexicalMemoryRetriever,
        *,
        enabled: bool = True,
        top_k: int = 5,
        max_context_characters: int = 12000,
    ) -> None:
        if not 1 <= top_k <= 20:
            raise ValueError("top_k 1 ile 20 arasinda olmali")
        if not 1000 <= max_context_characters <= 32000:
            raise ValueError("max_context_characters 1000 ile 32000 arasinda olmali")
        self._backend = backend
        self._retriever = retriever
        self._enabled = enabled
        self._top_k = top_k
        self._max_context_characters = max_context_characters

    @property
    def runtime_name(self):  # type: ignore[no-untyped-def]
        return self._backend.runtime_name

    @property
    def runtime_version(self) -> str | None:
        return self._backend.runtime_version

    @property
    def model_id(self) -> str:
        return self._backend.model_id

    @property
    def model_revision(self) -> str | None:
        return self._backend.model_revision

    @property
    def capabilities(self) -> BackendCapabilities:
        return self._backend.capabilities

    def probe(self) -> BackendCapabilities:
        return self._backend.probe()

    def preflight(self) -> PreflightResult:
        return self._backend.preflight()

    def generate(self, request: GenerationRequest) -> GenerationResponse:
        if not self._enabled:
            return self._backend.generate(request)
        user_messages = [message for message in request.messages if message.role == "user"]
        if not user_messages:
            raise MemoryAugmentationError("hafiza aramasi icin user mesaji gerekli")
        results = self._retriever.search(
            MemoryQuery(text=user_messages[-1].content, top_k=self._top_k)
        )
        memory_message = build_memory_context(
            results,
            max_characters=self._max_context_characters,
        )
        if memory_message is None:
            return self._backend.generate(request)
        augmented = self._merge_with_system_message(request, memory_message)
        return self._backend.generate(augmented)

    @staticmethod
    def _merge_with_system_message(
        request: GenerationRequest,
        memory_message: ChatMessage,
    ) -> GenerationRequest:
        if not request.messages or request.messages[0].role != "system":
            raise MemoryAugmentationError(
                "hafiza baglami icin ilk mesaj system rolunde olmali"
            )
        combined = request.messages[0].content + "\n\n---\n\n" + memory_message.content
        if len(combined) > 65536:
            raise MemoryAugmentationError("birlesik system mesaji siniri asiyor")
        messages = [ChatMessage(role="system", content=combined), *request.messages[1:]]
        return GenerationRequest(
            messages=messages,
            settings=request.settings,
            requested_profile=request.requested_profile,
        )
