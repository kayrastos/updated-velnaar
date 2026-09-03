from __future__ import annotations

import json
import socket
import unittest
from pathlib import Path
from unittest.mock import patch

from kayra_ai.runtime.config import RuntimeConfig, load_runtime_config, resolve_backend_config
from kayra_ai.runtime.errors import ConfigurationFailure
from kayra_ai.runtime.preflight import run_preflight
from kayra_ai.validation.model_artifact import load_model_artifact


ROOT = Path(__file__).resolve().parents[1]
LEGACY_MODEL_PROFILE = (
    ROOT / "configs" / "models" / "qwen3_5_9b_kayra_v1_q4_k_m.yaml"
)
FULGOR_MODEL_PROFILE = ROOT / "configs" / "models" / "fulgor-ray-v1-q4_k_m.yaml"
LEGACY_RUNTIME_PROFILE = ROOT / "configs" / "runtime.kayra-v1.lm-studio.yaml"
FULGOR_RUNTIME_PROFILE = ROOT / "configs" / "runtime.fulgor-ray-v1.lm-studio.yaml"
MODEL_ID = "qwen3.5-9b-kayra-v1"
ARTIFACT_SHA256 = "4ef803a9e021139abff93f6e6ecb358491c16ad9c6a841c3ad55fa512283c238"


