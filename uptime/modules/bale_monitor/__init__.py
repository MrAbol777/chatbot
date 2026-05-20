from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import logging

from .bale_client import BaleClient
from .config import BaleMonitorConfig, load_config
from .scheduler import MonitorScheduler
from .service import CommandService, MonitorService
from .storage import MonitorStorage
from .webhook import BaleWebhookHandler

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class BaleMonitorModule:
    config: BaleMonitorConfig
    storage: MonitorStorage
    scheduler: MonitorScheduler
    service: MonitorService
    command_service: CommandService
    webhook_handler: BaleWebhookHandler

    def shutdown(self) -> None:
        self.scheduler.shutdown()


def init_bale_monitor(app: Any, base_dir: str | Path | None = None) -> BaleMonitorModule:
    """Initialize Bale monitor module and register webhook route on app.

    Supported app types:
    - FastAPI/Starlette: app.post(path)(func) or add_api_route
    - Flask: app.add_url_rule(path, view_func=..., methods=['POST'])
    """
    config = load_config(base_dir=base_dir)

    storage = MonitorStorage(config.db_path)
    bale_client = BaleClient(
        token=config.token,
        timeout_seconds=config.bale_timeout_seconds,
        retry_attempts=config.bale_retry_attempts,
    )
    monitor_service = MonitorService(
        storage=storage,
        bale_client=bale_client,
        timeout_seconds=config.http_timeout_seconds,
    )
    scheduler = MonitorScheduler(storage=storage, service=monitor_service, timezone=str(config.timezone))
    command_service = CommandService(storage=storage, scheduler=scheduler)
    webhook_handler = BaleWebhookHandler(command_service=command_service, bale_client=bale_client)

    scheduler.start()
    _register_webhook_route(app, config.webhook_path, webhook_handler)

    logger.info("Bale monitor initialized on route %s", config.webhook_path)
    return BaleMonitorModule(
        config=config,
        storage=storage,
        scheduler=scheduler,
        service=monitor_service,
        command_service=command_service,
        webhook_handler=webhook_handler,
    )


def _register_webhook_route(app: Any, path: str, handler: BaleWebhookHandler) -> None:
    async def async_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
        return handler.handle_update(payload)

    def sync_endpoint():
        from flask import jsonify, request

        payload = request.get_json(silent=True) or {}
        return jsonify(handler.handle_update(payload))

    if hasattr(app, "add_api_route"):
        app.add_api_route(path, async_endpoint, methods=["POST"])
        return

    if hasattr(app, "post"):
        app.post(path)(async_endpoint)
        return

    if hasattr(app, "add_url_rule"):
        app.add_url_rule(path, view_func=sync_endpoint, methods=["POST"])
        return

    raise TypeError("Unsupported app type for webhook registration")
