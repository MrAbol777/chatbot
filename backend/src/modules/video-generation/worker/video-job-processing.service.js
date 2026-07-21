const { isTerminalJobStatus } = require('../video-generation.states');
const { assertVideoProvider } = require('../providers/video-provider.interface');
const { calculatePollDelay } = require('./video-worker.config');
const { VideoWorkerProcessingError, classifyProviderError, safeErrorMessage } = require('./video-worker.errors');

const ACTIVE_STATUSES = new Set(['queued', 'submitted', 'processing', 'storing']);

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

function createVideoJobProcessingService({ repository, providerRegistry, config, storageOrchestrator = null, clock = () => new Date(), logger = null }) {
  if (!repository || !config) throw new Error('repository and config are required.');
  const log = (event, job, extra = {}) => logger?.info?.({ event, generationId: job.id, status: job.status, attempt: Number(job.poll_attempts || 0), leaseOwner: String(job.worker_lease_owner || '').slice(0, 12), ...extra });
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
      if (!job.provider_job_id) {
        await repository.failAndReleaseJob({ jobId: job.id, workerId, errorCode: 'VIDEO_PROVIDER_JOB_ID_MISSING', errorMessage: 'شناسه امن کار Provider موجود نیست.', releaseReason: 'invalid_provider_job' });
        return { action: 'failed', errorCode: 'VIDEO_PROVIDER_JOB_ID_MISSING' };
      }

      let provider;
      try {
        provider = resolveProvider(providerRegistry, job.provider);
        if (!await repository.extendJobLease({ jobId: job.id, workerId, leaseSeconds: Math.ceil(config.leaseMs / 1000) })) return { action: 'ignored-lease-lost' };
        const response = await provider.getJobStatus(job.provider_job_id);
        const normalized = provider.normalizeStatus(response);
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

module.exports = { createVideoJobProcessingService, resolveProvider };
