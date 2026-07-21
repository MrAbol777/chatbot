from __future__ import annotations

import logging
import time

import requests

logger = logging.getLogger(__name__)


class BaleClient:
    def __init__(self, token: str, timeout_seconds: int = 10, retry_attempts: int = 2) -> None:
        self.base_url = f"https://tapi.bale.ai/bot{token}"
        self.timeout_seconds = timeout_seconds
        self.retry_attempts = max(1, retry_attempts)

    def send_message(self, chat_id: int, text: str) -> dict:
        url = f"{self.base_url}/sendMessage"
        payload = {"chat_id": chat_id, "text": text}
        return self._post_with_retry(url, payload)

    def _post_with_retry(self, url: str, payload: dict) -> dict:
        last_error: Exception | None = None
        for attempt in range(1, self.retry_attempts + 1):
            try:
                response = requests.post(url, json=payload, timeout=self.timeout_seconds)
                response.raise_for_status()
                data = response.json()
                if data.get("ok") is False:
                    raise RuntimeError(f"Bale API error: {data}")
                return data
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.warning("Bale API attempt %s/%s failed: %s", attempt, self.retry_attempts, exc)
                if attempt < self.retry_attempts:
                    time.sleep(0.25)
        raise RuntimeError(f"Bale API request failed after retries: {last_error}")
