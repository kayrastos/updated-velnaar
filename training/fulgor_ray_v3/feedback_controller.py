from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional
from .schemas import ExecutionResult, FailureOrigin, SerializedPatchV1
from .execution_adapter import ExecutionAdapter

class FeedbackState(str, Enum):
    READY = "ready"
    FIRST_COMPLETE = "first_complete"
    TERMINAL = "terminal"

@dataclass(frozen=True)
class FeedbackEvidence:
    patch_applied: bool
    failing_test_ids: tuple[str, ...]
    bounded_messages: tuple[str, ...]

@dataclass
class FeedbackController:
    state: FeedbackState = FeedbackState.READY
    refinement_count: int = 0

    def run_first(self, adapter: ExecutionAdapter, patch: SerializedPatchV1) -> ExecutionResult:
        if self.state is not FeedbackState.READY:
            raise RuntimeError("first execution is available exactly once")
        result = adapter.execute(patch)
        self.state = FeedbackState.TERMINAL if result.resolved or result.failure_origin is FailureOrigin.INFRASTRUCTURE else FeedbackState.FIRST_COMPLETE
        return result

    def refine_once(self, adapter: ExecutionAdapter, first: ExecutionResult,
                    build: Callable[[FeedbackEvidence], SerializedPatchV1]) -> ExecutionResult:
        if self.state is not FeedbackState.FIRST_COMPLETE or self.refinement_count != 0:
            raise RuntimeError("feedback refinement budget exhausted or unavailable")
        self.refinement_count = 1
        self.state = FeedbackState.TERMINAL
        evidence = FeedbackEvidence(first.patch_applied, first.failing_test_ids, first.bounded_messages)
        return adapter.execute(build(evidence))
