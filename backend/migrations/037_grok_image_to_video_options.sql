-- Temporarily restrict the private Grok Image-to-Video product to 480p.
-- The upstream adapter still supports 720p, but it must not be advertised or
-- accepted through the product route until it is explicitly re-enabled.
UPDATE app_video_models
SET allowed_durations=JSON_ARRAY(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),
    allowed_resolutions=JSON_ARRAY('480p'),
    capability_config=JSON_SET(
      COALESCE(capability_config, JSON_OBJECT()),
      '$.contractSource','bananaai_official_docs',
      '$.durationRange','1-15',
      '$.resolutions',JSON_ARRAY('480p')
    ),
    updated_at=NOW()
WHERE internal_key='bananaai_grok_imagine_video'
  AND provider='bananaai'
  AND provider_model_id='grok-imagine-video';
