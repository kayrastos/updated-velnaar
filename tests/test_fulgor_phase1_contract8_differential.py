from __future__ import annotations

import base64
import copy
import hashlib
import unittest
from typing import Any, Iterator

from kayra_ai.fulgor import FulgorValidationError, SafetyTrustPolicyPayloadV2_3_8, parse_safety_trust_policy
from kayra_ai.fulgor.frozen_schema import validate_contract8_schema


def _key() -> tuple[str, str]:
    raw = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
    return base64.b64encode(raw).decode("ascii"), hashlib.sha256(raw).hexdigest()


def _seed() -> dict[str, Any]:
    key, key_id = _key()
    policy = {
        "policy_epoch": 0, "root_generation": 0, "issuers": {}, "revoked_key_ids": [], "revoked_object_digests": [], "authorized_bootstrap_digests": [],
        "authorized_time_sources": {"permitted_mechanisms": [], "authorized_ak_key_ids": [], "authorized_tsa_root_ids": [], "authorized_tsa_policy_oids": [], "public_keys": [{"key_id": key_id, "public_key_der_base64": key, "role": "TPM_AK"}], "tpm_utc_calibration": None, "local_monotonic_max_drift_ppm": 0, "cms_accuracy_bound_ms": None},
        "max_trusted_time_uncertainty": 0, "max_trusted_time_age": 0, "authorized_runtime_profile_digests": ["a" * 64], "authorized_adapter_digests": ["b" * 64], "provenance_registry_digest": "c" * 64, "authorized_observer_key_ids": [], "allowed_action_types": [], "allowed_target_scopes": [], "max_capability_lifetime": 1,
        "anchor_profiles": [{"profile_id": "0" * 64, "profile_version": 1, "profile_document_sha256": "1" * 64, "verifier_code_digest": "2" * 64, "provider_type": "HSM", "anchor_instance_id": "3" * 64, "provider_instance_id": "4" * 64, "host_binding": "5" * 64, "authorized_service_identity": "6" * 64, "counter_namespace": "counter", "counter_object_identity": "7" * 64, "provisioning_generation": 1, "rollback_domain_id": "8" * 64, "durable_ledger_domain_id": "9" * 64, "trusted_administrators_digest": "a" * 64, "reset_authority_digest": "b" * 64, "capability": "STRONG_ANTI_ROLLBACK", "keys": [{"key_id": key_id, "public_key_base64": key, "algorithm": "ED25519"}], "threshold": 1, "response_key_id": key_id, "native_parameters": {"kind": "HSM", "vendor_profile_digest": "c" * 64, "monotonic_object_identity": "d" * 64, "primitive": "ATOMIC_EXPECTED_INCREMENT"}}],
        "checker_profiles": [], "effect_profiles": [], "transcript_verification_authorities": [],
        "state_verification_authorities": [{"authority_id": "d" * 64, "key_id": key_id, "public_key": key, "service_measurement_digest": "e" * 64, "verification_profile_id": "f" * 64, "verification_profile_version": 1, "valid_from": 0, "valid_until": 1}],
    }
    def h(number: int) -> str: return f"{number:064x}"
    def profile(number: int, provider: str, public: str, native: dict[str, Any]) -> dict[str, Any]:
        raw = base64.b64decode(public); key_id = hashlib.sha256(raw).hexdigest()
        return {"profile_id": h(number), "profile_version": 1, "profile_document_sha256": h(number + 10), "verifier_code_digest": h(number + 20), "provider_type": provider, "anchor_instance_id": h(number + 30), "provider_instance_id": h(number + 40), "host_binding": h(number + 50), "authorized_service_identity": h(number + 60), "counter_namespace": f"counter-{number}", "counter_object_identity": h(number + 70), "provisioning_generation": 1, "rollback_domain_id": h(number + 80), "durable_ledger_domain_id": h(number + 90), "trusted_administrators_digest": h(number + 100), "reset_authority_digest": h(number + 110), "capability": "STRONG_ANTI_ROLLBACK", "keys": [{"key_id": key_id, "public_key_base64": public, "algorithm": "VENDOR_NATIVE"}], "threshold": 1, "response_key_id": key_id, "native_parameters": native}
    policy["anchor_profiles"] = [
        policy["anchor_profiles"][0],
        profile(200, "TPM_NV", "Ag==", {"kind": "TPM_NV", "nv_index": 0, "nv_name": "Aw==", "nv_public_bytes": "BA==", "ak_key_id": h(300), "nv_attributes": 0, "counter_attribute": "TPMA_NV_COUNTER", "reset_protection_profile_digest": h(301)}),
        profile(400, "PROTECTED_HOST_DAEMON", "BQ==", {"kind": "PROTECTED_HOST_DAEMON", "daemon_key_id": h(500), "ledger_identity": h(501)}),
        profile(600, "REMOTE_AUTHORITY", "Bg==", {"kind": "REMOTE_AUTHORITY", "authority_set_digest": h(700), "consensus_profile_digest": h(701), "log_identity": h(702)}),
    ]
    scopes = [
        {"action_type": "FILE_WRITE", "namespace_id": h(801), "path_prefix": "", "allow_overwrite": False},
        {"action_type": "GIT_COMMIT", "repository_identity": h(802), "repository_uri": "repo", "allowed_refs": ["refs/heads/main"], "object_format": "SHA256"},
        {"action_type": "NETWORK_POST", "authority_identity": h(803), "origin": "https://example.com", "path_prefix": "/", "allowed_methods": ["POST"], "allowed_header_names": []},
        {"action_type": "COMMAND_EXEC", "namespace_id": h(804), "binary_path": "bin/tool", "binary_sha256": h(805), "working_directory": "work", "argv": [], "environment": {}},
    ]
    from kayra_ai.fulgor.phase1_payloads import _target_scope_digest
    policy["allowed_target_scopes"] = sorted(scopes, key=_target_scope_digest)
    policy["allowed_action_types"] = ["FILE_WRITE", "GIT_COMMIT", "NETWORK_POST", "COMMAND_EXEC"]
    policy["effect_profiles"] = [{"profile_id": h(900 + index), "action_type": scope["action_type"], "target_identity": scope.get("namespace_id", scope.get("repository_identity", scope.get("authority_identity"))), "target_scope_digest": _target_scope_digest(scope), "authority_key_id": key_id, "authority_public_key": key, "verifier_code_digest": h(910 + index), "idempotency_namespace": h(920 + index), "retention": "UNTIL_EXPLICIT_RETIREMENT", "one_winner_semantics": "ATOMIC_KEY_REQUEST_EFFECT_RECEIPT", "profile_document_sha256": h(930 + index), "target_scope": scope} for index, scope in enumerate(policy["allowed_target_scopes"]) if scope["action_type"] != "COMMAND_EXEC"]
    policy["checker_profiles"] = [{"checker_id": h(950), "checker_version": "1", "checker_code_digest": h(951), "checker_config_digest": h(952), "assertion_types": ["OUTPUT_ASSERTION"], "supervisor_key_id": key_id, "supervisor_public_key": key, "supervisor_measurement_digest": h(953), "authority_mode": "CONTROLLED_SUPERVISOR", "source_profile_digest": h(954), "reproducible_assertion_types": [], "required_assertion_ids": [h(955)]}]
    tsa_raw = b"\x02"; tsa_b64 = base64.b64encode(tsa_raw).decode("ascii"); tsa_id = hashlib.sha256(tsa_raw).hexdigest()
    policy["authorized_time_sources"]["public_keys"].append({"key_id": tsa_id, "public_key_der_base64": tsa_b64, "role": "TSA_ROOT"})
    policy["authorized_time_sources"]["tpm_utc_calibration"] = {"ak_key_id": key_id, "reset_count": 0, "restart_count": 0, "clock_milliseconds": 0, "utc_lower_ms": 0, "utc_upper_ms": 0, "max_drift_ppm": 0}
    policy["transcript_verification_authorities"] = [{"authority_id": h(960), "key_id": key_id, "public_key": key, "supervisor_measurement_digest": h(961), "verification_profile_digest": h(962), "valid_from": 0, "valid_until": 1}]
    policy["issuers"] = {h(970): {"authority_id": h(970), "serial_floor": 0, "keys": {key_id: {"key_id": key_id, "public_key": key, "permitted_payload_types": ["FinalEvidencePayloadV2_3_8"], "permitted_purposes": ["EVIDENCE"], "permitted_scope_digests": [], "valid_from": 0, "valid_until": 1}}}}
    return policy


