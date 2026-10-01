#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
from pathlib import Path
import re
import sys
from typing import Any


SCHEMA_VERSION = (
    "FULGOR_QWEN_QLORA_EXECUTOR_REQUEST_V1"
)

MODEL_ID = "Qwen/Qwen3.8-27B"

MODEL_REVISION_SHA = (
    "1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0"
)

MODEL_ARCHITECTURE = (
    "Qwen3_5ForConditionalGeneration"
)

MODEL_TYPE = "qwen3_5"

EXPECTED_TRAINING_STACK_VERSIONS = {
    "transformers": "5.18.0",
    "peft": "0.21.0",
    "bitsandbytes": "0.50.2",
    "accelerate": "1.15.0",
    "safetensors": "0.8.0",
}

EXPECTED_TORCH_VERSION_PREFIX = (
    "2.12.0a0+5aff3928d8"
)

EXPECTED_TORCH_CUDA_PREFIX = "13.2"

SHA256 = re.compile(r"^[a-f0-9]{64}$")
SHA40 = re.compile(r"^[a-f0-9]{40}$")


class ExecutorError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def fail(code: str) -> None:
    raise ExecutorError(code)


def mapping(
    value: Any,
    code: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(code)

    return value


def exact_keys(
    value: dict[str, Any],
    keys: set[str],
    code: str,
) -> None:
    if set(value.keys()) != keys:
        fail(code)


def require_equal(
    actual: Any,
    expected: Any,
    code: str,
) -> None:
    if actual != expected:
        fail(code)


def require_sha256(
    value: Any,
    code: str,
) -> str:
    if (
        not isinstance(value, str)
        or SHA256.fullmatch(value) is None
    ):
        fail(code)

    return value


def require_sha40(
    value: Any,
    code: str,
) -> str:
    if (
        not isinstance(value, str)
        or SHA40.fullmatch(value) is None
    ):
        fail(code)

    return value


def is_link_like(path: Path) -> bool:
    if path.is_symlink():
        return True

    junction_probe = getattr(
        path,
        "is_junction",
        None,
    )

    if junction_probe is not None:
        try:
            if junction_probe():
                return True
        except OSError:
            fail("LINK_INSPECTION_FAILED")

    return False


def assert_no_link_components(
    root: Path,
    candidate: Path,
) -> None:
    if is_link_like(root):
        fail("TRUSTED_ROOT_LINK_FORBIDDEN")

    try:
        relative = candidate.relative_to(root)
    except ValueError:
        fail("PATH_OUTSIDE_TRUSTED_ROOT")

    current = root

    for component in relative.parts:
        current = current / component

        if (
            current.exists()
            and is_link_like(current)
        ):
            fail("LINK_PATH_COMPONENT_FORBIDDEN")


def resolve_input_file(
    root: Path,
    raw: Any,
) -> Path:
    if (
        not isinstance(raw, str)
        or not raw
    ):
        fail("INVALID_INPUT_PATH")

    candidate = Path(raw)

    if not candidate.is_absolute():
        fail("INPUT_PATH_NOT_ABSOLUTE")

    try:
        trusted_root = root.resolve(
            strict=True
        )
    except OSError:
        fail("DATA_ROOT_INVALID")

    if not trusted_root.is_dir():
        fail("DATA_ROOT_NOT_DIRECTORY")

    assert_no_link_components(
        trusted_root,
        candidate,
    )

    try:
        resolved = candidate.resolve(
            strict=True
        )
    except OSError:
        fail("INPUT_FILE_MISSING")

    try:
        resolved.relative_to(
            trusted_root
        )
    except ValueError:
        fail("INPUT_PATH_ESCAPES_DATA_ROOT")

    if not resolved.is_file():
        fail("INPUT_NOT_FILE")

    return resolved


def resolve_output_dir(
    root: Path,
    raw: Any,
) -> Path:
    if (
        not isinstance(raw, str)
        or not raw
    ):
        fail("INVALID_OUTPUT_PATH")

    candidate = Path(raw)

    if not candidate.is_absolute():
        fail("OUTPUT_PATH_NOT_ABSOLUTE")

    try:
        trusted_root = root.resolve(
            strict=True
        )
    except OSError:
        fail("OUTPUT_ROOT_INVALID")

    if not trusted_root.is_dir():
        fail("OUTPUT_ROOT_NOT_DIRECTORY")

    assert_no_link_components(
        trusted_root,
        candidate,
    )

    resolved = candidate.resolve(
        strict=False
    )

    try:
        resolved.relative_to(
            trusted_root
        )
    except ValueError:
        fail("OUTPUT_PATH_ESCAPES_OUTPUT_ROOT")

    if resolved == trusted_root:
        fail("OUTPUT_ROOT_ITSELF_FORBIDDEN")

    return resolved


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as handle:
        while True:
            block = handle.read(
                1024 * 1024
            )

            if not block:
                break

            digest.update(block)

    return digest.hexdigest()


def validate_jsonl(
    path: Path,
    expected_count: Any,
) -> int:
    if (
        not isinstance(expected_count, int)
        or isinstance(expected_count, bool)
        or expected_count < 1
    ):
        fail("INVALID_EXAMPLE_COUNT")

    count = 0

    with path.open(
        "r",
        encoding="utf-8",
        newline="",
    ) as handle:
        for raw_line in handle:
            if not raw_line.endswith("\n"):
                fail("JSONL_LINE_MUST_END_LF")

            line = raw_line[:-1]

            if line.endswith("\r"):
                fail("JSONL_CRLF_FORBIDDEN")

            if not line:
                fail("JSONL_EMPTY_LINE")

            try:
                record = json.loads(
                    line
                )
            except json.JSONDecodeError:
                fail("INVALID_JSONL")

            if not isinstance(
                record,
                dict,
            ):
                fail("JSONL_RECORD_NOT_OBJECT")

            messages = record.get(
                "messages"
            )

            if (
                not isinstance(messages, list)
                or len(messages) < 1
            ):
                fail("JSONL_MESSAGES_INVALID")

            for message in messages:
                if not isinstance(
                    message,
                    dict,
                ):
                    fail("JSONL_MESSAGE_INVALID")

                if set(message.keys()) != {
                    "role",
                    "content",
                }:
                    fail(
                        "JSONL_MESSAGE_SHAPE_INVALID"
                    )

                if message["role"] not in {
                    "system",
                    "user",
                    "assistant",
                }:
                    fail(
                        "JSONL_MESSAGE_ROLE_INVALID"
                    )

                if (
                    not isinstance(
                        message["content"],
                        str,
                    )
                    or not message["content"]
                ):
                    fail(
                        "JSONL_MESSAGE_CONTENT_INVALID"
                    )

            count += 1

    if count != expected_count:
        fail(
            "JSONL_EXAMPLE_COUNT_MISMATCH"
        )

    return count


EXPECTED_MODEL = {
    "modelId":
        MODEL_ID,
    "modelRevisionSha":
        MODEL_REVISION_SHA,
    "architecture":
        MODEL_ARCHITECTURE,
    "modelType":
        MODEL_TYPE,
    "sourceFormat":
        "HF_SAFETENSORS",
    "requireSafeTensors":
        True,
    "trustRemoteCode":
        False,
    "ggufInputAllowed":
        False,
}

EXPECTED_RUNTIME = {
    "implementation":
        "TRANSFORMERS_PEFT_BITSANDBYTES",
    "targetRuntime":
        "GCE_SPOT_SINGLE_L4_24GB",
    "expectedGpu":
        "NVIDIA_L4_24GB",
    "expectedGpuCount":
        1,
    "minimumCudaComputeCapability":
        "8.9",
    "worldSize":
        1,
    "finalHoldoutAccessible":
        False,
}

EXPECTED_QUANTIZATION = {
    "loadIn4Bit":
        True,
    "quantType":
        "NF4",
    "computeDtype":
        "BFLOAT16",
    "useDoubleQuant":
        True,
    "threeBitAllowed":
        False,
}

EXPECTED_LORA = {
    "rank":
        32,
    "alpha":
        64,
    "dropout":
        0.05,
    "bias":
        "none",
    "taskType":
        "CAUSAL_LM",
    "targetScope":
        "TEXT_LANGUAGE_MODEL_ONLY",
    "textModelPrefix":
        "model.language_model.layers.",
    "expectedTextLayerCount":
        64,
    "expectedFullAttentionLayerCount":
        16,
    "expectedLinearAttentionLayerCount":
        48,
    "fullAttentionTargetModules": [
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",
    ],
    "linearAttentionTargetModules": [
        "in_proj_qkv",
        "in_proj_a",
        "in_proj_b",
        "in_proj_z",
        "out_proj",
    ],
    "mlpTargetModules": [
        "gate_proj",
        "up_proj",
        "down_proj",
    ],
    "requireExactTargetResolution":
        True,
    "visionModulesAllowed":
        False,
}

EXPECTED_TRAINING = {
    "maxSequenceLength":
        1536,
    "perDeviceTrainBatchSize":
        1,
    "perDeviceEvalBatchSize":
        1,
    "gradientAccumulationSteps":
        16,
    "numTrainEpochs":
        1,
    "learningRate":
        0.0002,
    "warmupRatio":
        0.03,
    "maxGradNorm":
        1,
    "optimizer":
        "PAGED_ADAMW_8BIT",
    "scheduler":
        "COSINE",
    "gradientCheckpointing":
        True,
    "useCache":
        False,
    "packing":
        False,
    "seed":
        3407,
}


def assert_exact_section(
    request: dict[str, Any],
    name: str,
    expected: dict[str, Any],
    code: str,
) -> None:
    section = mapping(
        request[name],
        code,
    )

    exact_keys(
        section,
        set(expected.keys()),
        code,
    )

    if section != expected:
        fail(code)


def validate_request(
    request: dict[str, Any],
    data_root: Path,
    output_root: Path,
) -> dict[str, Any]:
    exact_keys(
        request,
        {
            "schemaVersion",
            "executionIntent",
            "runnerContractSha256",
            "model",
            "runtime",
            "quantization",
            "lora",
            "training",
            "output",
            "data",
        },
        "INVALID_TOP_LEVEL_SHAPE",
    )

    require_equal(
        request["schemaVersion"],
        SCHEMA_VERSION,
        "INVALID_SCHEMA_VERSION",
    )

    require_equal(
        request["executionIntent"],
        "PREFLIGHT_ONLY",
        "EXECUTION_INTENT_NOT_PREFLIGHT_ONLY",
    )

    require_sha256(
        request["runnerContractSha256"],
        "INVALID_RUNNER_CONTRACT_SHA256",
    )

    model = mapping(
        request["model"],
        "INVALID_MODEL_SHAPE",
    )

    exact_keys(
        model,
        set(EXPECTED_MODEL.keys()),
        "INVALID_MODEL_SHAPE",
    )

    require_sha40(
        model["modelRevisionSha"],
        "INVALID_MODEL_REVISION",
    )

    if model != EXPECTED_MODEL:
        fail("MODEL_CONTRACT_MISMATCH")

    assert_exact_section(
        request,
        "runtime",
        EXPECTED_RUNTIME,
        "RUNTIME_CONTRACT_MISMATCH",
    )

    assert_exact_section(
        request,
        "quantization",
        EXPECTED_QUANTIZATION,
        "QUANTIZATION_CONTRACT_MISMATCH",
    )

    assert_exact_section(
        request,
        "lora",
        EXPECTED_LORA,
        "LORA_CONTRACT_MISMATCH",
    )

    assert_exact_section(
        request,
        "training",
        EXPECTED_TRAINING,
        "TRAINING_CONTRACT_MISMATCH",
    )

    output = mapping(
        request["output"],
        "INVALID_OUTPUT_SHAPE",
    )

    exact_keys(
        output,
        {
            "outputKind",
            "mergeAdapterIntoBase",
            "pushToHub",
            "outputDir",
        },
        "INVALID_OUTPUT_SHAPE",
    )

    require_equal(
        output["outputKind"],
        "PEFT_ADAPTER_ONLY",
        "OUTPUT_KIND_MISMATCH",
    )

    require_equal(
        output["mergeAdapterIntoBase"],
        False,
        "MODEL_MERGE_FORBIDDEN",
    )

    require_equal(
        output["pushToHub"],
        False,
        "HUB_PUSH_FORBIDDEN",
    )

    output_dir = resolve_output_dir(
        output_root,
        output["outputDir"],
    )

    data = mapping(
        request["data"],
        "INVALID_DATA_SHAPE",
    )

    exact_keys(
        data,
        {
            "trainJsonlPath",
            "trainJsonlSha256",
            "trainExampleCount",
            "devJsonlPath",
            "devJsonlSha256",
            "devExampleCount",
            "sourceFinalHoldoutCommitmentSha256",
        },
        "INVALID_DATA_SHAPE",
    )

    require_sha256(
        data[
            "sourceFinalHoldoutCommitmentSha256"
        ],
        "INVALID_HOLDOUT_COMMITMENT",
    )

    train_path = resolve_input_file(
        data_root,
        data["trainJsonlPath"],
    )

    dev_path = resolve_input_file(
        data_root,
        data["devJsonlPath"],
    )

    if train_path == dev_path:
        fail("TRAIN_DEV_PATH_COLLISION")

    train_sha = hash_file(
        train_path
    )

    dev_sha = hash_file(
        dev_path
    )

    require_equal(
        train_sha,
        require_sha256(
            data["trainJsonlSha256"],
            "INVALID_TRAIN_SHA256",
        ),
        "TRAIN_JSONL_DIGEST_MISMATCH",
    )

    require_equal(
        dev_sha,
        require_sha256(
            data["devJsonlSha256"],
            "INVALID_DEV_SHA256",
        ),
        "DEV_JSONL_DIGEST_MISMATCH",
    )

    train_count = validate_jsonl(
        train_path,
        data["trainExampleCount"],
    )

    dev_count = validate_jsonl(
        dev_path,
        data["devExampleCount"],
    )

    return {
        "schemaVersion":
            "FULGOR_QWEN_QLORA_PREFLIGHT_RESULT_V1",
        "accepted":
            True,
        "executionAuthorized":
            False,
        "trainingStarted":
            False,
        "modelDownloadStarted":
            False,
        "cloudProvisioningPerformed":
            False,
        "promotionAuthorized":
            False,
        "deploymentAuthorized":
            False,
        "modelId":
            MODEL_ID,
        "modelRevisionSha":
            MODEL_REVISION_SHA,
        "modelClass":
            MODEL_ARCHITECTURE,
        "trainJsonlSha256":
            train_sha,
        "devJsonlSha256":
            dev_sha,
        "trainExampleCount":
            train_count,
        "devExampleCount":
            dev_count,
        "outputDir":
            str(output_dir),
        "loadPlan": {
            "revision":
                MODEL_REVISION_SHA,
            "trust_remote_code":
                False,
            "use_safetensors":
                True,
            "load_in_4bit":
                True,
            "bnb_4bit_quant_type":
                "nf4",
            "bnb_4bit_compute_dtype":
                "bfloat16",
            "bnb_4bit_use_double_quant":
                True,
            "device":
                "cuda:0",
        },
    }


def import_training_stack() -> dict[str, Any]:
    modules: dict[str, Any] = {}

    for name in (
        "torch",
        "transformers",
        "peft",
        "bitsandbytes",
        "accelerate",
        "safetensors",
    ):
        try:
            modules[name] = (
                importlib.import_module(
                    name
                )
            )
        except Exception as exc:
            raise ExecutorError(
                "TRAINING_STACK_IMPORT_FAILED:"
                + name
            ) from exc

    transformers = modules[
        "transformers"
    ]

    for symbol in (
        "Qwen3_5ForConditionalGeneration",
        "BitsAndBytesConfig",
        "TrainingArguments",
        "Trainer",
    ):
        if not hasattr(
            transformers,
            symbol,
        ):
            fail(
                "TRANSFORMERS_SYMBOL_MISSING:"
                + symbol
            )

    peft = modules["peft"]

    for symbol in (
        "LoraConfig",
        "get_peft_model",
        "prepare_model_for_kbit_training",
    ):
        if not hasattr(
            peft,
            symbol,
        ):
            fail(
                "PEFT_SYMBOL_MISSING:"
                + symbol
            )

    return modules


def verify_training_stack_versions(
    modules: dict[str, Any],
) -> dict[str, Any]:
    expected_module_names = (
        set(
            EXPECTED_TRAINING_STACK_VERSIONS.keys()
        )
        | {"torch"}
    )

    if set(modules.keys()) != expected_module_names:
        fail(
            "TRAINING_STACK_MODULE_SET_MISMATCH"
        )

    torch_module = modules["torch"]

    torch_version = str(
        getattr(
            torch_module,
            "__version__",
            "UNKNOWN",
        )
    )

    if not torch_version.startswith(
        EXPECTED_TORCH_VERSION_PREFIX
    ):
        fail(
            "TRAINING_STACK_VERSION_MISMATCH:torch"
        )

    torch_version_module = getattr(
        torch_module,
        "version",
        None,
    )

    torch_cuda_version = getattr(
        torch_version_module,
        "cuda",
        None,
    )

    if (
        not isinstance(
            torch_cuda_version,
            str,
        )
        or not torch_cuda_version.startswith(
            EXPECTED_TORCH_CUDA_PREFIX
        )
    ):
        fail(
            "TRAINING_STACK_CUDA_MISMATCH"
        )

    package_versions: dict[str, str] = {
        "torch":
            torch_version,
    }

    for (
        name,
        expected_version,
    ) in EXPECTED_TRAINING_STACK_VERSIONS.items():
        actual_version = str(
            getattr(
                modules[name],
                "__version__",
                "UNKNOWN",
            )
        )

        if actual_version != expected_version:
            fail(
                "TRAINING_STACK_VERSION_MISMATCH:"
                + name
            )

        package_versions[name] = (
            actual_version
        )

    return {
        "packages":
            package_versions,
        "torchCudaVersion":
            torch_cuda_version,
    }


def probe_cuda_runtime(
    torch_module: Any,
) -> dict[str, Any]:
    cuda = torch_module.cuda

    if not cuda.is_available():
        fail("CUDA_NOT_AVAILABLE")

    count = cuda.device_count()

    if count != 1:
        fail("CUDA_DEVICE_COUNT_MISMATCH")

    name = str(
        cuda.get_device_name(0)
    )

    normalized = (
        name.upper()
        .replace("NVIDIA", "")
        .strip()
    )

    if normalized != "L4":
        fail("CUDA_GPU_IDENTITY_MISMATCH")

    capability = (
        cuda.get_device_capability(0)
    )

    if (
        not isinstance(
            capability,
            tuple,
        )
        or len(capability) != 2
        or capability < (8, 9)
    ):
        fail(
            "CUDA_COMPUTE_CAPABILITY_TOO_LOW"
        )

    if (
        hasattr(
            cuda,
            "is_bf16_supported",
        )
        and not cuda.is_bf16_supported()
    ):
        fail("CUDA_BF16_NOT_SUPPORTED")

    return {
        "gpuName":
            name,
        "gpuCount":
            count,
        "computeCapability":
            f"{capability[0]}.{capability[1]}",
        "bf16Supported":
            True,
    }


def container_preflight(
    request: dict[str, Any],
    data_root: Path,
    output_root: Path,
) -> dict[str, Any]:
    result = validate_request(
        request,
        data_root,
        output_root,
    )

    modules = import_training_stack()

    stack_versions = (
        verify_training_stack_versions(
            modules
        )
    )

    cuda_result = probe_cuda_runtime(
        modules["torch"]
    )

    return {
        **result,
        "schemaVersion":
            "FULGOR_QWEN_QLORA_CONTAINER_PREFLIGHT_RESULT_V1",
        "containerTrainingStackReady":
            True,
        "cuda":
            cuda_result,
        "packageVersions":
            stack_versions["packages"],
        "torchCudaVersion":
            stack_versions["torchCudaVersion"],
    }


def read_request(
    path: Path,
) -> dict[str, Any]:
    if is_link_like(path):
        fail("REQUEST_LINK_FORBIDDEN")

    try:
        raw = path.read_text(
            encoding="utf-8"
        )
    except OSError as exc:
        raise ExecutorError(
            "REQUEST_READ_FAILED"
        ) from exc

    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ExecutorError(
            "REQUEST_JSON_INVALID"
        ) from exc

    return mapping(
        value,
        "REQUEST_NOT_OBJECT",
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        prog="qwen_qlora_executor"
    )

    result.add_argument(
        "command",
        choices=(
            "dry-run",
            "container-preflight",
            "execute",
        ),
    )

    result.add_argument(
        "--request",
        required=True,
    )

    result.add_argument(
        "--data-root",
        required=True,
    )

    result.add_argument(
        "--output-root",
        required=True,
    )

    return result


def main(
    argv: list[str],
) -> int:
    args = parser().parse_args(
        argv
    )

    try:
        request = read_request(
            Path(args.request)
        )

        data_root = Path(
            args.data_root
        )

        output_root = Path(
            args.output_root
        )

        if args.command == "dry-run":
            result = validate_request(
                request,
                data_root,
                output_root,
            )

        elif (
            args.command
            == "container-preflight"
        ):
            result = container_preflight(
                request,
                data_root,
                output_root,
            )

        else:
            fail(
                "PRODUCTION_EXECUTION_GATE_NOT_WIRED"
            )

        print(
            json.dumps(
                result,
                sort_keys=True,
                separators=(",", ":"),
            )
        )

        return 0

    except ExecutorError as exc:
        print(
            json.dumps(
                {
                    "accepted":
                        False,
                    "error":
                        exc.code,
                    "trainingStarted":
                        False,
                    "cloudProvisioningPerformed":
                        False,
                    "promotionAuthorized":
                        False,
                    "deploymentAuthorized":
                        False,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )

        return 2


if __name__ == "__main__":
    raise SystemExit(
        main(sys.argv[1:])
    )