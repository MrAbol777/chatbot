import time
from typing import Any, Dict

import requests


class RubikaClient:
    def __init__(
        self,
        token: str,
        timeout_seconds: int = 15,
        retries: int = 2,
        retry_delay_seconds: float = 0.5,
    ) -> None:
        self._token = token
        self._timeout_seconds = timeout_seconds
        self._retries = retries
        self._retry_delay_seconds = retry_delay_seconds

    def _url(self, method: str) -> str:
        return f"https://botapi.rubika.ir/v3/{self._token}/{method}"

    def call_method(self, method: str, payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(1, self._retries + 1):
            try:
                response = requests.post(
                    self._url(method),
                    json=payload or {},
                    timeout=self._timeout_seconds,
                )
                response.raise_for_status()
                body = response.json()
                self._assert_success(method, body)
                return body
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt < self._retries:
                    time.sleep(self._retry_delay_seconds)
        raise RuntimeError(f"Failed Rubika API call '{method}' after retries: {last_error}")

    @staticmethod
    def _assert_success(method: str, body: Dict[str, Any]) -> None:
        # Rubika may return HTTP 200 with non-success status in body.
        status = str(body.get("status", "")).upper()
        ok_flag = body.get("ok")
        if status and status not in {"OK", "SUCCESS"}:
            raise RuntimeError(
                f"Rubika API '{method}' failed: status={body.get('status')} detail={body.get('status_det')}"
            )
        if isinstance(ok_flag, bool) and not ok_flag:
            raise RuntimeError(f"Rubika API '{method}' failed: {body}")

    def get_me(self) -> Dict[str, Any]:
        return self.call_method("getMe", {})

    def update_bot_endpoint(self, url: str, endpoint_type: str = "ReceiveUpdate") -> Dict[str, Any]:
        return self.call_method("updateBotEndpoints", {"url": url, "type": endpoint_type})

    def send_message(self, chat_id: str, text: str) -> Dict[str, Any]:
        payload = {"chat_id": str(chat_id), "text": text}
        return self.call_method("sendMessage", payload)
