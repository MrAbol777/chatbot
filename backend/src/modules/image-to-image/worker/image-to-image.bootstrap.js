'use strict';

const { createImageToImageRepository } = require('../image-to-image.repository');
const { createImageToImageStorage } = require('../image-to-image.storage');
const { createMetisImageToImageProvider } = require('../providers/metis-image-to-image.provider');
const { createImageToImageRuntime } = require('./image-to-image.runtime');

const WORKER_PROCESS_MODES = new Set(['embedded', 'dedicated', 'disabled']);

function resolveImageToImageWorkerMode(env = process.env) {
  const mode = String(env.IMAGE_TO_IMAGE_WORKER_MODE || 'embedded').trim().toLowerCase();
  if (!WORKER_PROCESS_MODES.has(mode)) {
    const error = new Error('IMAGE_TO_IMAGE_WORKER_MODE must be embedded, dedicated, or disabled.');
    error.code = 'IMAGE_TO_IMAGE_WORKER_MODE_INVALID';
    throw error;
  }
  return mode;
}

function createConfiguredImageToImageRuntime({ db, httpClient, noaBillingService, config, role = 'embedded', logger = console, env = process.env }) {
  const desiredMode = resolveImageToImageWorkerMode(env);
  const normalizedRole = String(role || '').trim().toLowerCase();
  const runtimeConfig = {
    ...config,
    // Only the process selected by IMAGE_TO_IMAGE_WORKER_MODE may consume jobs.
    // This prevents the API process and a dedicated worker from both running
    // unintentionally while still allowing either topology.
    workerMode: desiredMode === normalizedRole ? normalizedRole : 'disabled'
  };
  return createImageToImageRuntime({ config: runtimeConfig, logger, dependencies: {
    repository: createImageToImageRepository(db, { noaBillingService }),
    storage: createImageToImageStorage({ rootDirectory: config.storageDir, maxBytes: config.maxInputBytes }),
    provider: createMetisImageToImageProvider({ httpClient, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, resolution: config.resolution, outputFormat: config.outputFormat, pollTimeoutMs: config.pollTimeoutMs, pollIntervalMs: config.pollIntervalSeconds * 1000, maxResultBytes: config.maxResultBytes, allowedResultHosts: config.resultAllowedHosts })
  } });
}

module.exports = {
  WORKER_PROCESS_MODES,
  resolveImageToImageWorkerMode,
  createConfiguredImageToImageRuntime
};
