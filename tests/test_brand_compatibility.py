from __future__ import annotations

import tomllib
import unittest
from pathlib import Path

from kayra_ai.environment import (
    ENVIRONMENT_ALIASES,
    EnvironmentConfigurationError,
    resolve_environment_value,
)
from kayra_ai.memory.store import default_memory_db_path
from kayra_ai.tools.smoke_cli import LIVE_RUNTIME_ENV


ROOT = Path(__file__).resolve().parents[1]


class BrandCompatibilityTests(unittest.TestCase):
    def test_every_kayra_console_script_has_same_target_fulgor_alias(self) -> None:
        project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        scripts = project["project"]["scripts"]
        legacy = {
            name: target for name, target in scripts.items() if name.startswith("kayra-")
        }

        self.assertEqual(12, len(legacy))
        for legacy_name, target in legacy.items():
            current_name = "fulgor-" + legacy_name.removeprefix("kayra-")
            with self.subTest(legacy=legacy_name, current=current_name):
                self.assertIn(current_name, scripts)
                self.assertEqual(target, scripts[current_name])

    def test_known_environment_aliases_are_complete(self) -> None:
        self.assertEqual(
            {
                "KAYRA_MEMORY_DB": "FULGOR_MEMORY_DB",
                "KAYRA_LM_STUDIO_BASE_URL": "FULGOR_LM_STUDIO_BASE_URL",
                "KAYRA_LM_STUDIO_MODEL": "FULGOR_LM_STUDIO_MODEL",
                "KAYRA_LM_STUDIO_MODEL_REVISION": "FULGOR_LM_STUDIO_MODEL_REVISION",
                "KAYRA_LM_STUDIO_API_KEY": "FULGOR_LM_STUDIO_API_KEY",
                "KAYRA_LLAMA_CPP_BASE_URL": "FULGOR_LLAMA_CPP_BASE_URL",
                "KAYRA_LLAMA_CPP_MODEL": "FULGOR_LLAMA_CPP_MODEL",
                "KAYRA_LLAMA_CPP_MODEL_REVISION": "FULGOR_LLAMA_CPP_MODEL_REVISION",
                "KAYRA_LLAMA_CPP_API_KEY": "FULGOR_LLAMA_CPP_API_KEY",
            },
            dict(ENVIRONMENT_ALIASES),
        )

    def test_only_fulgor_only_kayra_and_equal_values_resolve(self) -> None:
        legacy = "KAYRA_LM_STUDIO_API_KEY"
        current = "FULGOR_LM_STUDIO_API_KEY"
        canary = "local-secret-canary"
        current_environment = {current: canary}
        original_environment = current_environment.copy()

        self.assertEqual(
            canary,
            resolve_environment_value(current_environment, legacy),
        )
        self.assertEqual(original_environment, current_environment)
        self.assertEqual(canary, resolve_environment_value({legacy: canary}, legacy))
        self.assertEqual(
            canary,
            resolve_environment_value({current: canary, legacy: canary}, legacy),
        )
        self.assertIsNone(resolve_environment_value({}, legacy))

    def test_conflicting_values_report_only_names(self) -> None:
        legacy_name = "KAYRA_LM_STUDIO_API_KEY"
        current_name = "FULGOR_LM_STUDIO_API_KEY"
        legacy_value = "legacy-secret-1f93"
        current_value = "current-secret-77ab"

        with self.assertRaises(EnvironmentConfigurationError) as caught:
            resolve_environment_value(
                {legacy_name: legacy_value, current_name: current_value},
                legacy_name,
            )

        message = str(caught.exception)
        self.assertIn(legacy_name, message)
        self.assertIn(current_name, message)
        self.assertNotIn(legacy_value, message)
        self.assertNotIn(current_value, message)

    def test_memory_path_aliases_do_not_change_default_layout(self) -> None:
        current_path = Path("current-memory.sqlite3")
        legacy_path = Path("legacy-memory.sqlite3")
        self.assertEqual(
            current_path,
            default_memory_db_path(environ={"FULGOR_MEMORY_DB": str(current_path)}),
        )
        self.assertEqual(
            legacy_path,
            default_memory_db_path(environ={"KAYRA_MEMORY_DB": str(legacy_path)}),
        )
        self.assertEqual(
            Path("C:/Users/test/AppData/Local/KayraAI/memory/memory.sqlite3"),
            default_memory_db_path(
                environ={"LOCALAPPDATA": "C:/Users/test/AppData/Local"}
            ),
        )

    def test_tool_smoke_keeps_legacy_contract_and_model_identity(self) -> None:
        self.assertEqual(
            {
                "KAYRA_LM_STUDIO_BASE_URL": "http://127.0.0.1:1234/api/v1",
                "KAYRA_LM_STUDIO_MODEL": "qwen3.5-9b-kayra-v1",
            },
            dict(LIVE_RUNTIME_ENV),
        )


if __name__ == "__main__":
    unittest.main()
