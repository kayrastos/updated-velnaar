from __future__ import annotations

import ast
import base64
import hashlib
import sys
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.fulgor import (  # noqa: E402
    PHASE0_FORMULA_DOMAIN_USES,
    PHASE0_REGISTERED_DOMAIN_TAGS,
    PHASE0_USED_DOMAIN_TAGS,
    REGISTERED_PAYLOAD_VALIDATORS,
    DetachedSignatureEnvelope,
    DetachedVerificationResult,
    FulgorErrorCode,
    FulgorValidationError,
    ProtectedHeader,
    TrustStatus,
    TypedPayloadValidatorRegistration,
    canonicalize,
    contract_digest,
    parse_json_strict,
    parse_protected_header,
    sign_detached,
    signature_input,
    validate_content_digest,
    verify_detached,
    verify_strict,
)
from kayra_ai.fulgor.domains import contract_domain_bytes, operation_domain_bytes  # noqa: E402


def public_bytes(private: Ed25519PrivateKey) -> bytes:
    return private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


def header_for(payload: object, public: bytes, **updates: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schema_version": "2.3.8",
        "payload_type": "RuntimeObservationV2_3_8",
        "purpose": "OBSERVATION",
        "scope_digest": "1" * 64,
        "authority_id": "2" * 64,
        "key_id": hashlib.sha256(public).hexdigest(),
        "policy_epoch": 7,
        "serial": 1,
        "issued_at": 20,
        "not_before": 10,
        "not_after": 30,
        "subject_digest": "3" * 64,
        "nonce": "4" * 64,
        "content_digest": contract_digest(38, payload),
        "root_generation": 5,
    }
    value.update(updates)
    return value


def verify_wire(envelope: object, payload: object, public_key: bytes | str, **kwargs: object) -> object:
    envelope_value = envelope.to_dict() if hasattr(envelope, "to_dict") else envelope
    return verify_detached(canonicalize(envelope_value), canonicalize(payload), public_key, **kwargs)


def validate_digest_wire(header: object, payload: object) -> str:
    header_value = header.to_dict() if hasattr(header, "to_dict") else header
    return validate_content_digest(canonicalize(header_value), canonicalize(payload))


