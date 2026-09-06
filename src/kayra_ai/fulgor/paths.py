from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Iterable

from .errors import FulgorErrorCode, FulgorValidationError


_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {f"COM{index}" for index in range(1, 10)} | {
    f"LPT{index}" for index in range(1, 10)
}
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_SUPERSCRIPT_DEVICE_DIGITS = str.maketrans({"¹": "1", "²": "2", "³": "3"})


def validate_logical_path(value: str) -> str:
    if type(value) is not str or not value:
        raise FulgorValidationError(FulgorErrorCode.INVALID_LOGICAL_PATH, "path must be non-empty text")
    if unicodedata.normalize("NFC", value) != value:
        raise FulgorValidationError(FulgorErrorCode.INVALID_LOGICAL_PATH, "path is not NFC")
    if value.startswith("/") or value.endswith("/"):
        raise FulgorValidationError(FulgorErrorCode.INVALID_LOGICAL_PATH, "leading/trailing slash")
    if "\\" in value or ":" in value:
        raise FulgorValidationError(FulgorErrorCode.INVALID_LOGICAL_PATH, "backslash/colon is forbidden")
    if _CONTROL_RE.search(value):
        raise FulgorValidationError(FulgorErrorCode.INVALID_LOGICAL_PATH, "control character is forbidden")
    for component in value.split("/"):
        if component in {"", ".", ".."}:
            raise FulgorValidationError(FulgorErrorCode.INVALID_LOGICAL_PATH, "empty/dot traversal component")
        if component.endswith((".", " ")):
            raise FulgorValidationError(FulgorErrorCode.INVALID_LOGICAL_PATH, "trailing dot/space")
        basename = component.split(".", 1)[0].upper().translate(_SUPERSCRIPT_DEVICE_DIGITS)
        if basename in _RESERVED:
            raise FulgorValidationError(FulgorErrorCode.INVALID_LOGICAL_PATH, "Windows reserved device basename")
    return value


def validate_no_casefold_collisions(paths: Iterable[str]) -> tuple[str, ...]:
    accepted: list[str] = []
    seen: dict[str, str] = {}
    for raw in paths:
        path = validate_logical_path(raw)
        folded = path.casefold()
        if folded in seen and seen[folded] != path:
            raise FulgorValidationError(
                FulgorErrorCode.CASEFOLD_PATH_COLLISION,
                f"{seen[folded]!r} collides with {path!r}",
            )
        seen[folded] = path
        accepted.append(path)
    return tuple(accepted)


def logical_path_sha256(value: str) -> str:
    """Raw portable identity helper; it deliberately is not protocol authority."""

    return hashlib.sha256(validate_logical_path(value).encode("utf-8")).hexdigest()
