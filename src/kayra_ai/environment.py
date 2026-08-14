from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType


LEGACY_ENV_PREFIX = "KAYRA_"
CURRENT_ENV_PREFIX = "FULGOR_"

ENVIRONMENT_ALIASES: Mapping[str, str] = MappingProxyType(
    {
        "KAYRA_MEMORY_DB": "FULGOR_MEMORY_DB",
        "KAYRA_LM_STUDIO_BASE_URL": "FULGOR_LM_STUDIO_BASE_URL",
        "KAYRA_LM_STUDIO_MODEL": "FULGOR_LM_STUDIO_MODEL",
        "KAYRA_LM_STUDIO_MODEL_REVISION": "FULGOR_LM_STUDIO_MODEL_REVISION",
        "KAYRA_LM_STUDIO_API_KEY": "FULGOR_LM_STUDIO_API_KEY",
        "KAYRA_LLAMA_CPP_BASE_URL": "FULGOR_LLAMA_CPP_BASE_URL",
        "KAYRA_LLAMA_CPP_MODEL": "FULGOR_LLAMA_CPP_MODEL",
        "KAYRA_LLAMA_CPP_MODEL_REVISION": "FULGOR_LLAMA_CPP_MODEL_REVISION",
        "KAYRA_LLAMA_CPP_API_KEY": "FULGOR_LLAMA_CPP_API_KEY",
    }
)


class EnvironmentConfigurationError(ValueError):
    """A safe configuration error that never includes environment values."""


def _brand_pair(configured_name: str) -> tuple[str, str] | None:
    if configured_name.startswith(LEGACY_ENV_PREFIX):
        return (
            CURRENT_ENV_PREFIX + configured_name.removeprefix(LEGACY_ENV_PREFIX),
            configured_name,
        )
    if configured_name.startswith(CURRENT_ENV_PREFIX):
        return (
            configured_name,
            LEGACY_ENV_PREFIX + configured_name.removeprefix(CURRENT_ENV_PREFIX),
        )
    return None


def resolve_environment_value(
    environ: Mapping[str, str],
    configured_name: str,
) -> str | None:
    """Resolve FULGOR_/KAYRA_ aliases without disclosing either value."""

    pair = _brand_pair(configured_name)
    if pair is None:
        return environ.get(configured_name)

    current_name, legacy_name = pair
    current_present = current_name in environ
    legacy_present = legacy_name in environ
    current_value = environ.get(current_name)
    legacy_value = environ.get(legacy_name)

    if current_present and legacy_present and current_value != legacy_value:
        raise EnvironmentConfigurationError(
            f"Çakışan ortam değişkenleri: {current_name} ve {legacy_name}."
        )
    if current_present:
        return current_value
    if legacy_present:
        return legacy_value
    return None
