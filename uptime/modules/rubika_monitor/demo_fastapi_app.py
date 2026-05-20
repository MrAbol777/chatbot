from fastapi import FastAPI

from modules.rubika_monitor import RubikaMonitorService, register_routes

app = FastAPI()
monitor_service = RubikaMonitorService()
monitor_service.start()
register_routes(app, monitor_service)
