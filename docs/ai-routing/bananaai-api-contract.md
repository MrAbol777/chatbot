# BananaAI Video API Contract

Source access date: 2026-07-23. Only public official BananaAI documentation was used. No Provider API request was made.

## Common

| Item | Value | Status |
|---|---|---|
| Base URL | `https://bananaai.ir` | CONFIRMED |
| API prefix | `/api/v1` | CONFIRMED |
| Authentication | `Authorization: Bearer <API_KEY>` | CONFIRMED |
| Content type | `application/json` | CONFIRMED |
| Rate limit | 30 requests/minute/API key | CONFIRMED |
| Poll guidance | every 2–5 seconds | CONFIRMED |
| Provider task timeout | about 15 minutes | CONFIRMED |
| Idempotency header | `NOT_DOCUMENTED` | NOT_DOCUMENTED |
| Webhook | `NOT_DOCUMENTED` | NOT_DOCUMENTED |
| Cancel endpoint | `NOT_DOCUMENTED` | NOT_DOCUMENTED |
| Retry-after contract | `NOT_DOCUMENTED` | NOT_DOCUMENTED |

## Text to Video

- Method/endpoint: `POST /api/v1/videos/generations`
- Required: `prompt` string.
- Optional documented fields: `model`, `duration`, `resolution`, `aspect_ratio`, `generate_audio`, `web_search`.
- Official model identifiers appearing in the official request/model documentation: `grok-imagine-video`, `kling-v3-turbo`, `seedance-2`, `seedance-2-mini`, `gemini-omni-video`, `kling-3.0`.

Minimal official-shape fixture (values are documentation fixtures, not a live request):

```json
{
  "model": "seedance-2",
  "prompt": "A cinematic drone shot over a desert city at sunset",
  "duration": 5,
  "resolution": "720p",
  "aspect_ratio": "9:16",
  "generate_audio": false
}
```

Submit response shape:

```json
{
  "id": "task_abc123",
  "status": "pending",
  "model": "seedance-2",
  "credits_reserved": 250,
  "created_at": "2026-07-11T12:00:00.000Z"
}
```

## Image to Video

- Method/endpoint: `POST /api/v1/videos/image-to-video`.
- Required: `prompt` string.
- Input is URL-based. Documented fields include `image_urls`, `first_frame_url`, `last_frame_url`, `reference_image_urls`, `reference_video_urls`, `reference_audio_urls`, and `video_list`.
- Multipart upload, upload endpoint, File ID and Base64 are `NOT_DOCUMENTED`.
- Input maximum bytes and explicit MIME/format allowlist are `NOT_DOCUMENTED`.
- Danoa will use only its owned private media and a short-lived HMAC URL; clients cannot provide arbitrary URLs.

```json
{
  "model": "grok-imagine-video",
  "prompt": "Slow cinematic orbit around the product",
  "image_urls": ["https://example.com/product.jpg"],
  "duration": 8,
  "resolution": "720p",
  "aspect_ratio": "auto"
}
```

## Task status and result

- Method/endpoint: `GET /api/v1/tasks/:taskId`.
- Statuses: `pending`, `processing`, `completed`, `failed`.
- Successful video results are in `videos[]`.
- Result URL host/path allowlist and URL expiration are `NOT_DOCUMENTED`.
- `credits_reserved` and `credits_deducted` are returned. Actual internal cost is recorded only when completion says credit was deducted; otherwise it is null.

## Error schema

```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "safe provider message"
  }
}
```

Documented errors: `missing_authorization`, `invalid_api_key`, `revoked_api_key`, `insufficient_credits`, `rate_limit_exceeded`, `task_not_found`, `invalid_request`, `internal_error`.

HTTP 400/401/403/429 with a valid error envelope and no task ID is a confirmed rejection. HTTP 5xx, transport timeout/disconnect, malformed response, or 2xx without ID is ambiguous and must never auto-fallback.

## Capability gaps

Negative prompt, seed, commercial API-specific warranty, moderation error schema, result-host contract, input size/format contract, timeout for individual HTTP calls, idempotency, webhook and cancellation are `NOT_DOCUMENTED`. Terms state that lawful generated outputs may be used by the user, subject to third-party rights, and commercial publication remains the user's responsibility.

Official sources: [API](https://bananaai.ir/docs/api), [authentication](https://bananaai.ir/docs/api/authentication), [T2V](https://bananaai.ir/docs/api/videos/generations), [I2V](https://bananaai.ir/docs/api/videos/image-to-video), [tasks](https://bananaai.ir/docs/api/tasks), [pricing](https://bananaai.ir/docs/api/pricing), [errors](https://bananaai.ir/docs/api/errors), [terms](https://bananaai.ir/terms).
