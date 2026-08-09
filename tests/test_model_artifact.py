from __future__ import annotations

from copy import deepcopy
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.validation.model_artifact import (
    ModelArtifact,
    ModelArtifactFile,
    ModelArtifactValidationError,
    load_model_artifact,
    validate_model_artifact,
)


MANIFEST_PATH = ROOT / "configs" / "models" / "qwen3-14b-q4_k_m.yaml"


class ModelArtifactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.artifact = load_model_artifact(MANIFEST_PATH)

    def test_repository_manifest_pins_the_official_single_file(self) -> None:
        self.assertEqual("Qwen/Qwen3-14B-GGUF", self.artifact.repository)
        self.assertEqual("c75e7b2d0234068f674a1bacf548ea32e27ccd29", self.artifact.commit)
        self.assertEqual("Apache-2.0", self.artifact.license)
        self.assertEqual("GGUF", self.artifact.format)
        self.assertEqual("Q4_K_M", self.artifact.quantization)
        self.assertEqual(4096, self.artifact.context_length)
        self.assertEqual(1, len(self.artifact.files))

        artifact_file = self.artifact.files[0]
        self.assertEqual("Qwen3-14B-Q4_K_M.gguf", artifact_file.filename)
        self.assertEqual(9001752960, artifact_file.size_bytes)
        self.assertEqual(
            "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0",
            artifact_file.sha256,
        )
        self.assertEqual(9001752960, self.artifact.total_size_bytes)

    def test_validate_alias_returns_the_strict_model(self) -> None:
        artifact = validate_model_artifact(MANIFEST_PATH)
        self.assertIsInstance(artifact, ModelArtifact)

    def test_unknown_field_and_type_coercion_are_rejected(self) -> None:
        data = self.artifact.model_dump(mode="python")
        data["files"][0]["size_bytes"] = "9001752960"
        data["unknown"] = True
        with self.assertRaises(ValueError):
            ModelArtifact.model_validate(data)

    def test_manifest_requires_exactly_one_file(self) -> None:
        data = self.artifact.model_dump(mode="python")
        data["files"] = []
        with self.assertRaises(ValueError):
            ModelArtifact.model_validate(data)

        data = self.artifact.model_dump(mode="python")
        data["files"].append(deepcopy(data["files"][0]))
        with self.assertRaises(ValueError):
            ModelArtifact.model_validate(data)

    def test_invalid_fixture_reports_file_and_each_broken_field(self) -> None:
        path = ROOT / "tests" / "fixtures" / "model_artifact_invalid.yaml"
        with self.assertRaises(ModelArtifactValidationError) as caught:
            load_model_artifact(path)
        message = str(caught.exception)
        self.assertIn(str(path), message)
        self.assertIn("files[0].size_bytes", message)
        self.assertIn("files[0].sha256", message)
        self.assertIn("files[0].unexpected", message)
        self.assertNotIn("not-a-sha256", message)

    def test_json_schema_matches_pydantic_required_fields(self) -> None:
        schema = json.loads(
            (ROOT / "schemas" / "model-artifact.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual("https://json-schema.org/draft/2020-12/schema", schema["$schema"])
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(1, schema["properties"]["files"]["minItems"])
        self.assertEqual(1, schema["properties"]["files"]["maxItems"])

        model_required = {
            name for name, field in ModelArtifact.model_fields.items() if field.is_required()
        }
        file_required = {
            name for name, field in ModelArtifactFile.model_fields.items() if field.is_required()
        }
        self.assertEqual(model_required, set(schema["required"]))
        self.assertEqual(file_required, set(schema["$defs"]["artifactFile"]["required"]))


if __name__ == "__main__":
    unittest.main()
