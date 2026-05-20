from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_WEBHOOK_PATH = "/bale/webhook"
MIN_INTERVAL_SECONDS = 10
MAX_INTERVAL_SECONDS = 24 * 60 * 60
DEFAULT_HTTP_TIMEOUT_SECONDS = 15
DEFAULT_BALE_TIMEOUT_SECONDS = 10
DEFAULT_BALE_RETRY_ATTEMPTS = 2


@dataclass(frozen=True, slots=True)
class BaleMonitorConfig:
    token: str
    db_path: Path
    timezone: ZoneInfo
    webhook_path: str
    http_timeout_seconds: int
    bale_timeout_seconds: int
    bale_retry_attempts: int


def load_config(base_dir: str | Path | None = None) -> BaleMonitorConfig:
    token = os.getenv("BALE_BOT_TOKEN", "").strip()
    if not token:
        raise RuntimeError("BALE_BOT_TOKEN is required")

    tz_name = os.getenv("BALE_MONITOR_TZ", "") or os.getenv("TZ", "UTC")
    timezone = ZoneInfo(tz_name)

    if base_dir is None:
        base_dir = Path(__file__).resolve().parents[3] / "uptime"
    base = Path(base_dir)
    db_path = Path(os.getenv("BALE_MONITOR_DB_PATH", str(base / "bale_monitor.sqlite3")))

    return BaleMonitorConfig(
        token=token,
        db_path=db_path,
        timezone=timezone,
        webhook_path=os.getenv("BALE_MONITOR_WEBHOOK_PATH", DEFAULT_WEBHOOK_PATH),
        http_timeout_seconds=int(os.getenv("BALE_MONITOR_HTTP_TIMEOUT", DEFAULT_HTTP_TIMEOUT_SECONDS)),
        bale_timeout_seconds=int(os.getenv("BALE_MONITOR_BALE_TIMEOUT", DEFAULT_BALE_TIMEOUT_SECONDS)),
        bale_retry_attempts=int(os.getenv("BALE_MONITOR_BALE_RETRIES", DEFAULT_BALE_RETRY_ATTEMPTS)),
    )
