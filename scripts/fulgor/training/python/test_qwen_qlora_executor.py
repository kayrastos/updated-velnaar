from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent

EXECUTOR_PATH = (
    HERE / "qwen_qlora_executor.py"
)

spec = (
    importlib.util
    .spec_from_file_location(
        "qwen_qlora_executor",
        EXECUTOR_PATH,
    )
)

if (
    spec is None
    or spec.loader is None
):
    raise RuntimeError(
        "EXECUTOR_IMPORT_FAILED"
    )

executor = (
    importlib.util
    .module_from_spec(spec)
)

sys.modules[
    "qwen_qlora_executor"
] = executor

spec.loader.exec_module(
    executor
)


def digest(
    path: Path,
) -> str:
    return hashlib.sha256(
        path.read_bytes()
    ).hexdigest()


class FakeCuda:
    @staticmethod
    def is_available():
        return True

    @staticmethod
    def device_count():
        return 1

    @staticmethod
    def get_device_name(index):
        if index != 0:
            raise AssertionError(index)

        return "NVIDIA L4"

    @staticmethod
    def get_device_capability(index):
        if index != 0:
            raise AssertionError(index)

        return (8, 9)

    @staticmethod
    def is_bf16_supported():
        return True


class FakeTorch:
    cuda = FakeCuda()


