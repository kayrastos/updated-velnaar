from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import socket
import sys
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from kayra_ai.evaluation.benchmark import (
    BenchmarkValidationError,
    SMOKE_CASE_IDS,
    SMOKE_SET_SHA256,
    load_benchmark_series,
    summarize_benchmark_series,
    validate_benchmark_payload,
)
from kayra_ai.evaluation.benchmark_cli import main as benchmark_main


SEED = ROOT / "data" / "eval" / "seed.jsonl"
SMOKE = ROOT / "data" / "eval" / "stage2-smoke.jsonl"
SCHEMA = ROOT / "schemas" / "benchmark-series.schema.json"
FIXTURE = ROOT / "tests" / "fixtures" / "benchmark-series-valid.json"


class BenchmarkContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_smoke_rows_are_byte_for_byte_seed_copies_in_seed_order(self) -> None:
        seed_lines = SEED.read_bytes().splitlines(keepends=True)
        expected = b"".join(seed_lines[index] for index in (0, 6, 9))
        actual = SMOKE.read_bytes()
        self.assertEqual(expected, actual)
        self.assertEqual(SMOKE_SET_SHA256, hashlib.sha256(actual).hexdigest())

        records = [json.loads(line) for line in actual.splitlines()]
        self.assertEqual(list(SMOKE_CASE_IDS), [record["id"] for record in records])
        self.assertEqual(
            ["non_thinking", "both", "thinking"],
            [record["mode"] for record in records],
        )
        profile_expansion = {
            "thinking": ("thinking",),
            "non_thinking": ("non_thinking",),
            "both": ("thinking", "non_thinking"),
        }
        executions = [
            (record["id"], profile, record["max_output_tokens"])
            for record in records
            for profile in profile_expansion[record["mode"]]
        ]
        self.assertEqual(4, len(executions))
        self.assertEqual(2, sum(profile == "thinking" for _, profile, _ in executions))
        self.assertEqual(2, sum(profile == "non_thinking" for _, profile, _ in executions))
        self.assertEqual(252, sum(max_tokens for _, _, max_tokens in executions))

    def test_schema_declares_exact_native_paths_and_fixed_run_policy(self) -> None:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        native = schema["$defs"]["metric_contract"]["properties"]["native_stats"]
        paths = native["properties"]
        self.assertEqual("stats.input_tokens", paths["input_tokens"]["const"])
        self.assertEqual("stats.total_output_tokens", paths["total_output_tokens"]["const"])
        self.assertEqual(
            "stats.reasoning_output_tokens",
            paths["reasoning_output_tokens"]["const"],
        )
        self.assertEqual("stats.tokens_per_second", paths["tokens_per_second"]["const"])
        self.assertEqual(
            "stats.time_to_first_token_seconds",
            paths["time_to_first_token_seconds"]["const"],
        )
        self.assertEqual(
            "stats.model_load_time_seconds",
            paths["model_load_time_seconds"]["const"],
        )
        configuration = schema["$defs"]["configuration"]["properties"]
        self.assertFalse(configuration["store"]["const"])
        self.assertFalse(configuration["stream"]["const"])
        self.assertEqual(4096, configuration["context_length"]["const"])
        self.assertEqual(1, configuration["parallel"]["const"])
        self.assertFalse(configuration["offload_kv_cache_to_gpu"]["const"])
        self.assertEqual(0, configuration["retries"]["const"])
        self.assertEqual(
            "native_api_reasoning_parameter",
            configuration["mode_control_method"]["const"],
        )
        self.assertEqual(
            "unknown",
            configuration["resolved_reasoning_state"]["const"],
        )
        self.assertEqual("lm_studio_native_v1", native["properties"]["source"]["const"])
        self.assertIn(
            "gpu_driver_version",
            schema["$defs"]["runtime"]["required"],
        )
        self.assertEqual(
            "^[a-f0-9]{64}$",
            configuration["runtime_config_sha256"]["pattern"],
        )
        self.assertEqual(
            "^[a-f0-9]{64}$",
            configuration["assistant_config_sha256"]["pattern"],
        )
        evidence = schema["$defs"]["reasoning_evidence"]
        self.assertIn("requested_reasoning", evidence["required"])
        self.assertIn("observed_reasoning_output", evidence["required"])
        advertised = evidence["properties"]["advertised_reasoning_options"]
        self.assertTrue(advertised["uniqueItems"])
        self.assertEqual(2, advertised["minItems"])
        sample = schema["$defs"]["sample"]
        self.assertIn("observed_reasoning_output", sample["required"])
        failed_native = sample["allOf"][1]["else"]["properties"]["native_stats"][
            "properties"
        ]
        self.assertEqual(
            "#/$defs/request_failed_integer_metric",
            failed_native["reasoning_output_tokens"]["$ref"],
        )
        successful_model_load = sample["allOf"][1]["then"]["properties"][
            "native_stats"
        ]["properties"]["model_load_time_seconds"]
        self.assertEqual(
            "#/$defs/successful_model_load_metric",
            successful_model_load["$ref"],
        )

        streamed = copy.deepcopy(self.payload)
        streamed["configuration"]["stream"] = True
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(streamed)

    def test_valid_fixture_has_two_exact_profile_series(self) -> None:
        series = load_benchmark_series(FIXTURE)
        self.assertEqual(["thinking", "non_thinking"], [item.profile for item in series.profiles])
        for profile in series.profiles:
            self.assertEqual(6, len(profile.samples))
            self.assertEqual("warmup", profile.samples[0].phase)
            self.assertEqual([1, 2, 3, 4, 5], [item.ordinal for item in profile.samples[1:]])
            self.assertTrue(all(item.phase == "measured" for item in profile.samples[1:]))
            self.assertTrue(all(item.retry_count == 0 for item in profile.samples))
            self.assertEqual("available_physical_mib", profile.memory.ram.metric)
            self.assertEqual(
                "powershell_get_counter_memory_available_mbytes",
                profile.memory.ram.collector,
            )
            self.assertEqual("used_mib", profile.memory.vram.metric)
            expected_request = "on" if profile.profile == "thinking" else "off"
            expected_observation = "present" if profile.profile == "thinking" else "absent"
            evidence = profile.reasoning_evidence
            self.assertEqual(expected_request, evidence.requested_reasoning)
            self.assertEqual(expected_observation, evidence.observed_reasoning_output)
            self.assertIn(expected_request, evidence.advertised_reasoning_options)
            self.assertEqual("behaviorally_consistent", evidence.profile_verification_status)
            self.assertEqual("unknown", evidence.resolved_reasoning_state)
            self.assertTrue(
                all(
                    item.observed_reasoning_output == expected_observation
                    for item in profile.samples
                )
            )
        self.assertEqual("fixture-driver-0.1", series.runtime.gpu_driver_version)
        self.assertFalse(series.configuration.offload_kv_cache_to_gpu)
        self.assertEqual(64, len(series.configuration.runtime_config_sha256))
        self.assertEqual(64, len(series.configuration.assistant_config_sha256))

    def test_json_numeric_and_boolean_fields_are_not_coerced(self) -> None:
        cases = (
            ("started-epoch", ("started_at",), 0),
            ("finished-bool", ("finished_at",), True),
            ("store-int", ("configuration", "store"), 0),
            ("stream-int", ("configuration", "stream"), 0),
            ("context-string", ("configuration", "context_length"), "4096"),
            ("parallel-bool", ("configuration", "parallel"), True),
            ("offload-int", ("configuration", "offload_kv_cache_to_gpu"), 0),
            ("retries-bool", ("configuration", "retries"), False),
            ("temperature-string", ("configuration", "temperature"), "0.2"),
            ("top-p-string", ("configuration", "top_p"), "0.9"),
            ("warmup-int", ("profiles", 0, "warmup_excluded"), 1),
            (
                "sampling-string",
                ("profiles", 0, "memory", "ram", "sampling_interval_ms"),
                "500",
            ),
            (
                "ram-number-string",
                ("profiles", 0, "memory", "ram", "baseline_mib"),
                "123",
            ),
            (
                "vram-number-string",
                ("profiles", 0, "memory", "vram", "measured_peak_mib"),
                "3800",
            ),
            ("ordinal-string", ("profiles", 0, "samples", 0, "ordinal"), "0"),
            ("retry-bool", ("profiles", 0, "samples", 0, "retry_count"), False),
            ("success-int", ("profiles", 0, "samples", 0, "success"), 1),
            (
                "integer-metric-string",
                (
                    "profiles",
                    0,
                    "samples",
                    0,
                    "native_stats",
                    "input_tokens",
                    "value",
                ),
                "19",
            ),
            (
                "float-metric-string",
                (
                    "profiles",
                    0,
                    "samples",
                    0,
                    "native_stats",
                    "tokens_per_second",
                    "value",
                ),
                "999",
            ),
            (
                "client-timing-string",
                ("profiles", 0, "samples", 0, "total_request_ms", "value"),
                "900",
            ),
        )
        for label, path, replacement in cases:
            with self.subTest(label=label):
                payload = copy.deepcopy(self.payload)
                target = payload
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = replacement
                with self.assertRaises(BenchmarkValidationError):
                    validate_benchmark_payload(payload)

    def test_summary_excludes_warmup_and_uses_reported_native_values(self) -> None:
        summary = summarize_benchmark_series(load_benchmark_series(FIXTURE))
        thinking = summary["profiles"][0]
        speed = thinking["metrics"]["tokens_per_second"]
        self.assertEqual(5, speed["reported_count"])
        self.assertEqual(30.0, speed["median"])
        self.assertEqual(50.0, speed["p95_nearest_rank"])
        self.assertNotEqual(999, speed["p95_nearest_rank"])
        model_load = thinking["metrics"]["model_load_time_seconds"]
        self.assertEqual(0, model_load["reported_count"])
        self.assertEqual(5, model_load["null_count"])
        self.assertEqual({"server_field_absent": 5}, model_load["null_reasons"])

    def test_wrong_sample_plan_retry_or_profile_case_is_rejected(self) -> None:
        wrong_ordinal = copy.deepcopy(self.payload)
        wrong_ordinal["profiles"][0]["samples"][2]["ordinal"] = 3
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(wrong_ordinal)

        retried = copy.deepcopy(self.payload)
        retried["profiles"][0]["samples"][1]["retry_count"] = 1
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(retried)

        incompatible_case = copy.deepcopy(self.payload)
        incompatible_case["profiles"][1]["samples"][1]["case_id"] = "eval-reason-001"
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(incompatible_case)

    def test_profile_probe_evidence_requires_advertised_and_matching_request(self) -> None:
        wrong_request = copy.deepcopy(self.payload)
        wrong_request["profiles"][0]["reasoning_evidence"]["requested_reasoning"] = "off"
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(wrong_request)

        request_not_advertised = copy.deepcopy(self.payload)
        request_not_advertised["profiles"][0]["reasoning_evidence"][
            "advertised_reasoning_options"
        ] = ["off", "low"]
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(request_not_advertised)

        default_not_advertised = copy.deepcopy(self.payload)
        default_not_advertised["profiles"][0]["reasoning_evidence"][
            "advertised_reasoning_options"
        ] = ["off", "on"]
        default_not_advertised["profiles"][0]["reasoning_evidence"][
            "advertised_reasoning_default"
        ] = "high"
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(default_not_advertised)

        wrong_probe_observation = copy.deepcopy(self.payload)
        wrong_probe_observation["profiles"][1]["reasoning_evidence"][
            "observed_reasoning_output"
        ] = "present"
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(wrong_probe_observation)

    def test_successful_samples_require_profile_specific_reasoning_evidence(self) -> None:
        thinking_without_tokens = copy.deepcopy(self.payload)
        thinking_without_tokens["profiles"][0]["samples"][1]["native_stats"][
            "reasoning_output_tokens"
        ]["value"] = 0
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(thinking_without_tokens)

        thinking_without_observation = copy.deepcopy(self.payload)
        thinking_without_observation["profiles"][0]["samples"][1][
            "observed_reasoning_output"
        ] = "absent"
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(thinking_without_observation)

        non_thinking_with_tokens = copy.deepcopy(self.payload)
        non_thinking_with_tokens["profiles"][1]["samples"][1]["native_stats"][
            "reasoning_output_tokens"
        ]["value"] = 1
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(non_thinking_with_tokens)

        non_thinking_with_observation = copy.deepcopy(self.payload)
        non_thinking_with_observation["profiles"][1]["samples"][1][
            "observed_reasoning_output"
        ] = "present"
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(non_thinking_with_observation)

    def test_metric_value_requires_one_explicit_null_reason(self) -> None:
        missing_reason = copy.deepcopy(self.payload)
        metric = missing_reason["profiles"][0]["samples"][1]["native_stats"]["input_tokens"]
        metric.update(value=None, null_reason=None)
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(missing_reason)

        wrong_source_reason = copy.deepcopy(self.payload)
        metric = wrong_source_reason["profiles"][0]["samples"][1]["native_stats"]["input_tokens"]
        metric.update(value=None, null_reason="client_measurement_unavailable")
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(wrong_source_reason)

        missing_required_native_stat = copy.deepcopy(self.payload)
        metric = missing_required_native_stat["profiles"][0]["samples"][1]["native_stats"][
            "input_tokens"
        ]
        metric.update(value=None, null_reason="server_field_absent")
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(missing_required_native_stat)

        missing_warmup_native_stat = copy.deepcopy(self.payload)
        metric = missing_warmup_native_stat["profiles"][0]["samples"][0]["native_stats"][
            "time_to_first_token_seconds"
        ]
        metric.update(value=None, null_reason="server_field_absent")
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(missing_warmup_native_stat)

        missing_client_timing = copy.deepcopy(self.payload)
        missing_client_timing["profiles"][0]["samples"][0]["total_request_ms"].update(
            value=None,
            null_reason="client_measurement_unavailable",
        )
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(missing_client_timing)

        unavailable_model_load = copy.deepcopy(self.payload)
        unavailable_model_load["profiles"][0]["samples"][1]["native_stats"][
            "model_load_time_seconds"
        ].update(value=None, null_reason="request_failed")
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(unavailable_model_load)

    def test_failed_sample_requires_typed_error_and_request_failed_native_stats(self) -> None:
        failed = copy.deepcopy(self.payload)
        sample = failed["profiles"][0]["samples"][1]
        sample["success"] = False
        sample["error_type"] = "timeout"
        sample["observed_reasoning_output"] = "unknown"
        sample["total_request_ms"].update(value=999999, null_reason=None)
        for metric in sample["native_stats"].values():
            metric.update(value=None, null_reason="request_failed")
        series = validate_benchmark_payload(failed)
        summary = summarize_benchmark_series(series)
        self.assertFalse(summary["ok"])
        self.assertEqual(1, summary["profiles"][0]["failure_count"])
        self.assertEqual(0.2, summary["profiles"][0]["error_rate"])
        self.assertEqual({"timeout": 1}, summary["profiles"][0]["errors"])
        total_request = summary["profiles"][0]["metrics"]["total_request_ms"]
        self.assertEqual(4, total_request["reported_count"])
        self.assertEqual(1, total_request["failed_reported_count"])
        self.assertEqual(0, total_request["failed_null_count"])
        self.assertEqual(1400.0, total_request["p95_nearest_rank"])
        self.assertNotEqual(999999, total_request["p95_nearest_rank"])
        model_load = summary["profiles"][0]["metrics"]["model_load_time_seconds"]
        self.assertEqual(4, model_load["null_count"])
        self.assertEqual({"server_field_absent": 4}, model_load["null_reasons"])
        self.assertEqual(0, model_load["failed_reported_count"])
        self.assertEqual(1, model_load["failed_null_count"])
        self.assertEqual({"request_failed": 1}, model_load["failed_null_reasons"])

        sample["native_stats"]["input_tokens"]["null_reason"] = "server_field_absent"
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(failed)

        failed_with_observation = copy.deepcopy(self.payload)
        sample = failed_with_observation["profiles"][0]["samples"][1]
        sample["success"] = False
        sample["error_type"] = "timeout"
        for metric in sample["native_stats"].values():
            metric.update(value=None, null_reason="request_failed")
        with self.assertRaises(BenchmarkValidationError):
            validate_benchmark_payload(failed_with_observation)

    def test_content_fields_and_secret_like_values_are_rejected_without_echo(self) -> None:
        content = copy.deepcopy(self.payload)
        content["prompt"] = "fixture prompt"
        with self.assertRaises(BenchmarkValidationError) as raised:
            validate_benchmark_payload(content)
        self.assertEqual("forbidden_content_key", raised.exception.code)
        self.assertNotIn("fixture prompt", str(raised.exception))

        secret = copy.deepcopy(self.payload)
        secret["runtime"]["version"] = "Bearer SECRET-CANARY-12345"
        with self.assertRaises(BenchmarkValidationError) as raised:
            validate_benchmark_payload(secret)
        self.assertEqual("secret_like_value", raised.exception.code)
        self.assertNotIn("SECRET-CANARY", str(raised.exception))

    def test_cli_emits_only_content_free_summary(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = benchmark_main([str(FIXTURE)])
        self.assertEqual(0, status)
        self.assertEqual("", stderr.getvalue())
        output = stdout.getvalue()
        parsed = json.loads(output)
        self.assertTrue(parsed["ok"])
        for forbidden in ('"prompt"', '"content"', '"authorization"', '"api_key"', '"headers"'):
            self.assertNotIn(forbidden, output.lower())

    def test_loader_and_cli_never_create_a_socket(self) -> None:
        with mock.patch.object(
            socket,
            "socket",
            side_effect=AssertionError("benchmark doğrulaması socket oluşturmamalı"),
        ) as socket_factory:
            series = load_benchmark_series(FIXTURE)
            self.assertTrue(summarize_benchmark_series(series)["ok"])
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
                io.StringIO()
            ):
                self.assertEqual(0, benchmark_main([str(FIXTURE)]))
        socket_factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
