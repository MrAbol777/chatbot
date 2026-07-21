class MonitorScheduler {
  constructor({ storage, onTick, timezone }) {
    this.storage = storage;
    this.onTick = onTick;
    this.timezone = timezone;
    this.jobs = new Map();
  }

  start() {
    const all = this.storage.listAll();
    all.forEach((m) => this.syncMonitor(m.id));
  }

  stop() {
    for (const id of this.jobs.keys()) this.removeJob(id);
  }

  syncMonitor(monitorId) {
    const monitor = this.storage.getById(monitorId);
    this.removeJob(monitorId);
    if (!monitor || Number(monitor.is_paused) === 1) return;

    if (monitor.type === 'interval') {
      const timer = setInterval(() => this.onTick(monitor.id), Number(monitor.interval_seconds) * 1000);
      this.jobs.set(monitor.id, { type: 'interval', timer });
      return;
    }

    if (monitor.type === 'daily_at') {
      const scheduleNext = () => {
        const m = this.storage.getById(monitorId);
        if (!m || Number(m.is_paused) === 1) {
          this.removeJob(monitorId);
          return;
        }
        const ms = this._msUntilNext(m.daily_time);
        const timer = setTimeout(async () => {
          await this.onTick(monitorId);
          scheduleNext();
        }, ms);
        this.jobs.set(monitorId, { type: 'daily_at', timer });
      };
      scheduleNext();
    }
  }

  removeJob(monitorId) {
    const job = this.jobs.get(monitorId);
    if (!job) return;
    if (job.type === 'interval') clearInterval(job.timer);
    else clearTimeout(job.timer);
    this.jobs.delete(monitorId);
  }

  _msUntilNext(hhmm) {
    const [hh, mm] = String(hhmm).split(':').map((x) => Number(x));
    const now = new Date();
    const next = new Date(now);
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }
}

module.exports = { MonitorScheduler };
