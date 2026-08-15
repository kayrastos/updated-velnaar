from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


class AssistantDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]{2,63}$")
    name: str = Field(min_length=1, max_length=80)
    default_language: str
    description: str = Field(min_length=20, max_length=500)
    system_prompt: str = Field(min_length=100, max_length=8000)
    capabilities: list[str] = Field(min_length=1)
    limitations: list[str] = Field(min_length=1)
    modes: dict[str, Any]
    privacy: dict[str, Any]
    tool_policy: dict[str, Any]
    response_style: dict[str, Any]
    generation_defaults: dict[str, Any]

    @model_validator(mode="after")
    def enforce_invariants(self) -> "AssistantDefinition":
        if self.schema_version != "1.0":
            raise ValueError("schema_version 1.0 olmalı")
        if self.default_language not in {"tr", "en"}:
            raise ValueError("default_language tr veya en olmalı")
        if self.privacy.get("embed_personal_data_in_weights") is not False:
            raise ValueError("kişisel veri ağırlıklara gömülemez")
        if self.privacy.get("retain_secrets") is not False:
            raise ValueError("sırlar kalıcı tutulamaz")
        if self.generation_defaults.get("context_length") != 4096:
            raise ValueError("Aşama 0 başlangıç context_length değeri 4096 olmalı")
        return self


def validate_assistant(path: Path) -> AssistantDefinition:
    with path.open("r", encoding="utf-8") as handle:
        value = yaml.safe_load(handle)
    if not isinstance(value, dict):
        raise ValueError("asistan tanımı bir YAML nesnesi olmalı")
    return AssistantDefinition.model_validate(value)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fulgor AI asistan tanımını doğrula")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        validate_assistant(args.path)
    except (OSError, ValueError, ValidationError, yaml.YAMLError) as exc:
        print(f"HATA: {exc}")
        return 1
    print(f"OK: {args.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
