from __future__ import annotations

import base64
import hashlib
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.fulgor import (
    CANONICAL_PROFILE,
    CONTRACT_DOMAINS,
    ED25519_PROFILE,
    LOGICAL_PATH_PROFILE,
    MAX_SAFE_INTEGER,
    OPERATION_DOMAINS,
    PHASE0_FORMULA_DOMAIN_USES,
    PHASE0_REGISTERED_DOMAIN_TAGS,
    PHASE0_USED_DOMAIN_TAGS,
    REGISTERED_DOMAIN_TAGS,
    FulgorErrorCode,
    FulgorValidationError,
    TrustStatus,
    VerificationExpectations,
    assert_registry_integrity,
    assert_phase0_domain_usage,
    canonicalize,
    contract_digest,
    decode_public_key_base64,
    logical_path_sha256,
    parse_json_strict,
    parse_protected_header,
    sign_detached,
    signature_input,
    validate_logical_path,
    validate_no_casefold_collisions,
    verify_detached,
    verify_strict,
    validate_domain_registry,
)
from kayra_ai.fulgor.canonical import length_prefix
from kayra_ai.fulgor.domains import contract_domain, operation_domain, operation_domain_bytes
from kayra_ai.fulgor.ed25519 import _L, decode_signature_base64
from kayra_ai.fulgor.header import PAYLOAD_CONTRACTS
from kayra_ai.fulgor.profiles import validate_installed_profile


H64 = "a" * 64


def public_bytes(private_key: Ed25519PrivateKey) -> bytes:
    return private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


def header_for(payload: object, public_key: bytes, **updates: object) -> dict[str, object]:
    payload_type = str(updates.pop("payload_type", "RuntimeObservationV2_3_8"))
    purposes = {
        "RuntimeObservationV2_3_8": "OBSERVATION",
        "HumanDecisionV2_3_8": "DECISION",
    }
    value: dict[str, object] = {
        "schema_version": "2.3.8",
        "payload_type": payload_type,
        "purpose": purposes.get(payload_type, "ATTESTATION"),
        "scope_digest": "1" * 64,
        "authority_id": "2" * 64,
        "key_id": hashlib.sha256(public_key).hexdigest(),
        "policy_epoch": 7,
        "serial": 1,
        "issued_at": 20,
        "not_before": 10,
        "not_after": 30,
        "subject_digest": "3" * 64,
        "nonce": "4" * 64,
        "content_digest": contract_digest(PAYLOAD_CONTRACTS[payload_type], payload),
        "root_generation": 5,
    }
    value.update(updates)
    return value


def signed_envelope(
    private_key: Ed25519PrivateKey, header: object, payload: object
) -> object:
    from kayra_ai.fulgor import DetachedSignatureEnvelope

    parsed = parse_protected_header(header)
    signature = private_key.sign(signature_input(parsed, payload))
    return DetachedSignatureEnvelope(
        protected_header=parsed,
        signature=base64.b64encode(signature).decode("ascii"),
    )


def verify_wire(envelope: object, payload: object, public_key: bytes | str, **kwargs: object) -> object:
    """Exercise only the authoritative canonical-bytes verification entrypoint."""

    envelope_value = envelope.to_dict() if hasattr(envelope, "to_dict") else envelope
    return verify_detached(canonicalize(envelope_value), canonicalize(payload), public_key, **kwargs)


def validate_digest_wire(header: object, payload: object) -> str:
    header_value = header.to_dict() if hasattr(header, "to_dict") else header
    from kayra_ai.fulgor import validate_content_digest

    return validate_content_digest(canonicalize(header_value), canonicalize(payload))


