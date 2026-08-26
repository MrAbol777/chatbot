-- Align the public Text-to-Video controls with the current product contract.
-- The Image-to-Video registration and route are intentionally untouched.

UPDATE app_video_models
SET description_fa='مدل ثابت ساخت ویدیو از متن با خروجی ۴۸۰p و مدت ۱ تا ۱۵ ثانیه.',
    allowed_durations=JSON_ARRAY(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15),
    allowed_resolutions=JSON_ARRAY('480p'),
    updated_at=NOW()
WHERE internal_key='bananaai_grok_imagine_video_t2v'
  AND provider='bananaai'
  AND provider_model_id='grok-imagine-video';
