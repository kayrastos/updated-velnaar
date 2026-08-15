from __future__ import annotations

import argparse
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError


ID_PATTERN = r"^[a-z0-9][a-z0-9._-]{2,127}$"
REPOSITORY_PATTERN = (
    r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}/"
    r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}$"
)
COMMIT_PATTERN = r"^[a-f0-9]{40}$"
LICENSE_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9.+-]{1,63}$"
QUANTIZATION_PATTERN = r"^[A-Z0-9][A-Z0-9_]{1,31}$"
FILENAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.gguf$"
SHA256_PATTERN = r"^[a-f0-9]{64}$"


class ModelArtifactValidationError(ValueError):
    """A safe validation error that identifies the manifest and broken field."""


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ModelArtifactFile(StrictModel):
    filename: str = Field(min_length=6, max_length=205, pattern=FILENAME_PATTERN)
    size_bytes: int = Field(ge=1)
    sha256: str = Field(pattern=SHA256_PATTERN)


class ModelArtifact(StrictModel):
    schema_version: Literal["1.0"]
    id: str = Field(pattern=ID_PATTERN)
    repository: str = Field(pattern=REPOSITORY_PATTERN)
    commit: str = Field(pattern=COMMIT_PATTERN)
    license: str = Field(pattern=LICENSE_PATTERN)
    format: Literal["GGUF"]
    quantization: str = Field(pattern=QUANTIZATION_PATTERN)
    context_length: int = Field(ge=512, le=131072)
    files: list[ModelArtifactFile] = Field(min_length=1, max_length=1)

    @property
    def total_size_bytes(self) -> int:
        return sum(item.size_bytes for item in self.files)


def _field_location(location: tuple[str | int, ...]) -> str:
    if not location:
        return "$"
    rendered = ""
    for part in location:
        if isinstance(part, int):
            rendered += f"[{part}]"
        else:
            rendered += f".{part}" if rendered else part
    return rendered


def _validation_reason(error: dict[str, object]) -> str:
    error_type = str(error["type"])
    location = tuple(error.get("loc", ()))
    field = location[-1] if location else None
    if error_type == "missing":
        return "zorunlu alan eksik"
    if error_type == "extra_forbidden":
        return "tanımsız alan"
    if error_type in {"dict_type", "model_type"}:
        return "nesne olmalı"
    if error_type in {"int_type", "int_parsing"}:
        return "tam sayı olmalı"
    if error_type == "literal_error":
        return "izin verilen sabit değer değil"
    if error_type == "string_pattern_mismatch":
        if field == "sha256":
            return "64 karakterli küçük harf SHA-256 olmalı"
        if field == "commit":
            return "40 karakterli küçük harf commit SHA'sı olmalı"
        return "beklenen biçimle eşleşmiyor"
    if error_type == "string_too_short":
        return "metin çok kısa"
    if error_type == "string_too_long":
        return "metin çok uzun"
    if error_type == "greater_than_equal":
        return "izin verilen alt sınırın altında"
    if error_type == "less_than_equal":
        return "izin verilen üst sınırın üzerinde"
    if error_type == "too_short":
        return "en az bir dosya gerekli"
    if error_type == "too_long":
        return "manifest tam olarak bir dosya içermeli"
    return "alan değeri geçersiz"


def _validation_message(path: Path, exc: ValidationError) -> str:
    issues: list[str] = []
    for error in exc.errors(include_input=False, include_context=False):
        location = _field_location(tuple(error.get("loc", ())))
        issues.append(f"{path}: alan '{location}' geçersiz: {_validation_reason(error)}")
    return "; ".join(dict.fromkeys(issues))


def load_model_artifact(path: str | Path) -> ModelArtifact:
    manifest_path = Path(path)
    try:
        with manifest_path.open("r", encoding="utf-8") as handle:
            value = yaml.safe_load(handle)
    except OSError as exc:
        detail = exc.strerror or "okuma hatası"
        raise ModelArtifactValidationError(f"{manifest_path}: dosya okunamadı: {detail}") from None
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        location = f":{mark.line + 1}:{mark.column + 1}" if mark is not None else ""
        raise ModelArtifactValidationError(
            f"{manifest_path}{location}: YAML sözdizimi geçersiz"
        ) from None

    if not isinstance(value, dict):
        raise ModelArtifactValidationError(
            f"{manifest_path}: alan '$' geçersiz: YAML kökü nesne olmalı"
        )
    try:
        return ModelArtifact.model_validate(value)
    except ValidationError as exc:
        raise ModelArtifactValidationError(_validation_message(manifest_path, exc)) from None


def validate_model_artifact(path: str | Path) -> ModelArtifact:
    """Validate a manifest without network or model access."""

    return load_model_artifact(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fulgor AI model artifact manifestini doğrula")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        artifact = validate_model_artifact(args.path)
    except ModelArtifactValidationError as exc:
        print(f"HATA: {exc}")
        return 1
    print(
        f"OK: {args.path} ({len(artifact.files)} dosya, "
        f"{artifact.total_size_bytes} byte)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