class Contract1CanonicalTests(unittest.TestCase):
    def test_installed_profile_and_domain_separated_identity(self) -> None:
        validate_installed_profile(dict(CANONICAL_PROFILE), CANONICAL_PROFILE)
        canonical = canonicalize(dict(CANONICAL_PROFILE))
        expected = hashlib.sha256(
            b"fulgor-contract-01-v2.3.8\0" + len(canonical).to_bytes(8, "big") + canonical
        ).hexdigest()
        self.assertEqual(expected, contract_digest(1, dict(CANONICAL_PROFILE)))

    def test_deterministic_utf16_key_order_and_exact_bytes(self) -> None:
        value = {"\ue000": 2, "\U0001f600": 1, "a": [True, None, "x\n"]}
        expected = '{"a":[true,null,"x\\n"],"😀":1,"":2}'.encode("utf-8")
        self.assertEqual(expected, canonicalize(value))
        self.assertEqual(expected, canonicalize(value))

    def test_strict_parser_rejects_ambiguity_and_bad_encoding(self) -> None:
        bad_values = [
            (b'{"a":1,"a":2}', FulgorErrorCode.DUPLICATE_JSON_KEY),
            (b'"\\ud800"', FulgorErrorCode.INVALID_JSON_VALUE),
            (b"\xef\xbb\xbf{}", FulgorErrorCode.INVALID_UTF8),
            (b'"\xff"', FulgorErrorCode.INVALID_UTF8),
            (b"1.0", FulgorErrorCode.INVALID_JSON_VALUE),
            (b"1e0", FulgorErrorCode.INVALID_JSON_VALUE),
            (b"NaN", FulgorErrorCode.INVALID_JSON_VALUE),
            (b"-0", FulgorErrorCode.INVALID_JSON_VALUE),
            (str(MAX_SAFE_INTEGER + 1).encode(), FulgorErrorCode.INVALID_JSON_VALUE),
        ]
        for raw, code in bad_values:
            with self.subTest(raw=raw), self.assertRaises(FulgorValidationError) as caught:
                parse_json_strict(raw)
            self.assertEqual(code, caught.exception.code)

    def test_noncanonical_serialization_and_payload_size_fail_closed(self) -> None:
        self.assertEqual({"a": 1, "b": 2}, parse_json_strict(b'{"a":1,"b":2}'))
        with self.assertRaises(FulgorValidationError) as caught:
            parse_json_strict(b'{ "a": 1 }')
        self.assertEqual(FulgorErrorCode.NON_CANONICAL_JSON, caught.exception.code)
        with self.assertRaises(FulgorValidationError) as caught:
            parse_json_strict(b'{"a":1}', max_payload_bytes=6)
        self.assertEqual(FulgorErrorCode.PAYLOAD_TOO_LARGE, caught.exception.code)
        with self.assertRaises(FulgorValidationError) as caught:
            parse_json_strict(b'{"b":2,"a":1}')
        self.assertEqual(FulgorErrorCode.NON_CANONICAL_JSON, caught.exception.code)
        with self.assertRaises(TypeError):
            parse_json_strict(b'{ "a":1}', require_canonical=False)

    def test_frozen_digest_projection_is_exact(self) -> None:
        projected = {"run_id": "a" * 64}
        stored = {**projected, "evidence_identity": "b" * 64}
        self.assertEqual(contract_digest(10, stored), contract_digest(10, {**stored, "evidence_identity": "c" * 64}))
        canonical = canonicalize(projected)
        expected = hashlib.sha256(
            b"fulgor-contract-10-v2.3.8\0" + length_prefix(canonical)
        ).hexdigest()
        self.assertEqual(expected, contract_digest(10, stored))
        with self.assertRaises(FulgorValidationError):
            contract_digest(10, projected)

    def test_programmatic_invalid_values_are_rejected(self) -> None:
        for value in (-1, MAX_SAFE_INTEGER + 1, 1.5, float("inf"), {"x": "\udfff"}):
            with self.subTest(value=repr(value)), self.assertRaises(FulgorValidationError):
                canonicalize(value)


