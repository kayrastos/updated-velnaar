"""Deterministic explicit schema contracts and JSON syntax shaping for Fulgor V3 A234 v6.

Key additions over v3:
1. Closed-world diagnosis inventory constraint: target_files MUST match exact entries in repository_files.
2. Migrates candidate schema to fulgor.semantic_patch_intent.v2:
   - Removes expected_preimage_sha256 and anchor from model output.
   - Model outputs only semantic edit coordinates: kind, file, start_line, end_line, replacement_text.
3. Explicit root JSON closure framing: ensures model outputs final '}' closing the root object before EOS,
   preventing premature ']' termination.
4. Preserves verifier and plan schema contracts.
"""

from __future__ import annotations

import json
from typing import Any, Mapping

COMMON_SYNTAX_CONTRACT = (
    "STRICT JSON SYNTAX SHAPING REQUIREMENTS:\n"
    "1. RETURN EXACTLY ONE JSON OBJECT. No array, no multiple objects.\n"
    "2. The FIRST non-whitespace character of your output MUST be '{'.\n"
    "3. The FINAL non-whitespace character of your output MUST be '}'.\n"
    "4. Use JSON DOUBLE QUOTES (\") for all strings and property names. NEVER use Python-style single quotes (').\n"
    "5. NEVER emit trailing commas (e.g. {\"a\": 1,} or [1, 2,] is illegal).\n"
    "6. NEVER emit comments (e.g. no // or /* */ or #).\n"
    "7. NEVER emit markdown fences (do not wrap output in ```json or ```).\n"
    "8. NEVER emit conversational prose or explanations before or after the JSON object.\n"
    "9. JSON boolean and null literals MUST be strictly lowercase: true, false, null. NEVER emit True, False, or None.\n"
    "10. All newline characters occurring inside string values MUST be validly JSON escaped as \\n.\n"
    "11. All backslash characters inside string values MUST be validly JSON escaped as \\\\.\n"
    "12. All literal double-quote characters inside string values MUST be validly JSON escaped as \\\".\n"
    "13. Every opened '{', '[', and '\"' must be syntactically closed before ending generation.\n"
    "14. BEFORE EOS: The root JSON object MUST be closed. After the final array value or property, ALWAYS emit the final '}' closing the root JSON object before emitting EOS.\n"
    "15. Before finishing generation, internally verify that the output can be parsed by json.loads() without syntax errors.\n"
    "CRITICAL RULE: PLACEHOLDER TEXT IS STRUCTURAL DOCUMENTATION ONLY. DO NOT COPY PLACEHOLDER TOKENS INTO THE RESPONSE. USE ACTUAL VALUES FROM THE SUPPLIED INPUT/BINDINGS.\n"
)


