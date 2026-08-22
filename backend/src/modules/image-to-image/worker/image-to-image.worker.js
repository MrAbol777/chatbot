'use strict';

function createImageToImageWorker({ repository, storage, provider, config, workerId = `i2i-${Math.random().toString(36).slice(2, 10)}`, logger = console }) {
  let running = false;
  const process = async (job) => {
    try {
      if (job.status === 'queued') {
        const sources = [];
        for (const source of job.sources) sources.push({ ...source, buffer: await storage.read(source.key) });
        const submitted = await provider.submit({ prompt: job.prompt, aspectRatio: job.aspect_ratio, sources });
        await repository.markSubmitted({ jobId: job.id, workerId, providerTaskId: submitted.taskId });
        return 'submitted';
      }
      const state = await provider.poll({ taskId: job.provider_task_id });
      if (state.state === 'pending') { await repository.deferPoll({ jobId: job.id, workerId, delaySeconds: config.pollIntervalSeconds }); return 'pending'; }
      if (state.state === 'failed') throw Object.assign(new Error('سرویس تصویر درخواست را رد کرد.'), { code: state.errorCode || 'IMAGE_TO_IMAGE_PROVIDER_REJECTED' });
      const output = await provider.download({ resultUrl: state.resultUrl });
      const saved = await storage.saveResult(job.id, output);
      await repository.complete({ jobId: job.id, workerId, result: { ...saved, mimeType: output.mimeType } });
      return 'completed';
    } catch (error) {
      logger?.error?.('[IMAGE_TO_IMAGE] job failed', { jobId: job.id, errorCode: error?.code || 'IMAGE_TO_IMAGE_FAILED' });
      await repository.fail({ jobId: job.id, workerId, errorCode: error?.code, errorMessage: 'ویرایش تصویر انجام نشد؛ نوآی رزروشده بازگشت.' });
      return 'failed';
    }
  };
  return {
    workerId,
    async tick() {
      if (running) return { action: 'overlap-ignored', processed: 0 };
      running = true;
      try { const job = await repository.claimDue({ workerId, leaseSeconds: config.leaseSeconds }); return job ? { action: await process(job), processed: 1 } : { action: 'idle', processed: 0 }; }
      finally { running = false; }
    }
  };
}

module.exports = { createImageToImageWorker };