def _at(root: Any, path: tuple[str | int, ...]) -> Any:
    value = root
    for part in path: value = value[part]
    return value


def _cases(value: Any, path: tuple[str | int, ...] = ()) -> Iterator[tuple[str, str, Any]]:
    """Deterministic, depth-first structural mutations for every seed node."""
    label = "/".join(map(str, path)) or "$"
    if type(value) is dict:
        for key in sorted(value):
            candidate = copy.deepcopy(_seed()); target = _at(candidate, path); target.pop(key)
            yield f"required:{label}:{key}", "REQUIRED_FIELD", candidate
        candidate = copy.deepcopy(_seed()); _at(candidate, path)["__injected__"] = True
        yield f"additional:{label}", "ADDITIONAL_PROPERTIES", candidate
        for key in sorted(value): yield from _cases(value[key], path + (key,))
    elif type(value) is list:
        candidate = copy.deepcopy(_seed()); _at(candidate, path).clear()
        yield f"empty:{label}", "ARRAY_EMPTY", candidate
        if value:
            candidate = copy.deepcopy(_seed()); _at(candidate, path).append(copy.deepcopy(value[0]))
            yield f"duplicate:{label}", "ARRAY_DUPLICATE", candidate
            yield from _cases(value[0], path + (0,))
    elif value is None:
        candidate = copy.deepcopy(_seed()); parent = _at(candidate, path[:-1]); parent[path[-1]] = "not-null"
        yield f"type:{label}", "TYPE", candidate
    elif type(value) is int:
        for replacement, kind in ((-1, "NUMERIC_MIN"), ("not-integer", "TYPE")):
            candidate = copy.deepcopy(_seed()); parent = _at(candidate, path[:-1]); parent[path[-1]] = replacement
            yield f"{kind.lower()}:{label}", kind, candidate
    elif type(value) is str:
        for replacement, kind in (("!", "STRING_PATTERN"), (0, "TYPE")):
            candidate = copy.deepcopy(_seed()); parent = _at(candidate, path[:-1]); parent[path[-1]] = replacement
            yield f"{kind.lower()}:{label}", kind, candidate


