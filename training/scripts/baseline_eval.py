#!/usr/bin/env python3

import json
import subprocess
import sys
from pathlib import Path

MODEL = "qwen/qwen3.5-9b"
API_URL = "http://localhost:1234/api/v1/chat"

EVAL_PATH = Path("training/data/eval/eval_v1.jsonl")
REPORT_PATH = Path("training/reports/baseline_qwen3.5_9b_v2.jsonl")
SUMMARY_PATH = Path("training/reports/baseline_qwen3.5_9b_v2_summary.json")


def load_jsonl(path):
    records = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f, 1):
            line = raw.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise RuntimeError(
                    f"{path} satır {line_no}: geçersiz JSON: {e}"
                )
    return records


def get_prompt(record):
    parts = []

    # Referans assistant cevabını kesinlikle modele göndermiyoruz.
    for msg in record.get("messages", []):
        if msg.get("role") == "assistant":
            break

        role = msg.get("role")
        content = msg.get("content", "").strip()

        if not content:
            continue

        if role == "system":
            parts.append(f"Sistem talimatı:\n{content}")
        elif role == "user":
            parts.append(content)

    if not parts:
        raise ValueError(f"{record.get('id')}: test promptu bulunamadı")

    return "\n\n".join(parts)


def get_reference(record):
    for msg in record.get("messages", []):
        if msg.get("role") == "assistant":
            return msg.get("content", "")
    return ""


def call_model(prompt):
    payload = {
        "model": MODEL,
        "input": prompt,
        "reasoning": "off",
        "temperature": 0.2,
        "max_output_tokens": 256,
        "store": False
    }

    proc = subprocess.run(
        [
            "curl.exe",
            "-sS",
            "--fail-with-body",
            API_URL,
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
    )

    if proc.returncode != 0:
        raise RuntimeError(
            proc.stderr.strip() or proc.stdout.strip()
        )

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"LM Studio geçersiz JSON döndürdü: {e}"
        )

    messages = [
        item for item in data.get("output", [])
        if item.get("type") == "message"
    ]

    if not messages:
        raise RuntimeError(
            f"Model cevabı bulunamadı. output={data.get('output')}"
        )

    answer = "\n".join(
        item.get("content", "").strip()
        for item in messages
        if item.get("content", "").strip()
    ).strip()

    if not answer:
        raise RuntimeError("Model boş cevap döndürdü")

    stats = data.get("stats", {})

    return answer, stats


def main():
    if not EVAL_PATH.exists():
        print(f"Eval dosyası yok: {EVAL_PATH}")
        sys.exit(1)

    records = load_jsonl(EVAL_PATH)

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)

    successes = 0
    failures = 0
    speeds = []
    ttfts = []

    print(f"Model: {MODEL}")
    print(f"Eval: {len(records)} kayıt")
    print("Reasoning: OFF")
    print("Store: FALSE")
    print("-" * 70)

    with REPORT_PATH.open("w", encoding="utf-8", newline="\n") as f:
        for i, record in enumerate(records, 1):
            rid = record.get("id")
            category = record.get("category")
            prompt = get_prompt(record)

            print(f"[{i}/{len(records)}] {rid} ({category})")

            result = {
                "id": rid,
                "category": category,
                "model": MODEL,
                "prompt": prompt,
                "reference_answer": get_reference(record),
                "reasoning": "off",
                "store": False,
            }

            try:
                answer, stats = call_model(prompt)

                result.update({
                    "status": "ok",
                    "model_answer": answer,
                    "stats": stats,
                })

                successes += 1

                tps = stats.get("tokens_per_second")
                ttft = stats.get("time_to_first_token_seconds")

                if isinstance(tps, (int, float)):
                    speeds.append(tps)

                if isinstance(ttft, (int, float)):
                    ttfts.append(ttft)

                preview = answer.replace("\n", " ")
                print(f"  Cevap: {preview[:140]}")
                print(
                    f"  Hız: {tps} tok/s | "
                    f"TTFT: {ttft} sn | "
                    f"Reasoning token: "
                    f"{stats.get('reasoning_output_tokens')}"
                )

            except Exception as e:
                failures += 1
                result.update({
                    "status": "error",
                    "error": str(e),
                })
                print(f"  HATA: {e}")

            f.write(json.dumps(result, ensure_ascii=False) + "\n")
            f.flush()

    summary = {
        "model": MODEL,
        "dataset": str(EVAL_PATH),
        "total": len(records),
        "successful": successes,
        "failed": failures,
        "reasoning": "off",
        "store": False,
        "average_tokens_per_second":
            round(sum(speeds) / len(speeds), 3) if speeds else None,
        "average_time_to_first_token_seconds":
            round(sum(ttfts) / len(ttfts), 3) if ttfts else None,
        "report": str(REPORT_PATH),
        "reference_answers_sent_to_model": False,
    }

    with SUMMARY_PATH.open("w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("-" * 70)
    print("CLEAN BASELINE TAMAMLANDI")
    print(f"Başarılı: {successes}/{len(records)}")
    print(f"Hatalı:    {failures}/{len(records)}")
    print(
        "Ort. hız:  "
        f"{summary['average_tokens_per_second']} tok/s"
    )
    print(
        "Ort. TTFT: "
        f"{summary['average_time_to_first_token_seconds']} sn"
    )
    print(f"Rapor: {REPORT_PATH}")
    print(f"Özet:  {SUMMARY_PATH}")


if __name__ == "__main__":
    main()
