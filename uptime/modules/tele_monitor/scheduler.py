from __future__ import annotations

import logging
from datetime import time as dt_time

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from telegram import Bot
from telegram.constants import ParseMode

from .checker import check_url, format_tick_message
from .storage import Monitor, MonitorStorage

logger = logging.getLogger(__name__)


class MonitorScheduler:
    """APScheduler wrapper that syncs jobs from persisted monitor records."""

    def __init__(self, bot: Bot, storage: MonitorStorage) -> None:
        self.bot = bot
        self.storage = storage
        self.scheduler = AsyncIOScheduler()

    @staticmethod
    def make_job_id(monitor_id: int) -> str:
        return f"monitor:{monitor_id}"

    async def init_scheduler(self) -> None:
        """Load all persisted monitors and schedule them after app startup."""
        monitors = self.storage.list_all_monitors()
        for monitor in monitors:
            self.add_monitor_job(monitor)

        if not self.scheduler.running:
            self.scheduler.start()

    def add_monitor_job(self, monitor: Monitor) -> None:
        job_id = self.make_job_id(monitor.id)

        self.scheduler.add_job(
            self._run_monitor,
            kwargs={"monitor_id": monitor.id},
            id=job_id,
            replace_existing=True,
            **self._build_trigger(monitor),
        )

    def remove_monitor_job(self, monitor_id: int) -> None:
        job_id = self.make_job_id(monitor_id)
        job = self.scheduler.get_job(job_id)
        if job is not None:
            self.scheduler.remove_job(job_id)

    def _build_trigger(self, monitor: Monitor) -> dict[str, object]:
        if monitor.schedule_type == "interval" and monitor.interval_seconds:
            return {"trigger": "interval", "seconds": monitor.interval_seconds}

        if monitor.schedule_type == "daily" and monitor.time_of_day:
            hour, minute = monitor.time_of_day.split(":", maxsplit=1)
            return {
                "trigger": "cron",
                "hour": int(hour),
                "minute": int(minute),
                "second": 0,
            }

        raise ValueError(f"Invalid monitor schedule configuration for monitor {monitor.id}")

    async def _run_monitor(self, monitor_id: int) -> None:
        try:
            monitor = self.storage.get_monitor(monitor_id)
        except KeyError:
            logger.warning("Monitor id=%s no longer exists in database", monitor_id)
            self.remove_monitor_job(monitor_id)
            return

        result = await check_url(monitor.url)
        text = format_tick_message(monitor.url, result)

        try:
            await self.bot.send_message(
                chat_id=monitor.chat_id,
                text=text,
                parse_mode=ParseMode.MARKDOWN,
                disable_web_page_preview=True,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Failed to send uptime tick for monitor id=%s", monitor_id)
