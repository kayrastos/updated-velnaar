from __future__ import annotations

import ipaddress
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit, urlunsplit

import yaml
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator, model_validator

from .contracts import ProfileName
from .errors import ConfigurationFailure, PrivacyPolicyFailure


ENV_NAME_PATTERN = r"^[A-Z_][A-Z0-9_]*$"
SHA256_PATTERN = r"^[a-f0-9]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExecutionConfig(StrictModel):
    context_length: int = Field(default=4096, ge=512, le=131072)
    max_in_flight: Literal[1] = 1
    retries: Literal[0] = 0
    connect_timeout_seconds: float = Field(default=3, gt=0, le=60)
    request_timeout_seconds: float = Field(default=180, gt=0, le=3600)


class NetworkConfig(StrictModel):
    allow_non_loopback: bool = False
    allowed_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1", "::1"])
    disable_environment_proxies: Literal[True] = True
    follow_redirects: Literal[False] = False

    @field_validator("allowed_hosts")
    @classmethod
    def hosts_are_exact_names(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for host in value:
            item = host.strip().lower().strip("[]")
            if not item or item != host.lower().strip("[]"):
                raise ValueError("allowed_hosts yalnız tam ve boşluksuz host adları içermeli")
            if any(character in item for character in ("/", "?", "#", "*")):
                raise ValueError("allowed_hosts URL veya wildcard içeremez")
            normalized.append(item)
        if len(normalized) != len(set(normalized)):
            raise ValueError("allowed_hosts değerleri benzersiz olmalı")
        return normalized


class PrivacyConfig(StrictModel):
    log_prompts: Literal[False] = False
    log_responses: Literal[False] = False
    log_headers: Literal[False] = False


class ConfiguredModel(StrictModel):
    id: str = Field(min_length=2, max_length=200)
    revision: str = Field(min_length=1, max_length=200)
    artifact_sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)


class MockBackendConfig(StrictModel):
    kind: Literal["mock"]
    model: ConfiguredModel


class LMStudioNativeV1Config(StrictModel):
    model_format: Literal["gguf"]
    quantization: Literal["Q4_K_M"]
    size_bytes: Literal[9001752960]
    context_length: Literal[4096]
    parallel: Literal[1]
    offload_kv_cache_to_gpu: Literal[False]


class LMStudioBackendConfig(StrictModel):
    kind: Literal["lm_studio"]
    enabled: bool = False
    base_url_env: str = Field(pattern=ENV_NAME_PATTERN)
    model_id_env: str = Field(pattern=ENV_NAME_PATTERN)
    model_revision_env: str | None = Field(default=None, pattern=ENV_NAME_PATTERN)
    api_key_env: str | None = Field(default=None, pattern=ENV_NAME_PATTERN)
    api_mode: Literal["openai_compatible", "native_v1"] = "openai_compatible"
    model_manifest: Literal["configs/models/qwen3-14b-q4_k_m.yaml"] | None = None
    native_v1: LMStudioNativeV1Config | None = None

    @model_validator(mode="after")
    def native_configuration_is_complete(self) -> "LMStudioBackendConfig":
        if self.api_mode == "native_v1":
            if self.model_manifest is None:
                raise ValueError("native_v1 LM Studio backend için model_manifest gerekli")
            if self.native_v1 is None:
                raise ValueError("native_v1 LM Studio backend için native_v1 beklentileri gerekli")
        elif self.native_v1 is not None or self.model_manifest is not None:
            raise ValueError(
                "model manifest ve native_v1 beklentileri yalnız api_mode=native_v1 ile kullanılabilir"
            )
        return self


class LlamaCppBackendConfig(StrictModel):
    kind: Literal["llama_cpp"]
    enabled: bool = False
    base_url_env: str = Field(pattern=ENV_NAME_PATTERN)
    model_id_env: str = Field(pattern=ENV_NAME_PATTERN)
    model_revision_env: str | None = Field(default=None, pattern=ENV_NAME_PATTERN)
    api_key_env: str | None = Field(default=None, pattern=ENV_NAME_PATTERN)
    api_mode: Literal["openai_compatible"] = "openai_compatible"
    model_manifest: None = None
    native_v1: None = None