class FulgorProfileCompatibilityTests(unittest.TestCase):
    def test_new_profiles_load_with_existing_contracts_and_schema_allowlist(self) -> None:
        artifact = load_model_artifact(FULGOR_MODEL_PROFILE)
        runtime = load_runtime_config(FULGOR_RUNTIME_PROFILE)
        schema = json.loads(
            (ROOT / "schemas" / "runtime-config.schema.json").read_text(
                encoding="utf-8"
            )
        )
        manifest_prop = schema["$defs"]["backends"]["properties"]["lm_studio"][
            "allOf"
        ][2]["then"]["properties"]["model_manifest"]

        self.assertEqual("1.0", artifact.schema_version)
        self.assertEqual("1.0", runtime.schema_version)
        self.assertEqual(r"^configs/models/.+\.ya?ml$", manifest_prop.get("pattern"))

        arbitrary = runtime.model_dump(mode="python")
        arbitrary["backends"]["lm_studio"]["model_manifest"] = (
            "configs/models/arbitrary-model.yaml"
        )
        with self.assertRaises(ValueError):
            RuntimeConfig.model_validate(arbitrary)

        extra = runtime.model_dump(mode="python")
        extra["unexpected"] = True
        with self.assertRaises(ValueError):
            RuntimeConfig.model_validate(extra)

    def test_fulgor_model_profile_is_an_exact_artifact_alias(self) -> None:
        legacy = load_model_artifact(LEGACY_MODEL_PROFILE)
        fulgor = load_model_artifact(FULGOR_MODEL_PROFILE)

        self.assertEqual(
            legacy.model_dump(exclude={"id"}),
            fulgor.model_dump(exclude={"id"}),
        )
        self.assertEqual("fulgor-ray-v1-genesis", fulgor.id)
        self.assertEqual("Qwen/Qwen3.5-9B", fulgor.repository)
        self.assertEqual("Q4_K_M", fulgor.quantization)
        self.assertEqual(4096, fulgor.context_length)
        self.assertEqual(
            "kayraai-qwen3.5-9b-kayra-v1-Q4_K_M-no-mtp.gguf",
            fulgor.files[0].filename,
        )
        self.assertEqual(ARTIFACT_SHA256, fulgor.files[0].sha256)

    def test_fulgor_and_legacy_runtime_profiles_are_effectively_equal(self) -> None:
        legacy = load_runtime_config(LEGACY_RUNTIME_PROFILE)
        fulgor = load_runtime_config(FULGOR_RUNTIME_PROFILE)

        self.assertEqual(legacy.schema_version, fulgor.schema_version)
        self.assertEqual(legacy.assistant_config, fulgor.assistant_config)
        self.assertEqual(legacy.active_backend, fulgor.active_backend)
        self.assertEqual(legacy.execution, fulgor.execution)
        self.assertEqual(legacy.network, fulgor.network)
        self.assertEqual(legacy.privacy, fulgor.privacy)
        self.assertEqual(legacy.profiles, fulgor.profiles)
        self.assertEqual(
            legacy.backends.lm_studio.model_dump(
                exclude={
                    "base_url_env",
                    "model_id_env",
                    "model_revision_env",
                    "api_key_env",
                    "model_manifest",
                }
            ),
            fulgor.backends.lm_studio.model_dump(
                exclude={
                    "base_url_env",
                    "model_id_env",
                    "model_revision_env",
                    "api_key_env",
                    "model_manifest",
                }
            ),
        )
        self.assertEqual(
            legacy.backends.llama_cpp.model_dump(
                exclude={
                    "base_url_env",
                    "model_id_env",
                    "model_revision_env",
                    "api_key_env",
                }
            ),
            fulgor.backends.llama_cpp.model_dump(
                exclude={
                    "base_url_env",
                    "model_id_env",
                    "model_revision_env",
                    "api_key_env",
                }
            ),
        )

        legacy_environment = {
            "KAYRA_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1",
            "KAYRA_LM_STUDIO_MODEL": MODEL_ID,
        }
        fulgor_environment = {
            "FULGOR_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1",
            "FULGOR_LM_STUDIO_MODEL": MODEL_ID,
        }
        legacy_resolved = resolve_backend_config(legacy, environ=legacy_environment)
        fulgor_resolved = resolve_backend_config(fulgor, environ=fulgor_environment)
        fulgor_from_legacy = resolve_backend_config(fulgor, environ=legacy_environment)
        expected = (
            legacy_resolved.kind,
            legacy_resolved.api_root,
            legacy_resolved.model_id,
            legacy_resolved.model_revision,
            legacy_resolved.api_mode,
            legacy_resolved.native_v1,
        )
        self.assertEqual(
            expected,
            (
                fulgor_resolved.kind,
                fulgor_resolved.api_root,
                fulgor_resolved.model_id,
                fulgor_resolved.model_revision,
                fulgor_resolved.api_mode,
                fulgor_resolved.native_v1,
            ),
        )
        self.assertEqual(MODEL_ID, fulgor_resolved.model_id)
        self.assertEqual(MODEL_ID, fulgor_from_legacy.model_id)
        self.assertNotEqual(
            load_model_artifact(FULGOR_MODEL_PROFILE).id,
            fulgor_resolved.model_id,
        )

    def test_legacy_profiles_continue_to_load(self) -> None:
        self.assertEqual(MODEL_ID, load_model_artifact(LEGACY_MODEL_PROFILE).id)
        self.assertEqual(
            "lm_studio",
            load_runtime_config(LEGACY_RUNTIME_PROFILE).active_backend,
        )
        self.assertEqual(
            "lm_studio",
            load_runtime_config(ROOT / "configs" / "runtime.lm-studio.yaml").active_backend,
        )

    def test_fulgor_profile_conflict_fails_before_transport_or_socket(self) -> None:
        config = load_runtime_config(FULGOR_RUNTIME_PROFILE)
        transport_factory_calls = 0

        def forbidden_transport_factory(_network):  # type: ignore[no-untyped-def]
            nonlocal transport_factory_calls
            transport_factory_calls += 1
            self.fail("transport factory must not be called")

        with (
            patch.object(
                socket,
                "socket",
                side_effect=AssertionError("test attempted socket.socket"),
            ) as socket_constructor,
            patch.object(
                socket,
                "create_connection",
                side_effect=AssertionError("test attempted socket.create_connection"),
            ) as create_connection,
            self.assertRaises(ConfigurationFailure),
        ):
            run_preflight(
                config,
                environ={
                    "FULGOR_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1",
                    "KAYRA_LM_STUDIO_BASE_URL": "http://127.0.0.1:4321/api/v1",
                    "FULGOR_LM_STUDIO_MODEL": MODEL_ID,
                    "KAYRA_LM_STUDIO_MODEL": MODEL_ID,
                },
                transport_factory=forbidden_transport_factory,
            )

        self.assertEqual(0, transport_factory_calls)
        socket_constructor.assert_not_called()
        create_connection.assert_not_called()

    def test_historical_manifests_remain_valid_and_compatible(self) -> None:
        for manifest_rel in (
            "configs/models/qwen3-14b-q4_k_m.yaml",
            "configs/models/qwen3_5_9b_kayra_v1_q4_k_m.yaml",
            "configs/models/fulgor-ray-v1-q4_k_m.yaml",
        ):
            with self.subTest(manifest=manifest_rel):
                artifact = load_model_artifact(ROOT / manifest_rel)
                self.assertEqual("1.0", artifact.schema_version)
                self.assertEqual("GGUF", artifact.format)
                self.assertEqual("Q4_K_M", artifact.quantization)
                self.assertEqual(64, len(artifact.files[0].sha256))


if __name__ == "__main__":
    unittest.main()
