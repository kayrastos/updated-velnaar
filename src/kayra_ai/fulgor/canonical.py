from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from .errors import FulgorErrorCode, FulgorValidationError


MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_PAYLOAD_BYTES = 104_857_600


def _reject_constant(value: str) -> None:
    raise FulgorValidationError(
        FulgorErrorCode.INVALID_JSON_VALUE, f"non-finite number is forbidden: {value}"
    )


def _parse_integer(value: str) -> int:
    if value == "-0":
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_JSON_VALUE, "negative zero is forbidden"
        )
    parsed = int(value)
    if parsed < 0 or parsed > MAX_SAFE_INTEGER:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_JSON_VALUE,
            f"integer outside [0,{MAX_SAFE_INTEGER}]",
        )
    return parsed


def _reject_fraction(value: str) -> None:
    raise FulgorValidationError(
        FulgorErrorCode.INVALID_JSON_VALUE, f"fractional/exponent number is forbidden: {value}"
    )


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise FulgorValidationError(
                FulgorErrorCode.DUPLICATE_JSON_KEY, f"duplicate object key: {key!r}"
            )
        result[key] = value
    return result


def parse_json_strict(
    raw: bytes,
    *,
    max_payload_bytes: int = MAX_PAYLOAD_BYTES,
) -> Any:
    """Parse the frozen integer-only JSON subset exactly once and fail closed."""

    if type(raw) is not bytes:
        raise TypeError("raw JSON input must be bytes")
    if type(max_payload_bytes) is not int or not 1 <= max_payload_bytes <= MAX_PAYLOAD_BYTES:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_PROFILE, "max_payload_bytes is outside the frozen bound"
        )
    if len(raw) > max_payload_bytes:
        raise FulgorValidationError(
            FulgorErrorCode.PAYLOAD_TOO_LARGE,
            f"payload is {len(raw)} bytes; limit is {max_payload_bytes}",
        )
    if raw.startswith(b"\xef\xbb\xbf"):
        raise FulgorValidationError(FulgorErrorCode.INVALID_UTF8, "leading UTF-8 BOM")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_UTF8, f"invalid UTF-8 at byte {exc.start}"
        ) from exc
    try:
        parsed = json.loads(
            text,
            object_pairs_hook=_unique_object,
            parse_int=_parse_integer,
            parse_float=_reject_fraction,
            parse_constant=_reject_constant,
        )
    except FulgorValidationError:
        raise
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise FulgorValidationError(FulgorErrorCode.INVALID_JSON, str(exc)) from exc
    validate_json_value(parsed)
    if canonicalize(parsed, max_payload_bytes=max_payload_bytes) != raw:
        raise FulgorValidationError(
            FulgorErrorCode.NON_CANONICAL_JSON, "serialized bytes do not equal J(parsed)"
        )
    return parsed


def _validate_string(value: str) -> None:
    for character in value:
        if 0xD800 <= ord(character) <= 0xDFFF:
            raise FulgorValidationError(
                FulgorErrorCode.INVALID_JSON_VALUE, "lone UTF-16 surrogate is forbidden"
            )


def validate_json_value(value: Any) -> None:
    if value is None or type(value) is bool:
        return
    if type(value) is int:
        if value < 0 or value > MAX_SAFE_INTEGER:
            raise FulgorValidationError(
                FulgorErrorCode.INVALID_JSON_VALUE,
                f"integer outside [0,{MAX_SAFE_INTEGER}]",
            )
        return
    if type(value) is float:
        detail = "non-finite number" if not math.isfinite(value) else "fraction/negative zero"
        raise FulgorValidationError(FulgorErrorCode.INVALID_JSON_VALUE, detail)
    if type(value) is str:
        _validate_string(value)
        return
    if type(value) is dict:
        for key, nested in value.items():
            if type(key) is not str:
                raise FulgorValidationError(
                    FulgorErrorCode.INVALID_JSON_VALUE, "object keys must be strings"
                )
            _validate_string(key)
            validate_json_value(nested)
        return
    if type(value) is list:
        for nested in value:
            validate_json_value(nested)
        return
    raise FulgorValidationError(
        FulgorErrorCode.INVALID_JSON_VALUE, f"unsupported JSON value type: {type(value).__name__}"
    )


def _utf16_sort_key(value: str) -> bytes:
    return value.encode("utf-16-be", errors="strict")


def _render(value: Any) -> str:
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is int:
        return str(value)
    if type(value) is str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if type(value) is dict:
        entries = (
            f"{_render(key)}:{_render(value[key])}"
            for key in sorted(value, key=_utf16_sort_key)
        )
        return "{" + ",".join(entries) + "}"
    return "[" + ",".join(_render(item) for item in value) + "]"


def canonicalize(value: Any, *, max_payload_bytes: int = MAX_PAYLOAD_BYTES) -> bytes:
    if type(max_payload_bytes) is not int or not 1 <= max_payload_bytes <= MAX_PAYLOAD_BYTES:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_PROFILE, "max_payload_bytes is outside the frozen bound"
        )
    validate_json_value(value)
    encoded = _render(value).encode("utf-8")
    if len(encoded) > max_payload_bytes:
        raise FulgorValidationError(
            FulgorErrorCode.PAYLOAD_TOO_LARGE,
            f"canonical payload is {len(encoded)} bytes; limit is {max_payload_bytes}",
        )
    return encoded


def u64be(value: int) -> bytes:
    if type(value) is not int or not 0 <= value <= (1 << 64) - 1:
        raise ValueError("U64BE input is outside the unsigned 64-bit range")
    return value.to_bytes(8, "big")


def length_prefix(value: bytes) -> bytes:
    return u64be(len(value)) + value


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()
