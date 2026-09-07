from typing import Protocol
from .schemas import ExecutionResult, SerializedPatchV1

class ExecutionAdapter(Protocol):
    """Future sandbox boundary; architecture tests provide only fakes."""
    def execute(self, patch: SerializedPatchV1) -> ExecutionResult: ...
