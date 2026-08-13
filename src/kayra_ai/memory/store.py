from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .contracts import MemoryDraft, MemoryRecord, WriteAuthorization


class MemoryAuthorizationError(PermissionError):
    pass


class UnsafeMemoryPathError(ValueError):
    pass


def default_memory_db_path() -> Path:
    configured = os.environ.get("KAYRA_MEMORY_DB")
    if configured:
        return Path(configured).expanduser()
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "KayraAI" / "memory" / "memory.sqlite3"
    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg_data_home).expanduser() if xdg_data_home else Path.home() / ".local" / "share"
    return base / "kayra-ai" / "memory" / "memory.sqlite3"


class MemoryStore:
    def __init__(
        self,
        db_path: str | Path | None = None,
        *,
        repository_root: str | Path | None = None,
    ) -> None:
        self.db_path = Path(db_path) if db_path is not None else default_memory_db_path()
        self.db_path = self.db_path.expanduser().resolve()
        if repository_root is not None:
            repo = Path(repository_root).expanduser().resolve()
            if self.db_path == repo or self.db_path.is_relative_to(repo):
                raise UnsafeMemoryPathError("kisisel hafiza veritabani Git deposunun disinda olmali")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    sensitivity TEXT NOT NULL,
                    source TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    expires_at TEXT,
                    deleted_at TEXT
                );

                CREATE TABLE IF NOT EXISTS memory_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    memory_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    purpose TEXT NOT NULL,
                    confirmed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(memory_id) REFERENCES memories(id)
                );
                """
            )

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
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO memories (
                    id, content, kind, sensitivity, source, tags_json,
                    created_at, updated_at, expires_at, deleted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    record.id,
                    record.content,
                    record.kind,
                    record.sensitivity,
                    record.source,
                    json.dumps(record.tags, ensure_ascii=False),
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

    @staticmethod
    def _insert_event(
        connection: sqlite3.Connection,
        memory_id: str,
        event_type: str,
        authorization: WriteAuthorization,
        created_at: datetime,
    ) -> None:
        connection.execute(
            """
            INSERT INTO memory_events (
                memory_id, event_type, purpose, confirmed_at, created_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                memory_id,
                event_type,
                authorization.purpose,
                authorization.confirmed_at.isoformat(),
                created_at.isoformat(),
            ),
        )

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> MemoryRecord:
        return MemoryRecord(
            id=row["id"],
            content=row["content"],
            kind=row["kind"],
            sensitivity=row["sensitivity"],
            source=row["source"],
            tags=tuple(json.loads(row["tags_json"])),
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            expires_at=datetime.fromisoformat(row["expires_at"]) if row["expires_at"] else None,
            deleted_at=datetime.fromisoformat(row["deleted_at"]) if row["deleted_at"] else None,
        )
