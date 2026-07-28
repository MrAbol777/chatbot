const { randomUUID } = require('crypto');

function createVideoGenerationWorker({ repository, processingService, config, workerId = `vw-${randomUUID().slice(0, 8)}`, logger = null }) {
  if (!repository || !processingService || !config) throw new Error('repository, processingService and config are required.');
  let running = false;
  let stopped = false;
  return {
    workerId,
    isRunning: () => running,
    stop: () => { stopped = true; },
    async processClaimedJob(job) { return processingService.processClaimedJob(job, { workerId }); },
    async tick() {
      if (running || stopped) return { action: running ? 'overlap-ignored' : 'stopped', processed: 0 };
      running = true;
      try {
        await repository.recoverExpiredLeases();
        const leaseSeconds = Math.ceil(config.leaseMs / 1000);
        const expiredJobs = await repository.claimExpiredJobs({ workerId, leaseSeconds, limit: config.batchSize });
        const submittableJobs = expiredJobs.length < config.batchSize && typeof repository.claimSubmittableJobs === 'function'
          ? await repository.claimSubmittableJobs({ workerId, leaseSeconds, limit: config.batchSize - expiredJobs.length })
          : [];
        const pollableJobs = expiredJobs.length + submittableJobs.length < config.batchSize
          ? await repository.claimPollableJobs({ workerId, leaseSeconds, limit: config.batchSize - expiredJobs.length - submittableJobs.length })
          : [];
        const jobs = [...expiredJobs, ...submittableJobs, ...pollableJobs];
        const results = [];
        for (const job of jobs) {
          try { results.push(await this.processClaimedJob(job)); }
          catch (error) { logger?.error?.({ event: 'video_job_process_error', generationId: job.id, errorCode: error.code || 'VIDEO_WORKER_PROCESSING_ERROR' }); results.push({ action: 'error', errorCode: error.code || 'VIDEO_WORKER_PROCESSING_ERROR' }); }
        }
        return { action: 'ticked', processed: jobs.length, results };
      } finally { running = false; }
    }
  };
}

module.exports = { createVideoGenerationWorker };
