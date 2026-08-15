const { isTerminalJobStatus } = require('../video-generation.states');
const { assertVideoProvider } = require('../providers/video-provider.interface');
const { calculatePollDelay } = require('./video-worker.config');
const { VideoWorkerProcessingError, classifyProviderError, safeErrorMessage } = require('./video-worker.errors');

const ACTIVE_STATUSES = new Set(['queued', 'routing', 'submitting', 'submitted', 'processing', 'storing']);

function resolveProvider(registry, name) {
  const provider = typeof registry === 'function' ? registry(name)
    : typeof registry?.get === 'function' ? registry.get(name)
      : registry?.[name];
  if (!provider) throw new VideoWorkerProcessingError('VIDEO_PROVIDER_NOT_FOUND', 'Configured video provider was not found.');
  if (provider.kind === 'fake' && process.env.NODE_ENV === 'production') {
    throw new VideoWorkerProcessingError('VIDEO_FAKE_PROVIDER_FORBIDDEN', 'Fake provider is not allowed in production.');
  }
  return assertVideoProvider(provider);
}

function createSubmissionLeaseHeartbeat({ repository, jobId, workerId, leaseMs, timers, logger }) {
  const intervalMs = Math.max(1_000, Math.floor(Number(leaseMs) / 3));
  const leaseSeconds = Math.ceil(Number(leaseMs) / 1_000);
  let stopped = false;
  let leaseLost = false;
  let renewal = Promise.resolve();
  const renew = () => {
    renewal = renewal.then(async () => {
      if (stopped) return;
      try {
        const extended = await repository.extendJobLease({ jobId, workerId, leaseSeconds });
        if (!extended) leaseLost = true;
      } catch (error) {
        leaseLost = true;
        logger?.warn?.({ event: 'video_submission_lease_renewal_failed', generationId: jobId, errorCode: String(error?.code || 'VIDEO_WORKER_LEASE_RENEWAL_FAILED').slice(0, 100) });
      }
    });
    return renewal;
  };
  const timer = timers.setInterval(() => { void renew(); }, intervalMs);
  timer?.unref?.();
  void renew();
  return {
    stop: async () => {
      stopped = true;
      timers.clearInterval(timer);
      await renewal;
      return !leaseLost;
    }
  };
}

