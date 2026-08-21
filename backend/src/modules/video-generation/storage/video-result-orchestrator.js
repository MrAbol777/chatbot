const crypto = require('crypto');
const { VideoStorageError } = require('./video-storage.errors');
const { sanitizeFilename } = require('./video-file-validator');

function storageDelay(attempt, config) { return Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * (2 ** Math.min(Math.max(0, attempt - 1), 20))); }
function safeStorageError(error) { return String(error?.code || 'VIDEO_RESULT_STORAGE_FAILED').slice(0, 100); }
async function streamSha256(stream) { const hash = crypto.createHash('sha256'); for await (const chunk of stream) hash.update(chunk); return hash.digest('hex'); }
function assertActiveLease(assertLease) {
  if (typeof assertLease === 'function' && !assertLease()) throw new VideoStorageError('VIDEO_WORKER_LEASE_LOST');
}
function createVideoResultOrchestrator({ storage, config, logger = null, clock = () => new Date(), faultInjector = null }) {
  if (!storage || !config) throw new Error('storage and config are required.');
  const injectFault = process.env.NODE_ENV === 'test' && typeof faultInjector === 'function' ? async (point) => faultInjector(point) : async () => {};
  return {
    async store({ job, provider, descriptor, repository, workerId, assertLease = null }) {
      if (!descriptor || typeof descriptor !== 'object' || !descriptor.source) throw new VideoStorageError('VIDEO_RESULT_DESCRIPTOR_INVALID');
      assertActiveLease(assertLease);
      const filename = sanitizeFilename(descriptor.filename, 'video.mp4');
      const extension = filename.toLowerCase().endsWith('.webm') ? '.webm' : '.mp4';
      const key = `results/${crypto.createHash('sha256').update(String(job.user_id || job.userId || '')).digest('hex').slice(0, 24)}/${job.id}/output${extension}`;
      if (!await repository.recordStorageAttempt({ jobId: job.id, workerId })) throw new VideoStorageError('VIDEO_WORKER_LEASE_LOST');
      let remote = null;
      try {
        const finalizeCommittedResult = async (committedKey, originalFilename) => {
          assertActiveLease(assertLease);
          const committed = await storage.stat(committedKey);
          const committedValidation = await storage.validateStoredFile(storage.resolveSafeKey(committedKey), {});
          const committedSha256 = await streamSha256(storage.openReadStream(committedKey));
          await injectFault('before_db_finalize');
          const result = await repository.finalizeStoredResult({ jobId: job.id, workerId, storageKey: committedKey, mimeType: committedValidation.mimeType, sizeBytes: committed.size, sha256: committedSha256, originalFilename });
          await injectFault('after_db_finalize');
          return result;
        };
        const candidateKeys = [...new Set([key, key.replace(/\.(mp4|webm)$/i, '.mp4'), key.replace(/\.(mp4|webm)$/i, '.webm')])];
        const existingKey = (await Promise.all(candidateKeys.map(async (candidate) => (await storage.exists(candidate) ? candidate : null)))).find(Boolean);
        if (existingKey) {
          const result = await finalizeCommittedResult(existingKey, filename);
          return { action: 'succeeded', ...result, reusedExistingFile: true };
        }
        const recoveryTemporaryPath = typeof storage.temporaryPathForKey === 'function' ? storage.temporaryPathForKey(key) : null;
        if (recoveryTemporaryPath && await storage.hasTemporary(recoveryTemporaryPath)) {
          try {
            const validation = await storage.validateStoredFile(recoveryTemporaryPath, { declaredMimeType: descriptor.mimeType });
            const committedKey = key.replace(/\.(mp4|webm)$/i, validation.extension);
            await storage.commitTemporaryFile(recoveryTemporaryPath, committedKey);
            const result = await finalizeCommittedResult(committedKey, filename);
            return { action: 'succeeded', ...result, reusedExistingTemporary: true };
          } catch (error) {
            if (error?.simulateCrash) throw error;
            if (!['VIDEO_RESULT_EMPTY_FILE', 'VIDEO_RESULT_TOO_LARGE', 'VIDEO_RESULT_INVALID_SIGNATURE', 'VIDEO_RESULT_MIME_MISMATCH'].includes(error?.code)) throw error;
            await storage.removeTemporary(recoveryTemporaryPath);
          }
        }
        const temporaryPath = await storage.createTemporaryTarget(key);
        let preserveTemporaryForCrashRecovery = false;
        try {
          assertActiveLease(assertLease);
          remote = await provider.fetchResultStream(descriptor, {
            timeoutMs: config.timeoutMs,
            maxBytes: config.maxBytes,
            maxRedirects: config.maxRedirects,
            logger,
            context: {
              generationId: job.id,
              provider: provider.getProviderKey?.() || job.provider || null,
              providerJobId: String(job.provider_job_id || '').slice(0, 191) || null,
              attempt: Number(job.storage_attempts || 0) + 1
            }
          });
          if (!remote?.stream) throw new VideoStorageError('VIDEO_RESULT_DOWNLOAD_INVALID', undefined, { retryable: true });
          const written = await storage.writeStream(remote.stream, temporaryPath);
          assertActiveLease(assertLease);
          logger?.info?.({
            event: 'video_result_download_stored',
            generationId: job.id,
            provider: provider.getProviderKey?.() || job.provider || null,
            providerJobId: String(job.provider_job_id || '').slice(0, 191) || null,
            attempt: Number(job.storage_attempts || 0) + 1,
            httpStatus: remote.metrics?.httpStatus || null,
            contentLength: remote.contentLength ?? null,
            receivedBytes: written.bytes,
            mimeType: remote.mimeType || descriptor.mimeType || null
          });
          const validation = await storage.validateStoredFile(temporaryPath, { declaredMimeType: remote.mimeType || descriptor.mimeType });
          const committedKey = key.replace(/\.(mp4|webm)$/i, validation.extension);
          assertActiveLease(assertLease);
          await storage.commitTemporaryFile(temporaryPath, committedKey);
          // A concurrent/recovered writer can win the no-clobber commit race.
          // Finalize the bytes actually present at the durable key, never the
          // losing temporary candidate's metadata or digest.
          const result = await finalizeCommittedResult(committedKey, filename);
          return { action: 'succeeded', ...result };
        } catch (error) {
          preserveTemporaryForCrashRecovery = process.env.NODE_ENV === 'test' && error?.simulateCrash === true;
          throw error;
        } finally {
          if (!preserveTemporaryForCrashRecovery) await storage.removeTemporary(temporaryPath);
        }
      } catch (error) {
        // Test-only process-crash simulations deliberately leave the filesystem
        // state untouched so the next worker exercises the real recovery path.
        if (process.env.NODE_ENV === 'test' && error?.simulateCrash) throw error;
        if (error?.code === 'VIDEO_WORKER_LEASE_LOST') throw error;
        const attempt = Number(job.storage_attempts || 0) + 1;
        const code = safeStorageError(error);
        if (error?.retryable && attempt < config.maxAttempts) {
          const nextStorageAttemptAt = new Date(clock().getTime() + storageDelay(attempt, config));
          assertActiveLease(assertLease);
          if (!await repository.scheduleStorageRetry({ jobId: job.id, workerId, nextStorageAttemptAt, errorCode: code })) return { action: 'ignored-lease-lost', errorCode: 'VIDEO_WORKER_LEASE_LOST' };
          logger?.info?.({
            event: 'video_result_storage_retry',
            generationId: job.id,
            provider: provider.getProviderKey?.() || job.provider || null,
            providerJobId: String(job.provider_job_id || '').slice(0, 191) || null,
            attempt,
            httpStatus: remote?.metrics?.httpStatus || null,
            contentLength: remote?.contentLength ?? null,
            receivedBytes: remote?.metrics?.receivedBytes ?? null,
            errorCode: code,
            underlyingCode: error?.underlyingCode || error?.code || null,
            underlyingName: error?.underlyingName || error?.name || null,
            retryable: true
          });
          return { action: 'storage-retry', errorCode: code, nextStorageAttemptAt };
        }
        assertActiveLease(assertLease);
        if (!await repository.failStorageAndRelease({ jobId: job.id, workerId, errorCode: attempt >= config.maxAttempts ? 'VIDEO_STORAGE_MAX_ATTEMPTS_REACHED' : code })) return { action: 'ignored-lease-lost', errorCode: 'VIDEO_WORKER_LEASE_LOST' };
        logger?.info?.({
          event: 'video_result_storage_failed',
          generationId: job.id,
          provider: provider.getProviderKey?.() || job.provider || null,
          providerJobId: String(job.provider_job_id || '').slice(0, 191) || null,
          attempt,
          httpStatus: remote?.metrics?.httpStatus || null,
          contentLength: remote?.contentLength ?? null,
          receivedBytes: remote?.metrics?.receivedBytes ?? null,
          errorCode: code,
          underlyingCode: error?.underlyingCode || error?.code || null,
          underlyingName: error?.underlyingName || error?.name || null,
          retryable: Boolean(error?.retryable)
        });
        return { action: 'storage-failed', errorCode: code };
      }
    }
  };
}
module.exports = { createVideoResultOrchestrator, storageDelay };
