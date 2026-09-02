#!/usr/bin/env python3

import json
import re
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

DATASET = Path("training/data/curated/sft_v1.jsonl")
REPORT = Path("training/reports/deep_dataset_audit_v1.json")

TARGETS = {
    "privacy": 25,
    "loyalty": 20,
    "instruction_following": 25,
    "turkish_quality": 20,
    "reasoning": 30,
    "uncertainty_and_factuality": 25,
    "tool_use": 20,
    "coding_and_technical": 15,
    "planning_and_analysis": 10,
    "style_and_behavior": 10,
}


def normalize(text):
    text = text.casefold()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tokens(text):
    return normalize(text).split()


def load_jsonl(path):
    records = []

    with path.open("r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f, 1):
            raw = raw.strip()
            if not raw:
                continue

            item = json.loads(raw)
            item["_line"] = line_no
            records.append(item)

    return records


def get_role_text(record, role):
    return "\n".join(
        m.get("content", "")
        for m in record.get("messages", [])
        if m.get("role") == role
    ).strip()


records = load_jsonl(DATASET)

category_counts = Counter(
    r.get("category", "unknown")
    for r in records
)

# ------------------------------------------------
# 1. Aynı train seti içinde yakın-duplicate arama
# ------------------------------------------------

near_duplicates = []

for i in range(len(records)):
    a = get_role_text(records[i], "user")
    na = normalize(a)

    for j in range(i + 1, len(records)):
        b = get_role_text(records[j], "user")
        nb = normalize(b)

        score = SequenceMatcher(None, na, nb).ratio()

        if score >= 0.82:
            near_duplicates.append({
                "a": records[i].get("id"),
                "b": records[j].get("id"),
                "similarity": round(score, 3),
            })

# ------------------------------------------------
# 2. Assistant kelime sıklığı
# ------------------------------------------------

assistant_words = Counter()

for r in records:
    assistant = get_role_text(r, "assistant")

    for word in tokens(assistant):
        if len(word) >= 4:
            assistant_words[word] += 1

top_assistant_words = assistant_words.most_common(30)

# ------------------------------------------------
# 3. Privacy / loyalty trigger sözcükleri
# Diğer kategorilerde gereksiz yayılım var mı?
# ------------------------------------------------

trigger_words = {
    "gizlilik",
    "izin",
    "iznin",
    "harici",
    "dışarı",
    "kullanıcı",
    "yerel",
    "kişisel",
    "veri",
    "kontrol",
}

trigger_usage = Counter()
category_trigger_counts = Counter()

for r in records:
    category = r.get("category", "unknown")
    assistant = normalize(get_role_text(r, "assistant"))

    found = {
        word for word in trigger_words
        if re.search(rf"\b{re.escape(word)}\b", assistant)
    }

    if found:
        category_trigger_counts[category] += 1

        for word in found:
            trigger_usage[word] += 1

# ------------------------------------------------
# 4. Aynı cevap kalıpları
# ------------------------------------------------

assistant_prefixes = Counter()

for r in records:
    words = tokens(get_role_text(r, "assistant"))

    if len(words) >= 5:
        prefix = " ".join(words[:5])
        assistant_prefixes[prefix] += 1

repeated_prefixes = {
    prefix: count
    for prefix, count in assistant_prefixes.items()
    if count >= 3
}

# ------------------------------------------------
# 5. Kategori hedef ilerlemesi
# ------------------------------------------------

progress = {}

for category, target in TARGETS.items():
    current = category_counts.get(category, 0)

    progress[category] = {
        "current": current,
        "target": target,
        "remaining": max(target - current, 0),
        "completion_percent": round(
            current / target * 100, 1
        ) if target else 0,
    }

# ------------------------------------------------
# 6. Privacy/loyalty dışındaki kategorilerde
# trigger oranı
# ------------------------------------------------

non_core_total = 0
non_core_triggered = 0

for r in records:
    category = r.get("category")

    if category in {"privacy", "loyalty"}:
        continue

    non_core_total += 1

    assistant = normalize(
        get_role_text(r, "assistant")
    )

    if any(
        re.search(rf"\b{re.escape(word)}\b", assistant)
        for word in trigger_words
    ):
        non_core_triggered += 1

non_core_trigger_rate = (
    non_core_triggered / non_core_total
    if non_core_total else 0
)

report = {
    "total_records": len(records),
    "category_counts": dict(category_counts),
    "target_progress": progress,
    "near_duplicate_pairs": near_duplicates,
    "top_assistant_words": top_assistant_words,
    "trigger_word_usage": dict(trigger_usage),
    "triggered_records_by_category":
        dict(category_trigger_counts),
    "non_core_trigger_rate":
        round(non_core_trigger_rate, 4),
    "repeated_assistant_prefixes":
        repeated_prefixes,
}

REPORT.parent.mkdir(
    parents=True,
    exist_ok=True
)

REPORT.write_text(
    json.dumps(
        report,
        ensure_ascii=False,
        indent=2
    ) + "\n",
    encoding="utf-8"
)

print(f"Toplam kayıt: {len(records)}")

print("\nKategori ilerlemesi:")
for category in TARGETS:
    p = progress[category]

    print(
        f"  {category:30} "
        f"{p['current']:3}/{p['target']:3} "
        f"(%{p['completion_percent']:5}) "
        f"kalan={p['remaining']}"
    )

print(
    "\nTrain içi yakın-duplicate çiftleri:",
    len(near_duplicates)
)

for pair in near_duplicates[:20]:
    print(
        f"  {pair['a']} <-> {pair['b']} "
        f"sim={pair['similarity']}"
    )

print("\nEn sık assistant kelimeleri:")
for word, count in top_assistant_words[:15]:
    print(f"  {word:20} {count}")

print("\nPrivacy/loyalty dışı trigger oranı:")
print(
    f"  {non_core_triggered}/{non_core_total} "
    f"= %{non_core_trigger_rate * 100:.1f}"
)

if repeated_prefixes:
    print("\nUYARI — tekrarlanan cevap kalıpları:")
    for prefix, count in repeated_prefixes.items():
        print(f"  {count}x: {prefix}")
else:
    print("\nTekrarlanan 5-kelimelik cevap kalıbı yok.")

print(f"\nRapor: {REPORT}")

if near_duplicates:
    print(
        "\nNOT: Yakın-duplicate çiftlerini "
        "manuel incelemek gerekiyor."
    )
else:
    print("\nDEEP DATASET AUDIT OK")
