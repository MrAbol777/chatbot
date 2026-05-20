import argparse
import json

from modules.rubika_monitor import Config
from modules.rubika_monitor.rubika_client import RubikaClient


def main() -> None:
    parser = argparse.ArgumentParser(description="Rubika Bot API debug helper")
    parser.add_argument("--set-webhook", help="Set webhook URL for ReceiveUpdate")
    args = parser.parse_args()

    config = Config()
    config.validate()
    client = RubikaClient(
        token=config.rubika_bot_token,
        timeout_seconds=config.monitor_timeout_seconds,
        retries=config.request_retries,
        retry_delay_seconds=config.request_retry_delay_seconds,
    )

    me = client.get_me()
    print("getMe:")
    print(json.dumps(me, ensure_ascii=False, indent=2))

    if args.set_webhook:
        result = client.update_bot_endpoint(args.set_webhook, endpoint_type="ReceiveUpdate")
        print("\nupdateBotEndpoints:")
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
