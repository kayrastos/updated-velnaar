#!/usr/bin/env python3

import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path


def normalize(text):
    text = text.casefold()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def words(text):
    return set(normalize(text).split())


def similarity(a, b):
    na = normalize(a)
    nb = normalize(b)

    sequence = SequenceMatcher(None, na, nb).ratio()

    wa = words(a)
    wb = words(b)

    union = wa | wb
    jaccard = len(wa & wb) / len(union) if union else 0.0

    return sequence, jaccard


def load(path):
    records = []
    with Path(path).open("r", encoding="utf-8") as f:
        for raw in f:
            if raw.strip():
                records.append(json.loads(raw))
    return records


def user_text(record):
    return "\n".join(
        m.get("content", "")
        for m in record.get("messages", [])
        if m.get("role") == "user"
    )


if len(sys.argv) != 3:
    print(
        "Kullanım: python3 check_near_leakage.py "
        "<train.jsonl> <eval.jsonl>"
    )
    sys.exit(2)

train = load(sys.argv[1])
eval_set = load(sys.argv[2])

warnings = []
critical = []

for tr in train:
    tr_text = user_text(tr)

    for ev in eval_set:
        ev_text = user_text(ev)

        seq, jac = similarity(tr_text, ev_text)

        item = {
            "train": tr.get("id"),
            "eval": ev.get("id"),
            "sequence": round(seq, 3),
            "jaccard": round(jac, 3),
        }

        # Çok yüksek benzerlik: olası eval contamination.
        if seq >= 0.90 or jac >= 0.85:
            critical.append(item)

        # Daha düşük eşik yalnızca gözden geçirmek için uyarı.
        elif seq >= 0.78 or jac >= 0.70:
            warnings.append(item)

print(f"Train: {len(train)}")
print(f"Eval:  {len(eval_set)}")

if warnings:
    print("\nİNCELEME UYARILARI:")
    for x in warnings:
        print(
            f"  {x['train']} <-> {x['eval']} | "
            f"seq={x['sequence']} jac={x['jaccard']}"
        )
else:
    print("\nOrta-yüksek benzerlik uyarısı yok.")

if critical:
    print("\nKRİTİK YAKIN-SIZINTI:")
    for x in critical:
        print(
            f"  {x['train']} <-> {x['eval']} | "
            f"seq={x['sequence']} jac={x['jaccard']}"
        )

    sys.exit(1)

print("\nNEAR-LEAKAGE CHECK OK")
