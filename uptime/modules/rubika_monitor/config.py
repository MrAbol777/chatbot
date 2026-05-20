import os


class Config:
    def __init__(self) -> None:
        self.rubika_bot_token = os.getenv("RUBIKA_BOT_TOKEN", "").strip()
        self.monitor_timeout_seconds = int(os.getenv("MONITOR_TIMEOUT_SECONDS", "15"))
        self.database_path = os.getenv(
            "RUBIKA_MONITOR_DB_PATH", "modules/rubika_monitor/rubika_monitor.db"
        )
        self.request_retries = int(os.getenv("RUBIKA_REQUEST_RETRIES", "2"))
        self.request_retry_delay_seconds = float(
            os.getenv("RUBIKA_REQUEST_RETRY_DELAY_SECONDS", "0.5")
        )

    def validate(self) -> None:
        if not self.rubika_bot_token:
            raise ValueError("RUBIKA_BOT_TOKEN is required.")
        if self.monitor_timeout_seconds <= 0:
            raise ValueError("MONITOR_TIMEOUT_SECONDS must be greater than 0.")
        if self.request_retries < 1:
            raise ValueError("RUBIKA_REQUEST_RETRIES must be >= 1.")
