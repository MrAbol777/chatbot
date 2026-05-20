from __future__ import annotations

from typing import Any
import logging

from .bale_client import BaleClient
from .service_commands import CommandService

logger = logging.getLogger(__name__)


class BaleWebhookHandler:
    def __init__(self, command_service: CommandService, bale_client: BaleClient) -> None:
        self.command_service = command_service
        self.bale_client = bale_client

    def handle_update(self, update: dict[str, Any]) -> dict[str, Any]:
        message = update.get("message")
        if not isinstance(message, dict):
            return {"ok": True, "ignored": "no_message"}

        text = message.get("text")
        chat = message.get("chat")
        if not isinstance(text, str) or not isinstance(chat, dict):
            return {"ok": True, "ignored": "not_text"}

        chat_id = chat.get("id")
        if not isinstance(chat_id, int):
            return {"ok": True, "ignored": "no_chat_id"}

        response = self.command_service.handle_text(chat_id=chat_id, text=text)

        try:
            self.bale_client.send_message(chat_id, response.text)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to send webhook command response")

        return {"ok": True}
