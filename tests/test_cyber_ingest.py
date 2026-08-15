from __future__ import annotations

import io
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

from kayra_ai.cyber.download import (
    CAPEC_LATEST_ZIP_URL,
    CWE_LATEST_ZIP_URL,
    CyberDownloadError,
    download_official_snapshot,
)
from kayra_ai.cyber.ingest import (
    CyberIngestError,
    normalize_capec_xml,
    normalize_cwe_xml,
    normalize_snapshot_zip,
    records_to_jsonl,
)

NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)

CWE_XML = b'''<?xml version="1.0" encoding="UTF-8"?>
<Weakness_Catalog xmlns="http://cwe.mitre.org/cwe-7">
  <Weaknesses>
    <Weakness ID="79" Name="Improper Neutralization of Input During Web Page Generation" Status="Stable">
      <Description>Untrusted input reaches an HTML output context.</Description>
      <Common_Consequences>
        <Consequence><Impact>Execute Unauthorized Code or Commands</Impact></Consequence>
      </Common_Consequences>
      <Detection_Methods>
        <Detection_Method><Description>Use static analysis.</Description></Detection_Method>
      </Detection_Methods>
      <Potential_Mitigations>
        <Mitigation><Description>Use context-aware output encoding.</Description></Mitigation>
      </Potential_Mitigations>
      <Related_Attack_Patterns>
        <Related_Attack_Pattern CAPEC_ID="63"/>
      </Related_Attack_Patterns>
    </Weakness>
  </Weaknesses>
</Weakness_Catalog>
'''

CAPEC_XML = b'''<?xml version="1.0" encoding="UTF-8"?>
<Attack_Pattern_Catalog xmlns="http://capec.mitre.org/capec-3">
  <Attack_Patterns>
    <Attack_Pattern ID="63" Name="Cross-Site Scripting" Status="Stable">
      <Description>An adversary injects script content into a trusted web context.</Description>
      <Prerequisites><Prerequisite>Untrusted content reaches browser output.</Prerequisite></Prerequisites>
      <Consequences><Consequence><Impact>Execute Unauthorized Commands</Impact></Consequence></Consequences>
      <Mitigations><Mitigation>Apply context-aware output encoding.</Mitigation></Mitigations>
      <Related_Weaknesses><Related_Weakness CWE_ID="79"/></Related_Weaknesses>
    </Attack_Pattern>
  </Attack_Patterns>
</Attack_Pattern_Catalog>
'''


class FakeHeaders(dict):
    def get(self, key, default=None):
        return super().get(key, default)


class FakeResponse(io.BytesIO):
    def __init__(self, payload: bytes) -> None:
        super().__init__(payload)
        self.headers = FakeHeaders({"Content-Length": str(len(payload))})

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()
        return False


def zip_bytes(name: str, payload: bytes) -> bytes:
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr(name, payload)
    return buffer.getvalue()


class CyberIngestTests(unittest.TestCase):
    def test_cwe_normalizer_preserves_identity_and_relationships(self) -> None:
        record = normalize_cwe_xml(CWE_XML, retrieved_at=NOW)[0]
        self.assertEqual(record.source_id, "CWE-79")
        self.assertEqual(record.attack_pattern_ids, ("CAPEC-63",))
        self.assertIn("static analysis", record.detection or "")
        self.assertIn("output encoding", record.remediation or "")

    def test_cwe_normalizer_records_status_and_skips_deprecated(self) -> None:
        xml = CWE_XML.replace(
            b'</Weaknesses>',
            b'<Weakness ID="132" Name="Deprecated Example" Status="Deprecated">'
            b'<Description>Do not ingest this record.</Description>'
            b'</Weakness></Weaknesses>',
        )
        records = normalize_cwe_xml(xml, retrieved_at=NOW)
        self.assertEqual([record.source_id for record in records], ["CWE-79"])
        self.assertEqual(records[0].source_status, "Stable")

    def test_capec_normalizer_maps_related_cwe(self) -> None:
        record = normalize_capec_xml(CAPEC_XML, retrieved_at=NOW)[0]
        self.assertEqual(record.source_id, "CAPEC-63")
        self.assertEqual(record.cwe_ids, ("CWE-79",))
        self.assertIn("browser output", record.vulnerable_condition or "")

    def test_capec_normalizer_records_status_and_skips_deprecated(self) -> None:
        xml = CAPEC_XML.replace(
            b'</Attack_Patterns>',
            b'<Attack_Pattern ID="106" Name="Deprecated Example" Status="Deprecated">'
            b'<Description>Do not ingest this record.</Description>'
            b'</Attack_Pattern></Attack_Patterns>',
        )
        records = normalize_capec_xml(xml, retrieved_at=NOW)
        self.assertEqual([record.source_id for record in records], ["CAPEC-63"])
        self.assertEqual(records[0].source_status, "Stable")

    def test_capec_title_only_active_record_is_preserved_but_not_eligible(self) -> None:
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<Attack_Pattern_Catalog xmlns="http://capec.mitre.org/capec-3">
  <Attack_Patterns>
    <Attack_Pattern ID="434" Name="Target Influence via Interview and Interrogation" Status="Draft">
      <Description></Description>
      <Typical_Severity>Low</Typical_Severity>
    </Attack_Pattern>
  </Attack_Patterns>
