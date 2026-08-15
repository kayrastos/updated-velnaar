from __future__ import annotations

import argparse
import getpass
from pathlib import Path
from typing import Callable, Sequence

import yaml
from pydantic import ValidationError

from kayra_ai.environment import EnvironmentConfigurationError
from kayra_ai.runtime import (
    ChatMessage,
    GenerationRequest,
    GenerationSettings,
    build_backend,
    load_runtime_config,
)
from kayra_ai.runtime.backends.base import Backend
from kayra_ai.runtime.errors import RuntimeFailure
from kayra_ai.validation.validate_assistant import validate_assistant

from .backend import MemoryAwareBackend
from .retrieval import LexicalMemoryRetriever
from .store import (
    MemoryDecryptionError,
    MemoryStore,
    UnencryptedMemoryDatabaseError,
    UnsafeMemoryPathError,
    default_memory_db_path,
)


InputFn = Callable[[str], str]
PasswordFn = Callable[[str], str]
BackendFactory = Callable[..., Backend]


def _repository_root(start: Path) -> Path | None:
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists() and (candidate / "pyproject.toml").is_file():
            return candidate
    return None


def _repository_file(path: Path, repository: Path) -> Path:
    expanded = path.expanduser()
    resolved = expanded.resolve() if expanded.is_absolute() else (repository / expanded).resolve()
    if not resolved.is_relative_to(repository) or not resolved.is_file():
        raise ValueError("yapilandirma dosyasi Fulgor AI Git deposunda bulunmali")
    return resolved


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fulgor AI yerel LM Studio ve sifreli hafiza sohbeti"
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=default_memory_db_path(),
        help="Git disindaki mevcut sifreli SQLite veritabani yolu",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("configs/runtime.fulgor-ray-v1.lm-studio.yaml"),
        help="Fulgor AI deposundaki runtime YAML yolu",
    )
    parser.add_argument(
        "--profile",
        choices=("thinking", "non_thinking"),
        default="non_thinking",
    )
    parser.add_argument("--top-k", type=int, default=5, choices=range(1, 21))
    parser.add_argument(
        "--max-context-characters",
        type=int,
        default=12000,
        choices=range(1000, 32001),
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    input_fn: InputFn = input,
    password_fn: PasswordFn = getpass.getpass,
    working_directory: Path | None = None,
    backend_factory: BackendFactory = build_backend,
) -> int:
    try:
        args = build_parser().parse_args(argv)
    except EnvironmentConfigurationError as exc:
        print(f"HATA: {exc}")
        return 1
    working = (working_directory or Path.cwd()).resolve()
    repository = _repository_root(working)
    db_path = args.db.expanduser().resolve()
    try:
        if repository is None:
            raise ValueError("komut bir Fulgor AI Git deposunda calistirilmali")
        if not db_path.is_file():
            raise ValueError("hafiza veritabani yok; once kayra-memory add kullan")
        config = load_runtime_config(_repository_file(args.config, repository))
        assistant = validate_assistant(
            _repository_file(Path(config.assistant_config), repository)
        )
        if assistant.privacy.get("rag_enabled") is not True:
            raise ValueError("asistan yapilandirmasinda rag_enabled=true olmali")

        resolved_backend = backend_factory(config)
        store = MemoryStore(
            db_path,
            passphrase=password_fn("Hafiza parolasi: "),
            repository_root=repository,
        )
        backend = MemoryAwareBackend(
            resolved_backend,
            LexicalMemoryRetriever(store),
            top_k=args.top_k,
            max_context_characters=args.max_context_characters,
        )
        backend.preflight()

        question = input_fn("Fulgor Ray'e sorulacak soru: ").strip()
        profile = config.profiles.get(args.profile)
        response = backend.generate(
            GenerationRequest(
                messages=[
                    ChatMessage(role="system", content=assistant.system_prompt),
                    ChatMessage(role="user", content=question),
                ],
                settings=GenerationSettings(
                    context_length=config.execution.context_length,
                    temperature=profile.temperature,
                    top_p=profile.top_p,
                    max_output_tokens=profile.max_output_tokens,
                    stream=False,
                ),
                requested_profile=args.profile,
            )
        )
        print(f"Fulgor Ray: {response.content}")
        if response.timing.tokens_per_second is not None:
            print(f"Hiz: {response.timing.tokens_per_second:.2f} token/sn")
        return 0
    except (
        MemoryDecryptionError,
        UnencryptedMemoryDatabaseError,
        UnsafeMemoryPathError,
        ValidationError,
        RuntimeFailure,
        OSError,
        ValueError,
        yaml.YAMLError,
    ) as exc:
        print(f"HATA: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
