from __future__ import annotations

import base64
import copy
import hashlib
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from kayra_ai.fulgor import (
    EvidenceSignerCertificatePayloadV2_3_8,
    FinalEvidencePayloadV2_3_8,
    FulgorValidationError,
    LocalTrustStatus,
    RootTrustAnchorV2_3_8,
    SafetyTrustPolicyPayloadV2_3_8,
    contract_digest,
    parse_root_trust_anchor,
)
from kayra_ai.fulgor.validators import REGISTERED_PAYLOAD_VALIDATORS, validate_registered_payload


def key_pair() -> tuple[str, str]:
    raw = Ed25519PrivateKey.generate().public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(raw).decode("ascii"), hashlib.sha256(raw).hexdigest()


class Contract7Tests(unittest.TestCase):
    def test_root_is_only_an_object_not_bootstrap_authority(self) -> None:
        public, key_id = key_pair()
        member, member_id = key_pair()
        anchor = RootTrustAnchorV2_3_8("a" * 64, key_id, public, 0, 0,
            {"threshold": 1, "members": [{"member_id": member_id, "public_key": member}]}, "b" * 64)
        outcome = anchor.__post_init__()  # constructor checks, never installs trust
        self.assertIsNone(outcome)
        self.assertFalse(parse_root_trust_anchor(anchor.to_dict()).__post_init__())
        with self.assertRaises(FulgorValidationError):
            parse_root_trust_anchor({**anchor.to_dict(), "bootstrap_source": "self"})
        bad = copy.deepcopy(anchor.to_dict()); bad["recovery_quorum"]["members"][0]["member_id"] = "0" * 64
        with self.assertRaises(FulgorValidationError): parse_root_trust_anchor(bad)


class Contract9And10Tests(unittest.TestCase):
    def test_certificate_binding_and_mode_a_evidence_projection(self) -> None:
        key, key_id = key_pair()
        certificate = EvidenceSignerCertificatePayloadV2_3_8(
            "1" * 64, "2" * 64, "3" * 64, "MODE_A_EXTERNAL", key, key_id,
            "EVIDENCE", "FinalEvidencePayloadV2_3_8", 1, 0, 1, 2, 1, "4" * 64)
        with self.assertRaises(FulgorValidationError):
            EvidenceSignerCertificatePayloadV2_3_8(**{**certificate.to_dict(), "purpose": "ACTION"})
        body = {
            "evidence_identity": "0" * 64, "run_id": "1" * 64, "run_nonce": "2" * 64,
            "reservation_id": "3" * 64, "execution_mode": "MODE_A_EXTERNAL", "state_sequence": None,
            "root_trust_anchor_digest": "4" * 64, "root_generation": 0, "safety_policy_digest": "5" * 64,
            "policy_epoch": 0, "evidence_root": "6" * 64, "qualification": "ATTESTED_AND_RUNTIME_OBSERVED",
            "signed_at": 1, "certificate_digest": contract_digest(9, certificate.to_dict()),
        }
        body["evidence_identity"] = contract_digest(10, body)
        evidence = FinalEvidencePayloadV2_3_8(**body)
        self.assertEqual(contract_digest(10, evidence.to_dict()), evidence.evidence_identity)
        with self.assertRaises(FulgorValidationError): FinalEvidencePayloadV2_3_8(**{**body, "state_sequence": 1})

    def test_frozen_validator_mapping_ignores_public_registry_rebinding(self) -> None:
        with self.assertRaises(FulgorValidationError): validate_registered_payload("RuntimeObservationV2_3_8", {})
        self.assertEqual(0, len(REGISTERED_PAYLOAD_VALIDATORS))


