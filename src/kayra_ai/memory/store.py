from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from kayra_ai.environment import resolve_environment_value

from .contracts import MemoryDraft, MemoryRecord, WriteAuthorization


class MemoryAuthorizationError(PermissionError):
    pass


class UnsafeMemoryPathError(ValueError):
    pass


class MemoryDecryptionError(ValueError):
    pass


class UnencryptedMemoryDatabaseError(ValueError):
    pass


def default_memory_db_path(*, environ: Mapping[str, str] | None = None) -> Path:
    values = os.environ if environ is None else environ
    configured = resolve_environment_value(values, "KAYRA_MEMORY_DB")
    if configured:
        return Path(configured).expanduser()
    local_app_data = values.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "KayraAI" / "memory" / "memory.sqlite3"
    xdg_data_home = values.get("XDG_DATA_HOME")
    base = Path(xdg_data_home).expanduser() if xdg_data_home else Path.home() / ".local" / "share"
    return base / "kayra-ai" / "memory" / "memory.sqlite3"


class MemoryStore:
    def __init__(
        self,
        db_path: str | Path | None = None,
        *,
        passphrase: str,
        repository_root: str | Path | None = None,
    ) -> None:
        if len(passphrase) < 12:
            raise ValueError("hafiza parolasi en az 12 karakter olmali")
        self.db_path = Path(db_path) if db_path is not None else default_memory_db_path()
        self.db_path = self.db_path.expanduser().resolve()
        if repository_root is not None:
            repo = Path(repository_root).expanduser().resolve()
            if self.db_path == repo or self.db_path.is_relative_to(repo):
                raise UnsafeMemoryPathError("kisisel hafiza veritabani Git deposunun disinda olmali")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize(passphrase)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.db_path)
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA journal_mode = WAL")
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self, passphrase: str) -> None:
        with self._connect() as connection:
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(memories)")
            }
            if columns and "payload_ciphertext" not in columns:
                raise UnencryptedMemoryDatabaseError(
                    "sifresiz eski hafiza veritabani otomatik acilamaz"
                )
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS memory_meta (
                    key TEXT PRIMARY KEY,
                    value BLOB NOT NULL
                );

                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    payload_nonce BLOB NOT NULL,
                    payload_ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    expires_at TEXT,
                    deleted_at TEXT
                );

                CREATE TABLE IF NOT EXISTS memory_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    memory_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    purpose_nonce BLOB NOT NULL,
                    purpose_ciphertext BLOB NOT NULL,
                    confirmed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(memory_id) REFERENCES memories(id)
                );
                """
            )
            self._aesgcm = self._load_or_create_cipher(connection, passphrase)
        try:
            os.chmod(self.db_path, 0o600)
        except OSError:
            pass

    @staticmethod
    def _derive_key(passphrase: str, salt: bytes) -> bytes:
        return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(
            passphrase.encode("utf-8")
        )

    def _load_or_create_cipher(
        self,
        connection: sqlite3.Connection,
        passphrase: str,
    ) -> AESGCM:
        rows = {
            row["key"]: bytes(row["value"])
            for row in connection.execute("SELECT key, value FROM memory_meta")
        }
        required = {"kdf_salt", "key_check_nonce", "key_check_ciphertext"}
        if rows and set(rows) != required:
            raise MemoryDecryptionError("hafiza anahtar metadatasi gecersiz")
        if not rows:
            salt = os.urandom(16)
            aesgcm = AESGCM(self._derive_key(passphrase, salt))
            nonce = os.urandom(12)
            ciphertext = aesgcm.encrypt(
                nonce,
                b"kayra-memory-key-check-v1",
                b"kayra-memory-meta-v1",
            )
            connection.executemany(
                "INSERT INTO memory_meta (key, value) VALUES (?, ?)",
                (
                    ("kdf_salt", salt),
                    ("key_check_nonce", nonce),
                    ("key_check_ciphertext", ciphertext),
                ),
            )
            return aesgcm
        aesgcm = AESGCM(self._derive_key(passphrase, rows["kdf_salt"]))
        try:
            plaintext = aesgcm.decrypt(
                rows["key_check_nonce"],
                rows["key_check_ciphertext"],
                b"kayra-memory-meta-v1",
            )
        except InvalidTag:
            raise MemoryDecryptionError("hafiza parolasi yanlis veya veritabani bozuk") from None
        if plaintext != b"kayra-memory-key-check-v1":
            raise MemoryDecryptionError("hafiza anahtar dogrulamasi basarisiz")
        return aesgcm

    @staticmethod
    def _record_aad(memory_id: str) -> bytes:
        return f"kayra-memory-record-v1:{memory_id}".encode("ascii")

    @staticmethod
    def _event_aad(memory_id: str, event_type: str, confirmed_at: str) -> bytes:
        return f"kayra-memory-event-v1:{memory_id}:{event_type}:{confirmed_at}".encode(
            "utf-8"
        )

    def _encrypt_payload(self, memory_id: str, draft: MemoryDraft) -> tuple[bytes, bytes]:
        payload = json.dumps(
            {
                "content": draft.content,
                "kind": draft.kind,
                "sensitivity": draft.sensitivity,
                "source": draft.source,
                "tags": draft.tags,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        nonce = os.urandom(12)
        return nonce, self._aesgcm.encrypt(nonce, payload, self._record_aad(memory_id))

    @staticmethod
    def _require_authorization(
        authorization: WriteAuthorization | None,
    ) -> WriteAuthorization:
        if authorization is None or authorization.confirmed_by_user is not True:
            raise MemoryAuthorizationError("kalici hafiza degisikligi icin acik kullanici onayi gerekli")
        return authorization

    def add(
        self,
        draft: MemoryDraft,
        *,
        authorization: WriteAuthorization | None,
    ) -> MemoryRecord:
        auth = self._require_authorization(authorization)
        now = datetime.now(timezone.utc)
        record = MemoryRecord(
            id=uuid4().hex,
            content=draft.content,
            kind=draft.kind,
            sensitivity=draft.sensitivity,
            source=draft.source,
            tags=draft.tags,
            created_at=now,
            updated_at=now,
            expires_at=draft.expires_at,
        )
        payload_nonce, payload_ciphertext = self._encrypt_payload(record.id, draft)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO memories (
                    id, payload_nonce, payload_ciphertext,
                    created_at, updated_at, expires_at, deleted_at
                ) VALUES (?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    record.id,
                    payload_nonce,
                    payload_ciphertext,
                    record.created_at.isoformat(),
                    record.updated_at.isoformat(),
                    record.expires_at.isoformat() if record.expires_at else None,
                ),
            )
            self._insert_event(connection, record.id, "create", auth, now)
        return record

    def soft_delete(
        self,
        memory_id: str,
        *,
        authorization: WriteAuthorization | None,
    ) -> bool:
        auth = self._require_authorization(authorization)
        now = datetime.now(timezone.utc)
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE memories SET deleted_at = ?, updated_at = ? "
                "WHERE id = ? AND deleted_at IS NULL",
                (now.isoformat(), now.isoformat(), memory_id),
            )
            if cursor.rowcount:
                self._insert_event(connection, memory_id, "delete", auth, now)
                return True
        return False

    def active_records(self, *, now: datetime | None = None) -> list[MemoryRecord]:
        current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM memories
                WHERE deleted_at IS NULL
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY created_at DESC
                """,
                (current.isoformat(),),
            ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def _insert_event(
        self,
        connection: sqlite3.Connection,
        memory_id: str,
        event_type: str,
        authorization: WriteAuthorization,
        created_at: datetime,
    ) -> None:
        confirmed_at = authorization.confirmed_at.isoformat()
        purpose_nonce = os.urandom(12)
        purpose_ciphertext = self._aesgcm.encrypt(
            purpose_nonce,
            authorization.purpose.encode("utf-8"),
            self._event_aad(memory_id, event_type, confirmed_at),
        )
        connection.execute(
            """
            INSERT INTO memory_events (
                memory_id, event_type, purpose_nonce, purpose_ciphertext,
                confirmed_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                memory_id,
                event_type,
                purpose_nonce,
                purpose_ciphertext,
                confirmed_at,
                created_at.isoformat(),
            ),
        )

    def _row_to_record(self, row: sqlite3.Row) -> MemoryRecord:
        try:
            plaintext = self._aesgcm.decrypt(
                bytes(row["payload_nonce"]),
                bytes(row["payload_ciphertext"]),
                self._record_aad(row["id"]),
            )
            payload = json.loads(plaintext.decode("utf-8"))
        except (InvalidTag, UnicodeDecodeError, json.JSONDecodeError, TypeError, KeyError):
            raise MemoryDecryptionError(
                f"hafiza kaydi dogrulanamadi: {row['id']}"
            ) from None
        return MemoryRecord(
            id=row["id"],
            content=payload["content"],
            kind=payload["kind"],
            sensitivity=payload["sensitivity"],
            source=payload["source"],
            tags=tuple(payload["tags"]),
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            expires_at=datetime.fromisoformat(row["expires_at"]) if row["expires_at"] else None,
            deleted_at=datetime.fromisoformat(row["deleted_at"]) if row["deleted_at"] else None,
        )
