from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

from .common import ValidationIssue, iter_jsonl, strings_in


@dataclass(frozen=True)
class Finding:
    kind: str
    preview: str


PATTERNS = {
    "email": re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.IGNORECASE),
    "turkish_phone": re.compile(r"(?<!\d)(?:\+?90\s*)?(?:\(?0?5\d{2}\)?)[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)"),
    "iban": re.compile(r"(?<![A-Z0-9])TR\d{2}(?:\s?\d{4}){5}\s?\d{2}(?![A-Z0-9])", re.IGNORECASE),
    "api_secret": re.compile(r"(?i)(?:api[_ -]?key|secret|token)\s*[:=]\s*[A-Za-z0-9_\-]{16,}"),
}


def _redact(value: str) -> str:
    if len(value) <= 8:
        return "***"
    return f"{value[:3]}…{value[-3:]}"


def _valid_tckn(candidate: str) -> bool:
    if len(candidate) != 11 or not candidate.isdigit() or candidate[0] == "0":
        return False
    digits = [int(char) for char in candidate]
    tenth = ((sum(digits[0:9:2]) * 7) - sum(digits[1:8:2])) % 10
    eleventh = sum(digits[:10]) % 10
    return digits[9] == tenth and digits[10] == eleventh


def _valid_luhn(candidate: str) -> bool:
    digits = [int(char) for char in candidate]
    checksum = 0
    parity = len(digits) % 2
    for index, digit in enumerate(digits):
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def scan_text(text: str) -> list[Finding]:
    findings: list[Finding] = []
    for kind, pattern in PATTERNS.items():
        findings.extend(Finding(kind, _redact(match.group(0))) for match in pattern.finditer(text))

    for match in re.finditer(r"(?<!\d)\d{11}(?!\d)", text):
        if _valid_tckn(match.group(0)):
            findings.append(Finding("tckn", _redact(match.group(0))))

    for match in re.finditer(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)", text):
        compact = re.sub(r"\D", "", match.group(0))
        if 13 <= len(compact) <= 19 and _valid_luhn(compact):
            findings.append(Finding("payment_card", _redact(compact)))
    return findings


def check_file(path: Path) -> tuple[int, list[str]]:
    record_count = 0
    errors: list[str] = []
    for line_number, record in iter_jsonl(path):
        record_count += 1
        for text in strings_in(record):
            for finding in scan_text(text):
                errors.append(f"{path}:{line_number}: {finding.kind} olasılığı ({finding.preview})")
    return record_count, errors


def main() -> int:
    parser = argparse.ArgumentParser(description="JSONL içindeki olası PII/sırları çevrimdışı tara")
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    total = 0
    all_errors: list[str] = []
    try:
        for path in args.paths:
            count, errors = check_file(path)
            total += count
            all_errors.extend(errors)
    except (OSError, ValidationIssue) as exc:
        print(f"HATA: {exc}")
        return 1
    if all_errors:
        for error in all_errors:
            print(f"HATA: {error}")
        print(f"BAŞARISIZ: {len(all_errors)} olası hassas değer")
        return 1
    print(f"OK: {len(args.paths)} dosya, {total} kayıt; bilinen PII/sır deseni bulunmadı")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

