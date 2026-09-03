from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.runtime.config import (
    ConfiguredModel,
    ExecutionConfig,
    LMStudioBackendConfig,
    LMStudioNativeV1Config,
    NetworkConfig,
    PrivacyConfig,
    ProfileConfig,
    RuntimeConfig,
    build_api_url,
    build_lm_studio_native_api_url,
    load_runtime_config,
    normalize_api_root,
    normalize_lm_studio_native_api_root,
    resolve_backend_config,
    validate_model_manifest_path,
)
from kayra_ai.runtime.errors import ConfigurationFailure, PrivacyPolicyFailure
from kayra_ai.runtime.preflight import run_preflight


class RuntimeConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_runtime_config(ROOT / "configs" / "runtime.yaml")

    def remote_config(
        self,
        *,
        allow_non_loopback: bool = False,
        allowed_hosts: list[str] | None = None,
    ) -> RuntimeConfig:
        data = self.config.model_dump(mode="python")
        data["active_backend"] = "lm_studio"
        data["backends"]["lm_studio"]["enabled"] = True
        data["network"]["allow_non_loopback"] = allow_non_loopback
        if allowed_hosts is not None:
            data["network"]["allowed_hosts"] = allowed_hosts
        return RuntimeConfig.model_validate(data)

    def test_repository_runtime_config_is_strict_and_mock_by_default(self) -> None:
        self.assertEqual("mock", self.config.active_backend)
        self.assertEqual(4096, self.config.execution.context_length)
        self.assertEqual(1, self.config.execution.max_in_flight)
        self.assertEqual(0, self.config.execution.retries)
        self.assertFalse(self.config.privacy.log_prompts)

    def test_repository_lm_studio_native_config_is_strict_and_versioned(self) -> None:
        config = load_runtime_config(ROOT / "configs" / "runtime.lm-studio.yaml")
        backend = config.backends.lm_studio
        self.assertEqual("lm_studio", config.active_backend)
        self.assertTrue(backend.enabled)
        self.assertEqual("native_v1", backend.api_mode)
        self.assertEqual("configs/models/qwen3-14b-q4_k_m.yaml", backend.model_manifest)
        self.assertEqual("gguf", backend.native_v1.model_format if backend.native_v1 else None)
        self.assertEqual("Q4_K_M", backend.native_v1.quantization if backend.native_v1 else None)
        self.assertEqual(9001752960, backend.native_v1.size_bytes if backend.native_v1 else None)
        self.assertEqual(4096, config.execution.context_length)
        self.assertEqual(1, config.execution.max_in_flight)
        self.assertFalse(config.network.allow_non_loopback)
        self.assertEqual(["127.0.0.1"], config.network.allowed_hosts)

    def test_kayra_v1_native_config_pins_the_observed_local_artifact(self) -> None:
        config = load_runtime_config(
            ROOT / "configs" / "runtime.kayra-v1.lm-studio.yaml"
        )
        backend = config.backends.lm_studio
        self.assertEqual("lm_studio", config.active_backend)
        self.assertTrue(backend.enabled)
        self.assertEqual("native_v1", backend.api_mode)
        self.assertEqual(
            "configs/models/qwen3_5_9b_kayra_v1_q4_k_m.yaml",
            backend.model_manifest,
        )
        self.assertEqual(
            5629108576,
            backend.native_v1.size_bytes if backend.native_v1 else None,
        )
        self.assertEqual(4096, config.execution.context_length)
        self.assertEqual(["127.0.0.1"], config.network.allowed_hosts)

    def test_unknown_yaml_field_is_rejected_without_echoing_value(self) -> None:
        data = self.config.model_dump(mode="python")
        data["private_canary"] = "DO-NOT-ECHO"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.yaml"
            path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
            with self.assertRaises(ConfigurationFailure) as caught:
                load_runtime_config(path)
        self.assertNotIn("DO-NOT-ECHO", str(caught.exception))

    def test_api_root_trailing_slashes_normalize_to_one_form(self) -> None:
        expected = "http://localhost:1234/v1"
        self.assertEqual(expected, normalize_api_root(expected))
        self.assertEqual(expected, normalize_api_root(expected + "/"))
        self.assertEqual(expected, normalize_api_root(expected + "///"))

    def test_endpoint_join_never_duplicates_v1_or_slashes(self) -> None:
        self.assertEqual(
            "http://127.0.0.1:8080/v1/chat/completions",
            build_api_url("http://127.0.0.1:8080/v1///", "/chat/completions/"),
        )
        with self.assertRaises(ConfigurationFailure):
            build_api_url("http://127.0.0.1:8080/v1", "v1/models")
        with self.assertRaises(ConfigurationFailure):
            build_api_url("http://127.0.0.1:8080/v1", "chat//completions")
        with self.assertRaises(ConfigurationFailure):
            build_api_url("http://127.0.0.1:8080/v1", "embeddings")

    def test_native_api_root_and_endpoint_allowlist_are_exact(self) -> None:
        expected = "http://127.0.0.1:1234/api/v1"
        self.assertEqual(expected, normalize_lm_studio_native_api_root(expected + "///"))
        self.assertEqual(
            expected + "/models",
            build_lm_studio_native_api_url(expected, "/models/"),
        )
        self.assertEqual(
            expected + "/chat",
            build_lm_studio_native_api_url(expected, "chat"),
        )
        for endpoint in ("chat/completions", "v1/models", "models/extra", "load"):
            with self.subTest(endpoint=endpoint), self.assertRaises(ConfigurationFailure):
                build_lm_studio_native_api_url(expected, endpoint)
        for root in (
            "http://127.0.0.1:1234/v1",
            "http://127.0.0.1:1234/api/v1/models",
            "http://user@127.0.0.1:1234/api/v1",
            "http://127.0.0.1:1234/api/v1?secret=x",
        ):
            with self.subTest(root=root), self.assertRaises(ConfigurationFailure):
                normalize_lm_studio_native_api_root(root)
        for root in (
            "http://localhost:1234/api/v1",
            "http://[::1]:1234/api/v1",
            "http://0.0.0.0:1234/api/v1",
            "http://192.168.1.50:1234/api/v1",
        ):
            with self.subTest(root=root), self.assertRaises(PrivacyPolicyFailure):
                normalize_lm_studio_native_api_root(root)

    def test_api_root_rejects_non_root_paths_and_unsafe_url_parts(self) -> None:
        invalid = (
            "http://localhost:1234",
            "http://localhost:1234/v1/v1",
            "http://localhost:1234/openai//v1",
            "http://user:password@localhost:1234/v1",
            "http://localhost:1234/v1?token=secret",
            "http://localhost:1234/v1?",
            "http://localhost:1234/v1#fragment",
            "http://localhost:1234/v1#",
        )
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ConfigurationFailure):
                normalize_api_root(value)

    def test_bind_addresses_are_never_connection_targets(self) -> None:
        for value in ("http://0.0.0.0:1234/v1", "http://[::]:1234/v1"):
            with self.subTest(value=value), self.assertRaises(PrivacyPolicyFailure):
                normalize_api_root(value)

    def test_optional_api_key_env_may_be_unset(self) -> None:
        config = self.remote_config()
        resolved = resolve_backend_config(
            config,
            environ={
                "KAYRA_LM_STUDIO_BASE_URL": "http://localhost:1234/v1/",
                "KAYRA_LM_STUDIO_MODEL": "local-model",
            },
        )
        self.assertIsNone(resolved.api_key)

    def test_fulgor_environment_names_resolve_without_legacy_names(self) -> None:
        resolved = resolve_backend_config(
            self.remote_config(),
            environ={
                "FULGOR_LM_STUDIO_BASE_URL": "http://localhost:1234/v1/",
                "FULGOR_LM_STUDIO_MODEL": "local-model",
                "FULGOR_LM_STUDIO_MODEL_REVISION": "local-revision",
            },
        )
        self.assertEqual("http://localhost:1234/v1", resolved.api_root)
        self.assertEqual("local-model", resolved.model_id)
        self.assertEqual("local-revision", resolved.model_revision)

    def test_legacy_environment_names_still_resolve(self) -> None:
        resolved = resolve_backend_config(
            self.remote_config(),
            environ={
                "KAYRA_LM_STUDIO_BASE_URL": "http://localhost:1234/v1/",
                "KAYRA_LM_STUDIO_MODEL": "legacy-model",
            },
        )
        self.assertEqual("http://localhost:1234/v1", resolved.api_root)
        self.assertEqual("legacy-model", resolved.model_id)

    def test_matching_fulgor_and_kayra_environment_values_are_accepted(self) -> None:
        environment = {
            "FULGOR_LM_STUDIO_BASE_URL": "http://localhost:1234/v1",
            "KAYRA_LM_STUDIO_BASE_URL": "http://localhost:1234/v1",
            "FULGOR_LM_STUDIO_MODEL": "same-model",
            "KAYRA_LM_STUDIO_MODEL": "same-model",
        }
        resolved = resolve_backend_config(self.remote_config(), environ=environment)
        self.assertEqual("same-model", resolved.model_id)

    def test_conflicting_environment_values_fail_before_transport_without_secrets(self) -> None:
        current_secret = "http://user:current-secret@localhost:1234/v1"
        legacy_secret = "http://user:legacy-secret@localhost:1234/v1"
        transport_factory_calls = 0

        def forbidden_transport_factory(_network):  # type: ignore[no-untyped-def]
            nonlocal transport_factory_calls
            transport_factory_calls += 1
            self.fail("transport factory must not be called")

        with self.assertRaises(ConfigurationFailure) as caught:
            run_preflight(
                self.remote_config(),
                environ={
                    "FULGOR_LM_STUDIO_BASE_URL": current_secret,
                    "KAYRA_LM_STUDIO_BASE_URL": legacy_secret,
                    "FULGOR_LM_STUDIO_MODEL": "same-model",
                    "KAYRA_LM_STUDIO_MODEL": "same-model",
                },
                transport_factory=forbidden_transport_factory,
            )

        message = str(caught.exception)
        self.assertEqual(0, transport_factory_calls)
        self.assertIn("FULGOR_LM_STUDIO_BASE_URL", message)
        self.assertIn("KAYRA_LM_STUDIO_BASE_URL", message)
        self.assertNotIn(current_secret, message)
        self.assertNotIn(legacy_secret, message)

    def test_fulgor_alias_preserves_default_lm_studio_model_identity(self) -> None:
        config = load_runtime_config(
            ROOT / "configs" / "runtime.kayra-v1.lm-studio.yaml"
        )
        resolved = resolve_backend_config(
            config,
            environ={
                "FULGOR_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1",
                "FULGOR_LM_STUDIO_MODEL": "qwen3.5-9b-kayra-v1",
            },
        )
        self.assertEqual("qwen3.5-9b-kayra-v1", resolved.model_id)

    def test_optional_api_key_env_field_may_be_omitted(self) -> None:
        data = self.remote_config().model_dump(mode="python")
        data["backends"]["lm_studio"].pop("api_key_env")
        config = RuntimeConfig.model_validate(data)
        resolved = resolve_backend_config(
            config,
            environ={
                "KAYRA_LM_STUDIO_BASE_URL": "http://localhost:1234/v1",
                "KAYRA_LM_STUDIO_MODEL": "local-model",
            },
        )
        self.assertIsNone(resolved.api_key)

    def test_schema_and_models_agree_on_defaulted_optional_fields(self) -> None:
        data = self.config.model_dump(mode="python")
        data["backends"]["mock"]["model"].pop("artifact_sha256")
        data["backends"]["lm_studio"].pop("enabled")
        validated = RuntimeConfig.model_validate(data)
        self.assertIsNone(validated.backends.mock.model.artifact_sha256)
        self.assertFalse(validated.backends.lm_studio.enabled)

        schema = json.loads(
            (ROOT / "schemas" / "runtime-config.schema.json").read_text(encoding="utf-8")
        )
        mappings = (
            (ExecutionConfig, "execution"),
            (NetworkConfig, "network"),
            (PrivacyConfig, "privacy"),
            (ConfiguredModel, "model"),
            (LMStudioBackendConfig, "remoteBackendBase"),
            (LMStudioNativeV1Config, "lmStudioNativeV1"),
            (ProfileConfig, "profile"),
        )
        for model, definition in mappings:
            with self.subTest(model=model.__name__, definition=definition):
                pydantic_required = {
                    name for name, field in model.model_fields.items() if field.is_required()
                }
                schema_required = set(schema["$defs"][definition].get("required", []))
                self.assertEqual(pydantic_required, schema_required)

    def test_native_mode_requires_manifest_and_exact_expectations(self) -> None:
        data = self.config.model_dump(mode="python")
        backend = data["backends"]["lm_studio"]
        backend["api_mode"] = "native_v1"
        data["network"]["allowed_hosts"] = ["127.0.0.1"]
        backend["model_manifest"] = None
        backend["native_v1"] = None
        with self.assertRaises(ValueError):
            RuntimeConfig.model_validate(data)

        backend["model_manifest"] = "configs/models/qwen3-14b-q4_k_m.yaml"
        backend["native_v1"] = {
            "model_format": "gguf",
            "quantization": "Q4_K_M",
            "size_bytes": 9001752960,
            "context_length": 4096,
            "parallel": 1,
            "offload_kv_cache_to_gpu": False,
        }
        validated = RuntimeConfig.model_validate(data)
        self.assertEqual("native_v1", validated.backends.lm_studio.api_mode)

        backend["native_v1"]["quantization"] = "Q3_K_M"
        with self.assertRaises(ValueError):
            RuntimeConfig.model_validate(data)

        backend["native_v1"]["quantization"] = "Q4_K_M"
        backend["native_v1"]["size_bytes"] = 9001752959
        with self.assertRaises(ValueError):
            RuntimeConfig.model_validate(data)

    def test_native_manifest_and_size_cannot_be_mixed(self) -> None:
        data = load_runtime_config(
            ROOT / "configs" / "runtime.kayra-v1.lm-studio.yaml"
        ).model_dump(mode="python")
        data["backends"]["lm_studio"]["model_manifest"] = (
            "configs/models/qwen3-14b-q4_k_m.yaml"
        )
        with self.assertRaises(ValueError):
            RuntimeConfig.model_validate(data)

    def test_native_mode_rejects_network_context_and_profile_fallback_drift(self) -> None:
        native = load_runtime_config(ROOT / "configs" / "runtime.lm-studio.yaml")
        changes = (
            ("network host", lambda item: item["network"].update(allowed_hosts=["localhost"])),
            ("non-loopback", lambda item: item["network"].update(allow_non_loopback=True)),
            ("context", lambda item: item["execution"].update(context_length=8192)),
            (
                "fallback",
                lambda item: item["profiles"]["thinking"].update(
                    unsupported_capability="backend_default"
                ),
            ),
        )
        for label, mutate in changes:
            data = native.model_dump(mode="python")
            mutate(data)
            with self.subTest(label=label), self.assertRaises(ValueError):
                RuntimeConfig.model_validate(data)

    def test_api_key_is_excluded_and_masked(self) -> None:
        canary = "API-KEY-CANARY-83f10"
        api_root_canary = "localhost:1234"
        model_canary = "local-model"
        config = self.remote_config()
        resolved = resolve_backend_config(
            config,
            environ={
                "KAYRA_LM_STUDIO_BASE_URL": "http://localhost:1234/v1",
                "KAYRA_LM_STUDIO_MODEL": "local-model",
                "KAYRA_LM_STUDIO_API_KEY": canary,
            },
        )
        self.assertNotIn(canary, repr(resolved))
        self.assertNotIn(canary, str(resolved.model_dump()))
        self.assertNotIn(canary, resolved.model_dump_json())
        self.assertNotIn("api_key", resolved.model_dump())
        self.assertNotIn(api_root_canary, repr(resolved))
        self.assertNotIn(model_canary, repr(resolved))
        self.assertNotIn(api_root_canary, resolved.model_dump_json())
        self.assertNotIn(model_canary, resolved.model_dump_json())
        self.assertEqual({"kind": "lm_studio"}, resolved.model_dump())

    def test_missing_required_env_is_safe_configuration_error(self) -> None:
        config = self.remote_config()
        with self.assertRaises(ConfigurationFailure) as caught:
            resolve_backend_config(config, environ={})
        self.assertIn("KAYRA_LM_STUDIO_BASE_URL", str(caught.exception))

    def test_non_loopback_requires_flag_and_exact_allowlist(self) -> None:
        environment = {
            "KAYRA_LM_STUDIO_BASE_URL": "http://192.168.1.50:1234/v1",
            "KAYRA_LM_STUDIO_MODEL": "local-model",
        }
        with self.assertRaises(PrivacyPolicyFailure):
            resolve_backend_config(self.remote_config(), environ=environment)
        with self.assertRaises(PrivacyPolicyFailure):
            resolve_backend_config(
                self.remote_config(allow_non_loopback=True, allowed_hosts=["localhost"]),
                environ=environment,
            )
        resolved = resolve_backend_config(
            self.remote_config(allow_non_loopback=True, allowed_hosts=["192.168.1.50"]),
            environ=environment,
        )
        self.assertEqual("http://192.168.1.50:1234/v1", resolved.api_root)

    def test_manifest_path_rejects_parent_traversal(self) -> None:
        for bad in (
            "configs/models/../models/fulgor-ray-v1-q4_k_m.yaml",
            "configs/models/../../passwords.yaml",
            "configs/../configs/models/fulgor-ray-v1-q4_k_m.yaml",
        ):
            with self.subTest(path=bad):
                with self.assertRaises(ValueError) as caught:
                    validate_model_manifest_path(bad, repository_root=ROOT)
                self.assertIn("üst dizin geçişi", str(caught.exception))

    def test_manifest_path_rejects_absolute_paths(self) -> None:
        for bad in (
            "/configs/models/model.yaml",
            "C:/configs/models/model.yaml",
            "C:\\configs\\models\\model.yaml",
            "\\\\server\\share\\model.yaml",
            "\\\\127.0.0.1\\share\\configs\\models\\model.yaml",
        ):
            with self.subTest(path=bad):
                with self.assertRaises(ValueError) as caught:
                    validate_model_manifest_path(bad, repository_root=ROOT)
                self.assertIn("mutlak yol", str(caught.exception))

    def test_manifest_path_rejects_escaping_configs_models(self) -> None:
        for bad in ("configs/other/model.yaml", "data/models/model.yaml"):
            with self.subTest(path=bad):
                with self.assertRaises(ValueError) as caught:
                    validate_model_manifest_path(bad, repository_root=ROOT)
                self.assertIn("configs/models/", str(caught.exception))

    def test_manifest_path_rejects_malformed_extensions(self) -> None:
        for bad in (
            "configs/models/model.json",
            "configs/models/model.txt",
            "configs/models/model",
        ):
            with self.subTest(path=bad):
                with self.assertRaises(ValueError) as caught:
                    validate_model_manifest_path(bad, repository_root=ROOT)
                self.assertIn(".yaml veya .yml", str(caught.exception))

    def test_manifest_path_rejects_nonexistent_file(self) -> None:
        with self.assertRaises(ValueError) as caught:
            validate_model_manifest_path(
                "configs/models/nonexistent_model_123.yaml", repository_root=ROOT
            )
        self.assertIn("bulunamadı", str(caught.exception))

    def test_arbitrary_valid_manifest_under_configs_models_is_accepted(self) -> None:
        manifest_content = {
            "schema_version": "1.0",
            "id": "candidate-custom-model-q4",
            "repository": "candidate/custom-model",
            "commit": "a" * 40,
            "license": "Apache-2.0",
            "format": "GGUF",
            "quantization": "Q4_K_M",
            "context_length": 4096,
            "files": [
                {
                    "filename": "Custom-Model.gguf",
                    "size_bytes": 12345678,
                    "sha256": "c" * 64,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            models_dir = temp_root / "configs" / "models"
            models_dir.mkdir(parents=True)
            manifest_file = models_dir / "candidate_model.yaml"
            manifest_file.write_text(yaml.safe_dump(manifest_content), encoding="utf-8")

            resolved = validate_model_manifest_path(
                "configs/models/candidate_model.yaml", repository_root=temp_root
            )
            self.assertEqual(manifest_file.resolve(), resolved)

    def test_native_config_rejects_mismatched_size_format_quantization(self) -> None:
        base = {
            "kind": "lm_studio",
            "enabled": True,
            "base_url_env": "TEST_BASE_URL",
            "model_id_env": "TEST_MODEL_ID",
            "api_mode": "native_v1",
            "model_manifest": "configs/models/fulgor-ray-v1-q4_k_m.yaml",
            "native_v1": {
                "model_format": "gguf",
                "quantization": "Q4_K_M",
                "size_bytes": 5629108576,
                "context_length": 4096,
                "parallel": 1,
                "offload_kv_cache_to_gpu": False,
            },
        }
        # Valid config passes:
        LMStudioBackendConfig.model_validate(base)

        # Mismatched size:
        mismatched_size = dict(base)
        mismatched_size["native_v1"] = dict(base["native_v1"], size_bytes=9999999999)
        with self.assertRaises(ValueError) as caught:
            LMStudioBackendConfig.model_validate(mismatched_size)
        self.assertIn("size_bytes", str(caught.exception))

        # Mismatched quantization:
        mismatched_quant = dict(base)
        mismatched_quant["native_v1"] = dict(base["native_v1"], quantization="Q8_0")
        with self.assertRaises(ValueError):
            LMStudioBackendConfig.model_validate(mismatched_quant)


if __name__ == "__main__":
    unittest.main()
