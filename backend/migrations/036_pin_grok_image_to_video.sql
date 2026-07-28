-- Pin the product Image-to-Video route to BananaAI Grok while keeping external
-- activation explicitly Admin-gated until credentials, input gateway and the
-- result-host allowlist have been configured.

UPDATE app_video_models
SET display_name_fa='گراک ایمجین ویدیو',
    display_name='Grok Imagine Video',
    description_fa='مدل ثابت ساخت ویدیو از تصویر برای هر دو سبک سینمایی و انیمیشنی.',
    is_active=1,
    is_public=0,
    supports_text_to_video=1,
    supports_image_to_video=1,
    supports_negative_prompt=0,
    supports_audio=0,
    allowed_aspect_ratios=JSON_ARRAY('16:9','9:16','1:1'),
    allowed_durations=JSON_ARRAY(3,5,8,10),
    allowed_qualities=JSON_ARRAY(),
    allowed_resolutions=JSON_ARRAY('720p'),
    max_prompt_length=2000,
    capability_config=JSON_OBJECT(
      'contractSource','bananaai_official_docs',
      'readiness','ACTIVATION_REQUIRED',
      'productRole','image_to_video_primary'
    ),
    provider_config=JSON_OBJECT(
      'requestContract','OFFICIAL_DOCS_VERIFIED',
      'resultContract','LIVE_VALIDATION_REQUIRED'
    ),
    updated_at=NOW()
WHERE internal_key='bananaai_grok_imagine_video'
  AND provider='bananaai'
  AND provider_model_id='grok-imagine-video';

UPDATE app_ai_capability_routes
SET primary_provider_key='bananaai',
    primary_model_key='bananaai_grok_imagine_video',
    fallback_provider_key=NULL,
    fallback_model_key=NULL,
    routing_policy='PRIMARY_ONLY',
    config_json=JSON_OBJECT(
      'modelPolicy','PINNED',
      'providerModelId','grok-imagine-video',
      'requestContract','OFFICIAL_DOCS_VERIFIED',
      'activation','ADMIN_REQUIRED'
    ),
    updated_at=NOW()
WHERE capability_key='video.image_to_video'
  AND enabled=0
  AND version=1
  AND (
    (primary_provider_key IS NULL AND primary_model_key IS NULL)
    OR (primary_provider_key='bananaai' AND primary_model_key='bananaai_grok_imagine_video')
  );

UPDATE app_ai_providers
SET config_json=JSON_OBJECT(
      'adapter','bananaai',
      'requestContract','OFFICIAL_DOCS_VERIFIED',
      'resultContract','LIVE_VALIDATION_REQUIRED',
      'readiness','ACTIVATION_REQUIRED'
    ),
    updated_at=NOW()
WHERE provider_key='bananaai'
  AND enabled=0
  AND version=1;
