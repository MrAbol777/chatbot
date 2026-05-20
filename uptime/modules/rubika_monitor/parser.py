import re
from dataclasses import dataclass
from urllib.parse import urlparse


INTERVAL_RE = re.compile(r"^(\d+)([smh])$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass
class Command:
    name: str
    args: list[str]


def parse_command(text: str) -> Command | None:
    if not text or not text.startswith("/"):
        return None
    parts = text.strip().split()
    if not parts:
        return None
    return Command(name=parts[0].lower(), args=parts[1:])


def validate_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    except Exception:  # noqa: BLE001
        return False


def parse_interval(interval_text: str) -> int | None:
    match = INTERVAL_RE.match(interval_text.strip().lower())
    if not match:
        return None
    value = int(match.group(1))
    unit = match.group(2)
    multiplier = {"s": 1, "m": 60, "h": 3600}[unit]
    seconds = value * multiplier
    if seconds < 10 or seconds > 86400:
        return None
    return seconds


def validate_daily_time(time_text: str) -> bool:
    return bool(TIME_RE.match(time_text.strip()))
