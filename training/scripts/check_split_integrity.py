#!/usr/bin/env python3

import hashlib
import json
import re
import sys
from pathlib import Path


def normalize(text: str) -> str:
    text = text.casefold()
    text = re.sub(r"\s+", " ", text).strip()
    return text


def digest(text: str) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


def load_jsonl(path: Path):
    records = []

    if not path.exists():
        raise FileNotFoundError(path)

    with path.open("r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f, 1):
            line = raw.strip()
            if not line:
                continue

            item = json.loads(line)
            records.append((line_no, item))

    return records


def conversation_signature(item):
    parts = []

    for msg in item.get("messages", []):
        role = msg.get("role", "")
        content = msg.get("content", "")
        parts.append(f"{role}:{normalize(content)}")

    return digest("\n".join(parts))


def user_prompt_signatures(item):
    signatures = []

    for msg in item.get("messages", []):
        if msg.get("role") == "user":
            signatures.append(digest(msg.get("content", "")))

    return signatures


def main():
    if len(sys.argv) != 3:
        print(
            "Kullanım: python3 check_split_integrity.py "
            "<train.jsonl> <eval.jsonl>"
        )
        sys.exit(2)

    train_path = Path(sys.argv[1])
    eval_path = Path(sys.argv[2])

    train = load_jsonl(train_path)
    eval_set = load_jsonl(eval_path)

    errors = []

    train_ids = {}
    train_conversations = {}
    train_user_prompts = {}

    for line_no, item in train:
        record_id = item.get("id")

        if record_id:
            train_ids[record_id] = line_no

        sig = conversation_signature(item)
        train_conversations.setdefault(sig, []).append(line_no)

        for prompt_sig in user_prompt_signatures(item):
            train_user_prompts.setdefault(prompt_sig, []).append(line_no)

    # Train içinde tam konuşma tekrarları
    for sig, lines in train_conversations.items():
        if len(lines) > 1:
            errors.append(
                f"TRAIN duplicate conversation: satırlar {lines}"
            )

    # Eval -> train sızıntısı
    for eval_line, item in eval_set:
        record_id = item.get("id")

        if record_id in train_ids:
            errors.append(
                f"ID leakage: eval satır {eval_line}, "
                f"train satır {train_ids[record_id]}: {record_id}"
            )

        conv_sig = conversation_signature(item)

        if conv_sig in train_conversations:
            errors.append(
                f"Exact conversation leakage: eval satır {eval_line}, "
                f"train satır(lar) {train_conversations[conv_sig]}"
            )

        for prompt_sig in user_prompt_signatures(item):
            if prompt_sig in train_user_prompts:
                errors.append(
                    f"User prompt leakage: eval satır {eval_line}, "
                    f"train satır(lar) {train_user_prompts[prompt_sig]}"
                )

    print(f"Train kayıtları: {len(train)}")
    print(f"Eval kayıtları:  {len(eval_set)}")

    if errors:
        print(f"HATA: {len(errors)} integrity sorunu bulundu:")
        for error in errors:
            print(f" - {error}")
        sys.exit(1)

    print("SPLIT INTEGRITY OK")


if __name__ == "__main__":
    main()
