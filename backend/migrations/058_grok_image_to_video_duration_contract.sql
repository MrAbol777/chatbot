-- BananaAI's live Image-to-Video endpoint rejects durations below six seconds.
-- Keep the model option list aligned with the provider so the UI and API
-- validate the request before it is submitted upstream.
UPDATE app_video_models
SET description_fa='مدل ثابت ساخت ویدیو از تصویر با مدت ۶ تا ۱۵ ثانیه و خروجی ۴۸۰p.',
    allowed_durations=JSON_ARRAY(6,7,8,9,10,11,12,13,14,15),
    capability_config=JSON_SET(
      COALESCE(capability_config, JSON_OBJECT()),
      '$.contractSource','bananaai_live_api_validation',
      '$.durationRange','6-15'
    ),
    updated_at=NOW()
WHERE internal_key='bananaai_grok_imagine_video'
  AND provider='bananaai'
  AND provider_model_id='grok-imagine-video';
