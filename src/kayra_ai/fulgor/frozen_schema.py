"""Small, closed Draft 2020-12 evaluator for the frozen local Fulgor schemas.

It intentionally supports only the vocabulary exercised by Contract 8 and its
inline Contract 53 TargetScopeDescriptor reference.  Unknown schema keywords
are an implementation error, never silently ignored.
"""
from __future__ import annotations

import json
import hashlib
import re
from pathlib import Path
from typing import Any

from .canonical import canonicalize
from .errors import FulgorErrorCode, FulgorValidationError

_ROOT = Path(__file__).resolve().parents[3] / "schemas" / "fulgor"
_FILES = {
    "urn:fulgor:SafetyTrustPolicyPayloadV2_3_8": "safety-trust-policy-payload-v2.3.8.schema.json",
    "urn:fulgor:RequestedActionV2_3_8": "requested-action-v2.3.8.schema.json",
}
_SHA256 = {
    "urn:fulgor:SafetyTrustPolicyPayloadV2_3_8": "f77802e0229af31690f4ba5cb41ac9306afd2c7c8f79d7f435912d125e1ed546",
    "urn:fulgor:RequestedActionV2_3_8": "6099f4201d1d414c3a4d7a619197f56f149dc5ac85605b19223805012efadf3b",
}
_ALLOWED = frozenset({"$schema", "$id", "$defs", "$ref", "type", "additionalProperties", "properties", "required", "propertyNames", "items", "minItems", "maxItems", "uniqueItems", "enum", "const", "pattern", "minLength", "maxLength", "minimum", "maximum", "oneOf", "anyOf", "allOf", "if", "then", "else", "minProperties", "maxProperties"})


def _error(path: str, message: str) -> None:
    raise FulgorValidationError(FulgorErrorCode.INVALID_SAFETY_TRUST_POLICY, f"schema {path}: {message}")


def _load(uri: str) -> dict[str, Any]:
    try:
        raw = (_ROOT / _FILES[uri]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != _SHA256[uri]:
            _error("$schema", f"frozen schema digest mismatch for {uri}")
        document = json.loads(raw)
    except (KeyError, OSError, json.JSONDecodeError) as exc:
        _error("$ref", f"unavailable frozen schema {uri}")
    if document.get("$id") != uri:
        _error("$id", "frozen schema identity mismatch")
    return document


def _pointer(document: dict[str, Any], pointer: str) -> Any:
    target: Any = document
    for part in pointer.removeprefix("/").split("/") if pointer else ():
        if type(target) is not dict or part.replace("~1", "/").replace("~0", "~") not in target:
            _error("$ref", f"unresolved JSON pointer #{pointer}")
        target = target[part.replace("~1", "/").replace("~0", "~")]
    return target


def _resolve(reference: str, root: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    if reference.startswith("#"):
        return _pointer(root, reference[1:]), root
    uri, separator, pointer = reference.partition("#")
    document = _load(uri)
    return _pointer(document, pointer) if separator else document, document


def _matches(value: Any, schema: Any, root: dict[str, Any], path: str) -> bool:
    try:
        _validate(value, schema, root, path)
        return True
    except FulgorValidationError:
        return False


def _type_matches(value: Any, expected: str) -> bool:
    return {
        "object": type(value) is dict,
        "array": type(value) is list,
        "string": type(value) is str,
        "integer": type(value) is int,
        "boolean": type(value) is bool,
        "null": value is None,
    }.get(expected, False)


def _validate(value: Any, schema: Any, root: dict[str, Any], path: str) -> None:
    if type(schema) is bool:
        if not schema: _error(path, "false schema")
        return
    if type(schema) is not dict: _error(path, "schema is not an object")
    unknown = set(schema) - _ALLOWED
    if unknown: _error(path, f"unsupported frozen schema keyword(s): {sorted(unknown)}")
    if "$ref" in schema:
        target, target_root = _resolve(schema["$ref"], root)
        _validate(value, target, target_root, path)
        return
    if "allOf" in schema:
        for child in schema["allOf"]: _validate(value, child, root, path)
    if "anyOf" in schema and not any(_matches(value, child, root, path) for child in schema["anyOf"]):
        _error(path, "does not match any anyOf branch")
    if "oneOf" in schema and sum(_matches(value, child, root, path) for child in schema["oneOf"]) != 1:
        _error(path, "does not match exactly one oneOf branch")
    if "if" in schema:
        selected = schema.get("then") if _matches(value, schema["if"], root, path) else schema.get("else")
        if selected is not None: _validate(value, selected, root, path)
    if "type" in schema:
        expected = schema["type"]
        choices = expected if type(expected) is list else [expected]
        if not any(_type_matches(value, item) for item in choices): _error(path, f"type must be {expected}")
    if "const" in schema and (type(value) is not type(schema["const"]) or value != schema["const"]): _error(path, "const mismatch")
    if "enum" in schema and not any(type(value) is type(item) and value == item for item in schema["enum"]): _error(path, "enum mismatch")
    if type(value) is str:
        if "minLength" in schema and len(value) < schema["minLength"]: _error(path, "shorter than minLength")
        if "maxLength" in schema and len(value) > schema["maxLength"]: _error(path, "longer than maxLength")
        if "pattern" in schema and re.fullmatch(schema["pattern"], value) is None: _error(path, "pattern mismatch")
    if type(value) is int:
        if "minimum" in schema and value < schema["minimum"]: _error(path, "below minimum")
        if "maximum" in schema and value > schema["maximum"]: _error(path, "above maximum")
    if type(value) is list:
        if "minItems" in schema and len(value) < schema["minItems"]: _error(path, "fewer than minItems")
        if "maxItems" in schema and len(value) > schema["maxItems"]: _error(path, "more than maxItems")
        if schema.get("uniqueItems") and len({canonicalize(item) for item in value}) != len(value): _error(path, "duplicate array item")
        if "items" in schema:
            for index, item in enumerate(value): _validate(item, schema["items"], root, f"{path}/{index}")
    if type(value) is dict:
        if "minProperties" in schema and len(value) < schema["minProperties"]: _error(path, "fewer than minProperties")
        if "maxProperties" in schema and len(value) > schema["maxProperties"]: _error(path, "more than maxProperties")
        required = schema.get("required", [])
        missing = [key for key in required if key not in value]
        if missing: _error(path, f"missing required field(s): {missing}")
        properties = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        for key, item in value.items():
            if "propertyNames" in schema: _validate(key, schema["propertyNames"], root, f"{path}/<key>")
            child = properties.get(key, additional)
            if child is False: _error(path, f"additional property {key!r}")
            _validate(item, child, root, f"{path}/{key}")


def validate_contract8_schema(value: Any) -> None:
    """Validate a programmatic JSON value against frozen Contract 8 structure."""
    root = _load("urn:fulgor:SafetyTrustPolicyPayloadV2_3_8")
    _validate(value, root, root, "$")
