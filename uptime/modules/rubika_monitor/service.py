from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import time
from typing import Any

import requests

from .config import Config
from .parser import parse_command, parse_interval, validate_daily_time, validate_url
from .rubika_client import RubikaClient
from .scheduler import MonitorScheduler
from .storage import MonitorRepository


@dataclass
class WebhookResult:
    ok: bool
    message: str = "ok"


class RubikaMonitorService:
    def __init__(
        self,
        config: Config | None = None,
        repository: MonitorRepository | None = None,
        scheduler: MonitorScheduler | None = None,
        rubika_client: RubikaClient | None = None,
    ) -> None:
        self.config = config or Config()
        self.config.validate()
        self.repository = repository or MonitorRepository(self.config.database_path)
        self.scheduler = scheduler or MonitorScheduler()
        self.rubika_client = rubika_client or RubikaClient(
            token=self.config.rubika_bot_token,
            timeout_seconds=self.config.monitor_timeout_seconds,
            retries=self.config.request_retries,
            retry_delay_seconds=self.config.request_retry_delay_seconds,
        )

    def start(self) -> None:
        self.scheduler.start()
        self._reload_jobs_from_db()

    def stop(self) -> None:
        self.scheduler.shutdown()

    def _reload_jobs_from_db(self) -> None:
        for monitor in self.repository.list_active():
            self.scheduler.schedule_monitor(monitor, self.run_monitor_tick)

    def run_monitor_tick(self, monitor_id: int) -> None:
        monitor = self.repository.get_by_id(monitor_id)
        if not monitor or monitor.is_paused:
            self.scheduler.remove_job(monitor_id)
            return

        started = time.perf_counter()
        now_text = datetime.now().strftime("%Y-%m-%d %H:%M")

        try:
            response = requests.get(
                monitor.url,
                timeout=self.config.monitor_timeout_seconds,
            )
            latency_ms = int((time.perf_counter() - started) * 1000)
            text = (
                "⏱ Monitor Tick\n"
                f"URL: {monitor.url}\n"
                f"Result: OK ({response.status_code})\n"
                f"Latency: {latency_ms}ms\n"
                f"Time: {now_text}"
            )
        except requests.Timeout:
            latency_ms = int((time.perf_counter() - started) * 1000)
            text = (
                "⏱ Monitor Tick\n"
                f"URL: {monitor.url}\n"
                "Result: ERROR\n"
                "Error: Timeout\n"
                f"Latency: {latency_ms}ms\n"
                f"Time: {now_text}"
            )
        except Exception as exc:  # noqa: BLE001
            latency_ms = int((time.perf_counter() - started) * 1000)
            text = (
                "⏱ Monitor Tick\n"
                f"URL: {monitor.url}\n"
                "Result: ERROR\n"
                f"Error: {type(exc).__name__}\n"
                f"Latency: {latency_ms}ms\n"
                f"Time: {now_text}"
            )

        self.rubika_client.send_message(monitor.chat_id, text)

    def handle_update(self, payload: dict[str, Any]) -> WebhookResult:
        try:
            print("[rubika_monitor] webhook payload:", json.dumps(payload, ensure_ascii=False))
            extracted = self._extract_new_message(payload)
            if not extracted:
                return WebhookResult(ok=True, message="ignored")

            chat_id = extracted.get("chat_id", "")
            text = extracted.get("text", "")
            if not chat_id or not text:
                return WebhookResult(ok=True, message="ignored")

            command = parse_command(text)
            if not command:
                self.rubika_client.send_message(chat_id, self._help_text())
                return WebhookResult(ok=True)

            self._handle_command(chat_id, command.name, command.args)
            return WebhookResult(ok=True)
        except Exception as exc:  # noqa: BLE001
            print(f"[rubika_monitor] handle_update error: {exc}")
            return WebhookResult(ok=False, message=str(exc))

    @staticmethod
    def _extract_new_message(payload: dict[str, Any]) -> dict[str, str] | None:
        if not isinstance(payload, dict):
            return None

        # Most Rubika webhook payloads are nested under payload.data.update
        data = payload.get("data")
        if isinstance(data, dict):
            update = data.get("update")
            if isinstance(update, dict):
                new_message = update.get("new_message")
                if isinstance(new_message, dict) and isinstance(new_message.get("text"), str):
                    return {
                        "chat_id": str(update.get("chat_id", "")).strip(),
                        "text": new_message.get("text", "").strip(),
                    }

        # Fallback for payloads where update is top-level
        update = payload.get("update")
        if isinstance(update, dict):
            new_message = update.get("new_message")
            if isinstance(new_message, dict) and isinstance(new_message.get("text"), str):
                return {
                    "chat_id": str(update.get("chat_id", "")).strip(),
                    "text": new_message.get("text", "").strip(),
                }
        return None

    def _handle_command(self, chat_id: str, name: str, args: list[str]) -> None:
        if name == "/add":
            self._cmd_add(chat_id, args)
        elif name == "/addat":
            self._cmd_addat(chat_id, args)
        elif name == "/list":
            self._cmd_list(chat_id)
        elif name == "/remove":
            self._cmd_remove(chat_id, args)
        elif name == "/pause":
            self._cmd_pause_resume(chat_id, args, pause=True)
        elif name == "/resume":
            self._cmd_pause_resume(chat_id, args, pause=False)
        else:
            self.rubika_client.send_message(chat_id, self._help_text())

    def _cmd_add(self, chat_id: str, args: list[str]) -> None:
        if len(args) != 2:
            self.rubika_client.send_message(chat_id, "Usage: /add <url> <interval>")
            return
        url, interval_text = args[0], args[1]
        if not validate_url(url):
            self.rubika_client.send_message(chat_id, "Invalid URL. Only http/https is allowed.")
            return
        seconds = parse_interval(interval_text)
        if seconds is None:
            self.rubika_client.send_message(
                chat_id, "Invalid interval. Use 10s..24h (e.g. 30s, 5m, 2h)."
            )
            return
        monitor_id = self.repository.create_interval(chat_id, url, seconds)
        monitor = self.repository.get_by_id(monitor_id)
        if monitor:
            self.scheduler.schedule_monitor(monitor, self.run_monitor_tick)
        self.rubika_client.send_message(
            chat_id,
            f"Monitor added.\nID: {monitor_id}\nURL: {url}\nType: interval ({seconds}s)",
        )

    def _cmd_addat(self, chat_id: str, args: list[str]) -> None:
        if len(args) != 2:
            self.rubika_client.send_message(chat_id, "Usage: /addat <url> <HH:MM>")
            return
        url, daily_time = args[0], args[1]
        if not validate_url(url):
            self.rubika_client.send_message(chat_id, "Invalid URL. Only http/https is allowed.")
            return
        if not validate_daily_time(daily_time):
            self.rubika_client.send_message(chat_id, "Invalid time format. Use HH:MM (24h).")
            return
        monitor_id = self.repository.create_daily(chat_id, url, daily_time)
        monitor = self.repository.get_by_id(monitor_id)
        if monitor:
            self.scheduler.schedule_monitor(monitor, self.run_monitor_tick)
        self.rubika_client.send_message(
            chat_id,
            f"Daily monitor added.\nID: {monitor_id}\nURL: {url}\nTime: {daily_time}",
        )

    def _cmd_list(self, chat_id: str) -> None:
        monitors = self.repository.list_by_chat(chat_id)
        if not monitors:
            self.rubika_client.send_message(chat_id, "No monitors found.")
            return
        lines = ["Monitors:"]
        for m in monitors:
            status = "paused" if m.is_paused else "active"
            spec = f"every {m.interval_seconds}s" if m.type == "interval" else f"at {m.daily_time}"
            lines.append(f"- #{m.id} [{status}] {m.url} ({m.type}: {spec})")
        self.rubika_client.send_message(chat_id, "\n".join(lines))

    def _cmd_remove(self, chat_id: str, args: list[str]) -> None:
        monitor_id = self._parse_id_arg(chat_id, args, "/remove <id>")
        if monitor_id is None:
            return
        deleted = self.repository.delete_by_id_and_chat(monitor_id, chat_id)
        self.scheduler.remove_job(monitor_id)
        if not deleted:
            self.rubika_client.send_message(chat_id, "Monitor not found.")
            return
        self.rubika_client.send_message(chat_id, f"Monitor #{monitor_id} removed.")

    def _cmd_pause_resume(self, chat_id: str, args: list[str], pause: bool) -> None:
        usage = "/pause <id>" if pause else "/resume <id>"
        monitor_id = self._parse_id_arg(chat_id, args, usage)
        if monitor_id is None:
            return
        updated = self.repository.set_paused(monitor_id, chat_id, pause)
        if not updated:
            self.rubika_client.send_message(chat_id, "Monitor not found.")
            return
        monitor = self.repository.get_by_id(monitor_id)
        if pause:
            self.scheduler.remove_job(monitor_id)
            self.rubika_client.send_message(chat_id, f"Monitor #{monitor_id} paused.")
        else:
            if monitor:
                self.scheduler.schedule_monitor(monitor, self.run_monitor_tick)
            self.rubika_client.send_message(chat_id, f"Monitor #{monitor_id} resumed.")

    def _parse_id_arg(self, chat_id: str, args: list[str], usage: str) -> int | None:
        if len(args) != 1:
            self.rubika_client.send_message(chat_id, f"Usage: {usage}")
            return None
        try:
            return int(args[0])
        except ValueError:
            self.rubika_client.send_message(chat_id, "Invalid id. Must be an integer.")
            return None

    @staticmethod
    def _help_text() -> str:
        return (
            "Commands:\n"
            "/add <url> <interval>\n"
            "/addat <url> <HH:MM>\n"
            "/list\n"
            "/remove <id>\n"
            "/pause <id>\n"
            "/resume <id>"
        )
