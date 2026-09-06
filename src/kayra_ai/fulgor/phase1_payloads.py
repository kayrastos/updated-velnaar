"""Frozen local representations for Fulgor V2.3.8 Contracts 7--10.

These validators deliberately establish only syntax, canonical projections, and
local relationships.  In particular, parsing a root is never bootstrap, and a
valid policy, certificate, or evidence object is never authorization.
"""

from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any

from .canonical import MAX_SAFE_INTEGER, parse_json_strict, validate_json_value
from .ed25519 import decode_public_key_base64
from .errors import FulgorErrorCode, FulgorValidationError
from .frozen_schema import validate_contract8_schema
from .canonical import canonicalize, length_prefix
from .digests import contract_digest
from .domains import operation_domain_bytes

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_B64 = re.compile(r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
_PAYLOAD_TYPES = frozenset({
    "SafetyTrustPolicyPayloadV2_3_8", "EvidenceSignerCertificatePayloadV2_3_8",
    "FinalEvidencePayloadV2_3_8", "HumanDecisionV2_3_8", "SafetyKernelDecisionV2_3_8",
    "ModelArtifactAttestationPayloadV2_3_8", "ExecutionBundleAttestationPayloadV2_3_8",
    "RuntimeObservationV2_3_8", "ProvenanceValidationRegistryV2_3_8",
    "ActionScopedCapabilityV2_3_8", "ActionResultV2_3_8",
})
_PURPOSES = frozenset({"ATTESTATION", "POLICY", "CERTIFICATE", "EVIDENCE", "DECISION", "ACTION", "OBSERVATION"})
_MODES = frozenset({"MODE_A_EXTERNAL", "MODE_B_CONTROLLED"})


class LocalTrustStatus(StrEnum):
    ROOT_ANCHOR_OBJECT_VALID = "ROOT_ANCHOR_OBJECT_VALID"
    LOCALLY_VALIDATED = "LOCALLY_VALIDATED"


@dataclass(frozen=True, slots=True)
class LocalValidationResult:
    status: LocalTrustStatus
    externally_trusted: bool = False
    issuer_authorized: bool | None = None
    not_revoked: bool | None = None
    time_valid: bool | None = None
    anti_rollback_valid: bool | None = None
    protected_state: bool | None = None
    evidence_signed: bool | None = None

    def __post_init__(self) -> None:
        if self.externally_trusted or any(value is not None for value in (
            self.issuer_authorized, self.not_revoked, self.time_valid,
            self.anti_rollback_valid, self.protected_state, self.evidence_signed,
        )):
            raise FulgorValidationError(FulgorErrorCode.INVALID_ENVELOPE,
                                        "Phase 1 local validation cannot carry authority facts")

    @property
    def trust_authorized(self) -> bool:
        return False


def _fail(code: FulgorErrorCode, detail: str) -> None:
    raise FulgorValidationError(code, detail)


def _closed(value: Any, fields: frozenset[str], code: FulgorErrorCode, name: str) -> dict[str, Any]:
    validate_json_value(value)
    if type(value) is not dict or frozenset(value) != fields:
        missing = sorted(fields - frozenset(value)) if type(value) is dict else sorted(fields)
        extra = sorted(frozenset(value) - fields) if type(value) is dict else []
        _fail(code, f"closed {name} fields mismatch; missing={missing}, extra={extra}")
    return value


def _hex(value: Any, field: str, code: FulgorErrorCode) -> str:
    if type(value) is not str or _HEX64.fullmatch(value) is None:
        _fail(code, f"{field} must be 64 lowercase hexadecimal characters")
    return value


def _integer(value: Any, field: str, code: FulgorErrorCode, *, minimum: int = 0) -> int:
    if type(value) is not int or not minimum <= value <= MAX_SAFE_INTEGER:
        _fail(code, f"{field} must be an integer in [{minimum},{MAX_SAFE_INTEGER}]")
    return value


def _key(value: Any, field: str, code: FulgorErrorCode) -> bytes:
    try:
        return decode_public_key_base64(value)
    except FulgorValidationError as exc:
        _fail(code, f"{field}: {exc.detail}")


_ROOT_FIELDS = frozenset({"root_authority_id", "root_key_id", "root_public_key", "root_generation", "minimum_policy_epoch", "recovery_quorum", "anchor_instance_id"})
_QUORUM_FIELDS = frozenset({"threshold", "members"})
_MEMBER_FIELDS = frozenset({"member_id", "public_key"})


@dataclass(frozen=True, slots=True)
class RootTrustAnchorV2_3_8:
    root_authority_id: str
    root_key_id: str
    root_public_key: str
    root_generation: int
    minimum_policy_epoch: int
    recovery_quorum: dict[str, Any]
    anchor_instance_id: str

    def __post_init__(self) -> None:
        _validate_root_trust_anchor_frozen(self)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def parse_root_trust_anchor(value: Any) -> RootTrustAnchorV2_3_8:
    value = _closed(value, _ROOT_FIELDS, FulgorErrorCode.INVALID_ROOT_TRUST_ANCHOR, "root anchor")
    return RootTrustAnchorV2_3_8(**value)


def parse_root_trust_anchor_bytes(raw: bytes) -> RootTrustAnchorV2_3_8:
    return parse_root_trust_anchor(parse_json_strict(raw))


def validate_root_trust_anchor(value: RootTrustAnchorV2_3_8) -> LocalValidationResult:
    code = FulgorErrorCode.INVALID_ROOT_TRUST_ANCHOR
    if type(value) is not RootTrustAnchorV2_3_8:
        _fail(code, "root anchor must have its exact frozen type")
    raw = value.to_dict()
    _closed(raw, _ROOT_FIELDS, code, "root anchor")
    _hex(raw["root_authority_id"], "root_authority_id", code)
    root_key = _key(raw["root_public_key"], "root_public_key", code)
    if hashlib.sha256(root_key).hexdigest() != _hex(raw["root_key_id"], "root_key_id", code):
        _fail(code, "root_key_id must equal H(raw root_public_key)")
    _integer(raw["root_generation"], "root_generation", code)
    _integer(raw["minimum_policy_epoch"], "minimum_policy_epoch", code)
    _hex(raw["anchor_instance_id"], "anchor_instance_id", code)
    quorum = _closed(raw["recovery_quorum"], _QUORUM_FIELDS, code, "recovery_quorum")
    threshold = _integer(quorum["threshold"], "recovery_quorum.threshold", code, minimum=1)
    members = quorum["members"]
    if type(members) is not list or not 1 <= len(members) <= 65536:
        _fail(code, "recovery_quorum.members must contain 1..65536 members")
    ids: set[str] = set(); keys: set[bytes] = set()
    for member in members:
        member = _closed(member, _MEMBER_FIELDS, code, "recovery member")
        key = _key(member["public_key"], "recovery member public_key", code)
        member_id = _hex(member["member_id"], "recovery member_id", code)
        if member_id != hashlib.sha256(key).hexdigest() or member_id in ids or key in keys:
            _fail(code, "recovery members require unique matching IDs and public keys")
        ids.add(member_id); keys.add(key)
    if threshold > len(members):
        _fail(code, "recovery quorum threshold exceeds member count")
    return LocalValidationResult(LocalTrustStatus.ROOT_ANCHOR_OBJECT_VALID)


_validate_root_trust_anchor_frozen = validate_root_trust_anchor


_POLICY_FIELDS = frozenset({
    "policy_epoch", "root_generation", "issuers", "revoked_key_ids", "revoked_object_digests",
    "authorized_bootstrap_digests", "authorized_time_sources", "max_trusted_time_uncertainty",
    "max_trusted_time_age", "authorized_runtime_profile_digests", "authorized_adapter_digests",
    "provenance_registry_digest", "authorized_observer_key_ids", "allowed_action_types",
    "allowed_target_scopes", "max_capability_lifetime", "anchor_profiles", "checker_profiles",
    "effect_profiles", "transcript_verification_authorities", "state_verification_authorities",
})
_ISSUER_FIELDS = frozenset({"authority_id", "serial_floor", "keys"})
_ISSUER_KEY_FIELDS = frozenset({"key_id", "public_key", "permitted_payload_types", "permitted_purposes", "permitted_scope_digests", "valid_from", "valid_until"})
_TIME_FIELDS = frozenset({"permitted_mechanisms", "authorized_ak_key_ids", "authorized_tsa_root_ids", "authorized_tsa_policy_oids", "public_keys", "tpm_utc_calibration", "local_monotonic_max_drift_ppm", "cms_accuracy_bound_ms"})


@dataclass(frozen=True, slots=True)
class SafetyTrustPolicyPayloadV2_3_8:
    policy_epoch: int; root_generation: int; issuers: dict[str, Any]; revoked_key_ids: list[str]
    revoked_object_digests: list[str]; authorized_bootstrap_digests: list[str]; authorized_time_sources: dict[str, Any]
    max_trusted_time_uncertainty: int; max_trusted_time_age: int; authorized_runtime_profile_digests: list[str]
    authorized_adapter_digests: list[str]; provenance_registry_digest: str; authorized_observer_key_ids: list[str]
    allowed_action_types: list[str]; allowed_target_scopes: list[Any]; max_capability_lifetime: int
    anchor_profiles: list[Any]; checker_profiles: list[Any]; effect_profiles: list[Any]
    transcript_verification_authorities: list[Any]; state_verification_authorities: list[Any]
    def __post_init__(self) -> None: _validate_safety_trust_policy_frozen(self)
    def to_dict(self) -> dict[str, Any]: return asdict(self)


def _unique_strings(value: Any, field: str, code: FulgorErrorCode, *, minimum: int = 0) -> list[str]:
    if type(value) is not list or not minimum <= len(value) <= 65536 or any(type(x) is not str for x in value) or len(set(value)) != len(value):
        _fail(code, f"{field} must be a unique string array")
    return value


def _digest_list(value: Any, field: str, code: FulgorErrorCode, *, minimum: int = 0) -> list[str]:
    result = _unique_strings(value, field, code, minimum=minimum)
    for item in result: _hex(item, field, code)
    return result


def _validate_issuers(issuers: Any, code: FulgorErrorCode) -> None:
    if type(issuers) is not dict:
        _fail(code, "issuers must be an object")
    all_keys: set[bytes] = set()
    for map_id, issuer in issuers.items():
        _hex(map_id, "issuer map key", code)
        issuer = _closed(issuer, _ISSUER_FIELDS, code, "issuer")
        if issuer["authority_id"] != map_id: _fail(code, "issuer map key must equal authority_id")
        _hex(issuer["authority_id"], "authority_id", code); _integer(issuer["serial_floor"], "serial_floor", code)
        if type(issuer["keys"]) is not dict: _fail(code, "issuer keys must be an object")
        for map_key_id, entry in issuer["keys"].items():
            _hex(map_key_id, "issuer key map key", code)
            entry = _closed(entry, _ISSUER_KEY_FIELDS, code, "issuer key")
            if entry["key_id"] != map_key_id: _fail(code, "issuer key map key must equal key_id")
            key = _key(entry["public_key"], "issuer public_key", code)
            if map_key_id != hashlib.sha256(key).hexdigest() or key in all_keys:
                _fail(code, "issuer key ID mismatch or duplicate public key")
            all_keys.add(key)
            types = _unique_strings(entry["permitted_payload_types"], "permitted_payload_types", code)
            if any(x not in _PAYLOAD_TYPES for x in types): _fail(code, "unsupported permitted payload type")
            if "SafetyTrustPolicyPayloadV2_3_8" in types:
                _fail(code, "an issuer key cannot self-authorize a root-signed policy")
            purposes = _unique_strings(entry["permitted_purposes"], "permitted_purposes", code)
            if any(x not in _PURPOSES for x in purposes): _fail(code, "unsupported permitted purpose")
            _digest_list(entry["permitted_scope_digests"], "permitted_scope_digests", code)
            if _integer(entry["valid_from"], "valid_from", code) > _integer(entry["valid_until"], "valid_until", code):
                _fail(code, "issuer key validity interval is inverted")


def parse_safety_trust_policy(value: Any) -> SafetyTrustPolicyPayloadV2_3_8:
    return SafetyTrustPolicyPayloadV2_3_8(**_closed(value, _POLICY_FIELDS, FulgorErrorCode.INVALID_SAFETY_TRUST_POLICY, "safety policy"))
def parse_safety_trust_policy_bytes(raw: bytes) -> SafetyTrustPolicyPayloadV2_3_8: return parse_safety_trust_policy(parse_json_strict(raw))
def validate_safety_trust_policy(value: SafetyTrustPolicyPayloadV2_3_8) -> LocalValidationResult:
    code = FulgorErrorCode.INVALID_SAFETY_TRUST_POLICY
    if type(value) is not SafetyTrustPolicyPayloadV2_3_8: _fail(code, "policy must have its exact frozen type")
    raw = _closed(value.to_dict(), _POLICY_FIELDS, code, "safety policy")
    validate_contract8_schema(raw)
    _integer(raw["policy_epoch"], "policy_epoch", code); _integer(raw["root_generation"], "root_generation", code)
    _validate_issuers(raw["issuers"], code)
    for field in ("revoked_key_ids", "revoked_object_digests", "authorized_bootstrap_digests", "authorized_runtime_profile_digests", "authorized_adapter_digests", "authorized_observer_key_ids"):
        _digest_list(raw[field], field, code, minimum=1 if field in {"authorized_runtime_profile_digests", "authorized_adapter_digests"} else 0)
    _hex(raw["provenance_registry_digest"], "provenance_registry_digest", code)
    for field in ("max_trusted_time_uncertainty", "max_trusted_time_age"):_integer(raw[field], field, code)
    _integer(raw["max_capability_lifetime"], "max_capability_lifetime", code, minimum=1)
    time = _closed(raw["authorized_time_sources"], _TIME_FIELDS, code, "authorized_time_sources")
    for field in ("authorized_ak_key_ids", "authorized_tsa_root_ids"):_digest_list(time[field], field, code)
    mechanisms = _unique_strings(time["permitted_mechanisms"], "permitted_mechanisms", code)
    if any(x not in {"TPM2_TIME", "RFC3161_CMS"} for x in mechanisms): _fail(code, "unsupported time mechanism")
    _unique_strings(time["authorized_tsa_policy_oids"], "authorized_tsa_policy_oids", code)
    if type(time["public_keys"]) is not list or not 1 <= len(time["public_keys"]) <= 65536: _fail(code, "authorized_time_sources.public_keys is invalid")
    time_key_ids: set[str] = set()
    time_public_keys: set[bytes] = set()
    for entry in time["public_keys"]:
        entry = _closed(entry, frozenset({"key_id", "public_key_der_base64", "role"}), code, "time public key")
        key_id = _hex(entry["key_id"], "time public key key_id", code)
        encoded = entry["public_key_der_base64"]
        if type(encoded) is not str or _B64.fullmatch(encoded) is None:
            _fail(code, "time public key DER is not canonical base64")
        try: raw_key = base64.b64decode(encoded, validate=True)
        except Exception: _fail(code, "time public key DER is invalid base64")
        if not raw_key or base64.b64encode(raw_key).decode("ascii") != encoded or key_id != hashlib.sha256(raw_key).hexdigest() or key_id in time_key_ids or raw_key in time_public_keys:
            _fail(code, "time public key identity mismatch or duplicate")
        if entry["role"] not in {"TPM_AK", "TSA_ROOT"}: _fail(code, "unknown time public key role")
        time_key_ids.add(key_id); time_public_keys.add(raw_key)
    if type(time["local_monotonic_max_drift_ppm"]) is not int or not 0 <= time["local_monotonic_max_drift_ppm"] <= 1_000_000: _fail(code, "local_monotonic_max_drift_ppm is invalid")
    if time["cms_accuracy_bound_ms"] is not None: _integer(time["cms_accuracy_bound_ms"], "cms_accuracy_bound_ms", code)
    actions = _unique_strings(raw["allowed_action_types"], "allowed_action_types", code)
    if len(actions) > 4 or any(x not in {"FILE_WRITE", "GIT_COMMIT", "NETWORK_POST", "COMMAND_EXEC"} for x in actions): _fail(code, "allowed_action_types is invalid")
    _validate_anchor_profiles(raw["anchor_profiles"], code)
    _validate_checker_profiles(raw["checker_profiles"], code)
    _validate_effect_profiles(raw["effect_profiles"], raw["allowed_target_scopes"], actions, code)
    _validate_receipt_authorities(raw["transcript_verification_authorities"], code, transcript=True, minimum=0)
    _validate_receipt_authorities(raw["state_verification_authorities"], code, transcript=False, minimum=1)
    return LocalValidationResult(LocalTrustStatus.LOCALLY_VALIDATED)


_validate_safety_trust_policy_frozen = validate_safety_trust_policy


def _base64_fingerprint(value: str, field: str, code: FulgorErrorCode) -> tuple[bytes, str]:
    if type(value) is not str or _B64.fullmatch(value) is None:
        _fail(code, f"{field} must be canonical base64")
    try: raw = base64.b64decode(value, validate=True)
    except Exception: _fail(code, f"{field} has invalid base64")
    if not raw or base64.b64encode(raw).decode("ascii") != value:
        _fail(code, f"{field} must have canonical base64 encoding")
    return raw, hashlib.sha256(raw).hexdigest()


def _validate_anchor_profiles(profiles: list[Any], code: FulgorErrorCode) -> None:
    identities: set[str] = set(); instances: set[str] = set(); public_keys: set[bytes] = set()
    for profile in profiles:
        profile_id = _hex(profile["profile_id"], "anchor profile_id", code)
        instance = _hex(profile["anchor_instance_id"], "anchor_instance_id", code)
        if profile_id in identities or instance in instances: _fail(code, "duplicate anchor profile or instance identity")
        identities.add(profile_id); instances.add(instance)
        keys: set[str] = set()
        for key in profile["keys"]:
            raw, fingerprint = _base64_fingerprint(key["public_key_base64"], "anchor public_key_base64", code)
            key_id = _hex(key["key_id"], "anchor key_id", code)
            if key_id != fingerprint or key_id in keys or raw in public_keys:
                _fail(code, "anchor key identity/fingerprint mismatch or duplicate public key")
            keys.add(key_id); public_keys.add(raw)
            if key["algorithm"] == "ED25519": _key(key["public_key_base64"], "anchor ED25519 public key", code)
        if _integer(profile["threshold"], "anchor threshold", code, minimum=1) > len(keys):
            _fail(code, "anchor threshold exceeds distinct key count")
        if profile["response_key_id"] not in keys:
            _fail(code, "anchor response_key_id does not select an anchor key")


def _validate_checker_profiles(profiles: list[Any], code: FulgorErrorCode) -> None:
    checker_ids: set[str] = set(); public_keys: set[bytes] = set()
    for profile in profiles:
        checker_id = _hex(profile["checker_id"], "checker_id", code)
        if checker_id in checker_ids: _fail(code, "duplicate checker_id")
        checker_ids.add(checker_id)
        key = _key(profile["supervisor_public_key"], "checker supervisor_public_key", code)
        if _hex(profile["supervisor_key_id"], "checker supervisor_key_id", code) != hashlib.sha256(key).hexdigest() or key in public_keys:
            _fail(code, "checker supervisor key identity mismatch or duplicate public key")
        public_keys.add(key)


def _target_scope_digest(descriptor: Any) -> str:
    wire = canonicalize(descriptor)
    return hashlib.sha256(operation_domain_bytes("target_scope") + length_prefix(wire)).hexdigest()


def _validate_effect_profiles(profiles: list[Any], allowed_scopes: list[Any], actions: list[str], code: FulgorErrorCode) -> None:
    profile_ids: set[str] = set(); scope_digests = [_target_scope_digest(scope) for scope in allowed_scopes]
    if scope_digests != sorted(scope_digests) or len(set(scope_digests)) != len(scope_digests):
        _fail(code, "allowed_target_scopes must be uniquely sorted by target_scope_digest")
    for profile in profiles:
        profile_id = _hex(profile["profile_id"], "effect profile_id", code)
        if profile_id in profile_ids: _fail(code, "duplicate effect profile_id")
        profile_ids.add(profile_id)
        public_key = _key(profile["authority_public_key"], "effect authority_public_key", code)
        if _hex(profile["authority_key_id"], "effect authority_key_id", code) != hashlib.sha256(public_key).hexdigest():
            _fail(code, "effect authority key identity mismatch")
        descriptor = profile["target_scope"]
        expected = _target_scope_digest(descriptor)
        if profile["target_scope_digest"] != expected or expected not in scope_digests:
            _fail(code, "effect profile target scope/digest is not policy-authorized")
        if profile["action_type"] not in actions:
            _fail(code, "effect profile action type is not allowed by policy")


def _validate_receipt_authorities(value: Any, code: FulgorErrorCode, *, transcript: bool, minimum: int) -> None:
    fields = (frozenset({"authority_id", "key_id", "public_key", "supervisor_measurement_digest", "verification_profile_digest", "valid_from", "valid_until"})
              if transcript else frozenset({"authority_id", "key_id", "public_key", "service_measurement_digest", "verification_profile_id", "verification_profile_version", "valid_from", "valid_until"}))
    if type(value) is not list or not minimum <= len(value) <= 65536:
        _fail(code, "receipt authorities have invalid cardinality")
    authorities: set[str] = set(); keys: set[bytes] = set()
    for entry in value:
        entry = _closed(entry, fields, code, "receipt authority")
        authority = _hex(entry["authority_id"], "receipt authority_id", code)
        key = _key(entry["public_key"], "receipt authority public_key", code)
        if _hex(entry["key_id"], "receipt key_id", code) != hashlib.sha256(key).hexdigest() or authority in authorities or key in keys:
            _fail(code, "receipt authority/key identity mismatch or duplicate")
        authorities.add(authority); keys.add(key)
        for name in fields - {"authority_id", "key_id", "public_key", "valid_from", "valid_until", "verification_profile_version"}:
            _hex(entry[name], name, code)
        if not transcript: _integer(entry["verification_profile_version"], "verification_profile_version", code, minimum=1)
        if _integer(entry["valid_from"], "valid_from", code) > _integer(entry["valid_until"], "valid_until", code):
            _fail(code, "receipt authority validity interval is inverted")


_CERT_FIELDS = frozenset({"run_id", "run_nonce", "reservation_id", "execution_mode", "ephemeral_public_key", "ephemeral_key_id", "purpose", "payload_type", "serial", "policy_epoch", "not_before", "not_after", "max_uses", "scope_digest"})
@dataclass(frozen=True, slots=True)
class EvidenceSignerCertificatePayloadV2_3_8:
    run_id: str; run_nonce: str; reservation_id: str; execution_mode: str; ephemeral_public_key: str; ephemeral_key_id: str; purpose: str; payload_type: str; serial: int; policy_epoch: int; not_before: int; not_after: int; max_uses: int; scope_digest: str
    def __post_init__(self) -> None: _validate_evidence_signer_certificate_frozen(self)
    def to_dict(self) -> dict[str, Any]: return asdict(self)
def parse_evidence_signer_certificate(value: Any) -> EvidenceSignerCertificatePayloadV2_3_8: return EvidenceSignerCertificatePayloadV2_3_8(**_closed(value, _CERT_FIELDS, FulgorErrorCode.INVALID_EVIDENCE_SIGNER_CERTIFICATE, "evidence signer certificate"))
def parse_evidence_signer_certificate_bytes(raw: bytes) -> EvidenceSignerCertificatePayloadV2_3_8: return parse_evidence_signer_certificate(parse_json_strict(raw))
def validate_evidence_signer_certificate(value: EvidenceSignerCertificatePayloadV2_3_8) -> LocalValidationResult:
    code = FulgorErrorCode.INVALID_EVIDENCE_SIGNER_CERTIFICATE
    if type(value) is not EvidenceSignerCertificatePayloadV2_3_8: _fail(code, "certificate must have its exact frozen type")
    raw = _closed(value.to_dict(), _CERT_FIELDS, code, "evidence signer certificate")
    for name in ("run_id", "run_nonce", "reservation_id", "scope_digest"): _hex(raw[name], name, code)
    key = _key(raw["ephemeral_public_key"], "ephemeral_public_key", code)
    if _hex(raw["ephemeral_key_id"], "ephemeral_key_id", code) != hashlib.sha256(key).hexdigest(): _fail(code, "ephemeral_key_id must equal H(raw ephemeral_public_key)")
    if raw["execution_mode"] not in _MODES or raw["purpose"] != "EVIDENCE" or raw["payload_type"] != "FinalEvidencePayloadV2_3_8": _fail(code, "certificate purpose, payload type, or mode is invalid")
    _integer(raw["serial"], "serial", code, minimum=1); _integer(raw["policy_epoch"], "policy_epoch", code)
    if _integer(raw["not_before"], "not_before", code) > _integer(raw["not_after"], "not_after", code): _fail(code, "certificate validity interval is inverted")
    if raw["max_uses"] != 1: _fail(code, "certificate max_uses must equal one")
    return LocalValidationResult(LocalTrustStatus.LOCALLY_VALIDATED)


_validate_evidence_signer_certificate_frozen = validate_evidence_signer_certificate


_EVIDENCE_FIELDS = frozenset({"evidence_identity", "run_id", "run_nonce", "reservation_id", "execution_mode", "state_sequence", "root_trust_anchor_digest", "root_generation", "safety_policy_digest", "policy_epoch", "evidence_root", "qualification", "signed_at", "certificate_digest"})
@dataclass(frozen=True, slots=True)
class FinalEvidencePayloadV2_3_8:
    evidence_identity: str; run_id: str; run_nonce: str; reservation_id: str; execution_mode: str; state_sequence: int | None; root_trust_anchor_digest: str; root_generation: int; safety_policy_digest: str; policy_epoch: int; evidence_root: str; qualification: str; signed_at: int; certificate_digest: str
    def __post_init__(self) -> None: _validate_final_evidence_frozen(self)
    def to_dict(self) -> dict[str, Any]: return asdict(self)
def parse_final_evidence(value: Any) -> FinalEvidencePayloadV2_3_8: return FinalEvidencePayloadV2_3_8(**_closed(value, _EVIDENCE_FIELDS, FulgorErrorCode.INVALID_FINAL_EVIDENCE, "final evidence"))
def parse_final_evidence_bytes(raw: bytes) -> FinalEvidencePayloadV2_3_8: return parse_final_evidence(parse_json_strict(raw))
def validate_final_evidence(value: FinalEvidencePayloadV2_3_8) -> LocalValidationResult:
    code = FulgorErrorCode.INVALID_FINAL_EVIDENCE
    if type(value) is not FinalEvidencePayloadV2_3_8: _fail(code, "final evidence must have its exact frozen type")
    raw = _closed(value.to_dict(), _EVIDENCE_FIELDS, code, "final evidence")
    for name in ("evidence_identity", "run_id", "run_nonce", "reservation_id", "root_trust_anchor_digest", "safety_policy_digest", "evidence_root", "certificate_digest"): _hex(raw[name], name, code)
    for name in ("root_generation", "policy_epoch", "signed_at"): _integer(raw[name], name, code)
    if raw["execution_mode"] == "MODE_A_EXTERNAL":
        if raw["state_sequence"] is not None or raw["qualification"] != "ATTESTED_AND_RUNTIME_OBSERVED": _fail(code, "Mode A requires null state_sequence and observational qualification")
    elif raw["execution_mode"] == "MODE_B_CONTROLLED":
        _integer(raw["state_sequence"], "state_sequence", code, minimum=1)
        if raw["qualification"] != "FULLY_VERIFIED_PRE_SIGNATURE": _fail(code, "Mode B requires its frozen qualification")
    else: _fail(code, "unsupported execution_mode")
    if raw["evidence_identity"] != contract_digest(10, raw): _fail(code, "evidence_identity must equal D(10,payload) projection")
    return LocalValidationResult(LocalTrustStatus.LOCALLY_VALIDATED)


_validate_final_evidence_frozen = validate_final_evidence


def validate_payload_8(payload: Any) -> None: _validate_safety_trust_policy_frozen(parse_safety_trust_policy(payload))
def validate_payload_9(payload: Any) -> None: _validate_evidence_signer_certificate_frozen(parse_evidence_signer_certificate(payload))
def validate_payload_10(payload: Any) -> None: _validate_final_evidence_frozen(parse_final_evidence(payload))
