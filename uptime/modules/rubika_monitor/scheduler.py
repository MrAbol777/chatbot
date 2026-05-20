from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .storage import Monitor


class MonitorScheduler:
    def __init__(self) -> None:
        self._scheduler = BackgroundScheduler()
        self._started = False

    def start(self) -> None:
        if not self._started:
            self._scheduler.start()
            self._started = True

    def shutdown(self) -> None:
        if self._started:
            self._scheduler.shutdown(wait=False)
            self._started = False

    @staticmethod
    def job_id(monitor_id: int) -> str:
        return f"monitor:{monitor_id}"

    def remove_job(self, monitor_id: int) -> None:
        jid = self.job_id(monitor_id)
        if self._scheduler.get_job(jid):
            self._scheduler.remove_job(jid)

    def schedule_monitor(self, monitor: Monitor, callback) -> None:
        self.remove_job(monitor.id)

        if monitor.is_paused:
            return

        jid = self.job_id(monitor.id)
        if monitor.type == "interval" and monitor.interval_seconds:
            trigger = IntervalTrigger(seconds=monitor.interval_seconds)
        elif monitor.type == "daily_at" and monitor.daily_time:
            hour, minute = monitor.daily_time.split(":")
            trigger = CronTrigger(hour=int(hour), minute=int(minute))
        else:
            return

        self._scheduler.add_job(
            callback,
            trigger=trigger,
            id=jid,
            replace_existing=True,
            args=[monitor.id],
            misfire_grace_time=30,
            coalesce=True,
            max_instances=1,
        )