class Contract2LogicalPathTests(unittest.TestCase):
    def test_profile_and_positive_paths(self) -> None:
        validate_installed_profile(dict(LOGICAL_PATH_PROFILE), LOGICAL_PATH_PROFILE)
        for path in ("file.txt", "a/b/c.json", "Türkçe/şema.json"):
            self.assertEqual(path, validate_logical_path(path))
            self.assertEqual(hashlib.sha256(path.encode()).hexdigest(), logical_path_sha256(path))

    def test_path_confusion_attacks_are_rejected(self) -> None:
        bad = (
            "", "/a", "a/", "a//b", ".", "a/./b", "a/../b", "../a",
            "C:/a", "C:\\a", "\\\\server\\share", "\\?\\C:\\a",
            "a\\b", "CON", "con.txt", "x/AUX.json", "COM1", "LPT9.log",
            "a.", "a ", "a/\x00b", "a/\x1fb", "a/\x85b", "Cafe\u0301/file", "COM¹.txt",
        )
        for path in bad:
            with self.subTest(path=repr(path)), self.assertRaises(FulgorValidationError):
                validate_logical_path(path)

    def test_casefold_collision_is_explicit(self) -> None:
        with self.assertRaises(FulgorValidationError) as caught:
            validate_no_casefold_collisions(["A/file", "a/file"])
        self.assertEqual(FulgorErrorCode.CASEFOLD_PATH_COLLISION, caught.exception.code)


class Contract3Ed25519Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.private = Ed25519PrivateKey.generate()
        self.public = public_bytes(self.private)
        self.message = b"phase-0-vector"
        self.signature = self.private.sign(self.message)

    def test_profile_and_valid_signature(self) -> None:
        validate_installed_profile(dict(ED25519_PROFILE), ED25519_PROFILE)
        verify_strict(self.public, self.signature, self.message)

    def test_rfc8032_vector_1(self) -> None:
        public_key = bytes.fromhex(
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
        )
        signature = bytes.fromhex(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
        )
        verify_strict(public_key, signature, b"")

    def test_wrong_key_modified_message_and_lengths_are_rejected(self) -> None:
        wrong = public_bytes(Ed25519PrivateKey.generate())
        cases = (
            (wrong, self.signature, self.message),
            (self.public, self.signature, self.message + b"!"),
            (self.public[:-1], self.signature, self.message),
            (self.public, self.signature[:-1], self.message),
        )
        for key, signature, message in cases:
            with self.subTest(lengths=(len(key), len(signature))), self.assertRaises(FulgorValidationError):
                verify_strict(key, signature, message)

    def test_noncanonical_scalar_and_small_order_points_are_rejected(self) -> None:
        noncanonical_s = self.signature[:32] + _L.to_bytes(32, "little")
        identity = b"\x01" + b"\x00" * 31
        bad_r = identity + self.signature[32:]
        noncanonical_y = (2**255 - 19).to_bytes(32, "little")
        for key, signature in (
            (self.public, noncanonical_s),
            (identity, self.signature),
            (self.public, bad_r),
            (noncanonical_y, self.signature),
        ):
            with self.subTest(key=key[:2], signature=signature[:2]), self.assertRaises(FulgorValidationError):
                verify_strict(key, signature, self.message)

    def test_base64_requires_canonical_padding_and_pad_bits(self) -> None:
        encoded = base64.b64encode(self.signature).decode("ascii")
        self.assertEqual(self.signature, decode_signature_base64(encoded))
        alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        last_index = alphabet.index(encoded[-3])
        nonzero_pad_bits = encoded[:-3] + alphabet[last_index + 1] + "=="
        for malformed in (
            encoded.rstrip("="), encoded[:-2] + "=A", "!" + encoded[1:], nonzero_pad_bits
        ):
            with self.subTest(value=malformed[-4:]), self.assertRaises(FulgorValidationError):
                decode_signature_base64(malformed)

        public_encoded = base64.b64encode(self.public).decode("ascii")
        self.assertEqual(self.public, decode_public_key_base64(public_encoded))
        last_index = alphabet.index(public_encoded[-2])
        public_nonzero_pad_bits = public_encoded[:-2] + alphabet[last_index + 1] + "="
        with self.assertRaises(FulgorValidationError):
            decode_public_key_base64(public_nonzero_pad_bits)


