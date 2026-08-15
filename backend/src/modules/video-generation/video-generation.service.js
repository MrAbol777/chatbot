const { createHash, randomUUID } = require('crypto');
const { fail } = require('./video-generation.errors');
const { validateSubmit } = require('./video-generation.schemas');
const { BANANAAI_IMAGE_TO_VIDEO_MODEL_ID } = require('./video-model.registry');
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function jsonArray(value) { if (Array.isArray(value)) return value; try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; } }
function modelDto(model) { return { internalKey:model.internal_key, displayNameFa:model.display_name_fa, displayName:model.display_name || null, descriptionFa:model.description_fa, supportsTextToVideo:Boolean(model.supports_text_to_video), supportsImageToVideo:Boolean(model.supports_image_to_video), supportsNegativePrompt:Boolean(model.supports_negative_prompt), supportsAudio:Boolean(model.supports_audio), allowedAspectRatios:jsonArray(model.allowed_aspect_ratios), allowedDurations:jsonArray(model.allowed_durations).map(String), allowedQualities:jsonArray(model.allowed_qualities), allowedResolutions:jsonArray(model.allowed_resolutions), maxPromptLength:model.max_prompt_length == null ? null : Number(model.max_prompt_length) }; }
function jobDto(job) {
  if (!job) return null;
  const succeeded = job.status === 'succeeded' && job.result_storage_key;
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    // `prompt` is the provider-ready compiled text for routed video jobs.
    // The user gallery must expose only the original request, never internal
    // system/profile instructions embedded in the compiled prompt.
    prompt: job.user_prompt || job.userPrompt || job.prompt,
    aspectRatio: job.aspect_ratio || job.aspectRatio,
    aspect_ratio: job.aspect_ratio || job.aspectRatio,
    duration: String(job.duration),
    quality: job.quality || '',
    resolution: job.resolution || null,
    generateAudio: Boolean(job.generate_audio ?? job.generateAudio),
    safeErrorCode: job.safe_error_code || null,
    safeErrorMessage: job.safe_error_message || null,
    createdAt: job.created_at || job.now,
    created_at: job.created_at || job.now,
    updatedAt: job.updated_at || job.now,
    updated_at: job.updated_at || job.now,
    completedAt: job.completed_at || null,
    completed_at: job.completed_at || null,
    result: succeeded ? { contentUrl: `/api/video-generations/${encodeURIComponent(job.id)}/content`, downloadUrl: `/api/video-generations/${encodeURIComponent(job.id)}/content?download=1`, mimeType: job.result_mime_type, sizeBytes: Number(job.result_size_bytes), storedAt: job.result_stored_at } : null
  };
}
function createVideoGenerationService({ repository, noaBillingService, provider, routeResolver = null, promptProfileRepository = null, promptCompiler = null, canUseInactiveModel = () => false, isFeatureEnabled = () => true }) {
  if (!noaBillingService || typeof noaBillingService.reserve !== 'function') {
    throw new Error('NOA_BILLING_SERVICE_REQUIRED');
  }
  const reservationInputFor = ({ userId, data, job, idempotencyKey, payloadHash }) => ({
    userId,
    actionKey: 'video_generation',
    quantity: String(data.duration),
    idempotencyKey: `video_generation:${idempotencyKey}`,
    payloadHash,
    referenceType: 'video_generation',
    referenceId: job.id,
    expiresAt: job.expiresAt,
    actorType: 'user',
    actorId: userId,
    metadata: {
      generationId: job.id,
      mode: data.mode,
      durationSeconds: String(data.duration)
    }
  });
  const validateModelOptions = (model, data, { routed = false } = {}) => {
    const allows = (json, value) => { const values = jsonArray(json).map(String); return !values.length || values.includes(String(value)); };
    const promptLimit = model.max_prompt_length == null ? null : Number(model.max_prompt_length);
    if ((data.mode==='text-to-video'&&!model.supports_text_to_video)||(data.mode==='image-to-video'&&!model.supports_image_to_video)||!allows(model.allowed_aspect_ratios,data.aspectRatio)||!allows(model.allowed_durations,data.duration)||(jsonArray(model.allowed_qualities).length ? !allows(model.allowed_qualities,data.quality) : Boolean(data.quality) && !routed)||(jsonArray(model.allowed_resolutions).length ? !allows(model.allowed_resolutions,data.resolution) : false)||(promptLimit !== null && data.prompt.length>promptLimit)||(data.negativePrompt && !model.supports_negative_prompt)||(data.generateAudio && !model.supports_audio)) {
      throw fail('VIDEO_GENERATION_OPTIONS_NOT_ALLOWED','تنظیمات انتخاب‌شده برای مدل مجاز نیست.');
    }
  };
  return {
    options: async () => {
      const pricing = await noaBillingService.quote({ actionKey: 'video_generation', quantity: '1' });
      if (!isFeatureEnabled()) return { enabled: false, models: [], pricing };
      if (!routeResolver) return { enabled: true, models: (await repository.listModels()).map(modelDto), pricing };
      const capabilities = {};
      for (const capability of ['video.text_to_video', 'video.image_to_video']) {
        try {
          const model = await routeResolver.publicModelFor(capability);
          if (model) {
            const dto = modelDto(model);
            capabilities[capability] = {
              allowedAspectRatios: dto.allowedAspectRatios,
              allowedDurations: dto.allowedDurations,
              allowedQualities: dto.allowedQualities,
              allowedResolutions: dto.allowedResolutions,
              maxPromptLength: Math.max(3, (dto.maxPromptLength == null ? 2000 : Math.min(2000, dto.maxPromptLength)) - 800),
              supportsNegativePrompt: dto.supportsNegativePrompt,
              supportsAudio: dto.supportsAudio
            };
          }
        } catch (_) {}
      }
      const promptProfiles = promptProfileRepository ? await promptProfileRepository.listPublic() : [];
      return { enabled: Boolean(capabilities['video.image_to_video']), models: [], capabilities, promptProfiles, pricing };
    },
    list: async (userId) => (await repository.listForUser(userId)).map(jobDto),
    get: async (id,userId) => jobDto(await repository.getForUser(id,userId)),
    getForAdmin: async (id) => jobDto(await repository.getById(id)),
    getContentRecord: async (id,userId) => repository.getForUser(id,userId),
    getContentRecordForAdmin: async (id) => repository.getById(id),
    submit: async ({ userId, idempotencyKey, input }) => {
      if (!isFeatureEnabled()) throw fail('VIDEO_GENERATION_DISABLED', 'ساخت ویدیو در حال حاضر فعال نیست.', 503);
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 191) throw fail('VIDEO_GENERATION_IDEMPOTENCY_REQUIRED','کلید یکتای درخواست لازم است.');
      const data=validateSubmit(input, { modelKeyRequired: !routeResolver }); const payloadHash=hash(JSON.stringify(data)); const keyHash=hash(idempotencyKey); const prior=await repository.findIdempotent(userId,keyHash);
      if (prior) { if (prior.payload_hash !== payloadHash) throw fail('VIDEO_GENERATION_IDEMPOTENCY_CONFLICT','کلید درخواست با محتوای دیگری استفاده شده است.',409); return prior; }
      if (routeResolver) {
        const capability = data.mode === 'image-to-video' ? 'video.image_to_video' : 'video.text_to_video';
        if (data.mode === 'text-to-video' && data.mediaId) throw fail('VIDEO_GENERATION_IMAGE_INPUT_DISABLED','ورودی تصویر برای این حالت مجاز نیست.',409);
        if (data.mode === 'image-to-video' && !data.mediaId) throw fail('VIDEO_INPUT_MEDIA_REQUIRED','تصویر ورودی الزامی است.',409);
        const snapshot = await routeResolver.resolve(capability, { input: data });
        if (capability === 'video.image_to_video' && (snapshot.providerKey !== 'bananaai' || snapshot.providerModelId !== BANANAAI_IMAGE_TO_VIDEO_MODEL_ID)) throw fail('VIDEO_GENERATION_MODEL_UNAVAILABLE','مسیر ساخت ویدیو از تصویر باید روی مدل Grok تنظیم شود.',503);
        if (data.modelKey && data.modelKey !== snapshot.internalModelKey) throw fail('VIDEO_GENERATION_MODEL_ROUTE_MISMATCH','مدل انتخاب‌شده با مسیر فعال سازگار نیست.',409);
        const model = await repository.getModel(snapshot.internalModelKey);
        if (!model) throw fail('VIDEO_GENERATION_MODEL_UNAVAILABLE','مدل انتخاب‌شده فعال نیست.',409);
        validateModelOptions(model, data, { routed: true });
        let promptSnapshot = null;
        if (capability === 'video.image_to_video') {
          if (!data.styleKey || !promptProfileRepository || !promptCompiler) throw fail('VIDEO_PROMPT_PROFILE_REQUIRED','سبک ساخت ویدیو الزامی است.',409);
          const profile = await promptProfileRepository.getCurrentByKey(data.styleKey, { publicOnly: true });
          if (!profile) throw fail('VIDEO_PROMPT_PROFILE_UNAVAILABLE','سبک ساخت ویدیو فعال یا عمومی نیست.',409);
          const compiledPromptLimit = model.max_prompt_length == null ? 2000 : Math.min(2000, Number(model.max_prompt_length));
          promptSnapshot = promptCompiler.compile({ profile, userPrompt: data.prompt, settings: { duration:data.duration,resolution:data.resolution,aspectRatio:data.aspectRatio,generateAudio:data.generateAudio }, maxCompiledPromptLength: compiledPromptLimit });
          promptSnapshot.profileId = profile.id;
          promptSnapshot.profileVersionId = profile.current_version_id;
        }
        const id = randomUUID(); const now = new Date();
        const job = {
          id,
          danoaRequestId: randomUUID(),
          userId,
          ...data,
          modelKey: snapshot.internalModelKey,
          provider: snapshot.providerKey,
          providerModelId: snapshot.providerModelId,
          capability,
          routeId: snapshot.routeId,
          routeVersion: snapshot.routeVersion,
          routeSnapshot: { ...snapshot, mode: data.mode, modelConstraints: { maxPromptLength: model.max_prompt_length == null ? 2000 : Math.min(2000, Number(model.max_prompt_length)) }, request: { duration: data.duration, resolution: data.resolution, aspectRatio: data.aspectRatio, generateAudio: data.generateAudio, hasNegativePrompt: Boolean(data.negativePrompt), mediaId: data.mediaId } },
          estimatedCost: null,
          promptProfileId: promptSnapshot?.profileId || null,
          promptProfileVersionId: promptSnapshot?.profileVersionId || null,
          promptProfileKey: promptSnapshot?.profileKey || null,
          promptProfileVersion: promptSnapshot?.profileVersion || null,
          promptCompilerVersion: promptSnapshot?.compilerVersion || null,
          // `prompt` is retained as the required, provider-facing snapshot for
          // the legacy NOT NULL column.  Routed jobs still keep the original
          // text separately in `userPrompt` and the enriched text in
          // `compiledPrompt`.
          prompt: promptSnapshot?.compiledPrompt || data.prompt,
          userPrompt: promptSnapshot?.userPrompt || data.prompt,
          compiledPrompt: promptSnapshot?.compiledPrompt || null,
          compiledPromptHash: promptSnapshot?.compiledPromptHash || null,
          idempotencyHash: keyHash,
          payloadHash,
          expiresAt: new Date(Date.now()+Number(process.env.VIDEO_JOB_TIMEOUT_MINUTES||30)*60000),
          nextPollAt: now,
          now
        };
        const reservationInput = reservationInputFor({
          userId,
          data,
          job,
          idempotencyKey: keyHash,
          payloadHash
        });
        try { return await repository.createRoutedWithReservation({ job, reservationInput }); }
        catch (error) {
          if (error?.code !== 'ER_DUP_ENTRY') throw error;
          const concurrent = await repository.findIdempotent(userId, keyHash);
          if (!concurrent || concurrent.payload_hash !== payloadHash) throw fail('VIDEO_GENERATION_IDEMPOTENCY_CONFLICT','کلید درخواست با محتوای دیگری استفاده شده است.',409);
          return concurrent;
        }
      }
      const model=await repository.getModel(data.modelKey); if (!model || (!model.is_active && !canUseInactiveModel({ userId, model, input: data }))) throw fail('VIDEO_GENERATION_MODEL_UNAVAILABLE','مدل انتخاب‌شده فعال نیست.',409);
      validateModelOptions(model, data);
      if (data.mode === 'text-to-video' && data.mediaId) throw fail('VIDEO_GENERATION_IMAGE_INPUT_DISABLED','ورودی تصویر برای این مرحله غیرفعال است.',409);
      if (data.mode==='image-to-video') throw fail('VIDEO_GENERATION_IMAGE_INPUT_NOT_CONFIGURED','اعتبارسنجی مالکیت تصویر برای ساخت ویدیو هنوز فعال نشده است.', 409);
      const id=randomUUID(), now=new Date(); const job={id,userId,...data,provider:model.provider,providerModelId:model.provider_model_id,upstreamVendor:model.upstream_vendor,providerOperation:model.upstream_operation,status:'queued',idempotencyHash:keyHash,payloadHash,expiresAt:new Date(Date.now()+Number(process.env.VIDEO_JOB_TIMEOUT_MINUTES||30)*60000),nextPollAt:now,now};
      const created = await repository.createWithReservation({
        job,
        reservationInput: reservationInputFor({
          userId,
          data,
          job,
          idempotencyKey: keyHash,
          payloadHash
        })
      });
      try {
        const submitted=data.mode==='image-to-video'
          ? await provider.submitImageToVideo({ ...created,inputMediaReference:data.mediaId })
          : await provider.submitTextToVideo(created);
        await repository.updateSubmission(id,submitted.providerJobId);
        return { ...created,status:'submitted',provider_job_id:submitted.providerJobId };
      } catch(error) {
        const code=error.code || 'VIDEO_PROVIDER_SUBMIT_FAILED';
        const message=provider.sanitizeError(error);
        await repository.markSubmitFailedAndRelease({id,errorCode:code,errorMessage:message,reason:'provider_submit_failed'});
        throw fail(code,message,502);
      }
    }
  };
}
module.exports = { createVideoGenerationService, jobDto };
