import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class Monitor:
    id: int
    chat_id: str
    url: str
    type: str
    interval_seconds: Optional[int]
    daily_time: Optional[str]
    is_paused: int
    created_at: str


class MonitorRepository:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS monitors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id TEXT NOT NULL,
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

    def create_interval(self, chat_id: str, url: str, interval_seconds: int) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO monitors
                (chat_id, url, type, interval_seconds, daily_time, is_paused, created_at)
                VALUES (?, ?, 'interval', ?, NULL, 0, ?)
                """,
                (chat_id, url, interval_seconds, datetime.now().isoformat(timespec="seconds")),
            )
            conn.commit()
            return int(cur.lastrowid)

    def create_daily(self, chat_id: str, url: str, daily_time: str) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO monitors
                (chat_id, url, type, interval_seconds, daily_time, is_paused, created_at)
                VALUES (?, ?, 'daily_at', NULL, ?, 0, ?)
                """,
                (chat_id, url, daily_time, datetime.now().isoformat(timespec="seconds")),
            )
            conn.commit()
            return int(cur.lastrowid)

    def list_by_chat(self, chat_id: str) -> list[Monitor]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM monitors WHERE chat_id = ? ORDER BY id ASC", (chat_id,)
            ).fetchall()
        return [Monitor(**dict(row)) for row in rows]

    def list_active(self) -> list[Monitor]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM monitors WHERE is_paused = 0").fetchall()
        return [Monitor(**dict(row)) for row in rows]

    def get_by_id(self, monitor_id: int) -> Optional[Monitor]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM monitors WHERE id = ?", (monitor_id,)).fetchone()
        return Monitor(**dict(row)) if row else None

    def delete_by_id_and_chat(self, monitor_id: int, chat_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM monitors WHERE id = ? AND chat_id = ?", (monitor_id, chat_id)
            )
            conn.commit()
        return cur.rowcount > 0

    def set_paused(self, monitor_id: int, chat_id: str, is_paused: bool) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE monitors SET is_paused = ? WHERE id = ? AND chat_id = ?",
                (1 if is_paused else 0, monitor_id, chat_id),
            )
            conn.commit()
        return cur.rowcount > 0