class Phase0RepairRegressionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.private = Ed25519PrivateKey.generate()
        self.public = public_bytes(self.private)
        self.payload = {"observation_id": "5" * 64, "count": 0}
        self.header_dict = header_for(self.payload, self.public)
        self.header = parse_protected_header(self.header_dict)

    def test_canonical_parser_has_no_relaxed_security_switch(self) -> None:
        for raw in (b'{ "a":1}', b'{"b":2,"a":1}'):
            with self.subTest(raw=raw), self.assertRaises(FulgorValidationError):
                parse_json_strict(raw)
        with self.assertRaises(TypeError):
            parse_json_strict(b'{ "a":1}', require_canonical=False)
        with self.assertRaises(FulgorValidationError):
            parse_json_strict(b'{"a":1,"a":2}')
        self.assertEqual({"a": 1}, parse_json_strict(b'{"a":1}'))

    def test_direct_header_construction_enforces_every_local_invariant(self) -> None:
        mutations = (
            ("schema_version", "2.3.7"),
            ("payload_type", "UnknownPayload"),
            ("purpose", "ATTESTATION"),
            ("scope_digest", "A" * 64),
            ("authority_id", "x" * 64),
            ("key_id", "0" * 63),
            ("policy_epoch", -1),
            ("serial", 0),
            ("issued_at", 31),
            ("not_before", 21),
            ("not_after", 19),
            ("subject_digest", "0" * 65),
            ("nonce", "A" * 64),
            ("content_digest", "0" * 63),
            ("root_generation", -1),
        )
        for field, value in mutations:
            changed = self.header.to_dict()
            changed[field] = value
            with self.subTest(field=field), self.assertRaises(FulgorValidationError):
                ProtectedHeader(**changed)
        with self.assertRaises(TypeError):
            ProtectedHeader(**{key: value for key, value in self.header.to_dict().items() if key != "nonce"})
        with self.assertRaises(TypeError):
            ProtectedHeader(**{**self.header.to_dict(), "hidden": True})

    def test_direct_envelope_construction_is_structurally_validated(self) -> None:
        signature = base64.b64encode(self.private.sign(signature_input(self.header, self.payload))).decode()
        envelope = DetachedSignatureEnvelope(self.header, signature)
        self.assertEqual(signature, envelope.signature)
        for malformed in ("not-base64", signature.rstrip("="), signature + "\n"):
            with self.subTest(malformed=malformed[-4:]), self.assertRaises(FulgorValidationError):
                DetachedSignatureEnvelope(self.header, malformed)
        with self.assertRaises(FulgorValidationError):
            DetachedSignatureEnvelope(self.header_dict, signature)

    def test_payload_validator_identity_and_contract_confusion_are_rejected(self) -> None:
        def accept_everything(payload: object) -> None:
            return None

        bad_bindings = (
            ("RuntimeObservationV2_3_8", 31, "urn:fulgor:RuntimeObservationV2_3_8"),
            ("RuntimeObservationV2_3_8", 38, "a" * 64),
            ("RuntimeObservationV2_3_8", 38, "urn:fulgor:HumanDecisionV2_3_8"),
            ("UnknownPayload", 38, "urn:fulgor:UnknownPayload"),
        )
        for payload_type, contract_number, identity in bad_bindings:
            with self.subTest(payload_type=payload_type, contract_number=contract_number), self.assertRaises(
                FulgorValidationError
            ):
                TypedPayloadValidatorRegistration(
                    payload_type=payload_type,
                    contract_number=contract_number,
                    validator_identity=identity,
                    validator=accept_everything,
                )
        with self.assertRaises(FulgorValidationError):
            TypedPayloadValidatorRegistration(
                payload_type="RuntimeObservationV2_3_8",
                contract_number=38,
                validator_identity="urn:fulgor:RuntimeObservationV2_3_8",
                validator=None,
            )

    def test_unimplemented_payload_types_and_callback_substitution_fail_closed(self) -> None:
        def accept_everything(payload: object) -> None:
            return None

        caller_registration = TypedPayloadValidatorRegistration(
            payload_type="RuntimeObservationV2_3_8",
            contract_number=38,
            validator_identity="urn:fulgor:RuntimeObservationV2_3_8",
            validator=accept_everything,
        )
        incompatible_registration = TypedPayloadValidatorRegistration(
            payload_type="HumanDecisionV2_3_8",
            contract_number=31,
            validator_identity="urn:fulgor:HumanDecisionV2_3_8",
            validator=accept_everything,
        )
        self.assertNotEqual(
            caller_registration.validator_identity,
            incompatible_registration.validator_identity,
        )
        self.assertEqual({}, dict(REGISTERED_PAYLOAD_VALIDATORS))
        signature = base64.b64encode(self.private.sign(signature_input(self.header, self.payload))).decode()
        envelope = DetachedSignatureEnvelope(self.header, signature)
        result = verify_wire(envelope, self.payload, self.public)
        self.assertFalse(result.cryptographically_valid)
        self.assertFalse(result.trust_authorized)
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, result.error_code)
        with self.assertRaises(TypeError):
            verify_wire(envelope, self.payload, self.public, payload_validator=lambda _: None)
        with self.assertRaises(FulgorValidationError) as caught:
            sign_detached(self.private, self.header, self.payload)
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, caught.exception.code)
        with self.assertRaises(TypeError):
            REGISTERED_PAYLOAD_VALIDATORS["RuntimeObservationV2_3_8"] = object()
        self.assertEqual({}, dict(REGISTERED_PAYLOAD_VALIDATORS))

    def test_phase0_result_type_cannot_construct_trust_authority(self) -> None:
        with self.assertRaises((ValueError, FulgorValidationError)):
            DetachedVerificationResult(
                cryptographically_valid=True,
                trust_status="AUTHORIZED_BY_LATER_PHASE",
                signature_valid=True,
                issuer_authorized=True,
                not_revoked=True,
                time_valid=True,
                anti_rollback_valid=True,
                payload_digest="0" * 64,
                policy_snapshot=None,
            )
        with self.assertRaises(FulgorValidationError):
            DetachedVerificationResult(
                cryptographically_valid=True,
                trust_status=TrustStatus.NOT_EVALUATED_PHASE_0,
                signature_valid=True,
                issuer_authorized=True,
                not_revoked=None,
                time_valid=None,
                anti_rollback_valid=None,
                payload_digest="0" * 64,
                policy_snapshot=None,
            )

    def test_v5_content_digest_and_signature_formulas_remain_identical(self) -> None:
        digest = validate_digest_wire(self.header, self.payload)
        self.assertEqual(contract_digest(38, self.payload), digest)
        self.assertNotEqual(hashlib.sha256(b'{"count":0,"observation_id":"' + b"5" * 64 + b'"}').hexdigest(), digest)
        signed_bytes = signature_input(self.header, self.payload)
        signature = self.private.sign(signed_bytes)
        verify_strict(self.public, signature, signed_bytes)
        changed_header = parse_protected_header({**self.header_dict, "nonce": "6" * 64})
        with self.assertRaises(FulgorValidationError):
            verify_strict(self.public, signature, signature_input(changed_header, self.payload))

    def test_domain_use_manifest_is_derived_and_tagging_is_registry_bound(self) -> None:
        derived = frozenset(
            tag for tags in PHASE0_FORMULA_DOMAIN_USES.values() for tag in tags
        )
        self.assertEqual(derived, PHASE0_USED_DOMAIN_TAGS)
        self.assertEqual(PHASE0_REGISTERED_DOMAIN_TAGS, PHASE0_USED_DOMAIN_TAGS)
        self.assertIsNot(PHASE0_REGISTERED_DOMAIN_TAGS, PHASE0_USED_DOMAIN_TAGS)
        self.assertEqual(b"fulgor-contract-01-v2.3.8\0", contract_domain_bytes(1))
        self.assertEqual(b"fulgor-detached-signature-v2.3.8\0", operation_domain_bytes("signature"))
        with self.assertRaises(FulgorValidationError):
            operation_domain_bytes("attacker-controlled")

    def test_domain_manifest_matches_actual_security_formula_callsites(self) -> None:
        source_root = ROOT / "src" / "kayra_ai" / "fulgor"
        actual: dict[str, set[str]] = {}
        raw_domain_literals: list[tuple[str, int]] = []
        for path in sorted(source_root.glob("*.py")):
            if path.name == "domains.py":
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            functions = [
                node
                for node in ast.walk(tree)
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            ]
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Constant)
                    and isinstance(node.value, bytes)
                    and node.value.startswith(b"fulgor-")
                ):
                    raw_domain_literals.append((path.name, node.lineno))
                if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                    continue
                owner = next(
                    (function.name for function in functions if node in list(ast.walk(function))),
                    None,
                )
                tags: set[str] = set()
                if node.func.id == "contract_domain_bytes" and owner == "contract_digest":
                    tags = set(PHASE0_REGISTERED_DOMAIN_TAGS) - {
                        "fulgor-detached-signature-v2.3.8"
                    }
                elif (
                    node.func.id == "operation_domain_bytes"
                    and owner == "signature_input"
                    and len(node.args) == 1
                    and isinstance(node.args[0], ast.Constant)
                    and node.args[0].value == "signature"
                ):
                    tags = {"fulgor-detached-signature-v2.3.8"}
                if owner and tags:
                    actual.setdefault(owner, set()).update(tags)
        self.assertEqual([], raw_domain_literals)
        self.assertEqual(
            {owner: frozenset(tags) for owner, tags in actual.items()},
            dict(PHASE0_FORMULA_DOMAIN_USES),
        )


if __name__ == "__main__":
    unittest.main()
