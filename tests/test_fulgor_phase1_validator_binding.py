from __future__ import annotations

import base64
import hashlib
import inspect
import unittest
from dataclasses import FrozenInstanceError, replace

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

import kayra_ai.fulgor as fulgor
import kayra_ai.fulgor.digests as digests_module
import kayra_ai.fulgor.envelope as envelope_module
import kayra_ai.fulgor.frozen_schema as frozen_schema_module
import kayra_ai.fulgor.phase1_payloads as phase1_payloads
import kayra_ai.fulgor.validators as validator_module
from kayra_ai.fulgor import (
    DetachedSignatureEnvelope,
    FulgorErrorCode,
    FulgorValidationError,
    ProtectedHeader,
    canonicalize,
    contract_digest,
    parse_protected_header,
    signature_input,
    verify_detached,
)
from kayra_ai.fulgor.validators import TypedPayloadValidatorRegistration, validate_registered_payload


def _public_key(private_key: Ed25519PrivateKey) -> bytes:
    return private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)


def _invalid_mode_a_payload() -> dict[str, object]:
    payload: dict[str, object] = {
        "evidence_identity": "0" * 64,
        "run_id": "1" * 64,
        "run_nonce": "2" * 64,
        "reservation_id": "3" * 64,
        "execution_mode": "MODE_A_EXTERNAL",
        "state_sequence": 1,
        "root_trust_anchor_digest": "4" * 64,
        "root_generation": 5,
        "safety_policy_digest": "6" * 64,
        "policy_epoch": 7,
        "evidence_root": "8" * 64,
        "qualification": "ATTESTED_AND_RUNTIME_OBSERVED",
        "signed_at": 9,
        "certificate_digest": "a" * 64,
    }
    payload["evidence_identity"] = contract_digest(10, payload)
    return payload


def _signed_invalid_mode_a() -> tuple[bytes, bytes, bytes]:
    private_key = Ed25519PrivateKey.generate()
    public_key = _public_key(private_key)
    payload = _invalid_mode_a_payload()
    header = parse_protected_header({
        "schema_version": "2.3.8",
        "payload_type": "FinalEvidencePayloadV2_3_8",
        "purpose": "EVIDENCE",
        "scope_digest": "b" * 64,
        "authority_id": "c" * 64,
        "key_id": hashlib.sha256(public_key).hexdigest(),
        "policy_epoch": 7,
        "serial": 1,
        "issued_at": 9,
        "not_before": 0,
        "not_after": 10,
        "subject_digest": "d" * 64,
        "nonce": "e" * 64,
        "content_digest": contract_digest(10, payload),
        "root_generation": 5,
    })
    signature = private_key.sign(signature_input(header, payload))
    envelope = DetachedSignatureEnvelope(header, base64.b64encode(signature).decode("ascii"))
    return canonicalize(envelope.to_dict()), canonicalize(payload), public_key


def _signed_structurally_invalid_payload(
    payload_type: str,
    purpose: str,
    contract_number: int,
) -> tuple[bytes, bytes, bytes]:
    """Produce valid wire bytes and Ed25519 over a wrong typed payload."""

    private_key = Ed25519PrivateKey.generate()
    public_key = _public_key(private_key)
    payload: dict[str, object] = {"structurally_invalid": True}
    if contract_number == 10:
        # Contract 10's digest projection requires this member even when the
        # rest of the object is deliberately malformed.
        payload["evidence_identity"] = "0" * 64
        payload["evidence_identity"] = contract_digest(contract_number, payload)
    header = parse_protected_header({
        "schema_version": "2.3.8",
        "payload_type": payload_type,
        "purpose": purpose,
        "scope_digest": "1" * 64,
        "authority_id": "2" * 64,
        "key_id": hashlib.sha256(public_key).hexdigest(),
        "policy_epoch": 0,
        "serial": 1,
        "issued_at": 1,
        "not_before": 0,
        "not_after": 2,
        "subject_digest": "3" * 64,
        "nonce": "4" * 64,
        "content_digest": contract_digest(contract_number, payload),
        "root_generation": 0,
    })
    signature = private_key.sign(signature_input(header, payload))
    envelope = DetachedSignatureEnvelope(header, base64.b64encode(signature).decode("ascii"))
    return canonicalize(envelope.to_dict()), canonicalize(payload), public_key


class ValidatorBindingRegressionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.envelope_raw, self.payload_raw, self.public_key = _signed_invalid_mode_a()

    def assert_invalid_mode_a_rejected(
        self, expected_error: FulgorErrorCode | None = FulgorErrorCode.INVALID_FINAL_EVIDENCE
    ) -> None:
        result = verify_detached(self.envelope_raw, self.payload_raw, self.public_key)
        self.assertFalse(result.cryptographically_valid)
        self.assertFalse(result.signature_valid)
        if expected_error is not None:
            self.assertEqual(expected_error, result.error_code)

    def assert_structurally_invalid_signed_payload_rejected(
        self, payload_type: str, purpose: str, contract_number: int
    ) -> None:
        envelope_raw, payload_raw, public_key = _signed_structurally_invalid_payload(
            payload_type, purpose, contract_number
        )
        result = verify_detached(envelope_raw, payload_raw, public_key)
        self.assertFalse(result.cryptographically_valid)
        self.assertFalse(result.signature_valid)
        self.assertFalse(result.trust_authorized)

    def test_original_object_setattr_attack_is_closed(self) -> None:
        binding = validator_module._FROZEN_BINDINGS[2]
        with self.assertRaises(AttributeError):
            object.__setattr__(binding, "validator", lambda payload: None)
        self.assert_invalid_mode_a_rejected()

    def test_normal_setattr_and_dataclasses_replace_cannot_inject_callable(self) -> None:
        binding = validator_module._FROZEN_BINDINGS[2]
        with self.assertRaises((FrozenInstanceError, TypeError, AttributeError)):
            setattr(binding, "validator", lambda payload: None)
        replacement = replace(binding, validator=lambda payload: None)
        self.assertFalse(callable(replacement.validator))
        self.assert_invalid_mode_a_rejected()

    def test_binding_and_registry_rebinding_are_inert(self) -> None:
        original_bindings = validator_module._FROZEN_BINDINGS
        original_registry = validator_module.REGISTERED_PAYLOAD_VALIDATORS
        try:
            validator_module._FROZEN_BINDINGS = (TypedPayloadValidatorRegistration(
                "FinalEvidencePayloadV2_3_8", 10, "urn:fulgor:FinalEvidencePayloadV2_3_8", lambda payload: None
            ),)
            validator_module.REGISTERED_PAYLOAD_VALIDATORS = {
                "FinalEvidencePayloadV2_3_8": lambda payload: None,
            }
            self.assert_invalid_mode_a_rejected()
        finally:
            validator_module._FROZEN_BINDINGS = original_bindings
            validator_module.REGISTERED_PAYLOAD_VALIDATORS = original_registry

    def test_exported_registry_and_validator_global_monkeypatches_are_inert(self) -> None:
        original_export = fulgor.REGISTERED_PAYLOAD_VALIDATORS
        original_validator = validator_module.validate_payload_10
        try:
            fulgor.REGISTERED_PAYLOAD_VALIDATORS = {
                "FinalEvidencePayloadV2_3_8": lambda payload: None,
            }
            validator_module.validate_payload_10 = lambda payload: None
            self.assert_invalid_mode_a_rejected()
        finally:
            fulgor.REGISTERED_PAYLOAD_VALIDATORS = original_export
            validator_module.validate_payload_10 = original_validator

    def test_forged_binding_lambda_and_subclass_do_not_route_dispatch(self) -> None:
        forged = object.__new__(TypedPayloadValidatorRegistration)
        object.__setattr__(forged, "payload_type", "FinalEvidencePayloadV2_3_8")
        object.__setattr__(forged, "contract_number", 10)
        object.__setattr__(forged, "validator_identity", "urn:fulgor:FinalEvidencePayloadV2_3_8")

        class ForgedRegistration(TypedPayloadValidatorRegistration):
            pass

        subclassed = ForgedRegistration(
            "FinalEvidencePayloadV2_3_8", 10, "urn:fulgor:FinalEvidencePayloadV2_3_8", lambda payload: None
        )
        with self.assertRaises((FrozenInstanceError, TypeError, AttributeError)):
            setattr(subclassed, "validator", lambda payload: None)
        original_bindings = validator_module._FROZEN_BINDINGS
        try:
            validator_module._FROZEN_BINDINGS = (forged, subclassed)
            self.assert_invalid_mode_a_rejected()
        finally:
            validator_module._FROZEN_BINDINGS = original_bindings

    def test_cross_validator_substitution_and_unsupported_payload_fail_closed(self) -> None:
        original_validator = validator_module.validate_payload_10
        try:
            validator_module.validate_payload_10 = validator_module.validate_payload_8
            self.assert_invalid_mode_a_rejected()
        finally:
            validator_module.validate_payload_10 = original_validator
        with self.assertRaises(FulgorValidationError) as unsupported:
            validate_registered_payload("ActionScopedCapabilityV2_3_8", {})
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, unsupported.exception.code)

    def test_wrong_metadata_contract_number_and_identity_fail_closed(self) -> None:
        with self.assertRaises(FulgorValidationError) as wrong_number:
            TypedPayloadValidatorRegistration(
                "FinalEvidencePayloadV2_3_8", 8, "urn:fulgor:FinalEvidencePayloadV2_3_8"
            )
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, wrong_number.exception.code)
        with self.assertRaises(FulgorValidationError) as wrong_identity:
            TypedPayloadValidatorRegistration(
                "FinalEvidencePayloadV2_3_8", 10, "urn:fulgor:EvidenceSignerCertificatePayloadV2_3_8"
            )
        self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, wrong_identity.exception.code)

    def test_verification_entrypoints_accept_no_dispatch_injection(self) -> None:
        self.assertEqual(["payload_type", "payload"], list(inspect.signature(validate_registered_payload).parameters))
        self.assertEqual(
            ["envelope_raw", "payload_raw", "public_key", "expected"],
            list(inspect.signature(verify_detached).parameters),
        )

    def test_lower_level_phase1_parser_and_helper_rebinding_fail_closed_for_all_signed_types(self) -> None:
        cases = (
            ("SafetyTrustPolicyPayloadV2_3_8", "POLICY", 8, "parse_safety_trust_policy"),
            ("EvidenceSignerCertificatePayloadV2_3_8", "CERTIFICATE", 9, "parse_evidence_signer_certificate"),
            ("FinalEvidencePayloadV2_3_8", "EVIDENCE", 10, "parse_final_evidence"),
        )
        for payload_type, purpose, number, parser_name in cases:
            original = getattr(phase1_payloads, parser_name)
            try:
                # This is the exact lower-level parser substitution class found
                # by the independent reviewer; returning None must not bypass
                # local structural validation after Ed25519 succeeds.
                setattr(phase1_payloads, parser_name, lambda payload: None)
                with self.subTest(payload_type=payload_type, attack="parser_none"):
                    self.assert_structurally_invalid_signed_payload_rejected(payload_type, purpose, number)
            finally:
                setattr(phase1_payloads, parser_name, original)

            original_helper = phase1_payloads._closed
            try:
                phase1_payloads._closed = lambda value, *args: value
                with self.subTest(payload_type=payload_type, attack="helper_rebind"):
                    self.assert_structurally_invalid_signed_payload_rejected(payload_type, purpose, number)
            finally:
                phase1_payloads._closed = original_helper

    def test_forged_parser_result_and_lambda_validator_rebinding_fail_closed(self) -> None:
        forged = object.__new__(fulgor.FinalEvidencePayloadV2_3_8)
        original_parser = phase1_payloads.parse_final_evidence
        try:
            phase1_payloads.parse_final_evidence = lambda payload: forged
            self.assert_invalid_mode_a_rejected(expected_error=None)
        finally:
            phase1_payloads.parse_final_evidence = original_parser

        original_validator = phase1_payloads.validate_final_evidence
        try:
            for replacement in (lambda payload: True, lambda payload: None):
                phase1_payloads.validate_final_evidence = replacement
                with self.subTest(replacement=replacement):
                    self.assert_invalid_mode_a_rejected(expected_error=None)
        finally:
            phase1_payloads.validate_final_evidence = original_validator

    def test_public_and_internal_validator_alias_rebinding_remain_inert_for_all_contracts(self) -> None:
        cases = (
            ("SafetyTrustPolicyPayloadV2_3_8", "POLICY", 8, "parse_safety_trust_policy", "validate_payload_8"),
            ("EvidenceSignerCertificatePayloadV2_3_8", "CERTIFICATE", 9, "parse_evidence_signer_certificate", "validate_payload_9"),
            ("FinalEvidencePayloadV2_3_8", "EVIDENCE", 10, "parse_final_evidence", "validate_payload_10"),
        )
        for payload_type, purpose, number, public_alias, internal_alias in cases:
            public_original = getattr(fulgor, public_alias)
            internal_original = getattr(validator_module, internal_alias)
            try:
                setattr(fulgor, public_alias, lambda payload: None)
                setattr(validator_module, internal_alias, lambda payload: True)
                with self.subTest(payload_type=payload_type):
                    self.assert_structurally_invalid_signed_payload_rejected(payload_type, purpose, number)
            finally:
                setattr(fulgor, public_alias, public_original)
                setattr(validator_module, internal_alias, internal_original)

    def test_root_payload_type_has_no_detached_validator_route_even_after_root_parser_rebinding(self) -> None:
        original = phase1_payloads.parse_root_trust_anchor
        try:
            phase1_payloads.parse_root_trust_anchor = lambda payload: object()
            with self.assertRaises(FulgorValidationError) as caught:
                parse_protected_header({
                    "schema_version": "2.3.8",
                    "payload_type": "RootTrustAnchorV2_3_8",
                    "purpose": "POLICY",
                    "scope_digest": "1" * 64,
                    "authority_id": "2" * 64,
                    "key_id": "3" * 64,
                    "policy_epoch": 0,
                    "serial": 1,
                    "issued_at": 1,
                    "not_before": 0,
                    "not_after": 2,
                    "subject_digest": "4" * 64,
                    "nonce": "5" * 64,
                    "content_digest": "6" * 64,
                    "root_generation": 0,
                })
            self.assertEqual(FulgorErrorCode.INVALID_HEADER, caught.exception.code)
        finally:
            phase1_payloads.parse_root_trust_anchor = original

    def test_envelope_module_validator_rebinding_fails_closed(self) -> None:
        original = envelope_module.validate_registered_payload
        try:
            envelope_module.validate_registered_payload = lambda *args: None
            self.assert_invalid_mode_a_rejected(expected_error=FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE)
        finally:
            envelope_module.validate_registered_payload = original

    def test_validators_module_validator_rebinding_fails_closed(self) -> None:
        original = validator_module.validate_registered_payload
        try:
            validator_module.validate_registered_payload = lambda *args: None
            self.assert_invalid_mode_a_rejected(expected_error=FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE)
        finally:
            validator_module.validate_registered_payload = original

    def test_frozen_schema_rebinding_fails_closed_for_contract_8(self) -> None:
        envelope_raw, payload_raw, public_key = _signed_structurally_invalid_payload(
            "SafetyTrustPolicyPayloadV2_3_8", "POLICY", 8
        )
        orig_validate = frozen_schema_module.validate_contract8_schema
        try:
            frozen_schema_module.validate_contract8_schema = lambda *args: None
            result = verify_detached(envelope_raw, payload_raw, public_key)
            self.assertFalse(result.cryptographically_valid)
            self.assertEqual(FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE, result.error_code)
        finally:
            frozen_schema_module.validate_contract8_schema = orig_validate

    def test_digests_module_rebinding_fails_closed_for_contract_10(self) -> None:
        orig_digest = digests_module.contract_digest
        try:
            digests_module.contract_digest = lambda *args: "0" * 64
            self.assert_invalid_mode_a_rejected(expected_error=FulgorErrorCode.UNSUPPORTED_PAYLOAD_TYPE)
        finally:
            digests_module.contract_digest = orig_digest

    def test_contract_7_root_validator_rebinding_cannot_bypass_post_init(self) -> None:
        original = phase1_payloads.validate_root_trust_anchor
        try:
            phase1_payloads.validate_root_trust_anchor = lambda *args: None
            with self.assertRaises(FulgorValidationError):
                phase1_payloads.RootTrustAnchorV2_3_8(
                    root_authority_id="invalid_not_hex",
                    root_key_id="invalid",
                    root_public_key="invalid",
                    root_generation=0,
                    minimum_policy_epoch=0,
                    recovery_quorum={},
                    anchor_instance_id="invalid",
                )
        finally:
            phase1_payloads.validate_root_trust_anchor = original

    def test_all_contracts_7_to_10_parser_and_validator_rebinding_fail_closed(self) -> None:
        # Contract 7: RootTrustAnchor has no detached verification route
        orig_root_parser = phase1_payloads.parse_root_trust_anchor
        try:
            phase1_payloads.parse_root_trust_anchor = lambda p: None
            with self.assertRaises(FulgorValidationError):
                phase1_payloads.parse_root_trust_anchor_bytes(b'{"invalid": true}')
        finally:
            phase1_payloads.parse_root_trust_anchor = orig_root_parser

        # Contracts 8, 9, 10: detached verification rejects malformed payloads even under monkeypatching
        triples = (
            ("SafetyTrustPolicyPayloadV2_3_8", "POLICY", 8, "parse_safety_trust_policy", "validate_safety_trust_policy"),
            ("EvidenceSignerCertificatePayloadV2_3_8", "CERTIFICATE", 9, "parse_evidence_signer_certificate", "validate_evidence_signer_certificate"),
            ("FinalEvidencePayloadV2_3_8", "EVIDENCE", 10, "parse_final_evidence", "validate_final_evidence"),
        )
        for payload_type, purpose, contract_num, parser_name, validator_name in triples:
            orig_p = getattr(phase1_payloads, parser_name)
            orig_v = getattr(phase1_payloads, validator_name)
            try:
                setattr(phase1_payloads, parser_name, lambda p: None)
                setattr(phase1_payloads, validator_name, lambda p: None)
                envelope_raw, payload_raw, public_key = _signed_structurally_invalid_payload(
                    payload_type, purpose, contract_num
                )
                result = verify_detached(envelope_raw, payload_raw, public_key)
                self.assertFalse(result.cryptographically_valid)
                self.assertFalse(result.signature_valid)
                self.assertFalse(result.trust_authorized)
            finally:
                setattr(phase1_payloads, parser_name, orig_p)
                setattr(phase1_payloads, validator_name, orig_v)


if __name__ == "__main__":
    unittest.main()