def get_stage_system_prompt(stage: str, **context: Any) -> str:
    """Return explicit, deterministic schema and syntax system instruction for the stage."""
    if stage == "diagnosis":
        exemplar = (
            "{\n"
            '  "schema_version": "fulgor.diagnosis.v1",\n'
            '  "target_files": [\n'
            '    "<TARGET_FILE>"\n'
            "  ],\n"
            '  "symbols": [\n'
            "    {\n"
            '      "file": "<TARGET_FILE>",\n'
            '      "qualified_name": "<QUALIFIED_NAME>"\n'
            "    }\n"
            "  ],\n"
            '  "observed_failure": "<OBSERVED_FAILURE>",\n'
            '  "likely_cause": "<LIKELY_CAUSE>",\n'
            '  "constraints": [\n'
            '    "<CONSTRAINT>"\n'
            "  ],\n"
            '  "minimal_edit_intent": "<MINIMAL_EDIT_INTENT>",\n'
            '  "uncertainties": []\n'
            "}"
        )
        return (
            "You are a strict diagnostic engine for code repair.\n"
            "You must return EXACTLY ONE JSON object matching the fulgor.diagnosis.v1 schema.\n\n"
            f"{COMMON_SYNTAX_CONTRACT}\n"
            "The JSON object MUST contain EXACTLY the following 8 top-level keys and NO ADDITIONAL KEYS:\n"
            "1. \"schema_version\": must be the exact string \"fulgor.diagnosis.v1\"\n"
            "2. \"target_files\": array of 1 to 3 unique, non-empty, repository-relative file paths (strings).\n"
            "   CRITICAL CLOSED-WORLD INVENTORY RULE: Every target file path MUST be an EXACT string match of a file path from the provided repository_files list. Never invent paths or guess parent directories.\n"
            "3. \"symbols\": array of objects, where EVERY object has EXACTLY two keys: \"file\" (string, matching one of target_files) and \"qualified_name\" (non-empty string). No extra keys.\n"
            "4. \"observed_failure\": non-empty string explaining the observed failure\n"
            "5. \"likely_cause\": non-empty string explaining the root cause\n"
            "6. \"constraints\": array of non-empty strings defining constraints\n"
            "7. \"minimal_edit_intent\": non-empty string stating minimal repair goal\n"
            "8. \"uncertainties\": array of non-empty strings (may be empty array [])\n\n"
            "CANONICAL STRUCTURAL SHAPE EXEMPLAR:\n"
            f"{exemplar}\n"
        )

    elif stage == "plan":
        diagnosis_hash = context.get("diagnosis_hash", "<EXACT_DIAGNOSIS_HASH>")
        exemplar = (
            "{\n"
            '  "schema_version": "fulgor.repair_plan.v1",\n'
            f'  "diagnosis_hash": "{diagnosis_hash}",\n'
            '  "steps": [\n'
            "    {\n"
            '      "order": 1,\n'
            '      "file": "<TARGET_FILE>",\n'
            '      "symbol": null,\n'
            '      "intent": "<REPAIR_INTENT>"\n'
            "    }\n"
            "  ],\n"
            '  "behavioral_postconditions": [\n'
            '    "<POSTCONDITION>"\n'
            "  ],\n"
            '  "regression_risks": [],\n'
            '  "test_intent": "<TEST_INTENT>",\n'
            '  "preservation_constraints": [\n'
            '    "<PRESERVATION_CONSTRAINT>"\n'
            "  ]\n"
            "}"
        )
        return (
            "You are a strict repair planning engine for code repair.\n"
            "You must return EXACTLY ONE JSON object matching the fulgor.repair_plan.v1 schema.\n\n"
            f"{COMMON_SYNTAX_CONTRACT}\n"
            "The JSON object MUST contain EXACTLY the following 7 top-level keys and NO ADDITIONAL KEYS:\n"
            "1. \"schema_version\": must be the exact string \"fulgor.repair_plan.v1\"\n"
            f"2. \"diagnosis_hash\": must be the exact string \"{diagnosis_hash}\"\n"
            "3. \"steps\": array of objects representing consecutively ordered repair steps (starting at order 1). Every step object MUST have EXACTLY these 4 keys:\n"
            "   - \"order\": integer (1, 2, ...)\n"
            "   - \"file\": string (must be one of the target_files from diagnosis)\n"
            "   - \"symbol\": string or null\n"
            "   - \"intent\": non-empty string\n"
            "   No extra keys in step objects.\n"
            "4. \"behavioral_postconditions\": array of non-empty strings\n"
            "5. \"regression_risks\": array of non-empty strings (may be empty array [])\n"
            "6. \"test_intent\": non-empty string\n"
            "7. \"preservation_constraints\": array of non-empty strings (non-empty list required! At least 1 constraint)\n\n"
            "CANONICAL STRUCTURAL SHAPE EXEMPLAR:\n"
            f"{exemplar}\n"
        )

    elif stage == "candidate":
        candidate_id = context.get("candidate_id", "<EXACT_CANDIDATE_ID>")
        diagnosis_hash = context.get("diagnosis_hash", "<EXACT_DIAGNOSIS_HASH>")
        plan_hash = context.get("plan_hash", "<EXACT_PLAN_HASH>")
        exemplar = (
            "{\n"
            '  "schema_version": "fulgor.semantic_patch_intent.v2",\n'
            f'  "candidate_id": "{candidate_id}",\n'
            f'  "diagnosis_hash": "{diagnosis_hash}",\n'
            f'  "plan_hash": "{plan_hash}",\n'
            '  "edits": [\n'
            "    {\n"
            '      "kind": "replace",\n'
            '      "file": "<TARGET_FILE>",\n'
            '      "start_line": 1,\n'
            '      "end_line": 2,\n'
            '      "replacement_text": "<REPLACEMENT_LINE_1>\\n<REPLACEMENT_LINE_2>\\n"\n'
            "    }\n"
            "  ],\n"
            '  "rationale": "<RATIONALE>",\n'
            '  "expected_fail_to_pass_effect": "<EXPECTED_EFFECT>",\n'
            '  "regression_risks": []\n'
            "}"
        )
        return (
            "You are a strict repair synthesis engine generating concrete code patch intents.\n"
            "You must return EXACTLY ONE JSON object matching the fulgor.semantic_patch_intent.v2 schema.\n\n"
            f"{COMMON_SYNTAX_CONTRACT}\n"
            "The JSON object MUST contain EXACTLY the following 8 top-level keys and NO ADDITIONAL KEYS:\n"
            "1. \"schema_version\": must be the exact string \"fulgor.semantic_patch_intent.v2\"\n"
            f"2. \"candidate_id\": must be the exact string \"{candidate_id}\"\n"
            f"3. \"diagnosis_hash\": must be the exact string \"{diagnosis_hash}\"\n"
            f"4. \"plan_hash\": must be the exact string \"{plan_hash}\"\n"
            "5. \"edits\": array of edit intent objects. Every edit object MUST have EXACTLY these 5 keys and NO OTHERS:\n"
            "   - \"kind\": \"replace\", \"insert\", or \"delete\"\n"
            "   - \"file\": string (must be one of the target_files from diagnosis)\n"
            "   - \"start_line\": integer (1-indexed start line)\n"
            "   - \"end_line\": integer (1-indexed end line; for insert, end_line MUST equal start_line - 1)\n"
            "   - \"replacement_text\": string (for delete, MUST be \"\"; for replace or insert, must end with \\n)\n"
            "   CRITICAL: DO NOT emit expected_preimage_sha256 or anchor fields. The trusted host derives all cryptographic hashes and anchors.\n"
            "6. \"rationale\": non-empty string explaining why this specific repair patch resolves the defect\n"
            "7. \"expected_fail_to_pass_effect\": non-empty string describing expected test pass effect\n"
            "8. \"regression_risks\": array of non-empty strings (may be empty array [])\n\n"
            "CANONICAL STRUCTURAL SHAPE EXEMPLAR:\n"
            f"{exemplar}\n"
        )

    elif stage == "verifier":
        blinded_id = context.get("blinded_id", "<EXACT_BLINDED_ID>")
        exemplar = (
            "{\n"
            '  "schema_version": "fulgor.verifier_score.v1",\n'
            f'  "blinded_id": "{blinded_id}",\n'
            '  "diagnosis_consistency": 3,\n'
            '  "plan_consistency": 3,\n'
            '  "localization_confidence": 3,\n'
            '  "likely_repair_benefit": 3,\n'
            '  "pass_to_pass_safety": 3,\n'
            '  "minimality": 3,\n'
            '  "unnecessary_edit_absence": 3,\n'
            '  "broad_edit_safety": 3,\n'
            '  "reasons": [\n'
            '    "<REASON>"\n'
            "  ],\n"
            '  "fatal_concerns": []\n'
            "}"
        )
        return (
            "You are a strict, blinded code-repair verification judge.\n"
            "You evaluate a proposed patch blind to the candidate's real identity.\n"
            "You must return EXACTLY ONE JSON object matching the fulgor.verifier_score.v1 schema.\n\n"
            f"{COMMON_SYNTAX_CONTRACT}\n"
            "The JSON object MUST contain EXACTLY the following 11 top-level keys and NO ADDITIONAL KEYS:\n"
            "1. \"schema_version\": must be the exact string \"fulgor.verifier_score.v1\"\n"
            f"2. \"blinded_id\": must be the exact string \"{blinded_id}\"\n"
            "3. \"diagnosis_consistency\": integer score from 0 (terrible) to 4 (excellent)\n"
            "4. \"plan_consistency\": integer score from 0 (terrible) to 4 (excellent)\n"
            "5. \"localization_confidence\": integer score from 0 (terrible) to 4 (excellent)\n"
            "6. \"likely_repair_benefit\": integer score from 0 (terrible) to 4 (excellent)\n"
            "7. \"pass_to_pass_safety\": integer score from 0 (terrible) to 4 (excellent)\n"
            "8. \"minimality\": integer score from 0 (terrible) to 4 (excellent)\n"
            "9. \"unnecessary_edit_absence\": integer score from 0 (terrible) to 4 (excellent)\n"
            "10. \"broad_edit_safety\": integer score from 0 (terrible) to 4 (excellent)\n"
            "11. \"reasons\": array of non-empty strings justifying your scores\n"
            "12. \"fatal_concerns\": array of non-empty strings for any disqualifying defects (empty [] if none)\n\n"
            "CANONICAL STRUCTURAL SHAPE EXEMPLAR:\n"
            f"{exemplar}\n"
        )
    else:
        raise ValueError(f"unknown stage: {stage}")


def build_stage_messages(stage: str, user_payload: Mapping[str, Any], **context: Any) -> list[dict[str, str]]:
    """Construct full OpenAI/Gemma chat messages with system prompt and user payload."""
    system_prompt = get_stage_system_prompt(stage, **context)
    user_content = json.dumps(user_payload, indent=2, sort_keys=True)
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
