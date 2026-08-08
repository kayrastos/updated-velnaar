from __future__ import annotations

from .openai_compatible import OpenAICompatibleBackend


class LlamaCppBackend(OpenAICompatibleBackend):
    """llama.cpp server identity adapter over the shared OpenAI-compatible client."""