</Attack_Pattern_Catalog>
"""
        record = normalize_capec_xml(xml, retrieved_at=NOW)[0]
        self.assertEqual(record.source_id, "CAPEC-434")
        self.assertTrue(record.source_description_missing)
        self.assertFalse(record.training_eligible)
        self.assertFalse(record.rag_eligible)
        self.assertIn("does not provide a description", record.summary)

    def test_capec_obsolete_record_is_preserved_but_not_eligible(self) -> None:
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<Attack_Pattern_Catalog xmlns="http://capec.mitre.org/capec-3">
  <Attack_Patterns>
    <Attack_Pattern ID="999" Name="Obsolete Example" Status="Obsolete">
      <Description>Historical catalog content.</Description>
    </Attack_Pattern>
  </Attack_Patterns>
</Attack_Pattern_Catalog>
"""
        record = normalize_capec_xml(xml, retrieved_at=NOW)[0]
        self.assertEqual(record.source_status, "Obsolete")
        self.assertFalse(record.source_description_missing)
        self.assertFalse(record.training_eligible)
        self.assertFalse(record.rag_eligible)

    def test_hash_is_stable_across_retrieval_times(self) -> None:
        first = normalize_cwe_xml(CWE_XML, retrieved_at=NOW)[0]
        second = normalize_cwe_xml(
            CWE_XML,
            retrieved_at=datetime(2026, 8, 16, tzinfo=timezone.utc),
        )[0]
        self.assertEqual(first.content_sha256, second.content_sha256)

    def test_snapshot_zip_requires_exactly_one_xml(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.zip"
            with ZipFile(path, "w") as archive:
                archive.writestr("one.xml", CWE_XML)
                archive.writestr("two.xml", CWE_XML)
            with self.assertRaises(CyberIngestError):
                normalize_snapshot_zip("cwe", path, retrieved_at=NOW)

    def test_jsonl_is_one_record_per_line(self) -> None:
        output = records_to_jsonl(normalize_cwe_xml(CWE_XML, retrieved_at=NOW))
        self.assertEqual(len(output.splitlines()), 1)
        self.assertIn('"source":"cwe"', output)

    def test_downloader_uses_fixed_official_url_and_validates_zip(self) -> None:
        self.assertTrue(CWE_LATEST_ZIP_URL.startswith("https://cwe.mitre.org/"))
        self.assertTrue(CAPEC_LATEST_ZIP_URL.startswith("https://capec.mitre.org/"))
        payload = zip_bytes("cwec_v4.20.xml", CWE_XML)
        seen = []

        def opener(request, *, timeout):
            seen.append(request.full_url)
            self.assertEqual(timeout, 7.0)
            return FakeResponse(payload)

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "cwe.zip"
            result = download_official_snapshot(
                "cwe",
                destination,
                timeout_seconds=7.0,
                opener=opener,
            )
            self.assertEqual(result, destination)
            self.assertTrue(destination.exists())
        self.assertEqual(seen, [CWE_LATEST_ZIP_URL])

    def test_downloader_rejects_non_zip_payload(self) -> None:
        def opener(_request, *, timeout):
            self.assertEqual(timeout, 30.0)
            return FakeResponse(b"not-a-zip")

        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(CyberDownloadError):
                download_official_snapshot(
                    "cwe",
                    Path(directory) / "cwe.zip",
                    opener=opener,
                )

    def test_unknown_source_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "bilinmeyen"):
                download_official_snapshot(
                    "user-url",
                    Path(directory) / "x.zip",
                )


if __name__ == "__main__":
    unittest.main()
