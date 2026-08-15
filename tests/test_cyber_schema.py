from __future__ import annotations

import unittest
from datetime import datetime, timezone

from pydantic import ValidationError

from kayra_ai.cyber import CYBER_SOURCES, CyberKnowledgeRecord, get_cyber_source


SHA256 = "a" * 64


class CyberKnowledgeSchemaTests(unittest.TestCase):
    def test_valid_cwe_record_is_strict_and_normalized(self) -> None:
        record = CyberKnowledgeRecord(
            source="cwe",
            source_id="CWE-79",
            category="weakness",
            title="Improper Neutralization of Input During Web Page Generation",
            summary="Untrusted input can reach an HTML output context without proper encoding.",
            cwe_ids=("cwe-79",),
            attack_pattern_ids=("capec-63",),
            remediation="Use context-aware output encoding.",
            references=("https://example.invalid/cwe-79",),
            license="source-license-recorded-by-ingestor",
            retrieved_at=datetime(2026, 8, 15, tzinfo=timezone.utc),
            training_eligible=True,
            rag_eligible=True,
            content_sha256=SHA256.upper(),
        )

        self.assertEqual(record.cwe_ids, ("CWE-79",))
        self.assertEqual(record.attack_pattern_ids, ("CAPEC-63",))
        self.assertEqual(record.content_sha256, SHA256)

    def test_extra_fields_are_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            CyberKnowledgeRecord(
                source="cwe",
                source_id="CWE-79",
                category="weakness",
                title="XSS",
                summary="summary",
                license="license",
                retrieved_at=datetime(2026, 8, 15, tzinfo=timezone.utc),
                training_eligible=True,
                rag_eligible=True,
                content_sha256=SHA256,
                unexpected="must fail",
            )

    def test_naive_retrieved_at_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            CyberKnowledgeRecord(
                source="cwe",
                source_id="CWE-79",
                category="weakness",
                title="XSS",
                summary="summary",
                license="license",
                retrieved_at=datetime(2026, 8, 15),
                training_eligible=True,
                rag_eligible=True,
                content_sha256=SHA256,
            )

    def test_source_identity_must_match_source(self) -> None:
        with self.assertRaises(ValidationError):
            CyberKnowledgeRecord(
                source="nvd",
                source_id="CWE-79",
                category="vulnerability",
                title="bad identity",
                summary="summary",
                license="license",
                retrieved_at=datetime(2026, 8, 15, tzinfo=timezone.utc),
                training_eligible=False,
                rag_eligible=True,
                content_sha256=SHA256,
            )

    def test_source_registry_separates_training_from_live_rag_defaults(self) -> None:
        self.assertTrue(get_cyber_source("cwe").default_training_eligible)
        self.assertTrue(get_cyber_source("capec").default_training_eligible)
        self.assertFalse(get_cyber_source("nvd").default_training_eligible)
        self.assertTrue(get_cyber_source("nvd").default_rag_eligible)
        self.assertFalse(get_cyber_source("cisa_kev").default_training_eligible)
        self.assertEqual(
            set(CYBER_SOURCES),
            {"cwe", "capec", "nvd", "cisa_kev", "owasp", "patch_corpus"},
        )

    def test_unknown_source_lookup_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "bilinmeyen cyber kaynagi"):
            get_cyber_source("unknown")


if __name__ == "__main__":
    unittest.main()
