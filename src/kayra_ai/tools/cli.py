from __future__ import annotations

import argparse
import unicodedata
from collections.abc import Callable, Sequence
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pydantic import ValidationError

from .approval import ToolApprovalError, ToolApprovalGate
from .commands import GitReadOnlyCommandPolicy, ReadOnlyCommandExecutor
from .contracts import (
    ListDirectoryRequest,
    ListDirectoryResult,
    ReadOnlyCommandRequest,
    ReadOnlyCommandResult,
    ReadTextRequest,
    ReadTextResult,
    StatPathRequest,
    StatPathResult,
    ToolAuthorization,
    ToolRequest,
    build_tool_preview,
)
from .filesystem import ReadOnlyFilesystem
from .policy import ReadOnlyPathPolicy, ToolPolicyError


InputFn = Callable[[str], str]
Clock = Callable[[], datetime]


def terminal_safe(value: str) -> str:
    """Escape terminal control and formatting characters in untrusted output."""

    parts: list[str] = []
    for character in value:
        if character in {"\n", "\t"}:
            parts.append(character)
            continue
        if unicodedata.category(character).startswith("C"):
            codepoint = ord(character)
            escape = f"\\u{codepoint:04x}" if codepoint <= 0xFFFF else f"\\U{codepoint:08x}"
            parts.append(escape)
            continue
        parts.append(character)
    return "".join(parts)


def _confirm(input_fn: InputFn, digest: str) -> bool:
    prompt = (
        "Bu salt-okunur arac istegini calistirmak icin EVET yaz.\n"
        f"Istek SHA256: {digest}\nOnay: "
    )
    return input_fn(prompt).strip() == "EVET"


def _authorization(preview_digest: str, *, clock: Clock) -> ToolAuthorization:
    confirmed_at = clock()
    return ToolAuthorization(
        confirmed_by_user=True,
        request_digest=preview_digest,
        confirmed_at=confirmed_at,
        expires_at=confirmed_at + timedelta(minutes=1),
    )


def _file_request(args: argparse.Namespace, policy: ReadOnlyPathPolicy) -> ToolRequest:
    if args.command == "list":
        request: ListDirectoryRequest | StatPathRequest | ReadTextRequest = (
            ListDirectoryRequest(
                path=args.path,
                purpose="CLI kullanicisi tarafindan istenen yerel dizin listeleme",
                max_entries=args.max_entries,
            )
        )
    elif args.command == "stat":
        request = StatPathRequest(
            path=args.path,
            purpose="CLI kullanicisi tarafindan istenen yerel metadata okuma",
        )
    elif args.command == "read":
        request = ReadTextRequest(
            path=args.path,
            purpose="CLI kullanicisi tarafindan istenen yerel metin okuma",
            max_chars=args.max_chars,
        )
    else:
        raise ValueError("bilinmeyen dosya komutu")

    canonical_path = policy.resolve(request.path)
    return request.model_copy(update={"path": str(canonical_path)})


def _git_request(args: argparse.Namespace, root: Path) -> ReadOnlyCommandRequest:
    if args.command == "git-status":
        argv = ["git", "status", "--short", "--branch"]
        if args.tracked_only:
            argv.append("--untracked-files=no")
    elif args.command == "git-diff-check":
        argv = ["git", "diff"]
        if args.cached:
            argv.append("--cached")
        argv.append("--check")
    elif args.command == "git-diff-names":
        argv = ["git", "diff"]
        if args.cached:
            argv.append("--cached")
        argv.append("--name-status")
    elif args.command == "git-head":
        argv = ["git", "show", "-s", "--format=%H%n%s", "HEAD"]
    elif args.command == "git-ls-files":
        argv = ["git", "ls-files"]
    else:
        raise ValueError("bilinmeyen Git komutu")
    return ReadOnlyCommandRequest(
        argv=tuple(argv),
        cwd=str(root),
        purpose="CLI kullanicisi tarafindan istenen salt-okunur Git sorgusu",
        timeout_seconds=args.timeout_seconds,
        max_output_chars=args.max_output_chars,
    )


def _show_preview(request: ToolRequest) -> str:
    if isinstance(request, ReadOnlyCommandRequest):
        summary = f"Git sorgusu: {' '.join(request.argv)} | cwd={request.cwd}"
    else:
        summary = f"Dosya sorgusu: {request.tool} | path={request.path}"
    preview = build_tool_preview(request, summary=summary)
    print("ARAC ONIZLEMESI")
    print("Etki: SALT-OKUNUR")
    print(f"Ozet: {terminal_safe(preview.summary)}")
    print(f"Istek SHA256: {preview.request_digest}")
    print(terminal_safe(preview.request.model_dump_json(indent=2)))
    return preview.request_digest