class Contract4DomainRegistryTests(unittest.TestCase):
    def test_registry_is_complete_unique_and_collision_free(self) -> None:
        self.assertEqual(57, len(CONTRACT_DOMAINS))
        self.assertEqual(36, len(OPERATION_DOMAINS))
        assert_registry_integrity(REGISTERED_DOMAIN_TAGS)
        self.assertEqual(PHASE0_REGISTERED_DOMAIN_TAGS, PHASE0_USED_DOMAIN_TAGS)
        self.assertEqual(
            PHASE0_USED_DOMAIN_TAGS,
            frozenset(tag for tags in PHASE0_FORMULA_DOMAIN_USES.values() for tag in tags),
        )
        self.assertIsNot(PHASE0_USED_DOMAIN_TAGS, PHASE0_REGISTERED_DOMAIN_TAGS)
        assert_phase0_domain_usage()

    def test_unregistered_and_wrong_owner_fail_closed(self) -> None:
        for call in (
            lambda: contract_domain(58),
            lambda: contract_domain("1"),
            lambda: operation_domain("customer-selected-domain"),
        ):
            with self.assertRaises(FulgorValidationError):
                call()
        with self.assertRaises(FulgorValidationError):
            assert_registry_integrity(set(REGISTERED_DOMAIN_TAGS) | {"attacker-domain"})
        duplicate_operations = dict(OPERATION_DOMAINS)
        duplicate_operations["signature"] = CONTRACT_DOMAINS["1"]
        with self.assertRaises(FulgorValidationError):
            validate_domain_registry(CONTRACT_DOMAINS, duplicate_operations, require_frozen_associations=False)
        reassigned = dict(CONTRACT_DOMAINS)
        reassigned["1"], reassigned["2"] = reassigned["2"], reassigned["1"]
        with self.assertRaises(FulgorValidationError) as caught:
            validate_domain_registry(reassigned, OPERATION_DOMAINS)
        self.assertEqual(FulgorErrorCode.DOMAIN_OWNER_MISMATCH, caught.exception.code)

    def test_phase0_formula_use_is_domain_separated(self) -> None:
        value = {"x": 1}
        canonical = canonicalize(value)
        plain = hashlib.sha256(canonical).hexdigest()
        self.assertNotEqual(plain, contract_digest(1, value))
        self.assertNotEqual(contract_digest(1, value), contract_digest(2, value))
        self.assertEqual(
            operation_domain_bytes("signature"), b"fulgor-detached-signature-v2.3.8\0"
        )