RemoteBackendConfig = Annotated[
    LMStudioBackendConfig | LlamaCppBackendConfig,
    Field(discriminator="kind"),
]


class BackendConfigs(StrictModel):
    mock: MockBackendConfig
    lm_studio: LMStudioBackendConfig
    llama_cpp: LlamaCppBackendConfig

    @model_validator(mode="after")
    def names_match_kinds(self) -> "BackendConfigs":
        expected = {
            "mock": self.mock.kind,
            "lm_studio": self.lm_studio.kind,
            "llama_cpp": self.llama_cpp.kind,
        }
        mismatches = [name for name, kind in expected.items() if name != kind]
        if mismatches:
            raise ValueError("backend anahtarı ile kind değeri uyuşmuyor")
        return self

    def get(self, name: str) -> MockBackendConfig | RemoteBackendConfig:
        if name not in {"mock", "lm_studio", "llama_cpp"}:
            raise ConfigurationFailure("Bilinmeyen backend adı.")
        return getattr(self, name)


class ProfileConfig(StrictModel):
    requested_mode: ProfileName
    unsupported_capability: Literal["error", "backend_default"] = "error"
    temperature: float = Field(default=0.6, ge=0, le=2)
    top_p: float = Field(default=0.95, gt=0, le=1)
    max_output_tokens: int = Field(default=512, ge=1, le=4096)


class ProfilesConfig(StrictModel):
    thinking: ProfileConfig
    non_thinking: ProfileConfig

    @model_validator(mode="after")
    def keys_match_requested_modes(self) -> "ProfilesConfig":
        if self.thinking.requested_mode != "thinking":
            raise ValueError("thinking profili requested_mode=thinking olmalı")
        if self.non_thinking.requested_mode != "non_thinking":
            raise ValueError("non_thinking profili requested_mode=non_thinking olmalı")
        return self

    def get(self, name: ProfileName) -> ProfileConfig:
        return getattr(self, name)


class RuntimeConfig(StrictModel):
    schema_version: Literal["1.0"]
    assistant_config: str = Field(min_length=1, max_length=500)
    active_backend: Literal["mock", "lm_studio", "llama_cpp"]
    execution: ExecutionConfig
    network: NetworkConfig
    privacy: PrivacyConfig
    backends: BackendConfigs
    profiles: ProfilesConfig

    @model_validator(mode="after")
    def native_lm_studio_profile_is_fail_closed(self) -> "RuntimeConfig":
        backend = self.backends.lm_studio
        if backend.api_mode != "native_v1":
            return self
        if self.execution.context_length != 4096:
            raise ValueError("LM Studio native v1 context_length tam olarak 4096 olmalı")
        if self.network.allow_non_loopback or self.network.allowed_hosts != ["127.0.0.1"]:
            raise ValueError("LM Studio native v1 yalnız 127.0.0.1 hedefini kullanmalı")
        if any(
            profile.unsupported_capability != "error"
            for profile in (self.profiles.thinking, self.profiles.non_thinking)
        ):
            raise ValueError("LM Studio native v1 profil fallback kullanamaz")
        return self


class ResolvedBackendConfig(StrictModel):
    kind: Literal["lm_studio", "llama_cpp"]
    api_root: str = Field(exclude=True, repr=False)
    model_id: str = Field(min_length=1, max_length=200, exclude=True, repr=False)
    model_revision: str | None = Field(default=None, max_length=200, exclude=True, repr=False)
    api_key: SecretStr | None = Field(default=None, exclude=True, repr=False)
    api_mode: Literal["openai_compatible", "native_v1"] = Field(
        default="openai_compatible", exclude=True, repr=False
    )
    model_manifest: str | None = Field(default=None, exclude=True, repr=False)
    native_v1: LMStudioNativeV1Config | None = Field(default=None, exclude=True, repr=False)


