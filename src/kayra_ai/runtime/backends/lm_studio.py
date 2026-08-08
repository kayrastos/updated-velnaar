from __future__ import annotations

from .openai_compatible import OpenAICompatibleBackend


class LMStudioBackend(OpenAICompatibleBackend):
    """LM Studio identity adapter over the shared OpenAI-compatible client."""
