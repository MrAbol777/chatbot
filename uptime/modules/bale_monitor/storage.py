from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import sqlite3
from threading import Lock
from typing import Optional


@dataclass(slots=True)
class Monitor:
    id: int
    chat_id: int
    url: str
    type: str
    interval_seconds: Optional[int]
    daily_time: Optional[str]
    is_paused: bool
    created_at: str


class MonitorStorage:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS monitors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER NOT NULL,
                    url TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('interval', 'daily_at')),
                    interval_seconds INTEGER NULL,
                    daily_time TEXT NULL,
                    is_paused INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def add_interval(self, chat_id: int, url: str, interval_seconds: int) -> Monitor:
        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO monitors(chat_id, url, type, interval_seconds, daily_time, is_paused, created_at)
                VALUES (?, ?, 'interval', ?, NULL, 0, ?)
                """,
                (chat_id, url, interval_seconds, created_at),
            )
            conn.commit()
            return self.get_by_id(int(cur.lastrowid))

    def add_daily(self, chat_id: int, url: str, daily_time: str) -> Monitor:
        created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO monitors(chat_id, url, type, interval_seconds, daily_time, is_paused, created_at)
                VALUES (?, ?, 'daily_at', NULL, ?, 0, ?)
                """,
                (chat_id, url, daily_time, created_at),
            )
            conn.commit()
            return self.get_by_id(int(cur.lastrowid))

    def list_by_chat(self, chat_id: int) -> list[Monitor]:
        with self._lock, self._connect() as conn:
            rows = conn.execute("SELECT * FROM monitors WHERE chat_id=? ORDER BY id ASC", (chat_id,)).fetchall()
        return [self._row_to_monitor(r) for r in rows]

    def list_all(self) -> list[Monitor]:
        with self._lock, self._connect() as conn:
            rows = conn.execute("SELECT * FROM monitors ORDER BY id ASC").fetchall()
        return [self._row_to_monitor(r) for r in rows]

    def get_by_id(self, monitor_id: int) -> Monitor:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM monitors WHERE id=?", (monitor_id,)).fetchone()
        if row is None:
            raise KeyError(f"Monitor {monitor_id} not found")
        return self._row_to_monitor(row)

    def remove(self, chat_id: int, monitor_id: int) -> bool:
        with self._lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM monitors WHERE id=? AND chat_id=?", (monitor_id, chat_id))
            conn.commit()
        return cur.rowcount > 0

    def set_paused(self, chat_id: int, monitor_id: int, paused: bool) -> bool:
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                "UPDATE monitors SET is_paused=? WHERE id=? AND chat_id=?",
                (1 if paused else 0, monitor_id, chat_id),
            )
            conn.commit()
        return cur.rowcount > 0

    @staticmethod
    def _row_to_monitor(row: sqlite3.Row) -> Monitor:
        return Monitor(
            id=row["id"],
            chat_id=row["chat_id"],
            url=row["url"],
            type=row["type"],
            interval_seconds=row["interval_seconds"],
            daily_time=row["daily_time"],
            is_paused=bool(row["is_paused"]),
            created_at=row["created_at"],
        )
