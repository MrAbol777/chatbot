from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .storage import Monitor, MonitorStorage
from .service import MonitorService

logger = logging.getLogger(__name__)


class MonitorScheduler:
    def __init__(self, storage: MonitorStorage, service: MonitorService, timezone: str) -> None:
        self.storage = storage
        self.service = service
        self.scheduler = BackgroundScheduler(timezone=timezone)

    @staticmethod
    def job_id(monitor_id: int) -> str:
        return f"monitor:{monitor_id}"

    def start(self) -> None:
        self.reload_all_jobs()
        if not self.scheduler.running:
            self.scheduler.start()

    def shutdown(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

    def reload_all_jobs(self) -> None:
        for monitor in self.storage.list_all():
            self._sync_job(monitor)

    def sync_monitor(self, monitor_id: int) -> None:
        try:
            monitor = self.storage.get_by_id(monitor_id)
        except KeyError:
            self.remove_job(monitor_id)
            return
        self._sync_job(monitor)

    def remove_job(self, monitor_id: int) -> None:
        job = self.scheduler.get_job(self.job_id(monitor_id))
        if job:
            self.scheduler.remove_job(job.id)

    def _sync_job(self, monitor: Monitor) -> None:
        self.remove_job(monitor.id)
        if monitor.is_paused:
            return

        trigger = self._build_trigger(monitor)
        self.scheduler.add_job(
            self.service.run_monitor_tick,
            trigger=trigger,
            args=[monitor.id],
            id=self.job_id(monitor.id),
            replace_existing=True,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=30,
        )

    @staticmethod
    def _build_trigger(monitor: Monitor):
        if monitor.type == "interval" and monitor.interval_seconds is not None:
            return IntervalTrigger(seconds=monitor.interval_seconds)

        if monitor.type == "daily_at" and monitor.daily_time:
            hour, minute = monitor.daily_time.split(":", maxsplit=1)
            return CronTrigger(hour=int(hour), minute=int(minute), second=0)

        raise ValueError(f"Monitor {monitor.id} has invalid schedule")
