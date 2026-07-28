-- The schema prerequisites are applied idempotently by
-- scripts/apply-video-generation-migration.js before this seed runs.
-- This seed is deliberately inactive: it must not expose the model publicly.
INSERT INTO app_video_models (
  internal_key, provider, upstream_vendor, provider_model_id, display_name_fa,
  display_name, description_fa, is_active, supports_text_to_video,
  supports_image_to_video, upstream_supports_image_to_video,
  upstream_supports_start_image, supports_negative_prompt,
  allowed_aspect_ratios, allowed_durations, allowed_qualities,
  max_prompt_length, max_input_image_bytes, sort_order,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  provider=VALUES(provider),
  upstream_vendor=VALUES(upstream_vendor),
  provider_model_id=VALUES(provider_model_id),
  display_name_fa=VALUES(display_name_fa),
  display_name=VALUES(display_name),
  description_fa=VALUES(description_fa),
  is_active=VALUES(is_active),
  supports_text_to_video=VALUES(supports_text_to_video),
  supports_image_to_video=VALUES(supports_image_to_video),
  upstream_supports_image_to_video=VALUES(upstream_supports_image_to_video),
  upstream_supports_start_image=VALUES(upstream_supports_start_image),
  supports_negative_prompt=VALUES(supports_negative_prompt),
  allowed_aspect_ratios=VALUES(allowed_aspect_ratios),
  allowed_durations=VALUES(allowed_durations),
  allowed_qualities=VALUES(allowed_qualities),
  max_prompt_length=VALUES(max_prompt_length),
  max_input_image_bytes=VALUES(max_input_image_bytes),
  sort_order=VALUES(sort_order),
  updated_at=NOW();
