from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re

from .config import MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS

INTERVAL_PATTERN = re.compile(r"^(\d+)([smh])$")


@dataclass(slots=True)
class ParsedCommand:
    name: str
    args: list[str]


class CommandParseError(ValueError):
    pass


def parse_command(text: str) -> ParsedCommand:
    if not text or not text.startswith("/"):
        raise CommandParseError("Command must start with '/'.")

    parts = text.strip().split()
    if not parts:
        raise CommandParseError("Empty command.")

    return ParsedCommand(name=parts[0].lower(), args=parts[1:])


def validate_url(url: str) -> str:
    clean = url.strip()
    if clean.startswith("http://") or clean.startswith("https://"):
        return clean
    raise CommandParseError("Invalid URL. It must start with http:// or https://")


def parse_interval(raw: str) -> int:
    match = INTERVAL_PATTERN.match(raw.lower().strip())
    if not match:
        raise CommandParseError("Invalid interval. Use formats like 30s, 5m, 1h")

    amount = int(match.group(1))
    unit = match.group(2)
    multiplier = {"s": 1, "m": 60, "h": 3600}[unit]
    seconds = amount * multiplier

    if seconds < MIN_INTERVAL_SECONDS or seconds > MAX_INTERVAL_SECONDS:
        raise CommandParseError("Interval must be between 10 seconds and 24 hours")

    return seconds


def parse_daily_time(raw: str) -> str:
    value = raw.strip()
    try:
        datetime.strptime(value, "%H:%M")
    except ValueError as exc:
        raise CommandParseError("Invalid time format. Use HH:MM (24-hour)") from exc
    return value


def parse_monitor_id(raw: str) -> int:
    if not raw.isdigit():
        raise CommandParseError("Monitor id must be numeric")
    return int(raw)
