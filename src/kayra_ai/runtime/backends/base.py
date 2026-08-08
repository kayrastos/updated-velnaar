from __future__ import annotations

from typing import Literal, Protocol

from ..contracts import BackendCapabilities, GenerationRequest, GenerationResponse, PreflightResult


class Backend(Protocol):
    @property
    def runtime_name(self) -> Literal["lm_studio", "llama_cpp", "mock"]: ...

    @property
    def runtime_version(self) -> str | None: ...

    @property
    def model_id(self) -> str: ...

    @property
    def model_revision(self) -> str | None: ...

    @property
    def capabilities(self) -> BackendCapabilities: ...

    def probe(self) -> BackendCapabilities: ...

    def preflight(self) -> PreflightResult: ...

    def generate(self, request: GenerationRequest) -> GenerationResponse: ...
