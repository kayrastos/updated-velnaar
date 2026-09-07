from dataclasses import dataclass
from typing import Callable, Tuple
from .constants import CANDIDATE_BUDGET
from .schemas import SemanticPatchV1

SLOTS = ("A:minimal_direct", "B:alternative_local", "C:causal_challenge")

@dataclass(frozen=True)
class CandidateBatch:
    candidates: Tuple[SemanticPatchV1, ...]
    def __post_init__(self) -> None:
        if len(self.candidates) != CANDIDATE_BUDGET:
            raise ValueError(f"exactly {CANDIDATE_BUDGET} candidate slots are required")
        if len({x.candidate_id for x in self.candidates}) != CANDIDATE_BUDGET:
            raise ValueError("candidate IDs must be unique")

def generate_fixed_slots(generate: Callable[[str, int], SemanticPatchV1]) -> CandidateBatch:
    """One call per frozen slot; failures are never replacement-sampled."""
    return CandidateBatch(tuple(generate(directive, index) for index, directive in enumerate(SLOTS)))