class Contract5And6EnvelopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.private = Ed25519PrivateKey.generate()
        self.public = public_bytes(self.private)
        self.payload = {"observation_id": "5" * 64, "count": 0}
        self.header_dict = header_for(self.payload, self.public)

    def test_header_closed_shape_required_fields_and_temporal_bounds(self) -> None:
        parsed = parse_protected_header(self.header_dict)
        self.assertEqual(20, parsed.issued_at)
        mutations = []
        for field in self.header_dict:
            missing = deepcopy(self.header_dict)
            missing.pop(field)
            mutations.append(missing)
        extra = deepcopy(self.header_dict)
        extra["hidden"] = True
        mutations.append(extra)
        for field, value in (("issued_at", 9), ("serial", 0), ("policy_epoch", -1), ("nonce", "A" * 64)):
            changed = deepcopy(self.header_dict)
            changed[field] = value
            mutations.append(changed)
        wrong_purpose = deepcopy(self.header_dict)
        wrong_purpose["purpose"] = "ATTESTATION"
        mutations.append(wrong_purpose)
        for value in mutations:
            with self.subTest(keys=value.keys()), self.assertRaises(FulgorValidationError):
                parse_protected_header(value)

    def test_signature_input_exact_formula_and_unsupported_result_is_not_authority(self) -> None:
        header = parse_protected_header(self.header_dict)
        expected = (
            b"fulgor-detached-signature-v2.3.8\0"
            + length_prefix(canonicalize(header.to_dict()))
            + length_prefix(canonicalize(self.payload))
        )
        self.assertEqual(expected, signature_input(header, self.payload))
        envelope = signed_envelope(self.private, self.header_dict, self.payload)
        verify_strict(self.public, base64.b64decode(envelope.signature), expected)
        result = verify_wire(
            envelope,
            self.payload,
            self.public,
            expected=VerificationExpectations(
                payload_type="RuntimeObservationV2_3_8",
                purpose="OBSERVATION",
                subject_digest="3" * 64,
                nonce="4" * 64,
                policy_epoch=7,
                root_generation=5,
            ),
        )
        self.assertFalse(result.cryptographically_valid)
        self.assertFalse(result.signature_valid)
        self.assertFalse(result.trust_authorized)
        self.assertEqual(TrustStatus.NOT_EVALUATED_PHASE_0, result.trust_status)
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, result.error_code)
        self.assertIsNone(result.issuer_authorized)
        encoded_public = base64.b64encode(self.public).decode("ascii")
        encoded_result = verify_wire(
            envelope,
            self.payload,
            encoded_public,
        )
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, encoded_result.error_code)

    def test_payload_header_key_and_cross_purpose_substitution_fail(self) -> None:
        envelope = signed_envelope(self.private, self.header_dict, self.payload)
        wrong_key = public_bytes(Ed25519PrivateKey.generate())
        cases = (
            (envelope, {**self.payload, "count": 1}, self.public, None),
            (envelope, self.payload, wrong_key, None),
            (
                envelope,
                self.payload,
                self.public,
                VerificationExpectations(purpose="ATTESTATION"),
            ),
            (
                envelope,
                self.payload,
                self.public,
                VerificationExpectations(payload_type="HumanDecisionV2_3_8"),
            ),
        )
        for candidate, payload, key, expected in cases:
            result = verify_wire(
                candidate, payload, key, expected=expected
            )
            self.assertFalse(result.cryptographically_valid)
            self.assertFalse(result.trust_authorized)

    def test_envelope_shape_signature_mutation_and_typed_payload_validator(self) -> None:
        envelope = signed_envelope(self.private, self.header_dict, self.payload)
        raw = envelope.to_dict()
        raw["additional"] = "hidden"
        self.assertFalse(
            verify_wire(raw, self.payload, self.public).cryptographically_valid
        )

        raw = envelope.to_dict()
        signature = bytearray(base64.b64decode(raw["signature"]))
        signature[0] ^= 1
        raw["signature"] = base64.b64encode(signature).decode("ascii")
        self.assertFalse(
            verify_wire(raw, self.payload, self.public).cryptographically_valid
        )

        result = verify_wire(envelope, self.payload, self.public)
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, result.error_code)
        with self.assertRaises(TypeError):
            verify_wire(envelope, self.payload, self.public, payload_validator=lambda value: None)

    def test_content_digest_is_payload_contract_digest_not_header_digest(self) -> None:
        header = parse_protected_header(self.header_dict)
        self.assertEqual(contract_digest(38, self.payload), header.content_digest)
        self.assertNotEqual(contract_digest(5, header.to_dict()), header.content_digest)


class FrozenSchemaTests(unittest.TestCase):
    def test_phase0_schema_files_are_closed_and_locally_resolved(self) -> None:
        schema_dir = ROOT / "schemas" / "fulgor"
        files = sorted(schema_dir.glob("*.schema.json"))
        self.assertEqual(11, len(files))
        for path in files:
            schema = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual("https://json-schema.org/draft/2020-12/schema", schema["$schema"])
            if schema.get("type") == "object":
                self.assertFalse(schema["additionalProperties"])
        envelope = json.loads((schema_dir / "detached-signature-envelope-v2.3.8.schema.json").read_text())
        self.assertEqual("urn:fulgor:ProtectedHeaderV2_3_8", envelope["properties"]["protected_header"]["$ref"])
        registry = json.loads((schema_dir / "payload-domain-registry-v2.3.8.schema.json").read_text())
        self.assertEqual(dict(CONTRACT_DOMAINS), registry["const"]["contract_domains"])
        self.assertEqual(dict(OPERATION_DOMAINS), registry["const"]["operation_domains"])
        header_schema = json.loads((schema_dir / "protected-header-v2.3.8.schema.json").read_text())
        self.assertEqual(set(self._header_field_names()), set(header_schema["required"]))

    @staticmethod
    def _header_field_names() -> tuple[str, ...]:
        from dataclasses import fields

        from kayra_ai.fulgor import ProtectedHeader

        return tuple(field.name for field in fields(ProtectedHeader))


if __name__ == "__main__":
    unittest.main()
