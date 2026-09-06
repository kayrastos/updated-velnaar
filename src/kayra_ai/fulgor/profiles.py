from __future__ import annotations

from types import MappingProxyType
from typing import Any

from .canonical import MAX_PAYLOAD_BYTES
from .errors import FulgorErrorCode, FulgorValidationError


CANONICAL_PROFILE = MappingProxyType(
    {
        "canonical_profile_id": "FULGOR_JCS_V2_3_8",
        "ruleset_version": "2.3.8",
        "target_format": "RFC8785_JCS",
        "number_representation": "IEEE754_STRICT_INTEGER_LIMIT",
        "max_payload_bytes": MAX_PAYLOAD_BYTES,
    }
)
LOGICAL_PATH_PROFILE = MappingProxyType(
    {
        "path_profile_id": "FULGOR_LOGICAL_PATH_V2_3_8",
        "separator_standard": "FORWARD_SLASH",
        "absolute_paths_permitted": False,
        "device_namespace_permitted": False,
        "traversal_tokens_permitted": False,
    }
)
ED25519_PROFILE = MappingProxyType(
    {
        "ed25519_profile_id": "FULGOR_ED25519_STRICT_V2_3_8",
        "public_key_bytes": 32,
        "signature_bytes": 64,
        "curve": "Edwards25519",
        "algorithm_agility_permitted": False,
    }
)


def validate_installed_profile(value: Any, installed: MappingProxyType) -> None:
    if type(value) is not dict or value != dict(installed):
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_PROFILE, "profile must exactly equal the installed frozen profile"
        )
