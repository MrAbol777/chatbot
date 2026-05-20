# Rubika Monitor Module

ماژول مستقل برای مانیتورینگ URL و گزارش هر Tick در چت Rubika.

## Environment Variables

- `RUBIKA_BOT_TOKEN` (required)
- `MONITOR_TIMEOUT_SECONDS` (optional, default: `15`)
- `RUBIKA_MONITOR_DB_PATH` (optional, default: `modules/rubika_monitor/rubika_monitor.db`)
- `RUBIKA_REQUEST_RETRIES` (optional, default: `2`)
- `RUBIKA_REQUEST_RETRY_DELAY_SECONDS` (optional, default: `0.5`)

## Dependencies

```bash
pip install requests apscheduler
```

## FastAPI Example

```python
from fastapi import FastAPI
from modules.rubika_monitor import RubikaMonitorService, register_routes

app = FastAPI()

monitor_service = RubikaMonitorService()
monitor_service.start()
register_routes(app, monitor_service)
```

Webhook path:
- `POST /rubika/webhook`

## Flask Example

```python
from flask import Flask
from modules.rubika_monitor import RubikaMonitorService, register_routes

app = Flask(__name__)

monitor_service = RubikaMonitorService()
monitor_service.start()
register_routes(app, monitor_service)
```

Webhook path:
- `POST /rubika/webhook`

## Supported Commands

- `/add <url> <interval>` (interval: `10s`, `5m`, `2h`, min=10s, max=24h)
- `/addat <url> <HH:MM>`
- `/list`
- `/remove <id>`
- `/pause <id>`
- `/resume <id>`

## Example Inputs

```text
/add https://example.com 30s
/addat https://example.com 14:30
/list
/pause 1
/resume 1
/remove 1
```

## Example Tick Output

```text
⏱ Monitor Tick
URL: https://example.com
Result: OK (200)
Latency: 241ms
Time: 2026-05-20 14:30
```

```text
⏱ Monitor Tick
URL: https://example.com
Result: ERROR
Error: Timeout
Latency: 15000ms
Time: 2026-05-20 14:30
```
