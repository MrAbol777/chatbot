from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Optional


@dataclass(slots=True)
class Monitor:
    id: int
    chat_id: int
    url: str
    schedule_type: str
    interval_seconds: Optional[int]
    time_of_day: Optional[str]
    created_at: str


class MonitorStorage:
    """SQLite-backed storage for persisted monitor definitions."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS monitors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER NOT NULL,
                    url TEXT NOT NULL,
                    schedule_type TEXT NOT NULL CHECK(schedule_type IN ('interval', 'daily')),
                    interval_seconds INTEGER,
                    time_of_day TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def add_interval_monitor(self, chat_id: int, url: str, interval_seconds: int) -> Monitor:
        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO monitors (chat_id, url, schedule_type, interval_seconds, time_of_day, created_at)
                VALUES (?, ?, 'interval', ?, NULL, ?)
                """,
                (chat_id, url, interval_seconds, created_at),
            )
            conn.commit()
            monitor_id = int(cursor.lastrowid)
        return self.get_monitor(monitor_id)

    def add_daily_monitor(self, chat_id: int, url: str, time_of_day: str) -> Monitor:
        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO monitors (chat_id, url, schedule_type, interval_seconds, time_of_day, created_at)
                VALUES (?, ?, 'daily', NULL, ?, ?)
                """,
                (chat_id, url, time_of_day, created_at),
            )
            conn.commit()
            monitor_id = int(cursor.lastrowid)
        return self.get_monitor(monitor_id)

    def list_monitors(self, chat_id: int) -> list[Monitor]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM monitors WHERE chat_id = ? ORDER BY id ASC", (chat_id,)
            ).fetchall()
        return [self._row_to_monitor(row) for row in rows]

    def list_all_monitors(self) -> list[Monitor]:
        with self._lock, self._connect() as conn:
            rows = conn.execute("SELECT * FROM monitors ORDER BY id ASC").fetchall()
        return [self._row_to_monitor(row) for row in rows]

    def remove_monitor(self, monitor_id: int, chat_id: Optional[int] = None) -> bool:
        with self._lock, self._connect() as conn:
            if chat_id is None:
                cursor = conn.execute("DELETE FROM monitors WHERE id = ?", (monitor_id,))
            else:
                cursor = conn.execute(
                    "DELETE FROM monitors WHERE id = ? AND chat_id = ?", (monitor_id, chat_id)
                )
            conn.commit()
            return cursor.rowcount > 0

    def get_monitor(self, monitor_id: int) -> Monitor:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM monitors WHERE id = ?", (monitor_id,)).fetchone()
        if row is None:
            raise KeyError(f"Monitor with id={monitor_id} was not found")
        return self._row_to_monitor(row)

    @staticmethod
    def _row_to_monitor(row: sqlite3.Row) -> Monitor:
        return Monitor(
            id=row["id"],
            chat_id=row["chat_id"],
            url=row["url"],
            schedule_type=row["schedule_type"],
            interval_seconds=row["interval_seconds"],
            time_of_day=row["time_of_day"],
            created_at=row["created_at"],
        )
