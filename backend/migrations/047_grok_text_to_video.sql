-- Add a capability-specific Grok registration for Text-to-Video. The existing
-- Image-to-Video model and route are intentionally not changed by this migration.

INSERT INTO app_video_models
  (internal_key,provider,upstream_vendor,provider_model_id,upstream_operation,display_name_fa,display_name,description_fa,is_active,is_public,
   supports_text_to_video,supports_image_to_video,upstream_supports_image_to_video,upstream_supports_start_image,supports_negative_prompt,
   supports_audio,supports_first_frame,supports_last_frame,supports_idempotency,supports_webhook,
   allowed_aspect_ratios,allowed_durations,allowed_qualities,allowed_resolutions,capability_config,max_prompt_length,max_input_image_bytes,
   cost_config,provider_config,quota_units,sort_order,created_at,updated_at)
VALUES
  ('bananaai_grok_imagine_video_t2v','bananaai',NULL,'grok-imagine-video',NULL,
   'گراک ایمجین ویدیو — متن به ویدیو','Grok Imagine Video — Text to Video','مدل ثابت ساخت ویدیو از متن با خروجی ۴۸۰p و مدت ۱ تا ۱۵ ثانیه.',1,0,
   1,0,1,1,0,0,0,0,0,0,
   JSON_ARRAY('16:9','9:16','1:1'),JSON_ARRAY(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),JSON_ARRAY(),JSON_ARRAY('480p'),
   JSON_OBJECT('contractSource','bananaai_official_docs','readiness','ACTIVATION_REQUIRED','productRole','text_to_video_primary'),
   8000,NULL,JSON_OBJECT('estimate',NULL,'status','NOT_DOCUMENTED'),
   JSON_OBJECT('requestContract','OFFICIAL_DOCS_VERIFIED','resultContract','LIVE_VALIDATION_REQUIRED'),1,1099,NOW(),NOW())
ON DUPLICATE KEY UPDATE
  provider=VALUES(provider),provider_model_id=VALUES(provider_model_id),display_name_fa=VALUES(display_name_fa),display_name=VALUES(display_name),
  description_fa=VALUES(description_fa),is_active=VALUES(is_active),is_public=VALUES(is_public),supports_text_to_video=VALUES(supports_text_to_video),
  supports_image_to_video=VALUES(supports_image_to_video),supports_negative_prompt=VALUES(supports_negative_prompt),supports_audio=VALUES(supports_audio),
  allowed_aspect_ratios=VALUES(allowed_aspect_ratios),allowed_durations=VALUES(allowed_durations),allowed_qualities=VALUES(allowed_qualities),
  allowed_resolutions=VALUES(allowed_resolutions),capability_config=VALUES(capability_config),max_prompt_length=VALUES(max_prompt_length),
  cost_config=VALUES(cost_config),provider_config=VALUES(provider_config),quota_units=VALUES(quota_units),sort_order=VALUES(sort_order),updated_at=NOW();

UPDATE app_ai_capability_routes
SET primary_provider_key='bananaai',
    primary_model_key='bananaai_grok_imagine_video_t2v',
    fallback_provider_key=NULL,
    fallback_model_key=NULL,
    routing_policy='PRIMARY_ONLY',
    config_json=JSON_OBJECT(
      'modelPolicy','PINNED',
      'providerModelId','grok-imagine-video',
      'requestContract','OFFICIAL_DOCS_VERIFIED',
      'activation','ADMIN_REQUIRED'
    ),
    version=version+1,
    updated_at=NOW()
WHERE capability_key='video.text_to_video'
  AND (
    (primary_provider_key='metis' AND primary_model_key='metis_kling_v25_turbo_pro')
    OR (primary_provider_key='bananaai' AND primary_model_key='bananaai_grok_imagine_video_t2v')
  )
  AND NOT (
    primary_provider_key='bananaai'
    AND primary_model_key='bananaai_grok_imagine_video_t2v'
    AND fallback_provider_key IS NULL
    AND fallback_model_key IS NULL
    AND routing_policy='PRIMARY_ONLY'
  );