function createVideoJobProcessingService({ repository, providerRegistry, config, storageOrchestrator = null, providerInputGateway = null, submissionGuard = null, clock = () => new Date(), logger = null, timers = globalThis }) {
  if (!repository || !config) throw new Error('repository and config are required.');
  const log = (event, job, extra = {}) => logger?.info?.({ event, generationId: job.id, status: job.status, attempt: Number(job.poll_attempts || 0), leaseOwner: String(job.worker_lease_owner || '').slice(0, 12), ...extra });
  const observeProviderOutcome = async (value) => {
    if (typeof repository.recordProviderOutcome !== 'function') return;
    try { await repository.recordProviderOutcome(value); }
    catch (error) { logger?.warn?.({ event: 'video_provider_health_observation_failed', provider: value.providerKey, errorCode: error.code || 'AI_HEALTH_WRITE_FAILED' }); }
  };
  const schedule = async (job, workerId, errorCode = null) => {
    const delay = calculatePollDelay(Math.max(0, Number(job.poll_attempts || 1) - 1), config);
    const nextPollAt = new Date(clock().getTime() + delay);
    const scheduled = await repository.scheduleNextPoll({ jobId: job.id, workerId, nextPollAt });
    if (!scheduled) return { action: 'ignored-lease-lost' };
    log('video_poll_scheduled', job, errorCode ? { errorCode } : {});
    return { action: 'scheduled', nextPollAt, errorCode };
  };

  return {
    async processClaimedJob(job, { workerId } = {}) {
      if (!job?.id || !workerId || job.worker_lease_owner !== workerId) return { action: 'ignored-lease-mismatch' };
      if (isTerminalJobStatus(job.status) || !ACTIVE_STATUSES.has(job.status)) return { action: 'ignored-terminal' };
      const now = clock();
      const createdAt = new Date(job.created_at);
      if (config.providerDeadlineSeconds > 0 && Number.isFinite(createdAt.getTime()) && now.getTime() - createdAt.getTime() >= config.providerDeadlineSeconds * 1000) {
        await repository.failAndReleaseJob({ jobId: job.id, workerId, errorCode: 'VIDEO_PROVIDER_DEADLINE_EXCEEDED', errorMessage: 'ساخت ویدیو در مهلت مجاز تکمیل نشد.', releaseReason: 'provider_deadline_exceeded' });
        log('video_job_failed', job, { errorCode: 'VIDEO_PROVIDER_DEADLINE_EXCEEDED' });
        return { action: 'failed', errorCode: 'VIDEO_PROVIDER_DEADLINE_EXCEEDED' };
      }
      const expiresAt = new Date(job.expires_at);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
        await repository.expireAndReleaseJob({ jobId: job.id, workerId, releaseReason: 'job_timeout', errorCode: 'VIDEO_JOB_TIMEOUT' });
        log('video_job_expired', job, { errorCode: 'VIDEO_JOB_TIMEOUT' });
        return { action: 'expired', errorCode: 'VIDEO_JOB_TIMEOUT' };
      }
      if (Number(job.poll_attempts || 0) > config.maxPollAttempts) {
        await repository.expireAndReleaseJob({ jobId: job.id, workerId, releaseReason: 'max_poll_attempts', errorCode: 'VIDEO_MAX_POLL_ATTEMPTS_REACHED' });
        log('video_job_expired', job, { errorCode: 'VIDEO_MAX_POLL_ATTEMPTS_REACHED' });
        return { action: 'expired', errorCode: 'VIDEO_MAX_POLL_ATTEMPTS_REACHED' };
      }
      if (job.status === 'submitting' && job.provider_attempt_id && typeof repository.markSubmissionAmbiguous === 'function') {
        await repository.markSubmissionAmbiguous({ jobId: job.id, workerId, errorCode: 'VIDEO_PROVIDER_STATUS_UNKNOWN' });
        return { action: 'provider-status-unknown', errorCode: 'VIDEO_PROVIDER_STATUS_UNKNOWN' };
      }
      if (['queued', 'routing', 'submitting'].includes(job.status) && job.provider_attempt_id && typeof repository.beginSubmission === 'function') {
        let provider;
        let submissionStarted = false;
        let submitStartedAt = 0;
        try {
          provider = resolveProvider(providerRegistry, job.provider);
          if ((job.capability_key === 'video.image_to_video' || job.mode === 'image-to-video') && !String(job.compiled_prompt || '').trim()) {
            throw Object.assign(new Error('Compiled prompt snapshot is required for image-to-video.'), { code: 'VIDEO_COMPILED_PROMPT_REQUIRED', submissionOutcome: 'not_submitted' });
          }
          let snapshot = {};
          try { snapshot = typeof job.route_snapshot === 'string' ? JSON.parse(job.route_snapshot) : job.route_snapshot || {}; } catch (_) {}
          const promptLimit = Number(snapshot?.modelConstraints?.maxPromptLength || 2000);
          const submitInput = {
            capability: job.capability_key || (job.mode === 'image-to-video' ? 'video.image_to_video' : 'video.text_to_video'),
            mode: job.mode,
            providerModelId: job.provider_model_id_snapshot,
            upstreamVendor: snapshot.upstreamVendor,
            providerOperation: snapshot.providerOperation,
            prompt: job.compiled_prompt || job.prompt,
            negativePrompt: job.negative_prompt,
            duration: job.duration,
            resolution: job.resolution || job.quality || null,
            aspectRatio: job.aspect_ratio,
            generateAudio: Boolean(job.generate_audio),
            idempotencyKey: String(job.danoa_request_id || job.id || '').trim()
          };
          if (!Number.isSafeInteger(promptLimit) || promptLimit < 256 || String(submitInput.prompt || '').length > promptLimit) {
            throw Object.assign(new Error('Compiled prompt exceeds the provider model limit.'), { code: 'VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG', submissionOutcome: 'not_submitted', details: { promptLength: String(submitInput.prompt || '').length, promptLimit } });
          }
          if (submitInput.capability === 'video.image_to_video') {
            if (!providerInputGateway || typeof providerInputGateway.createUrl !== 'function') throw Object.assign(new Error('Provider input gateway is not configured.'), { code: 'VIDEO_INPUT_GATEWAY_NOT_CONFIGURED', submissionOutcome: 'not_submitted' });
            submitInput.providerInputUrl = await providerInputGateway.createUrl({ jobId: job.id, attemptId: job.provider_attempt_id, mediaId: job.input_media_id, userId: job.user_id, mimeType: job.input_media_mime_type });
          }
          await submissionGuard?.check(job, submitInput);
          provider.validateRequest?.(submitInput);
          await repository.beginSubmission({ jobId: job.id, workerId });
          submissionStarted = true;
          submitStartedAt = Date.now();
          const submissionLease = createSubmissionLeaseHeartbeat({ repository, jobId: job.id, workerId, leaseMs: config.leaseMs, timers, logger });
          let submitted;
          let leaseActive;
          try {
            try {
              submitted = await provider.submit(submitInput);
            } catch (error) {
              if (error?.submissionOutcome !== 'ambiguous' || !submitInput.idempotencyKey) throw error;
              log('video_submit_idempotent_retry', job, { errorCode: String(error.code || 'VIDEO_PROVIDER_STATUS_UNKNOWN').slice(0, 100) });
              submitted = await provider.submit(submitInput);
            }
          } finally {
            leaseActive = await submissionLease.stop();
          }
          if (!leaseActive) throw Object.assign(new Error('Submission lease was lost before the provider response could be persisted.'), { code: 'VIDEO_WORKER_LEASE_LOST', submissionOutcome: 'ambiguous' });
          await repository.markSubmissionAccepted({ jobId: job.id, workerId, providerJobId: submitted.providerJobId, creditsReserved: submitted.creditsReserved });
          await observeProviderOutcome({ providerKey: job.provider, capabilityKey: submitInput.capability, success: true, latencyMs: Date.now() - submitStartedAt });
          log('video_job_submitted', job);
          return { action: 'submitted' };
        } catch (error) {
          const code = error?.code || 'VIDEO_PROVIDER_STATUS_UNKNOWN';
          const providerStatus = Number(error?.details?.status || 0) || null;
          const providerCode = typeof error?.details?.providerCode === 'string' ? error.details.providerCode.slice(0, 80) : null;
          if (submissionStarted && error?.submissionOutcome !== 'confirmed_rejected' && error?.submissionOutcome !== 'not_submitted') {
            await repository.markSubmissionAmbiguous({ jobId: job.id, workerId, errorCode: code });
            await observeProviderOutcome({ providerKey: job.provider, capabilityKey: job.capability_key, success: false, latencyMs: submitStartedAt ? Date.now() - submitStartedAt : null });
            log('video_submit_ambiguous', job, { errorCode: code, providerStatus, providerCode });
            return { action: 'provider-status-unknown', errorCode: code };
          }
          const result = await repository.rejectSubmissionAndRoute({ jobId: job.id, workerId, errorCode: code, errorMessage: provider?.sanitizeError?.(error) || 'درخواست پیش از پذیرش Provider رد شد.' });
          log(result.action === 'fallback-queued' ? 'video_fallback_queued' : 'video_submit_rejected', job, { errorCode: code, providerStatus, providerCode });
          return { ...result, errorCode: code };
        }
      }
      if (!job.provider_job_id) {
        await repository.failAndReleaseJob({ jobId: job.id, workerId, errorCode: 'VIDEO_PROVIDER_JOB_ID_MISSING', errorMessage: 'شناسه امن کار Provider موجود نیست.', releaseReason: 'invalid_provider_job' });
        return { action: 'failed', errorCode: 'VIDEO_PROVIDER_JOB_ID_MISSING' };
      }

      let provider;
      try {
        provider = resolveProvider(providerRegistry, job.provider);
        if (!await repository.extendJobLease({ jobId: job.id, workerId, leaseSeconds: Math.ceil(config.leaseMs / 1000) })) return { action: 'ignored-lease-lost' };
        const pollStartedAt = Date.now();
        const response = await provider.getJobStatus(job.provider_job_id);
        const normalized = provider.normalizeStatus(response);
        const latencyMs = Date.now() - pollStartedAt;
        const cost = provider.normalizeCost?.(response) || null;
        await observeProviderOutcome({ providerKey: job.provider, capabilityKey: job.capability_key || (job.mode === 'image-to-video' ? 'video.image_to_video' : 'video.text_to_video'), success: true, latencyMs });
        await repository.recordAttemptPoll?.({ attemptId: job.provider_attempt_id, normalizedStatus: normalized, actualCost: cost?.credits ?? cost?.minor ?? null, costCurrency: cost?.currency || null, latencyMs });
        // The fake provider has a test-only terminal result used by legacy DB
        // fixtures. Every real provider, including Metis, must use `storing`.
        const fakeTestSuccess = provider.kind === 'fake' && process.env.NODE_ENV === 'test' && normalized === 'succeeded';
        if (!['queued', 'submitted', 'processing', 'storing', 'failed', 'cancelled'].includes(normalized) && !fakeTestSuccess) {
          const errorCode = response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'status')
            ? 'VIDEO_PROVIDER_UNKNOWN_STATUS' : 'VIDEO_PROVIDER_MALFORMED_RESPONSE';
          return schedule(job, workerId, errorCode);
        }
        if (['queued', 'submitted', 'processing'].includes(normalized)) return schedule(job, workerId);
        if (!await repository.extendJobLease({ jobId: job.id, workerId, leaseSeconds: Math.ceil(config.leaseMs / 1000) })) return { action: 'ignored-lease-lost' };
        if (fakeTestSuccess) {
          await repository.finalizeSuccessfulJob({ jobId: job.id, workerId });
          return { action: 'succeeded-test-fixture' };
        }
        if (normalized === 'storing') {
          // Metis COMPLETED only means the upstream result is ready.  The job can
          // succeed only after a validated local result has been stored.
          if (!storageOrchestrator) {
            if (job.status !== 'storing') await repository.markJobStoring({ jobId: job.id, workerId });
            return { action: 'storing-awaiting-storage' };
          }
          if (typeof provider.normalizeResult !== 'function' || typeof provider.fetchResultStream !== 'function') throw new VideoWorkerProcessingError('VIDEO_PROVIDER_RESULT_NOT_SUPPORTED', 'Configured provider cannot retrieve video results.');
          if (job.status !== 'storing') {
            const moved = await repository.markJobStoring({ jobId: job.id, workerId });
            if (!moved) return { action: 'ignored-lease-lost' };
            job = { ...job, status: 'storing', storage_attempts: 0 };
          }
          const descriptor = provider.normalizeResult(response);
          const stored = await storageOrchestrator.store({ job, provider, descriptor, repository, workerId });
          log(stored.action === 'succeeded' ? 'video_job_succeeded' : 'video_result_storage', job, stored.errorCode ? { errorCode: stored.errorCode } : {});
          return stored;
        }
        const errorCode = normalized === 'cancelled' ? 'VIDEO_PROVIDER_CANCELLED' : 'VIDEO_PROVIDER_FAILED';
        await repository.failAndReleaseJob({ jobId: job.id, workerId, errorCode, errorMessage: safeErrorMessage(null, provider), releaseReason: normalized === 'cancelled' ? 'provider_cancelled' : 'provider_failure' });
        log('video_job_failed', job, { errorCode });
        return { action: 'failed', errorCode };
      } catch (error) {
        if (error instanceof VideoWorkerProcessingError && !error.retryable) {
          await repository.failAndReleaseJob({ jobId: job.id, workerId, errorCode: error.code, errorMessage: 'تنظیمات سرویس ساخت ویدیو معتبر نیست.', releaseReason: 'provider_configuration' });
          return { action: 'failed', errorCode: error.code };
        }
        const classified = classifyProviderError(error);
        if (classified.retryable) await observeProviderOutcome({ providerKey: job.provider, capabilityKey: job.capability_key || (job.mode === 'image-to-video' ? 'video.image_to_video' : 'video.text_to_video'), success: false });
        if (classified.retryable) return schedule(job, workerId, classified.code);
        if (provider) {
          await repository.failAndReleaseJob({ jobId: job.id, workerId, errorCode: classified.code, errorMessage: safeErrorMessage(error, provider), releaseReason: 'provider_failure' });
          log('video_job_failed', job, { errorCode: classified.code });
          return { action: 'failed', errorCode: classified.code };
        }
        throw error;
      }
    }
  };
}

module.exports = { createVideoJobProcessingService, createSubmissionLeaseHeartbeat, resolveProvider };
