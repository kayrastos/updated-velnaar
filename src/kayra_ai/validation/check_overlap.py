from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from .common import ValidationIssue, iter_jsonl, jaccard, normalized_text, prompt_text, token_ngrams


@dataclass(frozen=True)
class PromptRecord:
    record_id: str
    line_number: int
    normalized: str
    ngrams: set[tuple[str, ...]]


def load_prompts(path: Path, ngram_size: int) -> list[PromptRecord]:
    records: list[PromptRecord] = []
    for line_number, record in iter_jsonl(path):
        record_id = str(record.get("id") or record.get("case_id") or f"line-{line_number}")
        text = prompt_text(record)
        normalized = normalized_text(text)
        if normalized:
            records.append(PromptRecord(record_id, line_number, normalized, token_ngrams(text, ngram_size)))
    return records


def find_overlaps(
    training_path: Path,
    eval_path: Path,
    threshold: float = 0.8,
    ngram_size: int = 5,
) -> list[str]:
    training = load_prompts(training_path, ngram_size)
    evaluation = load_prompts(eval_path, ngram_size)
    exact_index: dict[str, list[int]] = {}
    ngram_index: dict[tuple[str, ...], set[int]] = {}
    for index, case in enumerate(evaluation):
        exact_index.setdefault(case.normalized, []).append(index)
        for ngram in case.ngrams:
            ngram_index.setdefault(ngram, set()).add(index)

    findings: list[str] = []
    for train in training:
        exact_matches = set(exact_index.get(train.normalized, []))
        for index in exact_matches:
            case = evaluation[index]
            findings.append(
                f"exact: {training_path}:{train.line_number} ({train.record_id}) <-> "
                f"{eval_path}:{case.line_number} ({case.record_id})"
            )

        candidates: set[int] = set()
        for ngram in train.ngrams:
            candidates.update(ngram_index.get(ngram, set()))
        for index in candidates - exact_matches:
            case = evaluation[index]
            score = jaccard(train.ngrams, case.ngrams)
            if score >= threshold:
                findings.append(
                    f"fuzzy={score:.3f}: {training_path}:{train.line_number} ({train.record_id}) <-> "
                    f"{eval_path}:{case.line_number} ({case.record_id})"
                )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Eğitim/eval prompt örtüşmesini çevrimdışı tara")
    parser.add_argument("training", type=Path)
    parser.add_argument("evaluation", type=Path)
    parser.add_argument("--threshold", type=float, default=0.8)
    parser.add_argument("--ngram-size", type=int, default=5)
    args = parser.parse_args()
    if not 0 < args.threshold <= 1:
        parser.error("--threshold 0 ile 1 arasında olmalı")
    if args.ngram_size < 1:
        parser.error("--ngram-size en az 1 olmalı")
    try:
        findings = find_overlaps(args.training, args.evaluation, args.threshold, args.ngram_size)
    except (OSError, ValidationIssue) as exc:
        print(f"HATA: {exc}")
        return 1
    if findings:
        for finding in findings:
            print(f"HATA: {finding}")
        print(f"BAŞARISIZ: {len(findings)} olası örtüşme")
        return 1
    print("OK: eğitim/eval prompt örtüşmesi bulunmadı")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
