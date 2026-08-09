from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from .benchmark import BenchmarkValidationError, load_benchmark_series, summarize_benchmark_series


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="İçeriksiz LM Studio benchmark serisini doğrula ve özetle"
    )
    parser.add_argument("series", type=Path, help="benchmark-series JSON artifact'i")
    parser.add_argument("--pretty", action="store_true", help="JSON çıktısını girintile")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        series = load_benchmark_series(args.series)
        summary = summarize_benchmark_series(series)
    except BenchmarkValidationError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "validation",
                    "reason": exc.code,
                    "message": "Benchmark serisi doğrulanamadı.",
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2
    except OSError:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "io",
                    "message": "Benchmark serisi okunamadı.",
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2

    print(json.dumps(summary, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
