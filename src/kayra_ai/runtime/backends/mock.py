from __future__ import annotations

import hashlib
import json
from typing import Literal

from ..config import MockBackendConfig
from ..contracts import (
    BackendCapabilities,
    GenerationRequest,
    GenerationResponse,
    PreflightResult,
    TimingMetrics,
    TokenUsage,
)


class MockBackend:
    """Deterministic pipeline backend. It never owns or creates an HTTP transport."""

    def __init__(self, config: MockBackendConfig) -> None:
        self._config = config
        self._capabilities = BackendCapabilities(
            thinking="supported",
            non_thinking="supported",
            streaming="unsupported",
            token_usage="unsupported",
            model_listing="supported",
            source="static_backend",
        )

    @property
    def runtime_name(self) -> Literal["mock"]:
        return "mock"

    @property
    def runtime_version(self) -> str:
        return "deterministic-v1"

    @property
    def model_id(self) -> str:
        return self._config.model.id

    @property
    def model_revision(self) -> str:
        return self._config.model.revision

    @property
    def capabilities(self) -> BackendCapabilities:
        return self._capabilities.model_copy(deep=True)

    def probe(self) -> BackendCapabilities:
        return self.capabilities

    def preflight(self) -> PreflightResult:
        return PreflightResult(
            ok=True,
            backend_name="mock",
            model_available=True,
            capabilities=self.capabilities,
        )

    def generate(self, request: GenerationRequest) -> GenerationResponse:
        canonical = json.dumps(
            request.model_dump(mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        digest = hashlib.sha256(canonical).hexdigest()[:16]
        return GenerationResponse(
            content=f"[kayra-mock:{request.requested_profile}:{digest}] pipeline-ok",
            usage=TokenUsage(source="mock_deterministic"),
            timing=TimingMetrics(
                total_ms=0.0,
                total_ms_source="mock_deterministic",
                ttft_ms=None,
                ttft_ms_source="unavailable",
            ),
            effective_profile=request.requested_profile,
            finish_reason="mock_complete",
        )
