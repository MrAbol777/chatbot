# Bale Monitor Module

A plug-in style Bale webhook monitor with SQLite persistence and APScheduler jobs.

## Commands
- `/add <url> <interval>` (10s to 24h, supports s/m/h)
- `/addat <url> <HH:MM>`
- `/list`
- `/remove <id>`
- `/pause <id>`
- `/resume <id>`

## Env Vars
- `BALE_BOT_TOKEN` (required)
- `BALE_MONITOR_TZ` (optional, default uses `TZ` or `UTC`)
- `BALE_MONITOR_DB_PATH` (optional)
- `BALE_MONITOR_WEBHOOK_PATH` (optional, default `/bale/webhook`)
- `BALE_MONITOR_HTTP_TIMEOUT` (optional, default `15`)
- `BALE_MONITOR_BALE_TIMEOUT` (optional, default `10`)
- `BALE_MONITOR_BALE_RETRIES` (optional, default `2`)

## Integration

```python
from modules.bale_monitor import init_bale_monitor

module = init_bale_monitor(app)
# webhook route is auto-registered and scheduler starts automatically
```

## Notes
- Every job tick sends a report message, including successful 200 responses.
- Deterministic job IDs are used: `monitor:{id}`.
- Existing monitors are loaded from DB on startup.
