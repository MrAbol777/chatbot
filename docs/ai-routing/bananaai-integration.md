# BananaAI Integration

BananaAI is a disabled, backend-only provider. It supports the documented asynchronous T2V/I2V request and task status shapes through an injected HTTP client. The browser never receives its endpoint, API key, authorization header, task ID or result URL.

I2V sends one Danoa-owned short-lived HMAC URL in `image_urls`. Arbitrary client URLs, Base64, Multipart and File IDs are rejected. Output download remains blocked until explicit BananaAI result-host and result-path-prefix allowlists are configured because the official docs do not identify the final result URL contract.

Submit errors are divided into confirmed rejection and ambiguous delivery. Only confirmed rejection before an ID may use a configured fallback. No live request was used to build or validate this integration.
