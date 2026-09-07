from dataclasses import dataclass
from typing import Iterable, Union
from .schemas import DiffStats, NoPrimary, VerifierScoreV1

@dataclass(frozen=True)
class SelectableCandidate:
    score: VerifierScoreV1
    stats: DiffStats

def select_primary(candidates: Iterable[SelectableCandidate]) -> Union[SelectableCandidate, NoPrimary]:
    items = tuple(candidates)
    if not items:
        return NoPrimary(("NO_GATE_SURVIVORS",))
    return min(items, key=lambda item: (-item.score.aggregate_score,
        -item.score.pass_to_pass_safety, -item.score.minimality,
        item.stats.changed_lines, item.stats.files_changed, item.score.candidate_id))
