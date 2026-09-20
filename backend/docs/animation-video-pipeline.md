# Animation video pipeline contract

`animation_video_jobs.payload` is an immutable approved snapshot. It contains the AnimationProject ID, Scenario/Character Sheet/Storyboard IDs and versions, duration, aspect ratio, visual style, audio settings, and the approved source objects needed by the worker.

The animation worker reads only this snapshot. It never regenerates Scenario, Character Sheet, or Storyboard. For every approved storyboard scene it creates one `animation_video_scenes` record and one normal `app_video_generations` image-to-video job. The existing video worker owns provider submission, polling, reservations, and result storage.

Scene states are `queued`, `processing`, `completed`, `failed`, and `retrying`. A retry changes only a failed scene and derives an idempotency key from animation job, source scene ID, and retry count. When all scene assets are truly stored, the existing FFmpeg montage service joins their generation IDs in `scene_order`. Only then is the parent job and AnimationProject marked `completed` and a final content URL exposed.

If a source frame, provider, worker, or FFmpeg is unavailable, the affected scene/job is marked failed with a safe error. No mock asset or completed status is produced.