class Contract8DifferentialTests(unittest.TestCase):
    def test_deterministic_schema_runtime_mutation_corpus(self) -> None:
        seed = _seed()
        validate_contract8_schema(seed)
        SafetyTrustPolicyPayloadV2_3_8(**copy.deepcopy(seed))
        results: list[tuple[str, bool, bool]] = []
        for case_id, mutation_class, candidate in _cases(seed):
            try:
                validate_contract8_schema(candidate); schema_ok = True
            except FulgorValidationError:
                schema_ok = False
            try:
                parse_safety_trust_policy(candidate); runtime_ok = True
            except FulgorValidationError:
                runtime_ok = False
            results.append((f"{case_id}:{mutation_class}", schema_ok, runtime_ok))
        self.assertGreaterEqual(len(results), 100)
        # Contract 8 F--G additionally requires effect action membership and
        # descriptor/digest membership.  These are deliberately stricter than
        # the JSON schema and therefore separately classified, not mismatches.
        prose_stricter = {
            "empty:allowed_action_types:ARRAY_EMPTY",
            "empty:allowed_target_scopes:ARRAY_EMPTY",
            "string_pattern:allowed_target_scopes/0/path_prefix:STRING_PATTERN",
            "string_pattern:effect_profiles/0/target_scope/path_prefix:STRING_PATTERN",
        }
        mismatches = [case_id for case_id, schema_ok, runtime_ok in results if schema_ok != runtime_ok and case_id not in prose_stricter]
        unexpected = [case_id for case_id, schema_ok, runtime_ok in results if schema_ok != runtime_ok and case_id not in prose_stricter]
        self.assertEqual([], unexpected, f"unexplained schema/runtime mismatch: {unexpected}")
        self.assertEqual(prose_stricter, {case_id for case_id, schema_ok, runtime_ok in results if schema_ok and not runtime_ok})
        self.assertTrue(any(not schema_ok for _, schema_ok, _ in results))


if __name__ == "__main__":
    unittest.main()
