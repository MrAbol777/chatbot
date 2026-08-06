# Multi-Image Video Generation — Deployment & Activation

## Overview

This feature adds multi-image (2–7 reference images) video generation via OpenRouter (x-ai/grok-imagine-video). The existing single-image BananaAI flow is unchanged.

## Environment Variables

### OpenRouter Provider (required for multi-image)

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | (none) | OpenRouter API key. Provider not registered unless set. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai` | Base URL for OpenRouter API |
| `OPENROUTER_REQUEST_TIMEOUT_MS` | `120000` | Submit request timeout (ms) |
| `OPENROUTER_STATUS_TIMEOUT_MS` | `30000` | Polling request timeout (ms) |
| `OPENROUTER_VIDEO_RESULT_ALLOWED_HOSTS` | (none) | Comma-separated result host allowlist |
| `OPENROUTER_VIDEO_RESULT_ALLOWED_PATH_PREFIXES` | (none) | Comma-separated result path prefix allowlist |

### Submit Retry Configuration

| Variable | Default | Max | Description |
|---|---|---|
| `VIDEO_SUBMIT_RETRY_MAX` | `3` | `10` | Max confirmed retries before terminal failure |
| `VIDEO_SUBMIT_RETRY_BASE_DELAY_MS` | `5000` | — | Base delay for exponential backoff |
| `VIDEO_SUBMIT_RETRY_MAX_DELAY_MS` | `60000` | — | Maximum delay for retry backoff |

### Activation Guard

| Variable | Default | Description |
|---|---|---|
| `VIDEO_MULTI_IMAGE_ACTIVATION_EXPECTED` | `0` | Set to `1` when multi-image should be active |

---

## Safe Activation Order

1. **Deploy code** — push all backend + frontend changes
2. **Apply migrations** — run `node backend/scripts/apply-video-generation-migration.js`
3. **Set OpenRouter environment:**
   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   OPENROUTER_BASE_URL=https://openrouter.ai
   OPENROUTER_VIDEO_RESULT_ALLOWED_HOSTS=cdn.openrouter.ai
   OPENROUTER_VIDEO_RESULT_ALLOWED_PATH_PREFIXES=/api/v1/videos/
   VIDEO_PROVIDER_INPUT_SIGNING_SECRET=<your-secret>
   VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL=https://your-domain.com
   ```
4. **Configure pricing** — set `unit_price` for `video_multi_image_generation` via admin panel
5. **Activate pricing:**
   ```sql
   UPDATE app_noa_pricing_configs SET is_active=1 WHERE action_key='video_multi_image_generation';
   ```
6. **Activate model:**
   ```sql
   UPDATE app_video_models SET is_active=1 WHERE internal_key='openrouter_grok_imagine_video';
   ```
7. **Activate provider:**
   ```sql
   UPDATE app_ai_providers SET enabled=1 WHERE provider_key='openrouter';
   ```
8. **Activate route:**
   ```sql
   UPDATE app_ai_capability_routes SET enabled=1 WHERE capability_key='video.image_to_video_multi';
   ```
9. **Set activation expected:**
   ```
   VIDEO_MULTI_IMAGE_ACTIVATION_EXPECTED=1
   ```
10. **Run readiness checker:**
    ```
    node backend/scripts/check-video-multi-image-readiness.js
    ```
11. **Restart API and Worker**
12. **Perform staging smoke test** with 2 reference images

---

## Rollback

To disable multi-image while preserving data:

1. Disable route:
   ```sql
   UPDATE app_ai_capability_routes SET enabled=0 WHERE capability_key='video.image_to_video_multi';
   ```
2. Disable pricing:
   ```sql
   UPDATE app_noa_pricing_configs SET is_active=0 WHERE action_key='video_multi_image_generation';
   ```
3. Disable model:
   ```sql
   UPDATE app_video_models SET is_active=0 WHERE internal_key='openrouter_grok_imagine_video';
   ```
4. Disable provider:
   ```sql
   UPDATE app_ai_providers SET enabled=0 WHERE provider_key='openrouter';
   ```
5. Set `VIDEO_MULTI_IMAGE_ACTIVATION_EXPECTED=0`
6. Restart services

Do NOT drop tables or restore old unique indexes on production.
