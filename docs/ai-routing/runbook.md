# AI Routing Runbook

1. Keep `VIDEO_GENERATION_ENABLED=0`, BananaAI disabled and the worker stopped during migration/readiness checks.
2. Apply additive video migrations locally with the existing runner.
3. Run readiness; it performs no HTTP request.
4. Resolve only local configuration/schema/storage warnings.
5. Never enable BananaAI I2V until public input base URL and exact result-host/result-path allowlists are reviewed.
6. For `provider_status_unknown`, do not retry or fallback. Use the audited Admin recovery action only with external evidence.
7. For an emergency, disable the route/provider and stop the worker gracefully. Accepted jobs retain their snapshot.

## Required configuration for I2V readiness

- `BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS` must contain a reviewed exact host contract; it intentionally defaults empty.
- `BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES` must contain reviewed exact path prefixes; it intentionally defaults empty and never inherits the Metis path contract.
- `VIDEO_PROVIDER_INPUT_SIGNING_SECRET` must contain at least 32 random characters.
- `VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL` must be an HTTPS public origin.
- `VIDEO_PROVIDER_INPUT_TTL_SECONDS` must be between 30 and 900.
- Enabling BananaAI through Admin is rejected until its key presence and result allowlist are configured.

Readiness is local-only and never performs Provider HTTP, balance, health, submit, poll or result requests.
