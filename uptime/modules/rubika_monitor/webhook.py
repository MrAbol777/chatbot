from __future__ import annotations

from typing import Any

from .service import RubikaMonitorService


def register_fastapi_routes(app: Any, service: RubikaMonitorService) -> None:
    @app.post("/rubika/webhook")
    async def rubika_webhook(payload: dict) -> dict[str, Any]:
        result = service.handle_update(payload)
        return {"ok": result.ok, "message": result.message}


def register_flask_routes(app: Any, service: RubikaMonitorService) -> None:
    from flask import jsonify, request

    @app.route("/rubika/webhook", methods=["POST"])
    def rubika_webhook():
        payload = request.get_json(silent=True) or {}
        result = service.handle_update(payload)
        return jsonify({"ok": result.ok, "message": result.message}), 200


def register_routes(app: Any, service: RubikaMonitorService) -> None:
    app_module = app.__class__.__module__.lower()
    if "fastapi" in app_module or "starlette" in app_module:
        register_fastapi_routes(app, service)
        return
    if "flask" in app_module:
        register_flask_routes(app, service)
        return
    raise RuntimeError(
        "Unsupported app type for auto route registration. "
        "Use register_fastapi_routes or register_flask_routes explicitly."
    )
