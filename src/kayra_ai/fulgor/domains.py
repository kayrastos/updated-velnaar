from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType

from .errors import FulgorErrorCode, FulgorValidationError


_CONTRACT_DOMAINS = {str(number): f"fulgor-contract-{number:02d}-v2.3.8" for number in range(1, 58)}
_OPERATION_DOMAINS = {
    "signature": "fulgor-detached-signature-v2.3.8",
    "artifact_entries": "fulgor-artifact-entries-v2.3.8",
    "bundle_components": "fulgor-bundle-components-v2.3.8",
    "dependency_packages": "fulgor-dependency-packages-v2.3.8",
    "channel_key": "fulgor-channel-key-v2.3.8",
    "transcript_key": "fulgor-transcript-key-v2.3.8",
    "channel_frame": "fulgor-channel-frame-v2.3.8",
    "transcript_frame": "fulgor-transcript-frame-v2.3.8",
    "transcript_terminal": "fulgor-transcript-terminal-v2.3.8",
    "session": "fulgor-session-identity-v2.3.8",
    "prepared_transaction": "fulgor-prepared-transaction-v2.3.8",
    "state_mac": "fulgor-protected-state-mac-v2.3.8",
    "key_rotation": "fulgor-state-key-rotation-v2.3.8",
    "pre_x": "fulgor-evidence-root-pre-x-v2.3.8",
    "root": "fulgor-evidence-root-v2.3.8",
    "finalized_id": "fulgor-finalized-record-id-v2.3.8",
    "anchor_request": "fulgor-monotonic-anchor-request-v2.3.8",
    "anchor_proof": "fulgor-monotonic-anchor-proof-v2.3.8",
    "time_request": "fulgor-time-request-v2.3.8",
    "provenance_statement": "fulgor-provenance-statement-v2.3.8",
    "root_transition_signature": "fulgor-root-transition-signature-v2.3.8",
    "preparation": "fulgor-pre-execution-preparation-v2.3.8",
    "evidence_package": "fulgor-evidence-package-v2.3.8",
    "checker_result": "fulgor-checker-result-v2.3.8",
    "checker_execution": "fulgor-checker-execution-v2.3.8",
    "action_reconciliation": "fulgor-action-reconciliation-v2.3.8",
    "action_receipt": "fulgor-action-receipt-v2.3.8",
    "target_scope": "fulgor-target-scope-v2.3.8",
    "transcript_identity": "fulgor-transcript-identity-v2.3.8",
    "transcript_verification_receipt": "fulgor-transcript-verification-receipt-v2.3.8",
    "transcript_verification_signature": "fulgor-transcript-verification-signature-v2.3.8",
    "anchor_response_core": "fulgor-anchor-response-core-v2.3.8",
    "state_verification_receipt": "fulgor-state-verification-receipt-v2.3.8",
    "state_verification_signature": "fulgor-state-verification-signature-v2.3.8",
    "state_key_retirement_receipt": "fulgor-state-key-retirement-receipt-v2.3.8",
    "state_key_retirement_signature": "fulgor-state-key-retirement-signature-v2.3.8",
}

CONTRACT_DOMAINS = MappingProxyType(_CONTRACT_DOMAINS)
OPERATION_DOMAINS = MappingProxyType(_OPERATION_DOMAINS)
REGISTERED_DOMAIN_TAGS = frozenset(_CONTRACT_DOMAINS.values()) | frozenset(_OPERATION_DOMAINS.values())
PHASE0_REGISTERED_DOMAIN_TAGS = frozenset(
    list(_CONTRACT_DOMAINS.values()) + [_OPERATION_DOMAINS["signature"]]
)
PHASE0_FORMULA_DOMAIN_USES = MappingProxyType(
    {
        "contract_digest": frozenset(_CONTRACT_DOMAINS.values()),
        "signature_input": frozenset({_OPERATION_DOMAINS["signature"]}),
    }
)


def _derive_used_domain_tags(formula_uses: Mapping[str, frozenset[str]]) -> frozenset[str]:
    return frozenset(tag for tags in formula_uses.values() for tag in tags)


PHASE0_USED_DOMAIN_TAGS = _derive_used_domain_tags(PHASE0_FORMULA_DOMAIN_USES)


def contract_domain(contract_number: int) -> str:
    if type(contract_number) is not int:
        raise FulgorValidationError(FulgorErrorCode.DOMAIN_OWNER_MISMATCH, "contract owner must be int")
    try:
        return CONTRACT_DOMAINS[str(contract_number)]
    except KeyError as exc:
        raise FulgorValidationError(
            FulgorErrorCode.UNREGISTERED_DOMAIN, f"unregistered contract: {contract_number}"
        ) from exc


def operation_domain(operation: str) -> str:
    if type(operation) is not str:
        raise FulgorValidationError(
            FulgorErrorCode.DOMAIN_OWNER_MISMATCH, "operation owner must be str"
        )
    try:
        return OPERATION_DOMAINS[operation]
    except KeyError as exc:
        raise FulgorValidationError(
            FulgorErrorCode.UNREGISTERED_DOMAIN, f"unregistered operation: {operation!r}"
        ) from exc


