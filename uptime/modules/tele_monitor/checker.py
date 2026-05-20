from __future__ import annotations

import time
from datetime import datetime

import aiohttp


def _safe_inline(value: str) -> str:
    return value.replace("`", "'")


async def check_url(url: str, timeout_seconds: int = 15) -> dict[str, object]:
    """Run async HTTP GET and return normalized result."""
    started = time.perf_counter()

    try:
        timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, allow_redirects=True) as response:
                await response.read()
                latency_ms = int((time.perf_counter() - started) * 1000)
                return {
                    "ok": True,
                    "status": response.status,
                    "latency_ms": latency_ms,
                    "error": None,
                }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": None,
            "latency_ms": None,
            "error": _safe_inline(str(exc) or exc.__class__.__name__),
        }


def format_tick_message(url: str, result: dict[str, object]) -> str:
    """Build Markdown-formatted tick report for success and failure states."""
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    safe_url = _safe_inline(url)

    if result["ok"]:
        return (
            "*⏱ Monitor Tick*\n"
            f"🔗 URL: `{safe_url}`\n"
            f"✅ Result: `OK` (Status: {result['status']})\n"
            f"⏱ Latency: `{result['latency_ms']}ms`\n"
            f"📅 Time: `{now_str}`"
        )

    return (
        "*⏱ Monitor Tick*\n"
        f"🔗 URL: `{safe_url}`\n"
        "❌ Result: `ERROR`\n"
        f"⚠️ Error: `{result['error']}`\n"
        f"📅 Time: `{now_str}`"
    )
