from __future__ import annotations

import argparse
from pathlib import Path

from .common import ValidationIssue, iter_jsonl


def validate_jsonl(path: Path) -> int:
    count = sum(1 for _ in iter_jsonl(path))
    if count == 0:
        raise ValidationIssue(f"{path}: en az bir kayıt gerekli")
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="JSONL sözdizimini çevrimdışı doğrula")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        count = validate_jsonl(args.path)
    except (OSError, ValidationIssue) as exc:
        print(f"HATA: {exc}")
        return 1
    print(f"OK: {args.path} ({count} kayıt)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

