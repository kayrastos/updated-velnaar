#!/usr/bin/env python3

import json
import subprocess
import sys
from pathlib import Path

MODEL = "qwen/qwen3.5-9b"
API_URL = "http://localhost:1234/api/v1/chat"

EVAL = Path("training/data/eval/eval_v2.jsonl")
REPORT = Path("training/reports/baseline_qwen3.5_9b_eval_v2.jsonl")
SUMMARY = Path("training/reports/baseline_qwen3.5_9b_eval_v2_summary.json")


def load_jsonl(path):
    rows = []
    for n, raw in enumerate(
        path.read_text(encoding="utf-8").splitlines(), 1
    ):
        if not raw.strip():
            continue
        try:
            rows.append(json.loads(raw))
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Satır {n}: {e}")
    return rows


def get_user(record):
    users = [
        m["content"]
        for m in record["messages"]
        if m.get("role") == "user"
    ]

    if len(users) != 1:
        raise RuntimeError(
            f"{record['id']}: tek user mesajı bekleniyordu, "
            f"{len(users)} bulundu"
        )

    return users[0]


def get_reference(record):
    answers = [
        m["content"]
        for m in record["messages"]
        if m.get("role") == "assistant"
    ]

    if len(answers) != 1:
        raise RuntimeError(
            f"{record['id']}: tek referans assistant cevabı bekleniyordu"
        )

    return answers[0]


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

    data = json.loads(proc.stdout)

    messages = [
        x for x in data.get("output", [])
        if x.get("type") == "message"
    ]

    answer = "\n".join(
        x.get("content", "").strip()
        for x in messages
        if x.get("content", "").strip()
    ).strip()

    if not answer:
        raise RuntimeError("Boş model cevabı")

    return answer, data.get("stats", {})


def main():
    records = load_jsonl(EVAL)

    successes = 0
    failures = 0
    speeds = []
    ttfts = []
    reasoning_tokens = 0

    REPORT.parent.mkdir(parents=True, exist_ok=True)

    print(f"MODEL:     {MODEL}")
    print(f"EVAL V2:   {len(records)} kayıt")
    print("REASONING: OFF")
    print("STORE:     FALSE")
    print("-" * 72)

    with REPORT.open("w", encoding="utf-8", newline="\n") as out:
        for i, r in enumerate(records, 1):

            prompt = get_user(r)
            reference = get_reference(r)

            print(
                f"[{i:02}/{len(records)}] "
                f"{r['id']} ({r['category']})"
            )

            result = {
                "id": r["id"],
                "category": r["category"],
                "model": MODEL,
                "prompt": prompt,
                "reference_answer": reference,
                "reasoning": "off",
                "store": False,
            }

            try:
                answer, stats = call_model(prompt)

                rt = stats.get("reasoning_output_tokens", 0) or 0
                tps = stats.get("tokens_per_second")
                ttft = stats.get("time_to_first_token_seconds")

                reasoning_tokens += rt

                if isinstance(tps, (int, float)):
                    speeds.append(tps)

                if isinstance(ttft, (int, float)):
                    ttfts.append(ttft)

                result.update({
                    "status": "ok",
                    "model_answer": answer,
                    "stats": stats
                })

                successes += 1

                preview = answer.replace("\n", " ")[:150]

                print(f"  Cevap: {preview}")
                print(
                    f"  Hız={tps} tok/s | "
                    f"TTFT={ttft} sn | "
                    f"Reasoning={rt}"
                )

            except Exception as e:
                failures += 1
                result.update({
                    "status": "error",
                    "error": str(e)
                })
                print(f"  HATA: {e}")

            out.write(
                json.dumps(result, ensure_ascii=False) + "\n"
            )
            out.flush()

    summary = {
        "model": MODEL,
        "eval": str(EVAL),
        "total": len(records),
        "successful": successes,
        "failed": failures,
        "reasoning_mode": "off",
        "total_reasoning_output_tokens": reasoning_tokens,
        "average_tokens_per_second":
            round(sum(speeds) / len(speeds), 3)
            if speeds else None,
        "average_ttft_seconds":
            round(sum(ttfts) / len(ttfts), 3)
            if ttfts else None,
        "reference_answers_sent_to_model": False,
        "temperature": 0.2,
        "max_output_tokens": 256,
        "store": False
    }

    SUMMARY.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

    print("-" * 72)
    print("EVAL V2 BASELINE TAMAMLANDI")
    print(f"Başarılı:       {successes}/{len(records)}")
    print(f"Hatalı:         {failures}/{len(records)}")
    print(f"Reasoning token:{reasoning_tokens}")
    print(
        f"Ort. hız:       "
        f"{summary['average_tokens_per_second']} tok/s"
    )
    print(
        f"Ort. TTFT:      "
        f"{summary['average_ttft_seconds']} sn"
    )
    print(f"Rapor: {REPORT}")
    print(f"Özet:  {SUMMARY}")

    if failures or reasoning_tokens != 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
