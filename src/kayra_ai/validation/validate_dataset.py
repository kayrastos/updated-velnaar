from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .common import ValidationIssue, iter_jsonl, normalized_text, prompt_text, sha256_for
from .models import DATASET_MODELS


def semantic_content(kind: str, record: dict[str, Any]) -> Any:
    if kind == "sft":
        return record.get("messages")
    if kind == "preference":
        return {
            "prompt_messages": record.get("prompt_messages"),
            "chosen": record.get("chosen"),
            "rejected": record.get("rejected"),
        }
    return None


def validate_dataset(path: Path, kind: str, check_hash: bool = True) -> int:
    model = DATASET_MODELS[kind]
    seen_ids: dict[str, int] = {}
    seen_prompts: dict[str, tuple[str, int]] = {}
    count = 0

    for line_number, record in iter_jsonl(path):
        try:
            validated = model.model_validate(record)
        except ValidationError as exc:
            details = "; ".join(
                f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
                for error in exc.errors()
            )
            raise ValidationIssue(f"{path}:{line_number}: {details}") from exc

        if kind == "run-result":
            record_id = str(validated.result_id)
        else:
            record_id = str(validated.id)
        if record_id in seen_ids:
            raise ValidationIssue(
                f"{path}:{line_number}: yinelenen id {record_id!r}; ilk satır {seen_ids[record_id]}"
            )
        seen_ids[record_id] = line_number

        normalized_prompt = normalized_text(prompt_text(record))
        if normalized_prompt and normalized_prompt in seen_prompts:
            previous_id, previous_line = seen_prompts[normalized_prompt]
            raise ValidationIssue(
                f"{path}:{line_number}: yinelenen prompt; {previous_id!r} satır {previous_line}"
            )
        if normalized_prompt:
            seen_prompts[normalized_prompt] = (record_id, line_number)

        if check_hash and kind in {"sft", "preference"}:
            expected = sha256_for(semantic_content(kind, record))
            if record.get("content_sha256") != expected:
                raise ValidationIssue(
                    f"{path}:{line_number}: content_sha256 semantik içerikle eşleşmiyor"
                )
        count += 1

    if count == 0:
        raise ValidationIssue(f"{path}: en az bir kayıt gerekli")
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Fulgor AI veri setini çevrimdışı doğrula")
    parser.add_argument("path", type=Path)
    parser.add_argument("--kind", required=True, choices=sorted(DATASET_MODELS))
    parser.add_argument("--skip-hash", action="store_true", help="SFT/preference hash kontrolünü atla")
    args = parser.parse_args()
    try:
        count = validate_dataset(args.path, args.kind, check_hash=not args.skip_hash)
    except (OSError, ValidationIssue) as exc:
        print(f"HATA: {exc}")
        return 1
    print(f"OK: {args.path} ({count} {args.kind} kaydı)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
