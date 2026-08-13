from __future__ import annotations

import argparse
import getpass
from pathlib import Path
from typing import Callable, Sequence

from pydantic import ValidationError

from .contracts import MemoryDraft, MemoryQuery, WriteAuthorization
from .retrieval import LexicalMemoryRetriever
from .store import (
    MemoryAuthorizationError,
    MemoryDecryptionError,
    MemoryStore,
    UnencryptedMemoryDatabaseError,
    UnsafeMemoryPathError,
    default_memory_db_path,
)


InputFn = Callable[[str], str]
PasswordFn = Callable[[str], str]


def _repository_root(start: Path) -> Path | None:
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists() and (candidate / "pyproject.toml").is_file():
            return candidate
    return None


def _read_passphrase(
    db_path: Path,
    *,
    password_fn: PasswordFn,
) -> str:
    passphrase = password_fn("Hafiza parolasi: ")
    if not db_path.exists():
        confirmation = password_fn("Yeni hafiza parolasini tekrar gir: ")
        if passphrase != confirmation:
            raise ValueError("hafiza parolalari eslesmiyor")
    return passphrase


def _open_store(
    db_path: Path,
    *,
    password_fn: PasswordFn,
    working_directory: Path,
) -> MemoryStore:
    passphrase = _read_passphrase(db_path, password_fn=password_fn)
    return MemoryStore(
        db_path,
        passphrase=passphrase,
        repository_root=_repository_root(working_directory),
    )


def _confirm(input_fn: InputFn, prompt: str) -> bool:
    return input_fn(f"{prompt}\nOnaylamak icin EVET yaz: ").strip() == "EVET"


def _add(
    args: argparse.Namespace,
    store: MemoryStore,
    *,
    input_fn: InputFn,
) -> int:
    content = input_fn("Hafizaya kaydedilecek metin: ").strip()
    tags = tuple(tag.strip() for tag in args.tags.split(",") if tag.strip())
    draft = MemoryDraft(
        content=content,
        kind=args.kind,
        sensitivity=args.sensitivity,
        source=args.source,
        tags=tags,
    )
    preview = content if len(content) <= 160 else content[:157] + "..."
    if not _confirm(
        input_fn,
        "Kalici ve sifreli hafizaya su kayit eklenecek:\n"
        f"Tur: {draft.kind} | Hassasiyet: {draft.sensitivity}\n"
        f"Metin: {preview}",
    ):
        print("IPTAL: hafizaya kayit eklenmedi")
        return 2
    record = store.add(
        draft,
        authorization=WriteAuthorization(
            confirmed_by_user=True,
            purpose="CLI uzerinden kullanici tarafindan acikca onaylanan hafiza kaydi",
        ),
    )
    print(f"OK: sifreli hafiza kaydi eklendi: {record.id}")
    return 0


def _search(
    args: argparse.Namespace,
    store: MemoryStore,
    *,
    input_fn: InputFn,
) -> int:
    query_text = input_fn("Hafizada aranacak ifade: ").strip()
    results = LexicalMemoryRetriever(store).search(
        MemoryQuery(text=query_text, top_k=args.top_k)
    )
    if not results:
        print("SONUC: ilgili aktif hafiza kaydi bulunamadi")
        return 0
    for index, item in enumerate(results, 1):
        record = item.record
        print(
            f"[{index}] {record.id} | {record.kind} | skor={item.score:.2f}\n"
            f"Kaynak: {record.source}\nMetin: {record.content}"
        )
    return 0


def _delete(
    args: argparse.Namespace,
    store: MemoryStore,
    *,
    input_fn: InputFn,
) -> int:
    if not _confirm(input_fn, f"Hafiza kaydi silinecek: {args.memory_id}"):
        print("IPTAL: hafiza kaydi silinmedi")
        return 2
    deleted = store.soft_delete(
        args.memory_id,
        authorization=WriteAuthorization(
            confirmed_by_user=True,
            purpose="CLI uzerinden kullanici tarafindan acikca onaylanan hafiza silme",
        ),
    )
    if not deleted:
        print("HATA: aktif hafiza kaydi bulunamadi")
        return 1
    print(f"OK: hafiza kaydi silindi: {args.memory_id}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="KayraAI sifreli yerel hafiza yonetimi"
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=default_memory_db_path(),
        help="Git disindaki sifreli SQLite veritabani yolu",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    add_parser = subparsers.add_parser("add", help="Acik onayla hafiza ekle")
    add_parser.add_argument(
        "--kind", choices=("fact", "preference", "project", "note"), required=True
    )
    add_parser.add_argument(
        "--sensitivity", choices=("private", "sensitive"), default="private"
    )
    add_parser.add_argument("--source", default="user-explicit")
    add_parser.add_argument("--tags", default="")

    search_parser = subparsers.add_parser("search", help="Hafizada yerel arama yap")
    search_parser.add_argument("--top-k", type=int, default=5, choices=range(1, 21))

    delete_parser = subparsers.add_parser("delete", help="Acik onayla hafiza sil")
    delete_parser.add_argument("memory_id")
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    input_fn: InputFn = input,
    password_fn: PasswordFn = getpass.getpass,
    working_directory: Path | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    db_path = args.db.expanduser().resolve()
    try:
        store = _open_store(
            db_path,
            password_fn=password_fn,
            working_directory=working_directory or Path.cwd(),
        )
        if args.command == "add":
            return _add(args, store, input_fn=input_fn)
        if args.command == "search":
            return _search(args, store, input_fn=input_fn)
        if args.command == "delete":
            return _delete(args, store, input_fn=input_fn)
        parser.error("bilinmeyen komut")
    except (
        MemoryAuthorizationError,
        MemoryDecryptionError,
        UnencryptedMemoryDatabaseError,
        UnsafeMemoryPathError,
        ValidationError,
        OSError,
        ValueError,
    ) as exc:
        print(f"HATA: {exc}")
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
