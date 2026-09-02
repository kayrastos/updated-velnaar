#!/usr/bin/env python3

import json
import statistics
from collections import Counter
from pathlib import Path

TRAIN = Path("training/data/curated/sft_v1.jsonl")
REPORT = Path("training/reports/dataset_quality_v1.json")


def load_jsonl(path):
    records = []
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if raw:
                records.append(json.loads(raw))
    return records


def get_text(record, role):
    return "\n".join(
        m.get("content", "")
        for m in record.get("messages", [])
        if m.get("role") == role
    ).strip()


records = load_jsonl(TRAIN)

categories = Counter()
user_lengths = []
assistant_lengths = []
assistant_openings = Counter()

for r in records:
    categories[r.get("category", "unknown")] += 1

    user = get_text(r, "user")
    assistant = get_text(r, "assistant")

    user_lengths.append(len(user.split()))
    assistant_lengths.append(len(assistant.split()))

    words = assistant.casefold().split()
    if words:
        opening = " ".join(words[:4])
        assistant_openings[opening] += 1

repeated_openings = {
    text: count
    for text, count in assistant_openings.items()
    if count >= 3
}

report = {
    "total_records": len(records),
    "category_counts": dict(sorted(categories.items())),
    "user_words": {
        "min": min(user_lengths) if user_lengths else 0,
        "max": max(user_lengths) if user_lengths else 0,
        "mean": round(statistics.mean(user_lengths), 2)
            if user_lengths else 0,
        "median": statistics.median(user_lengths)
            if user_lengths else 0,
    },
    "assistant_words": {
        "min": min(assistant_lengths) if assistant_lengths else 0,
        "max": max(assistant_lengths) if assistant_lengths else 0,
        "mean": round(statistics.mean(assistant_lengths), 2)
            if assistant_lengths else 0,
        "median": statistics.median(assistant_lengths)
            if assistant_lengths else 0,
    },
    "repeated_assistant_openings_3plus": repeated_openings,
}

REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8"
)

print(f"Toplam kayıt: {len(records)}")
print("\nKategori dağılımı:")
for category, count in sorted(categories.items()):
    print(f"  {category:30} {count}")

print("\nUzunluklar:")
print(
    f"  User      ort={report['user_words']['mean']} "
    f"median={report['user_words']['median']} "
    f"min={report['user_words']['min']} "
    f"max={report['user_words']['max']}"
)
print(
    f"  Assistant ort={report['assistant_words']['mean']} "
    f"median={report['assistant_words']['median']} "
    f"min={report['assistant_words']['min']} "
    f"max={report['assistant_words']['max']}"
)

if repeated_openings:
    print("\nUYARI — 3+ kez kullanılan cevap başlangıçları:")
    for text, count in sorted(
        repeated_openings.items(),
        key=lambda x: -x[1]
    ):
        print(f"  {count}x: {text}")
else:
    print("\nTekrarlanan cevap başlangıcı sorunu yok.")

print(f"\nRapor: {REPORT}")
