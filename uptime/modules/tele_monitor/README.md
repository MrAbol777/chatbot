# Telegram Uptime Monitor Plugin

Standalone plugin-style module for `python-telegram-bot` (v20+) with:
- persistent SQLite monitor storage
- APScheduler AsyncIOScheduler jobs
- active reporting on **every tick** (UP and ERROR)

## Commands
- `/add <url> <interval>` (supports `s`, `m`, `h`)
- `/addat <url> <HH:MM>`
- `/list`
- `/remove <id>`

## Quick Integration

```python
from uptime.modules.tele_monitor import create_plugin

plugin = create_plugin(application)
application.add_handlers(plugin.add_handlers())

# call this once on startup (after Application is ready)
await plugin.init_scheduler()
```

## ENV
- `TELEGRAM_TOKEN` must be set.

## Dependencies
- `python-telegram-bot>=20`
- `apscheduler`
- `aiohttp`