def _print_result(
    result: ListDirectoryResult | StatPathResult | ReadTextResult | ReadOnlyCommandResult,
) -> int:
    if isinstance(result, ListDirectoryResult):
        print(f"OK: dizin listelendi: {terminal_safe(result.path)}")
        for entry in result.entries:
            print(f"{entry.kind}\t{entry.size_bytes}\t{terminal_safe(entry.name)}")
        if result.truncated:
            print("UYARI: dizin sonucu sinir nedeniyle kesildi")
        return 0
    if isinstance(result, StatPathResult):
        print(
            f"OK: {result.kind} | {result.size_bytes} byte | "
            f"{terminal_safe(result.path)}"
        )
        return 0
    if isinstance(result, ReadTextResult):
        print(
            f"OK: metin okundu: {terminal_safe(result.path)} | "
            f"{result.size_bytes} byte"
        )
        print(terminal_safe(result.text))
        if result.truncated:
            print("UYARI: metin sonucu karakter siniri nedeniyle kesildi")
        return 0

    print(f"OK: komut tamamlandi | returncode={result.returncode}")
    if result.stdout:
        print("STDOUT:")
        print(terminal_safe(result.stdout), end="" if result.stdout.endswith("\n") else "\n")
    if result.stderr:
        print("STDERR:")
        print(terminal_safe(result.stderr), end="" if result.stderr.endswith("\n") else "\n")
    if result.stdout_truncated or result.stderr_truncated:
        print("UYARI: komut ciktisi sinir nedeniyle kesildi")
    if result.timed_out:
        print("HATA: komut zaman asimina ugradi")
        return 1
    return 0 if result.returncode == 0 else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="KayraAI kullanici onayli salt-okunur yerel araclari"
    )
    parser.add_argument("--root", type=Path, required=True, help="Acikca izin verilen kok")
    parser.add_argument("--max-file-bytes", type=int, default=1_000_000)
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="Dizini recursive olmadan listele")
    list_parser.add_argument("path")
    list_parser.add_argument("--max-entries", type=int, default=200)

    stat_parser = subparsers.add_parser("stat", help="Dosya veya dizin metadata oku")
    stat_parser.add_argument("path")

    read_parser = subparsers.add_parser("read", help="Sinirli UTF-8 metin oku")
    read_parser.add_argument("path")
    read_parser.add_argument("--max-chars", type=int, default=65536)

    status_parser = subparsers.add_parser("git-status", help="Git durumunu oku")
    status_parser.add_argument("--tracked-only", action="store_true")

    for name, help_text in (
        ("git-diff-check", "Git whitespace hatalarini oku"),
        ("git-diff-names", "Degisen dosya adlarini oku"),
    ):
        git_parser = subparsers.add_parser(name, help=help_text)
        git_parser.add_argument("--cached", action="store_true")

    subparsers.add_parser("git-head", help="HEAD kimligi ve mesajini oku")
    subparsers.add_parser("git-ls-files", help="Takip edilen dosya adlarini oku")

    for git_parser_name in (
        "git-status",
        "git-diff-check",
        "git-diff-names",
        "git-head",
        "git-ls-files",
    ):
        selected = subparsers.choices[git_parser_name]
        selected.add_argument("--timeout-seconds", type=float, default=10.0)
        selected.add_argument("--max-output-chars", type=int, default=65536)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    input_fn: InputFn = input,
    clock: Clock | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    current_clock = clock or (lambda: datetime.now(timezone.utc))
    try:
        configured_root = args.root.expanduser()
        path_policy = ReadOnlyPathPolicy(
            (configured_root,),
            max_file_bytes=args.max_file_bytes,
        )
        root = path_policy.allowed_roots[0]
        if args.command in {"list", "stat", "read"}:
            request = _file_request(args, path_policy)
            executor = ReadOnlyFilesystem(path_policy, ToolApprovalGate(clock=current_clock))
        else:
            request = _git_request(args, root)
            command_policy = GitReadOnlyCommandPolicy(path_policy)
            command_policy.prepare(request)
            executor = ReadOnlyCommandExecutor(
                command_policy,
                ToolApprovalGate(clock=current_clock),
            )

        digest = _show_preview(request)
        if not _confirm(input_fn, digest):
            print("IPTAL: arac calistirilmadi")
            return 2
        result = executor.execute(
            request,
            _authorization(digest, clock=current_clock),
        )
        return _print_result(result)
    except (
        OSError,
        ToolApprovalError,
        ToolPolicyError,
        ValidationError,
        ValueError,
    ) as exc:
        print(f"HATA: {terminal_safe(str(exc))}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
