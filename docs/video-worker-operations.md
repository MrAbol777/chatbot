# Video Worker Operations

The video worker is disabled by default. It has no import-time side effect and it never makes a provider request during startup.

## Modes

- `disabled`: no worker is built or scheduled (the default).
- `embedded`: start the API and worker together with `VIDEO_WORKER_ENABLED=true`.
- `dedicated`: run `npm run video-worker`; the HTTP server is not started.

Use one dedicated worker process in production where possible. Multiple worker processes are safe because MariaDB leases and transactional finalization prevent duplicate settlement, but a dedicated process makes operations easier to reason about.

## Lifecycle

Database initialization completes before the provider registry, runtime, and scheduler are created. The scheduler uses a chained `setTimeout`: it waits for a tick to finish before scheduling the next one. `SIGINT` and `SIGTERM` clear the timer, stop new ticks, wait up to `VIDEO_WORKER_SHUTDOWN_TIMEOUT_MS`, then close the database. An interrupted lease expires and is recovered by another runtime.

## Local usage

Keep `VIDEO_WORKER_ENABLED=false` for normal local API work. For a test-only embedded worker set `NODE_ENV=test`, `VIDEO_WORKER_ENABLED=true`, and `VIDEO_WORKER_PROCESS_MODE=embedded`; the worker registry resolves Fake Provider only in this test environment. For the dedicated equivalent use `VIDEO_WORKER_PROCESS_MODE=dedicated` and `npm run video-worker`.

Important environment variables: `VIDEO_WORKER_ENABLED`, `VIDEO_WORKER_PROCESS_MODE`, `VIDEO_WORKER_RUN_IMMEDIATELY`, `VIDEO_WORKER_INTERVAL_MS`, `VIDEO_WORKER_BATCH_SIZE`, `VIDEO_WORKER_LEASE_MS`, `VIDEO_JOB_TIMEOUT_MINUTES`, `VIDEO_MAX_POLL_ATTEMPTS`, `VIDEO_POLL_BASE_DELAY_MS`, `VIDEO_POLL_MAX_DELAY_MS`, and `VIDEO_WORKER_SHUTDOWN_TIMEOUT_MS`.

`/api/health` exposes only enabled/mode/state for the worker. It does not expose secrets, prompts, jobs, or provider IDs. No live Metis test was performed in this module.

Run the worker tests with `npm run test:video-generation-runtime`, `npm run test:video-generation-startup`, and `npm run test:video-generation-runtime-db`.
