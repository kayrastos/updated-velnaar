#!/usr/bin/env python3

import json
import sys
from pathlib import Path

ALLOWED_ROLES = {"system", "user", "assistant", "tool"}

def validate(path: Path):
    errors = []
    ids = set()
    count = 0

    if not path.exists():
        return [f"Dosya bulunamadı: {path}"], 0

    with path.open("r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f, 1):
            line = raw.strip()
            if not line:
                continue

            count += 1

            try:
                item = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"Satır {line_no}: geçersiz JSON: {e}")
                continue

            record_id = item.get("id")
            if not isinstance(record_id, str) or not record_id.strip():
                errors.append(f"Satır {line_no}: geçerli id yok")
            elif record_id in ids:
                errors.append(f"Satır {line_no}: tekrar eden id: {record_id}")
            else:
                ids.add(record_id)

            category = item.get("category")
            if not isinstance(category, str) or not category.strip():
                errors.append(f"Satır {line_no}: category eksik")

            messages = item.get("messages")
            if not isinstance(messages, list) or len(messages) < 2:
                errors.append(f"Satır {line_no}: messages en az 2 mesaj içermeli")
                continue

            has_user = False
            has_assistant = False

            for i, msg in enumerate(messages):
                if not isinstance(msg, dict):
                    errors.append(f"Satır {line_no}, mesaj {i}: nesne değil")
                    continue

                role = msg.get("role")
                content = msg.get("content")

                if role not in ALLOWED_ROLES:
                    errors.append(
                        f"Satır {line_no}, mesaj {i}: geçersiz role={role!r}"
                    )

                if not isinstance(content, str) or not content.strip():
                    errors.append(
                        f"Satır {line_no}, mesaj {i}: content boş/geçersiz"
                    )

                if role == "user":
                    has_user = True
                elif role == "assistant":
                    has_assistant = True

            if not has_user:
                errors.append(f"Satır {line_no}: user mesajı yok")
            if not has_assistant:
                errors.append(f"Satır {line_no}: assistant mesajı yok")

    return errors, count


def main():
    if len(sys.argv) != 2:
        print("Kullanım: python3 validate_dataset.py <dosya.jsonl>")
        sys.exit(2)

    path = Path(sys.argv[1])
    errors, count = validate(path)

    print(f"Dosya: {path}")
    print(f"Kayıt sayısı: {count}")

    if errors:
        print(f"HATA: {len(errors)} sorun bulundu:")
        for e in errors:
            print(f" - {e}")
        sys.exit(1)

    print("VALIDATION OK")


if __name__ == "__main__":
    main()
