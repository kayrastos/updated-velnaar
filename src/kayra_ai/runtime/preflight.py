from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence

from .backends import build_backend
from .config import RuntimeConfig, load_runtime_config
from .contracts import PreflightResult
from .errors import InternalRuntimeFailure, RuntimeFailure
from .http_transport import TransportFactory


def run_preflight(
    config: RuntimeConfig,
    backend_name: str | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    transport_factory: TransportFactory | None = None,
) -> PreflightResult:
    backend = build_backend(
        config,
        backend_name,
        environ=environ,
        transport_factory=transport_factory,
    )
    return backend.preflight()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fulgor AI güvenli yerel runtime bağlantı ön kontrolü")
    parser.add_argument("--config", required=True, help="Runtime YAML dosyası")
    parser.add_argument("--backend", choices=("mock", "lm_studio", "llama_cpp"))
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = load_runtime_config(args.config)
        result = run_preflight(config, args.backend)
    except RuntimeFailure as exc:
        print(json.dumps(exc.info.model_dump(mode="json"), ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception:
        failure = InternalRuntimeFailure()
        print(json.dumps(failure.info.model_dump(mode="json"), ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps(result.model_dump(mode="json"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