class Contract8Tests(unittest.TestCase):
    def test_policy_is_local_only_and_issuer_cannot_authorize_policy(self) -> None:
        key, key_id = key_pair()
        policy = {
            "policy_epoch": 0, "root_generation": 0, "issuers": {}, "revoked_key_ids": [],
            "revoked_object_digests": [], "authorized_bootstrap_digests": [],
            "authorized_time_sources": {"permitted_mechanisms": [], "authorized_ak_key_ids": [],
                "authorized_tsa_root_ids": [], "authorized_tsa_policy_oids": [],
                "public_keys": [{"key_id": key_id, "public_key_der_base64": key, "role": "TPM_AK"}],
                "tpm_utc_calibration": None, "local_monotonic_max_drift_ppm": 0, "cms_accuracy_bound_ms": None},
            "max_trusted_time_uncertainty": 0, "max_trusted_time_age": 0,
            "authorized_runtime_profile_digests": ["a" * 64], "authorized_adapter_digests": ["b" * 64],
            "provenance_registry_digest": "c" * 64, "authorized_observer_key_ids": [],
            "allowed_action_types": [], "allowed_target_scopes": [], "max_capability_lifetime": 1,
            "anchor_profiles": [{
                "profile_id": "0" * 64, "profile_version": 1, "profile_document_sha256": "1" * 64,
                "verifier_code_digest": "2" * 64, "provider_type": "HSM", "anchor_instance_id": "3" * 64,
                "provider_instance_id": "4" * 64, "host_binding": "5" * 64, "authorized_service_identity": "6" * 64,
                "counter_namespace": "counter", "counter_object_identity": "7" * 64, "provisioning_generation": 1,
                "rollback_domain_id": "8" * 64, "durable_ledger_domain_id": "9" * 64,
                "trusted_administrators_digest": "a" * 64, "reset_authority_digest": "b" * 64,
                "capability": "STRONG_ANTI_ROLLBACK", "keys": [{"key_id": key_id, "public_key_base64": key, "algorithm": "ED25519"}],
                "threshold": 1, "response_key_id": key_id,
                "native_parameters": {"kind": "HSM", "vendor_profile_digest": "c" * 64,
                    "monotonic_object_identity": "d" * 64, "primitive": "ATOMIC_EXPECTED_INCREMENT"},
            }], "checker_profiles": [], "effect_profiles": [],
            "transcript_verification_authorities": [], "state_verification_authorities": [{
                "authority_id": "d" * 64, "key_id": key_id, "public_key": key,
                "service_measurement_digest": "e" * 64, "verification_profile_id": "f" * 64,
                "verification_profile_version": 1, "valid_from": 0, "valid_until": 1,
            }],
        }
        parsed = SafetyTrustPolicyPayloadV2_3_8(**policy)
        self.assertEqual(0, parsed.policy_epoch)
        self.assertFalse(parsed.__post_init__())
        self_authorizing = copy.deepcopy(policy)
        self_authorizing["issuers"] = {"a" * 64: {"authority_id": "a" * 64, "serial_floor": 0, "keys": {key_id: {
            "key_id": key_id, "public_key": key, "permitted_payload_types": ["SafetyTrustPolicyPayloadV2_3_8"],
            "permitted_purposes": ["POLICY"], "permitted_scope_digests": [], "valid_from": 0, "valid_until": 1,
        }}}}
        with self.assertRaises(FulgorValidationError): SafetyTrustPolicyPayloadV2_3_8(**self_authorizing)

    def test_schema_constrained_profile_injection_and_forgery_fail_closed(self) -> None:
        key, key_id = key_pair()
        policy = {
            "policy_epoch": 0, "root_generation": 0, "issuers": {}, "revoked_key_ids": [], "revoked_object_digests": [], "authorized_bootstrap_digests": [],
            "authorized_time_sources": {"permitted_mechanisms": [], "authorized_ak_key_ids": [], "authorized_tsa_root_ids": [], "authorized_tsa_policy_oids": [], "public_keys": [{"key_id": key_id, "public_key_der_base64": key, "role": "TPM_AK"}], "tpm_utc_calibration": None, "local_monotonic_max_drift_ppm": 0, "cms_accuracy_bound_ms": None},
            "max_trusted_time_uncertainty": 0, "max_trusted_time_age": 0, "authorized_runtime_profile_digests": ["a" * 64], "authorized_adapter_digests": ["b" * 64], "provenance_registry_digest": "c" * 64, "authorized_observer_key_ids": [], "allowed_action_types": [], "allowed_target_scopes": [], "max_capability_lifetime": 1,
            "anchor_profiles": [], "checker_profiles": [], "effect_profiles": [], "transcript_verification_authorities": [], "state_verification_authorities": [],
        }
        with self.assertRaises(FulgorValidationError): SafetyTrustPolicyPayloadV2_3_8(**policy)
        forged = object.__new__(SafetyTrustPolicyPayloadV2_3_8)
        for name, value in policy.items(): object.__setattr__(forged, name, value)
        from kayra_ai.fulgor import validate_safety_trust_policy
        with self.assertRaises(FulgorValidationError): validate_safety_trust_policy(forged)


if __name__ == "__main__":
    unittest.main()
