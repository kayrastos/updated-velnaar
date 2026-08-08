from __future__ import annotations

import time
from collections.abc import Callable, Mapping

from ..config import MockBackendConfig, RuntimeConfig, resolve_backend_config
from ..http_transport import TransportFactory
from .base import Backend
from .llama_cpp import LlamaCppBackend
from .lm_studio import LMStudioBackend
from .mock import MockBackend


def build_backend(
    config: RuntimeConfig,
    backend_name: str | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    transport_factory: TransportFactory | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> Backend:
    resolved = resolve_backend_config(config, backend_name, environ=environ)
    if isinstance(resolved, MockBackendConfig):
        # This branch deliberately does not touch transport_factory. Mock mode is
        # offline by construction, including its preflight operation.
        return MockBackend(resolved)

    backend_type = LMStudioBackend if resolved.kind == "lm_studio" else LlamaCppBackend
    return backend_type(
        config=resolved,
        execution=config.execution,
        network=config.network,
        profiles=config.profiles,
        transport_factory=transport_factory,
        clock=clock,
    )


create_backend = build_backend


__all__ = [
    "Backend",
    "LlamaCppBackend",
    "LMStudioBackend",
    "MockBackend",
    "build_backend",
    "create_backend",
]
