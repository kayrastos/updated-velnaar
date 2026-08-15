from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from kayra_ai.runtime.errors import RuntimeFailure
from kayra_ai.validation.common import ValidationIssue

from .reporting import OutputCollisionError
from .runner import EvaluationFailure, run_evaluation


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fulgor AI eval setini modelden bağımsız backend ile çalıştır")
    parser.add_argument("--config", required=True, type=Path, help="Runtime YAML dosyası")
    parser.add_argument("--backend", choices=("mock", "lm_studio", "llama_cpp"))
    parser.add_argument("--eval", dest="eval_path", required=True, type=Path, help="Eval JSONL dosyası")
    parser.add_argument(
        "--profiles",
        choices=("all", "thinking", "non_thinking"),
        default="all",
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--output-root", type=Path, default=Path("reports/runs"))
    parser.add_argument(
        "--allow-native-non-smoke-eval",
        action="store_true",
        help="Yalnız ayrı G-FULL onayından sonra native smoke kilidini aç",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        completed = run_evaluation(
            config_path=args.config,
            eval_path=args.eval_path,
            backend_name=args.backend,
            profiles=args.profiles,
            run_id=args.run_id,
            output_root=args.output_root,
            allow_native_non_smoke_eval=args.allow_native_non_smoke_eval,
        )
    except RuntimeFailure as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": exc.info.kind,
                    "message": exc.info.message,
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2
    except (EvaluationFailure, OutputCollisionError, ValidationIssue) as exc:
        print(
            json.dumps(
                {"ok": False, "error": "validation", "message": str(exc)},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2
    except OSError:
        print(
            json.dumps(
                {"ok": False, "error": "io", "message": "Koşu artifact'leri yazılamadı."},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2
    except Exception:
        print(
            json.dumps(
                {"ok": False, "error": "internal", "message": "Beklenmeyen eval hatası oluştu."},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2

    summary = completed.summary
    print(
        json.dumps(
            {
                "ok": summary.failure_count == 0,
                "run_id": summary.run_id,
                "run_directory": str(completed.run_directory),
                "distinct_case_count": summary.distinct_case_count,
                "execution_count": summary.execution_count,
                "success_count": summary.success_count,
                "failure_count": summary.failure_count,
                "semantic_scoring_performed": summary.semantic_scoring_performed,
            },
            ensure_ascii=False,
        )
    )
    return 0 if summary.failure_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
