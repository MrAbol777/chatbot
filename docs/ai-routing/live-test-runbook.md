# BananaAI Live Test Runbook

The repository contains the opt-in `backend/scripts/test-bananaai-video-live.js` script only. It was not executed by tests, readiness, startup or this implementation.

Required exact gates are:

- `BANANAAI_LIVE_CONFIRM_PROVIDER=I_CONFIRM_BANANAAI_GROK_LIVE_REQUEST`
- `BANANAAI_LIVE_CONFIRM_COST=I_CONFIRM_BANANAAI_GROK_COST`
- `BANANAAI_API_KEY`
- `BANANAAI_LIVE_MODEL=grok-imagine-video`
- explicit `BANANAAI_LIVE_PROMPT`, `BANANAAI_LIVE_DURATION`, `BANANAAI_LIVE_RESOLUTION` and `BANANAAI_LIVE_ASPECT_RATIO`

There is no default tuple. The script makes at most one Grok submit request and performs no poll, balance, result or health request. Missing any condition exits before HTTP. Automated tests execute only the pure precondition function with a fake key.

Implementation execution counters remain: BananaAI 0, Metis video 0, other providers 0, live executions 0.
