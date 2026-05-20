from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import logging
import time

import requests

from .parser import (
    CommandParseError,
    parse_command,
    parse_daily_time,
    parse_interval,
    parse_monitor_id,
    validate_url,
)
from .scheduler import MonitorScheduler
from .bale_client import BaleClient
from .storage import Monitor, MonitorStorage

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class CheckResult:
    ok: bool
    status_code: int | None
    error: str | None
    latency_ms: int


class MonitorService:
    def __init__(self, storage: MonitorStorage, bale_client: BaleClient, timeout_seconds: int = 15) -> None:
        self.storage = storage
        self.bale_client = bale_client
        self.timeout_seconds = timeout_seconds

    def run_monitor_tick(self, monitor_id: int) -> None:
        try:
            monitor = self.storage.get_by_id(monitor_id)
        except KeyError:
            logger.info("Monitor %s missing in DB; skipping tick", monitor_id)
            return

        if monitor.is_paused:
            logger.debug("Monitor %s is paused; skipping tick", monitor_id)
            return

        result = self._check_url(monitor.url)
        report = self._build_report(monitor, result)

        try:
            self.bale_client.send_message(monitor.chat_id, report)
        except Exception:  # noqa: BLE001
            logger.exception("Failed sending Bale monitor report for id=%s", monitor.id)

    def _check_url(self, url: str) -> CheckResult:
        start = time.perf_counter()
        try:
            resp = requests.get(url, timeout=self.timeout_seconds)
            latency_ms = int((time.perf_counter() - start) * 1000)
            return CheckResult(ok=True, status_code=resp.status_code, error=None, latency_ms=latency_ms)
        except Exception as exc:  # noqa: BLE001
            latency_ms = int((time.perf_counter() - start) * 1000)
            return CheckResult(ok=False, status_code=None, error=str(exc), latency_ms=latency_ms)

    @staticmethod
    def _build_report(monitor: Monitor, result: CheckResult) -> str:
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        if result.ok:
            return (
                "⏱ Monitor Tick\n\n"
                f"URL: {monitor.url}\n"
                f"Result: OK ({result.status_code})\n"
                f"Latency: {result.latency_ms}ms\n"
                f"Time: {now}"
            )

        return (
            "⏱ Monitor Tick\n\n"
            f"URL: {monitor.url}\n"
            "Result: ERROR\n"
            f"Error: {result.error or 'Unknown error'}\n"
            f"Latency: {result.latency_ms}ms\n"
            f"Time: {now}"
        )


@dataclass(slots=True)
class CommandResponse:
    text: str


class CommandService:
    def __init__(self, storage: MonitorStorage, scheduler: MonitorScheduler) -> None:
        self.storage = storage
        self.scheduler = scheduler

    def handle_text(self, chat_id: int, text: str) -> CommandResponse:
        try:
            cmd = parse_command(text)
            match cmd.name:
                case "/add":
                    return self._add(chat_id, cmd.args)
                case "/addat":
                    return self._addat(chat_id, cmd.args)
                case "/list":
                    return self._list(chat_id)
                case "/remove":
                    return self._remove(chat_id, cmd.args)
                case "/pause":
                    return self._pause(chat_id, cmd.args)
                case "/resume":
                    return self._resume(chat_id, cmd.args)
                case _:
                    return CommandResponse(
                        "Unknown command. Available: /add, /addat, /list, /remove, /pause, /resume"
                    )
        except CommandParseError as exc:
            return CommandResponse(str(exc))
        except Exception:  # noqa: BLE001
            logger.exception("Unhandled command error")
            return CommandResponse("Internal error while processing command")

    def _add(self, chat_id: int, args: list[str]) -> CommandResponse:
        if len(args) != 2:
            raise CommandParseError("Usage: /add <url> <interval>")
        url = validate_url(args[0])
        interval_seconds = parse_interval(args[1])

        monitor = self.storage.add_interval(chat_id, url, interval_seconds)
        self.scheduler.sync_monitor(monitor.id)
        return CommandResponse(
            f"Monitor added.\nID: {monitor.id}\nURL: {monitor.url}\nSchedule: every {monitor.interval_seconds}s"
        )

    def _addat(self, chat_id: int, args: list[str]) -> CommandResponse:
        if len(args) != 2:
            raise CommandParseError("Usage: /addat <url> <HH:MM>")
        url = validate_url(args[0])
        daily_time = parse_daily_time(args[1])

        monitor = self.storage.add_daily(chat_id, url, daily_time)
        self.scheduler.sync_monitor(monitor.id)
        return CommandResponse(
            f"Daily monitor added.\nID: {monitor.id}\nURL: {monitor.url}\nSchedule: daily at {monitor.daily_time}"
        )

    def _list(self, chat_id: int) -> CommandResponse:
        monitors = self.storage.list_by_chat(chat_id)
        if not monitors:
            return CommandResponse("No monitors found for this chat.")

        lines = ["Monitors:"]
        for m in monitors:
            sched = f"every {m.interval_seconds}s" if m.type == "interval" else f"daily at {m.daily_time}"
            status = "paused" if m.is_paused else "active"
            lines.append(f"#{m.id} | {m.url} | {m.type} ({sched}) | {status}")

        return CommandResponse("\n".join(lines))

    def _remove(self, chat_id: int, args: list[str]) -> CommandResponse:
        if len(args) != 1:
            raise CommandParseError("Usage: /remove <id>")
        monitor_id = parse_monitor_id(args[0])
        removed = self.storage.remove(chat_id, monitor_id)
        if not removed:
            return CommandResponse("Monitor not found.")

        self.scheduler.remove_job(monitor_id)
        return CommandResponse(f"Monitor #{monitor_id} removed.")

    def _pause(self, chat_id: int, args: list[str]) -> CommandResponse:
        if len(args) != 1:
            raise CommandParseError("Usage: /pause <id>")
        monitor_id = parse_monitor_id(args[0])
        changed = self.storage.set_paused(chat_id, monitor_id, paused=True)
        if not changed:
            return CommandResponse("Monitor not found.")
        self.scheduler.sync_monitor(monitor_id)
        return CommandResponse(f"Monitor #{monitor_id} paused.")

    def _resume(self, chat_id: int, args: list[str]) -> CommandResponse:
        if len(args) != 1:
            raise CommandParseError("Usage: /resume <id>")
        monitor_id = parse_monitor_id(args[0])
        changed = self.storage.set_paused(chat_id, monitor_id, paused=False)
        if not changed:
            return CommandResponse("Monitor not found.")
        self.scheduler.sync_monitor(monitor_id)
        return CommandResponse(f"Monitor #{monitor_id} resumed.")
