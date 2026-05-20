from __future__ import annotations

import os
from pathlib import Path

from telegram.ext import Application, BaseHandler

from .handlers import MonitorHandlers
from .scheduler import MonitorScheduler
from .storage import MonitorStorage


class TelegramUptimePlugin:
    """Low-coupling uptime-monitor plugin for python-telegram-bot v20+."""

    def __init__(self, application: Application, db_path: str | Path | None = None) -> None:
        if not os.getenv("TELEGRAM_TOKEN"):
            raise RuntimeError("TELEGRAM_TOKEN environment variable is required.")

        self.application = application
        self.storage = MonitorStorage(db_path or Path("uptime") / "tele_monitor.sqlite3")
        self.scheduler = MonitorScheduler(application.bot, self.storage)
        self._handlers = MonitorHandlers(self.storage, self.scheduler)

    def add_handlers(self) -> list[BaseHandler]:
        """Return handlers for application.add_handlers(plugin.add_handlers())."""
        return self._handlers.build()

    async def init_scheduler(self) -> None:
        """Initialize scheduler and recover persisted jobs from DB."""
        await self.scheduler.init_scheduler()


def create_plugin(application: Application, db_path: str | Path | None = None) -> TelegramUptimePlugin:
    return TelegramUptimePlugin(application=application, db_path=db_path)
