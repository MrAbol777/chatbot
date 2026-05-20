"""Plugin-style Telegram uptime monitor module."""

from .plugin import TelegramUptimePlugin, create_plugin

__all__ = ["TelegramUptimePlugin", "create_plugin"]