def _validation_message(exc: ValidationError) -> str:
    locations = []
    for error in exc.errors(include_input=False, include_context=False):
        location = ".".join(str(part) for part in error["loc"])
        locations.append(location or "root")
    summary = ", ".join(dict.fromkeys(locations))
    return f"Çalışma zamanı yapılandırması geçersiz; alanlar: {summary}."


def load_runtime_config(path: str | Path) -> RuntimeConfig:
    config_path = Path(path)
    try:
        with config_path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
    except OSError:
        raise ConfigurationFailure("Çalışma zamanı yapılandırması okunamadı.") from None
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        suffix = f" (satır {mark.line + 1})" if mark is not None else ""
        raise ConfigurationFailure(f"Çalışma zamanı YAML sözdizimi geçersiz{suffix}.") from None
    if not isinstance(data, dict):
        raise ConfigurationFailure("Çalışma zamanı yapılandırmasının kökü nesne olmalı.")
    try:
        return RuntimeConfig.model_validate(data)
    except ValidationError as exc:
        raise ConfigurationFailure(_validation_message(exc)) from None


def normalize_api_root(value: str) -> str:
    """Validate and normalize an OpenAI-compatible API root ending in /v1."""

    if "?" in value or "#" in value:
        raise ConfigurationFailure("OpenAI-compatible API kökü query veya fragment içeremez.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError):
        raise ConfigurationFailure("OpenAI-compatible API kökü geçersiz.") from None
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ConfigurationFailure("OpenAI-compatible API kökü http veya https kullanmalı.")
    if not parsed.hostname:
        raise ConfigurationFailure("OpenAI-compatible API kökünde host gerekli.")
    if parsed.username is not None or parsed.password is not None:
        raise ConfigurationFailure("OpenAI-compatible API kökü userinfo içeremez.")
    if parsed.query or parsed.fragment:
        raise ConfigurationFailure("OpenAI-compatible API kökü query veya fragment içeremez.")
    path = parsed.path.rstrip("/")
    if "//" in path:
        raise ConfigurationFailure("OpenAI-compatible API kökü çift eğik çizgi içeremez.")
    if path != "/v1":
        raise ConfigurationFailure("OpenAI-compatible API kökü tam olarak /v1 yolunu göstermeli.")

    host = parsed.hostname.lower()
    if host in {"0.0.0.0", "::"}:
        raise PrivacyPolicyFailure("Dinleme adresi bağlantı hedefi olarak kullanılamaz.")

    host_text = f"[{host}]" if ":" in host else host
    netloc = f"{host_text}:{port}" if port is not None else host_text
    return urlunsplit((parsed.scheme.lower(), netloc, "/v1", "", ""))


def normalize_lm_studio_native_api_root(value: str) -> str:
    """Validate and normalize an LM Studio native API root ending in /api/v1."""

    if "?" in value or "#" in value:
        raise ConfigurationFailure("LM Studio native API kökü query veya fragment içeremez.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError):
        raise ConfigurationFailure("LM Studio native API kökü geçersiz.") from None
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ConfigurationFailure("LM Studio native API kökü http veya https kullanmalı.")
    if not parsed.hostname:
        raise ConfigurationFailure("LM Studio native API kökünde host gerekli.")
    if parsed.username is not None or parsed.password is not None:
        raise ConfigurationFailure("LM Studio native API kökü userinfo içeremez.")
    if parsed.query or parsed.fragment:
        raise ConfigurationFailure("LM Studio native API kökü query veya fragment içeremez.")
    path = parsed.path.rstrip("/")
    if "//" in path:
        raise ConfigurationFailure("LM Studio native API kökü çift eğik çizgi içeremez.")
    if path != "/api/v1":
        raise ConfigurationFailure("LM Studio native API kökü tam olarak /api/v1 yolunu göstermeli.")

    host = parsed.hostname.lower()
    if host != "127.0.0.1":
        raise PrivacyPolicyFailure("LM Studio native v1 yalnız 127.0.0.1 hedefine bağlanabilir.")

    host_text = f"[{host}]" if ":" in host else host
    netloc = f"{host_text}:{port}" if port is not None else host_text
    return urlunsplit((parsed.scheme.lower(), netloc, "/api/v1", "", ""))


def build_api_url(api_root: str, endpoint: str) -> str:
    root = normalize_api_root(api_root)
    relative = endpoint.strip("/")
    if relative not in {"models", "chat/completions"}:
        raise ConfigurationFailure("Yalnız models ve chat/completions endpoint'leri desteklenir.")
    return f"{root}/{relative}"


def build_lm_studio_native_api_url(api_root: str, endpoint: str) -> str:
    root = normalize_lm_studio_native_api_root(api_root)
    relative = endpoint.strip("/")
    if relative not in {"models", "chat"}:
        raise ConfigurationFailure("Yalnız LM Studio native models ve chat endpoint'leri desteklenir.")
    return f"{root}/{relative}"


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def enforce_network_policy(api_root: str, network: NetworkConfig) -> None:
    host = urlsplit(api_root).hostname
    if host is None:
        raise ConfigurationFailure("OpenAI-compatible API kökünde host gerekli.")
    normalized_host = host.lower()
    if normalized_host in {"0.0.0.0", "::"}:
        raise PrivacyPolicyFailure("Dinleme adresi bağlantı hedefi olarak kullanılamaz.")
    if _is_loopback(normalized_host):
        return
    if not network.allow_non_loopback:
        raise PrivacyPolicyFailure("Loopback dışı hedef varsayılan olarak engellidir.")
    if normalized_host not in network.allowed_hosts:
        raise PrivacyPolicyFailure("Loopback dışı hedef açık host listesinde değil.")


def resolve_backend_config(
    config: RuntimeConfig,
    backend_name: str | None = None,
    *,
    environ: Mapping[str, str] | None = None,
) -> MockBackendConfig | ResolvedBackendConfig:
    name = backend_name or config.active_backend
    backend = config.backends.get(name)
    if isinstance(backend, MockBackendConfig):
        return backend
    if not backend.enabled:
        raise ConfigurationFailure("Seçilen gerçek backend etkin değil.")

    values = os.environ if environ is None else environ
    raw_api_root = values.get(backend.base_url_env)
    raw_model_id = values.get(backend.model_id_env)
    if not raw_api_root:
        raise ConfigurationFailure(f"Gerekli ortam değişkeni tanımlı değil: {backend.base_url_env}.")
    if not raw_model_id:
        raise ConfigurationFailure(f"Gerekli ortam değişkeni tanımlı değil: {backend.model_id_env}.")
    api_mode = backend.api_mode if isinstance(backend, LMStudioBackendConfig) else "openai_compatible"
    api_root = (
        normalize_lm_studio_native_api_root(raw_api_root)
        if api_mode == "native_v1"
        else normalize_api_root(raw_api_root)
    )
    enforce_network_policy(api_root, config.network)

    model_revision = values.get(backend.model_revision_env) if backend.model_revision_env else None
    raw_api_key = values.get(backend.api_key_env) if backend.api_key_env else None
    api_key = SecretStr(raw_api_key) if raw_api_key else None
    try:
        return ResolvedBackendConfig(
            kind=backend.kind,
            api_root=api_root,
            model_id=raw_model_id,
            model_revision=model_revision or None,
            api_key=api_key,
            api_mode=api_mode,
            model_manifest=backend.model_manifest if isinstance(backend, LMStudioBackendConfig) else None,
            native_v1=backend.native_v1 if isinstance(backend, LMStudioBackendConfig) else None,
        )
    except ValidationError:
        raise ConfigurationFailure("Çözümlenen backend yapılandırması geçersiz.") from None
