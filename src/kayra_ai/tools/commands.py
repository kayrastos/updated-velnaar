from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

from .approval import ToolApprovalGate
from .contracts import ReadOnlyCommandRequest, ReadOnlyCommandResult, ToolAuthorization
from .policy import ReadOnlyPathPolicy, ToolPolicyError


@dataclass(frozen=True)
class PreparedCommand:
    argv: tuple[str, ...]
    cwd: Path
    environment: dict[str, str]


class GitReadOnlyCommandPolicy:
    """Allow only a small set of exact, reviewed Git inspection commands."""

    ALLOWED_ARGV = frozenset(
        {
            ("git", "status", "--short"),
            ("git", "status", "--short", "--branch"),
            ("git", "status", "--short", "--branch", "--untracked-files=no"),
            ("git", "diff", "--check"),
            ("git", "diff", "--cached", "--check"),
            ("git", "diff", "--name-status"),
            ("git", "diff", "--cached", "--name-status"),
            ("git", "show", "-s", "--format=%H%n%s", "HEAD"),
            ("git", "ls-files"),
        }
    )

    def __init__(
        self,
        path_policy: ReadOnlyPathPolicy,
        *,
        git_executable: str | Path | None = None,
    ) -> None:
        self.path_policy = path_policy
        discovered = str(git_executable) if git_executable is not None else shutil.which("git")
        if discovered is None:
            raise ValueError("git executable bulunamadi")
        executable = Path(discovered).expanduser().resolve(strict=True)
        if not executable.is_file():
            raise ValueError("git executable normal bir dosya olmali")
        self.git_executable = executable

    def prepare(self, request: ReadOnlyCommandRequest) -> PreparedCommand:
        if request.argv not in self.ALLOWED_ARGV:
            raise ToolPolicyError("komut veya argumanlar salt-okunur allowlist icinde degil")

        cwd = self.path_policy.resolve(request.cwd)
        if not cwd.is_dir():
            raise ToolPolicyError("komut calisma yolu bir dizin olmali")

        requested = list(request.argv[1:])
        subcommand = requested[0]
        arguments = requested[1:]
        effective: list[str] = [
            str(self.git_executable),
            "--no-pager",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "color.ui=false",
            subcommand,
        ]
        if subcommand in {"diff", "show"}:
            effective.extend(("--no-ext-diff", "--no-textconv", "--no-color"))
        effective.extend(arguments)

        environment = {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_PAGER": "cat",
            "GIT_TERMINAL_PROMPT": "0",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PAGER": "cat",
            "PATH": str(self.git_executable.parent),
        }
        return PreparedCommand(tuple(effective), cwd, environment)


class ReadOnlyCommandExecutor:
    def __init__(
        self,
        policy: GitReadOnlyCommandPolicy,
        approval_gate: ToolApprovalGate,
    ) -> None:
        self.policy = policy
        self.approval_gate = approval_gate

    def execute(
        self,
        request: ReadOnlyCommandRequest,
        authorization: ToolAuthorization | None,
    ) -> ReadOnlyCommandResult:
        prepared = self.policy.prepare(request)
        self.approval_gate.require(request, authorization)
        started = perf_counter()

        with tempfile.TemporaryFile() as stdout_file, tempfile.TemporaryFile() as stderr_file:
            try:
                completed = subprocess.run(
                    prepared.argv,
                    cwd=prepared.cwd,
                    env=prepared.environment,
                    stdin=subprocess.DEVNULL,
                    stdout=stdout_file,
                    stderr=stderr_file,
                    timeout=request.timeout_seconds,
                    check=False,
                    shell=False,
                )
                returncode: int | None = completed.returncode
                timed_out = False
            except subprocess.TimeoutExpired:
                returncode = None
                timed_out = True
            except OSError as exc:
                raise ToolPolicyError("salt-okunur komut baslatilamadi") from exc

            stdout, stdout_truncated = self._read_limited(
                stdout_file,
                request.max_output_chars,
            )
            stderr, stderr_truncated = self._read_limited(
                stderr_file,
                request.max_output_chars,
            )

        return ReadOnlyCommandResult(
            request_id=request.request_id,
            argv=request.argv,
            cwd=str(prepared.cwd),
            returncode=returncode,
            stdout=stdout,
            stderr=stderr,
            stdout_truncated=stdout_truncated,
            stderr_truncated=stderr_truncated,
            timed_out=timed_out,
            duration_ms=(perf_counter() - started) * 1000,
        )

    @staticmethod
    def _read_limited(handle, limit: int) -> tuple[str, bool]:  # type: ignore[no-untyped-def]
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        handle.seek(0)
        data = handle.read(limit)
        return data.decode("utf-8", errors="replace"), size > len(data)
