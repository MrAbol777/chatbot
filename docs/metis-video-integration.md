# Metis video integration

The local registry contains the panel-confirmed Text-to-Video contract for the inactive `metis_kling_v25_turbo_pro` model: provider vendor `kwaivgi`, model `kling-v2.5-turbo-pro`, operation `Video Generation`, durations `5`/`10`, and aspect ratios `16:9`/`9:16`/`1:1`. It deliberately remains unavailable to public options and Image-to-Video remains disabled.

The Metis adapter is therefore isolated behind a provider contract and is blocked by the database model registry: no active model is seeded. An administrator must verify the official Metis documentation/account panel and register the exact provider model ID and its capability allowlists before users can submit work.

Authentication is backend-only Bearer authentication using `METIS_API_KEY` (the legacy `METIS_VIDEO_API_KEY` is only a runtime fallback); it is never sent to the browser. The adapter expects asynchronous create/status behavior and sanitizes provider errors before they reach clients. `COMPLETED` transitions only to controlled `storing`, never directly to success.

The panel value **“150000” is an amount with an unknown unit**. It is not provider cost, quota, plan, or payment data and must not be used as any of those.
