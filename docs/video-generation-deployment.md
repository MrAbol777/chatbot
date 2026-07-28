# Video generation deployment

The production deployment for this repository uses BananaAI only for the
`video.image_to_video` capability. The database route is pinned to provider
`bananaai`, internal model `bananaai_grok_imagine_video`, provider model
`grok-imagine-video`, policy `PRIMARY_ONLY`, and no fallback.

For the exact `danoa.ir` VPS procedure, file inventory, TLS setup, migration,
activation, readiness checks, one-request live test, and rollback, see
[`danoa-vps-video-deployment.md`](./danoa-vps-video-deployment.md).

The emergency kill switch is `VIDEO_GENERATION_ENABLED=0`. After changing it,
recreate the app container so the new environment is loaded:

```bash
docker compose up -d --force-recreate app
```

Do not drop the additive video tables during rollback. Preserve the database,
`video-inputs`, and `video-results` volumes.