def _terminated_registered_domain(tag: str) -> bytes:
    if tag not in REGISTERED_DOMAIN_TAGS or "\x00" in tag:
        raise FulgorValidationError(
            FulgorErrorCode.UNREGISTERED_DOMAIN, "domain tag is not a frozen registered tag"
        )
    return tag.encode("utf-8") + b"\x00"


def contract_domain_bytes(contract_number: int) -> bytes:
    return _terminated_registered_domain(contract_domain(contract_number))


def operation_domain_bytes(operation: str) -> bytes:
    return _terminated_registered_domain(operation_domain(operation))


def validate_domain_registry(
    contract_domains: Mapping[str, str],
    operation_domains: Mapping[str, str],
    *,
    require_frozen_associations: bool = True,
) -> None:
    if any(type(key) is not str or type(value) is not str for key, value in contract_domains.items()):
        raise FulgorValidationError(FulgorErrorCode.DOMAIN_OWNER_MISMATCH, "invalid contract association")
    if any(type(key) is not str or type(value) is not str for key, value in operation_domains.items()):
        raise FulgorValidationError(FulgorErrorCode.DOMAIN_OWNER_MISMATCH, "invalid operation association")
    values = list(contract_domains.values()) + list(operation_domains.values())
    if len(values) != len(set(values)):
        raise FulgorValidationError(FulgorErrorCode.UNREGISTERED_DOMAIN, "duplicate domain tag")
    terminated = [value.encode("utf-8") + b"\x00" for value in values]
    for index, left in enumerate(terminated):
        for right in terminated[index + 1 :]:
            if left.startswith(right) or right.startswith(left):
                raise FulgorValidationError(
                    FulgorErrorCode.UNREGISTERED_DOMAIN, "terminal-NUL-complete prefix collision"
                )
    if require_frozen_associations and (
        dict(contract_domains) != _CONTRACT_DOMAINS or dict(operation_domains) != _OPERATION_DOMAINS
    ):
        raise FulgorValidationError(
            FulgorErrorCode.DOMAIN_OWNER_MISMATCH, "domain owner/primitive association differs from V2.3.8"
        )


def assert_registry_integrity(used_domain_tags: set[str] | frozenset[str] | None = None) -> None:
    validate_domain_registry(CONTRACT_DOMAINS, OPERATION_DOMAINS)
    if used_domain_tags is not None and frozenset(used_domain_tags) != REGISTERED_DOMAIN_TAGS:
        missing = REGISTERED_DOMAIN_TAGS - frozenset(used_domain_tags)
        unknown = frozenset(used_domain_tags) - REGISTERED_DOMAIN_TAGS
        raise FulgorValidationError(
            FulgorErrorCode.UNREGISTERED_DOMAIN,
            f"domain use/registry mismatch; missing={sorted(missing)}, unknown={sorted(unknown)}",
        )


def assert_phase0_domain_usage() -> None:
    expected_formula_owners = {"contract_digest", "signature_input"}
    if set(PHASE0_FORMULA_DOMAIN_USES) != expected_formula_owners:
        raise FulgorValidationError(
            FulgorErrorCode.DOMAIN_OWNER_MISMATCH,
            "Phase 0 formula owner manifest differs from the implemented security formulas",
        )
    if PHASE0_FORMULA_DOMAIN_USES["contract_digest"] != frozenset(CONTRACT_DOMAINS.values()):
        raise FulgorValidationError(
            FulgorErrorCode.DOMAIN_OWNER_MISMATCH,
            "contract_digest domain family differs from the frozen contract registry",
        )
    if PHASE0_FORMULA_DOMAIN_USES["signature_input"] != frozenset(
        {OPERATION_DOMAINS["signature"]}
    ):
        raise FulgorValidationError(
            FulgorErrorCode.DOMAIN_OWNER_MISMATCH,
            "signature_input domain differs from the frozen operation registry",
        )
    derived = _derive_used_domain_tags(PHASE0_FORMULA_DOMAIN_USES)
    if PHASE0_USED_DOMAIN_TAGS != derived:
        raise FulgorValidationError(
            FulgorErrorCode.UNREGISTERED_DOMAIN,
            "Phase 0 used-domain set is not derived from the formula owner manifest",
        )
    if PHASE0_USED_DOMAIN_TAGS != PHASE0_REGISTERED_DOMAIN_TAGS:
        raise FulgorValidationError(
            FulgorErrorCode.UNREGISTERED_DOMAIN, "Phase 0 used-domain set differs from its registered set"
        )
    if not PHASE0_USED_DOMAIN_TAGS <= REGISTERED_DOMAIN_TAGS:
        raise FulgorValidationError(FulgorErrorCode.UNREGISTERED_DOMAIN, "Phase 0 uses an unknown tag")