class ExecutorTests(
    unittest.TestCase
):
    def fixture(self):
        temp = (
            tempfile
            .TemporaryDirectory()
        )

        root = Path(temp.name)

        data_root = root / "data"
        output_root = root / "output"

        data_root.mkdir()
        output_root.mkdir()

        train = (
            data_root /
            "train.jsonl"
        )

        dev = (
            data_root /
            "dev.jsonl"
        )

        def record(
            label: str,
        ) -> str:
            return (
                json.dumps(
                    {
                        "messages": [
                            {
                                "role":
                                    "system",
                                "content":
                                    "system",
                            },
                            {
                                "role":
                                    "user",
                                "content":
                                    label,
                            },
                            {
                                "role":
                                    "assistant",
                                "content":
                                    "answer",
                            },
                        ]
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )

        train.write_text(
            record("train"),
            encoding="utf-8",
            newline="\n",
        )

        dev.write_text(
            record("dev"),
            encoding="utf-8",
            newline="\n",
        )

        request = {
            "schemaVersion":
                executor.SCHEMA_VERSION,

            "executionIntent":
                "PREFLIGHT_ONLY",

            "runnerContractSha256":
                "a" * 64,

            "model":
                dict(
                    executor
                    .EXPECTED_MODEL
                ),

            "runtime":
                dict(
                    executor
                    .EXPECTED_RUNTIME
                ),

            "quantization":
                dict(
                    executor
                    .EXPECTED_QUANTIZATION
                ),

            "lora":
                dict(
                    executor
                    .EXPECTED_LORA
                ),

            "training":
                dict(
                    executor
                    .EXPECTED_TRAINING
                ),

            "output": {
                "outputKind":
                    "PEFT_ADAPTER_ONLY",
                "mergeAdapterIntoBase":
                    False,
                "pushToHub":
                    False,
                "outputDir":
                    str(
                        output_root /
                        "candidate-001"
                    ),
            },

            "data": {
                "trainJsonlPath":
                    str(train),
                "trainJsonlSha256":
                    digest(train),
                "trainExampleCount":
                    1,
                "devJsonlPath":
                    str(dev),
                "devJsonlSha256":
                    digest(dev),
                "devExampleCount":
                    1,
                "sourceFinalHoldoutCommitmentSha256":
                    "b" * 64,
            },
        }

        return (
            temp,
            data_root,
            output_root,
            train,
            dev,
            request,
        )

    def test_valid_dry_run_is_non_authoritative(
        self,
    ):
        (
            temp,
            data_root,
            output_root,
            _train,
            _dev,
            request,
        ) = self.fixture()

        self.addCleanup(
            temp.cleanup
        )

        result = (
            executor
            .validate_request(
                request,
                data_root,
                output_root,
            )
        )

        self.assertTrue(
            result["accepted"]
        )

        self.assertFalse(
            result[
                "executionAuthorized"
            ]
        )

        self.assertFalse(
            result["trainingStarted"]
        )

        self.assertFalse(
            result[
                "modelDownloadStarted"
            ]
        )

    def test_rejects_other_git_sha(
        self,
    ):
        (
            temp,
            data_root,
            output_root,
            _train,
            _dev,
            request,
        ) = self.fixture()

        self.addCleanup(
            temp.cleanup
        )

        request["model"][
            "modelRevisionSha"
        ] = "f" * 40

        with self.assertRaisesRegex(
            executor.ExecutorError,
            "MODEL_CONTRACT_MISMATCH",
        ):
            executor.validate_request(
                request,
                data_root,
                output_root,
            )

    def test_rejects_tampered_train_data(
        self,
    ):
        (
            temp,
            data_root,
            output_root,
            train,
            _dev,
            request,
        ) = self.fixture()

        self.addCleanup(
            temp.cleanup
        )

        train.write_text(
            '{"messages":[{"role":"user","content":"tampered"}]}\n',
            encoding="utf-8",
            newline="\n",
        )

        with self.assertRaisesRegex(
            executor.ExecutorError,
            "TRAIN_JSONL_DIGEST_MISMATCH",
        ):
            executor.validate_request(
                request,
                data_root,
                output_root,
            )

    def test_rejects_authority_escape_field(
        self,
    ):
        (
            temp,
            data_root,
            output_root,
            _train,
            _dev,
            request,
        ) = self.fixture()

        self.addCleanup(
            temp.cleanup
        )

        request[
            "trainingExecutionAuthorized"
        ] = True

        with self.assertRaisesRegex(
            executor.ExecutorError,
            "INVALID_TOP_LEVEL_SHAPE",
        ):
            executor.validate_request(
                request,
                data_root,
                output_root,
            )

    def test_rejects_holdout_path(
        self,
    ):
        (
            temp,
            data_root,
            output_root,
            _train,
            _dev,
            request,
        ) = self.fixture()

        self.addCleanup(
            temp.cleanup
        )

        request["data"][
            "finalHoldoutPath"
        ] = str(
            data_root /
            "holdout.jsonl"
        )

        with self.assertRaisesRegex(
            executor.ExecutorError,
            "INVALID_DATA_SHAPE",
        ):
            executor.validate_request(
                request,
                data_root,
                output_root,
            )

    def test_cuda_probe_accepts_l4(
        self,
    ):
        result = (
            executor
            .probe_cuda_runtime(
                FakeTorch()
            )
        )

        self.assertEqual(
            result["gpuName"],
            "NVIDIA L4",
        )

        self.assertEqual(
            result["gpuCount"],
            1,
        )

        self.assertEqual(
            result[
                "computeCapability"
            ],
            "8.9",
        )

    def test_execute_cli_fails_closed(
        self,
    ):
        (
            temp,
            data_root,
            output_root,
            _train,
            _dev,
            request,
        ) = self.fixture()

        self.addCleanup(
            temp.cleanup
        )

        request_path = (
            Path(temp.name) /
            "request.json"
        )

        request_path.write_text(
            json.dumps(request),
            encoding="utf-8",
        )

        result = subprocess.run(
            [
                sys.executable,
                str(EXECUTOR_PATH),
                "execute",
                "--request",
                str(request_path),
                "--data-root",
                str(data_root),
                "--output-root",
                str(output_root),
            ],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(
            result.returncode,
            2,
        )

        payload = json.loads(
            result.stderr
        )

        self.assertEqual(
            payload["error"],
            "PRODUCTION_EXECUTION_GATE_NOT_WIRED",
        )

        self.assertFalse(
            payload[
                "trainingStarted"
            ]
        )


if __name__ == "__main__":
    unittest.main(
        verbosity=2
    )