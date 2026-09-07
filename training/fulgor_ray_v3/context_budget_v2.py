"""Deterministic prompt budgeting for independent post-A1 inference (V2).

Successor to context_budget.py (v1). Fixes the defect where apply_chat_template
returning a BatchEncoding caused len(BatchEncoding) to count mapping keys (2)
rather than actual token count.

Ensures that both context budgeting and generation preparation share the same
canonical tokenization primitive and token count calculation.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Callable, Generic, TypeVar


class ContextBudgetError(ValueError):
    """A prompt cannot fit without modifying immutable content."""


T = TypeVar("T")


@dataclass(frozen=True)
class ContextBudgetResult(Generic[T]):
    messages: list[dict]
    context: T
    metadata: dict
    tokenized_prompt: Any = None


def extract_input_ids(batch: Any) -> Any:
    """Extract input_ids from BatchEncoding, mapping, or tensor/list directly."""
    if hasattr(batch, "get") and "input_ids" in batch:
        return batch["input_ids"]
    if hasattr(batch, "input_ids"):
        return batch.input_ids
    return batch


def extract_token_count(batch: Any) -> int:
    """Derive token count explicitly from input_ids shape or length.

    NEVER uses len(batch) if batch is a BatchEncoding or mapping.
    """
    input_ids = extract_input_ids(batch)
    if hasattr(input_ids, "shape"):
        return int(input_ids.shape[-1])
    if isinstance(input_ids, (list, tuple)):
        if input_ids and isinstance(input_ids[0], (list, tuple)):
            return len(input_ids[0])
        return len(input_ids)
    raise TypeError(f"cannot extract token count from {type(batch).__name__}")


def hash_token_ids(batch_or_ids: Any) -> str:
    """Return deterministic SHA256 of the token ID sequence."""
    input_ids = extract_input_ids(batch_or_ids)
    if hasattr(input_ids, "tolist"):
        raw = input_ids.tolist()
    elif isinstance(input_ids, (list, tuple)):
        raw = list(input_ids)
    else:
        raw = list(input_ids)
    while raw and isinstance(raw[0], (list, tuple)):
        raw = [item for sub in raw for item in sub]
    serialized = ",".join(str(int(x)) for x in raw)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def tokenize_chat_prompt(tokenizer, messages: list[dict]) -> tuple[Any, int, str]:
    """Canonical chat-tokenization helper for both budgeting and generation preparation.

    Uses production-equivalent arguments:
    - tokenize=True
    - add_generation_prompt=True
    - enable_thinking=False
    - return_tensors="pt"
    - return_dict=True

    Returns (batch, token_count, token_ids_sha256).
    """
    try:
        batch = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            enable_thinking=False,
            return_tensors="pt",
            return_dict=True,
        )
    except (TypeError, ValueError):
        # Fallback for mock/test tokenizers that do not accept return_tensors or return_dict
        batch = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            enable_thinking=False,
        )
    token_count = extract_token_count(batch)
    token_hash = hash_token_ids(batch)
    return batch, token_count, token_hash


def _prompt_tokens(tokenizer, messages: list[dict]) -> int:
    """Compute prompt token count using canonical tokenizer helper."""
    return tokenize_chat_prompt(tokenizer, messages)[1]


def fit_designated_context_v2(
    tokenizer,
    build_messages: Callable[[T], list[dict]],
    render_context: Callable[[int], T],
    *,
    full_context_units: int,
    reserved_generation_tokens: int,
    context_window_tokens: int = 8192,
) -> ContextBudgetResult[T]:
    """Fit the largest deterministic context rendering into a prompt.

    ``render_context(n)`` must be deterministic and monotonic in serialized
    size. A zero-unit rendering is tested first, ensuring immutable prompt
    content is never silently truncated. Binary search then selects the
    largest fitting rendering. Fresh metadata is constructed for every call.
    """
    if full_context_units < 0:
        raise ContextBudgetError("full_context_units must be nonnegative")
    if reserved_generation_tokens <= 0 or reserved_generation_tokens >= context_window_tokens:
        raise ContextBudgetError("invalid generation reserve")

    limit = context_window_tokens - reserved_generation_tokens
    empty_context = render_context(0)
    empty_messages = build_messages(empty_context)
    empty_batch, empty_tokens, empty_hash = tokenize_chat_prompt(tokenizer, empty_messages)
    if empty_tokens > limit:
        raise ContextBudgetError(
            f"immutable prompt requires {empty_tokens} tokens; limit is {limit}"
        )

    low, high = 0, full_context_units
    best_context, best_messages, best_tokens, best_batch, best_hash, best_units = (
        empty_context, empty_messages, empty_tokens, empty_batch, empty_hash, 0
    )
    while low <= high:
        middle = (low + high) // 2
        candidate_context = render_context(middle)
        candidate_messages = build_messages(candidate_context)
        candidate_batch, candidate_tokens, candidate_hash = tokenize_chat_prompt(
            tokenizer, candidate_messages
        )
        if candidate_tokens <= limit:
            best_context, best_messages, best_tokens = (
                candidate_context, candidate_messages, candidate_tokens
            )
            best_batch, best_hash, best_units = candidate_batch, candidate_hash, middle
            low = middle + 1
        else:
            high = middle - 1

    serialized = json.dumps(best_context, sort_keys=True, separators=(",", ":"), default=str)
    metadata = {
        "policy_version": "fulgor.context_budget.v2",
        "context_window_tokens": context_window_tokens,
        "reserved_generation_tokens": reserved_generation_tokens,
        "prompt_tokens": best_tokens,
        "available_generation_tokens": context_window_tokens - best_tokens,
        "requested_context_units": full_context_units,
        "included_context_units": best_units,
        "context_truncated": best_units < full_context_units,
        "rendered_context_sha256": hashlib.sha256(serialized.encode()).hexdigest(),
        "prompt_token_ids_sha256": best_hash,
    }
    return ContextBudgetResult(best_messages, best_context, metadata, tokenized_prompt=best_batch)


fit_designated_context = fit_designated_context_v2


def prefix_items(items: list[T], count: int) -> list[T]:
    """Return a deterministic prefix for inventories already in stable order."""
    if count < 0:
        raise ContextBudgetError("count must be nonnegative")
    return items[:count]


def prefix_text(text: str, utf8_bytes: int) -> str:
    """Return a valid UTF-8 prefix bounded in bytes, with no invented marker."""
    if utf8_bytes < 0:
        raise ContextBudgetError("utf8_bytes must be nonnegative")
    return text.encode("utf-8")[:utf8_bytes].decode("utf-8", errors="ignore")


def balanced_prefix_mapping(values: dict[str, str], utf8_bytes: int) -> dict[str, str]:
    """Share a byte allowance deterministically across sorted mapping entries."""
    if utf8_bytes < 0:
        raise ContextBudgetError("utf8_bytes must be nonnegative")
    keys = sorted(values)
    if not keys:
        return {}
    base, remainder = divmod(utf8_bytes, len(keys))
    return {
        key: prefix_text(values[key], base + (1 if index < remainder else 0))
        for index, key in enumerate(keys)
    }