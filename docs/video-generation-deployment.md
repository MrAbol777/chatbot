# Video Generation deployment runbook

This runbook deploys no secret in Git and starts with video generation disabled.
The emergency kill switch is `VIDEO_GENERATION_ENABLED=0`; restart the API to
apply it. It does not need a migration or data deletion.

1. Take and verify a database backup, including `app_video_*` tables and `app_plans`.
2. Pull or copy the reviewed release; do not copy a local `.env` or signed URL.
3. In `backend`, run `npm ci` (or the project-approved locked install command).
4. Copy `backend/.env.video-generation.example` to the host-managed environment file and fill secrets only there.
5. Run `npm run db:migrate-video-generation`; it is additive through migration 031.
6. Create `VIDEO_STORAGE_ROOT` and `VIDEO_STORAGE_TEMP_ROOT`, owned by the service account and not web-public.
7. Confirm that both directories are writable and that the temp directory is on the same filesystem as the storage root.
8. Set the exact Metis result allowlist in the environment and keep redirects at zero.
9. Run `npm run check:video-generation-readiness`. It checks only local DB/filesystem/config and sends no Metis request.
10. Start API and the dedicated worker separately with `pm2 start ecosystem.config.cjs`; then run `pm2 save`.
11. Check API and worker logs for safe error codes only; no provider URL, authorization header, or raw response should appear.
12. Keep `VIDEO_GENERATION_ENABLED=0` until operational approval.
13. To enable the registry entry, run `ALLOW_VIDEO_MODEL_ACTIVATION=1 npm run admin:enable-video-model`. This does not enable I2V or change plans.
14. Configure exactly one already-approved plan using `ALLOW_VIDEO_QUOTA_CONFIGURATION=1 npm run admin:set-video-quota -- --plan=<plan-id> --daily=<limit>`. Choose the limit outside this runbook; no plan is changed automatically.
15. Set `VIDEO_GENERATION_ENABLED=1`, restart API, and test with an approved test subscriber using the lowest-cost valid setting.
16. Monitor worker leases, queue/storing/failed counts, storage space, and private content/range playback.

## Rollback

Set `VIDEO_GENERATION_ENABLED=0`, restart `danoa-api`, and stop
`danoa-video-worker` after its graceful shutdown window. Existing stored files
and jobs remain intact. Roll back application code only after confirming the
additive migration remains compatible; do not drop Video Generation columns or
tables as a rollback action. Restore the verified database backup only for a
separate database incident.

## Controlled failed-job recovery

`npm run recover:metis-video-result` is disabled by default. It requires
`RUN_METIS_RESULT_RECOVERY=1`, a single `METIS_RECOVERY_JOB_ID`, and a signed
result URL supplied only through `METIS_RECOVERY_RESULT_URL`. It never submits
or polls. A real invocation may make one direct download; do not run it without
approval. The script does not log the URL and is idempotent after success.
