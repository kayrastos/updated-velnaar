from __future__ import annotations

import base64
import binascii
import re

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .errors import FulgorErrorCode, FulgorValidationError


PUBLIC_KEY_BYTES = 32
SIGNATURE_BYTES = 64
_P = 2**255 - 19
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)
_L = 2**252 + 27742317777372353535851937790883648493
_B64_SIGNATURE_RE = re.compile(r"^[A-Za-z0-9+/]{86}==$")
_B64_PUBLIC_KEY_RE = re.compile(r"^[A-Za-z0-9+/]{43}=$")


def decode_base64_exact(value: str, *, expected_bytes: int) -> bytes:
    if type(value) is not str:
        raise FulgorValidationError(FulgorErrorCode.INVALID_BASE64, "base64 value must be text")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise FulgorValidationError(FulgorErrorCode.INVALID_BASE64, "invalid RFC4648 base64") from exc
    if len(decoded) != expected_bytes or base64.b64encode(decoded).decode("ascii") != value:
        raise FulgorValidationError(
            FulgorErrorCode.INVALID_BASE64, "base64 length, padding, or unused pad bits are noncanonical"
        )
    return decoded


def decode_signature_base64(value: str) -> bytes:
    if type(value) is not str or _B64_SIGNATURE_RE.fullmatch(value) is None:
        raise FulgorValidationError(FulgorErrorCode.INVALID_BASE64, "signature base64 shape is invalid")
    return decode_base64_exact(value, expected_bytes=SIGNATURE_BYTES)


def decode_public_key_base64(value: str) -> bytes:
    if type(value) is not str or _B64_PUBLIC_KEY_RE.fullmatch(value) is None:
        raise FulgorValidationError(FulgorErrorCode.INVALID_BASE64, "public-key base64 shape is invalid")
    decoded = decode_base64_exact(value, expected_bytes=PUBLIC_KEY_BYTES)
    validate_encoded_point(decoded, label="public key")
    return decoded


def _recover_x(encoded: bytes) -> tuple[int, int]:
    if len(encoded) != 32:
        raise FulgorValidationError(FulgorErrorCode.INVALID_PUBLIC_KEY, "encoded point must be 32 bytes")
    raw = int.from_bytes(encoded, "little")
    sign = raw >> 255
    y = raw & ((1 << 255) - 1)
    if y >= _P:
        raise FulgorValidationError(FulgorErrorCode.INVALID_PUBLIC_KEY, "noncanonical encoded point")
    y2 = y * y % _P
    x2 = (y2 - 1) * pow((_D * y2 + 1) % _P, _P - 2, _P) % _P
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P:
        x = x * _I % _P
    if (x * x - x2) % _P:
        raise FulgorValidationError(FulgorErrorCode.INVALID_PUBLIC_KEY, "point is not on Edwards25519")
    if x == 0 and sign:
        raise FulgorValidationError(FulgorErrorCode.INVALID_PUBLIC_KEY, "noncanonical x sign")
    if (x & 1) != sign:
        x = _P - x
    return x, y


def _add(left: tuple[int, int], right: tuple[int, int]) -> tuple[int, int]:
    x1, y1 = left
    x2, y2 = right
    product = _D * x1 * x2 * y1 * y2 % _P
    x3 = (x1 * y2 + y1 * x2) * pow((1 + product) % _P, _P - 2, _P) % _P
    y3 = (y1 * y2 + x1 * x2) * pow((1 - product) % _P, _P - 2, _P) % _P
    return x3, y3


def _multiply_by_eight(point: tuple[int, int]) -> tuple[int, int]:
    for _ in range(3):
        point = _add(point, point)
    return point


def validate_encoded_point(encoded: bytes, *, label: str) -> None:
    try:
        point = _recover_x(encoded)
    except FulgorValidationError as exc:
        raise FulgorValidationError(FulgorErrorCode.INVALID_PUBLIC_KEY, f"invalid {label}: {exc.detail}") from exc
    if _multiply_by_eight(point) == (0, 1):
        raise FulgorValidationError(FulgorErrorCode.INVALID_PUBLIC_KEY, f"small-order {label}")


def verify_strict(public_key: bytes, signature: bytes, message: bytes) -> None:
    if type(public_key) is not bytes or len(public_key) != PUBLIC_KEY_BYTES:
        raise FulgorValidationError(FulgorErrorCode.INVALID_PUBLIC_KEY, "public key must be exactly 32 bytes")
    if type(signature) is not bytes or len(signature) != SIGNATURE_BYTES:
        raise FulgorValidationError(FulgorErrorCode.INVALID_SIGNATURE, "signature must be exactly 64 bytes")
    validate_encoded_point(public_key, label="public key")
    try:
        validate_encoded_point(signature[:32], label="signature R")
    except FulgorValidationError as exc:
        raise FulgorValidationError(FulgorErrorCode.INVALID_SIGNATURE, exc.detail) from exc
    if int.from_bytes(signature[32:], "little") >= _L:
        raise FulgorValidationError(FulgorErrorCode.INVALID_SIGNATURE, "signature scalar S is not canonical")
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, message)
    except (InvalidSignature, ValueError) as exc:
        raise FulgorValidationError(FulgorErrorCode.INVALID_SIGNATURE, "mathematical verification failed") from exc
