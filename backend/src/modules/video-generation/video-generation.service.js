const { createHash, randomUUID } = require('crypto');
const { fail } = require('./video-generation.errors');
const { validateSubmit } = require('./video-generation.schemas');
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function modelDto(model) { return { internalKey:model.internal_key, displayNameFa:model.display_name_fa, displayName:model.display_name || null, descriptionFa:model.description_fa, supportsTextToVideo:Boolean(model.supports_text_to_video), supportsImageToVideo:Boolean(model.supports_image_to_video), supportsNegativePrompt:Boolean(model.supports_negative_prompt), allowedAspectRatios:JSON.parse(model.allowed_aspect_ratios || '[]'), allowedDurations:JSON.parse(model.allowed_durations || '[]').map(String), allowedQualities:JSON.parse(model.allowed_qualities || '[]'), maxPromptLength:model.max_prompt_length == null ? null : Number(model.max_prompt_length), quotaUnits:Number(model.quota_units) }; }
function jobDto(job) { if (!job) return null; const succeeded = job.status === 'succeeded' && job.result_storage_key; return { ...job, result: succeeded ? { contentUrl: `/api/video-generations/${encodeURIComponent(job.id)}/content`, downloadUrl: `/api/video-generations/${encodeURIComponent(job.id)}/content?download=1`, mimeType: job.result_mime_type, sizeBytes: Number(job.result_size_bytes), storedAt: job.result_stored_at } : null }; }
function createVideoGenerationService({ repository, quotaService, provider, canUseInactiveModel = () => false, isFeatureEnabled = () => true }) {
  return {
    options: async () => ({ enabled: Boolean(isFeatureEnabled()), models: Boolean(isFeatureEnabled()) ? (await repository.listModels()).map(modelDto) : [] }),
    list: async (userId) => (await repository.listForUser(userId)).map(jobDto),
    get: async (id,userId) => jobDto(await repository.getForUser(id,userId)),
    getForAdmin: async (id) => jobDto(await repository.getById(id)),
    submit: async ({ userId, idempotencyKey, input }) => {
      if (!isFeatureEnabled()) throw fail('VIDEO_GENERATION_DISABLED', 'ساخت ویدیو در حال حاضر فعال نیست.', 503);
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 191) throw fail('VIDEO_GENERATION_IDEMPOTENCY_REQUIRED','کلید یکتای درخواست لازم است.');
      const data=validateSubmit(input); const payloadHash=hash(JSON.stringify(data)); const keyHash=hash(idempotencyKey); const prior=await repository.findIdempotent(userId,keyHash);
      if (prior) { if (prior.payload_hash !== payloadHash) throw fail('VIDEO_GENERATION_IDEMPOTENCY_CONFLICT','کلید درخواست با محتوای دیگری استفاده شده است.',409); return prior; }
      const model=await repository.getModel(data.modelKey); if (!model || (!model.is_active && !canUseInactiveModel({ userId, model, input: data }))) throw fail('VIDEO_GENERATION_MODEL_UNAVAILABLE','مدل انتخاب‌شده فعال نیست.',409);
      const allow=(json,value)=>JSON.parse(json || '[]').map(String).includes(String(value)); const qualities=JSON.parse(model.allowed_qualities || '[]'); const promptLimit=model.max_prompt_length == null ? null : Number(model.max_prompt_length); if ((data.mode==='text-to-video'&&!model.supports_text_to_video)||(data.mode==='image-to-video'&&!model.supports_image_to_video)||!allow(model.allowed_aspect_ratios,data.aspectRatio)||!allow(model.allowed_durations,data.duration)||(qualities.length ? !allow(model.allowed_qualities,data.quality) : Boolean(data.quality))||(promptLimit !== null && data.prompt.length>promptLimit)) throw fail('VIDEO_GENERATION_OPTIONS_NOT_ALLOWED','تنظیمات انتخاب‌شده برای مدل مجاز نیست.');
      if (data.mode === 'text-to-video' && data.mediaId) throw fail('VIDEO_GENERATION_IMAGE_INPUT_DISABLED','ورودی تصویر برای این مرحله غیرفعال است.',409);
      if (data.mode==='image-to-video') throw fail('VIDEO_GENERATION_IMAGE_INPUT_NOT_CONFIGURED','اعتبارسنجی مالکیت تصویر برای ساخت ویدیو هنوز فعال نشده است.', 409);
      const id=randomUUID(), now=new Date(); const job={id,userId,...data,provider:model.provider,providerModelId:model.provider_model_id,upstreamVendor:model.upstream_vendor,providerOperation:model.upstream_operation,status:'queued',quotaUnits:Number(model.quota_units),reservationId:null,idempotencyHash:keyHash,payloadHash,expiresAt:new Date(Date.now()+Number(process.env.VIDEO_JOB_TIMEOUT_MINUTES||30)*60000),nextPollAt:now,now}; await repository.create(job);
      let reservationId;
      try { reservationId=await quotaService.reserve({userId,units:Number(model.quota_units),generationId:id}); await repository.attachReservation?.(id,reservationId); job.reservationId=reservationId; }
      catch (error) { await repository.markSubmitFailed?.(id, error.code || 'VIDEO_QUOTA_RESERVATION_FAILED', 'سهمیه ساخت ویدیو قابل رزرو نیست.'); throw error; }
      try { const submitted=data.mode==='image-to-video'?await provider.submitImageToVideo({ ...job,inputMediaReference:data.mediaId }):await provider.submitTextToVideo(job); await repository.updateSubmission(id,submitted.providerJobId); return { ...job,status:'submitted',provider_job_id:submitted.providerJobId }; } catch(error) { const code=error.code || 'VIDEO_PROVIDER_SUBMIT_FAILED'; const message=provider.sanitizeError(error); await repository.markSubmitFailed?.(id,code,message); await quotaService.release?.({reservationId,reason:'provider_submit_failed'}); throw fail(code,message,502); }
    }
  };
}
module.exports = { createVideoGenerationService, jobDto };
