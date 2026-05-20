from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urlparse

from telegram import Update
from telegram.ext import CommandHandler, ContextTypes

from .scheduler import MonitorScheduler
from .storage import MonitorStorage

INTERVAL_PATTERN = re.compile(r"^(\d+)([smh])$")


class MonitorHandlers:
    """Telegram command handlers for uptime monitor management."""

    def __init__(self, storage: MonitorStorage, scheduler: MonitorScheduler) -> None:
        self.storage = storage
        self.scheduler = scheduler

    def build(self) -> list[CommandHandler]:
        return [
            CommandHandler("add", self.add_monitor),
            CommandHandler("addat", self.add_daily_monitor),
            CommandHandler("list", self.list_monitors),
            CommandHandler("remove", self.remove_monitor),
        ]

    async def add_monitor(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if update.effective_chat is None:
            return

        args = context.args
        if len(args) != 2:
            await update.message.reply_text("Usage: /add <url> <interval>\nExample: /add https://google.com 5m")
            return

        url, interval_raw = args
        if not _is_valid_url(url):
            await update.message.reply_text("Invalid URL. Example: https://example.com")
            return

        interval_seconds = _parse_interval(interval_raw)
        if interval_seconds is None:
            await update.message.reply_text("Invalid interval. Supported units: s, m, h (example: 30s, 5m, 1h)")
            return

        monitor = self.storage.add_interval_monitor(update.effective_chat.id, url, interval_seconds)
        self.scheduler.add_monitor_job(monitor)

        await update.message.reply_text(
            f"Monitor added.\nID: {monitor.id}\nURL: {monitor.url}\nInterval: {interval_raw}"
        )

    async def add_daily_monitor(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if update.effective_chat is None:
            return

        args = context.args
        if len(args) != 2:
            await update.message.reply_text("Usage: /addat <url> <HH:MM>\nExample: /addat https://google.com 09:00")
            return

        url, at_time = args
        if not _is_valid_url(url):
            await update.message.reply_text("Invalid URL. Example: https://example.com")
            return

        if not _is_valid_hhmm(at_time):
            await update.message.reply_text("Invalid time format. Use HH:MM (24h), e.g. 09:00")
            return

        monitor = self.storage.add_daily_monitor(update.effective_chat.id, url, at_time)
        self.scheduler.add_monitor_job(monitor)

        await update.message.reply_text(
            f"Daily monitor added.\nID: {monitor.id}\nURL: {monitor.url}\nAt: {at_time}"
        )

    async def list_monitors(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if update.effective_chat is None:
            return

        monitors = self.storage.list_monitors(update.effective_chat.id)
        if not monitors:
            await update.message.reply_text("No monitors configured yet.")
            return

        lines = ["Your monitors:"]
        for m in monitors:
            if m.schedule_type == "interval":
                schedule = f"every {m.interval_seconds}s"
            else:
                schedule = f"daily at {m.time_of_day}"
            lines.append(f"- #{m.id} | {m.url} | {schedule}")

        await update.message.reply_text("\n".join(lines))

    async def remove_monitor(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if update.effective_chat is None:
            return

        if len(context.args) != 1 or not context.args[0].isdigit():
            await update.message.reply_text("Usage: /remove <id>")
            return

        monitor_id = int(context.args[0])
        removed = self.storage.remove_monitor(monitor_id, chat_id=update.effective_chat.id)
        if not removed:
            await update.message.reply_text("Monitor not found.")
            return

        self.scheduler.remove_monitor_job(monitor_id)
        await update.message.reply_text(f"Monitor #{monitor_id} removed.")


def _is_valid_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    except Exception:  # noqa: BLE001
        return False


def _parse_interval(value: str) -> int | None:
    match = INTERVAL_PATTERN.match(value.lower().strip())
    if not match:
        return None

    amount = int(match.group(1))
    unit = match.group(2)
    if amount <= 0:
        return None

    factor = {"s": 1, "m": 60, "h": 3600}[unit]
    return amount * factor


def _is_valid_hhmm(value: str) -> bool:
    try:
        datetime.strptime(value, "%H:%M")
        return True
    except ValueError:
        return False
