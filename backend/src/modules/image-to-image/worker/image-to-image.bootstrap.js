'use strict';

const { createImageToImageRepository } = require('../image-to-image.repository');
const { createImageToImageStorage } = require('../image-to-image.storage');
const { createMetisImageToImageProvider } = require('../providers/metis-image-to-image.provider');
const { createImageToImageRuntime } = require('./image-to-image.runtime');

function createConfiguredImageToImageRuntime({ db, httpClient, noaBillingService, config, role = 'embedded', logger = console }) {
  const runtimeConfig = { ...config, workerMode: role };
  return createImageToImageRuntime({ config: runtimeConfig, logger, dependencies: {
    repository: createImageToImageRepository(db, { noaBillingService }),
    storage: createImageToImageStorage({ rootDirectory: config.storageDir, maxBytes: config.maxInputBytes }),
    provider: createMetisImageToImageProvider({ httpClient, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, resolution: config.resolution, outputFormat: config.outputFormat, pollTimeoutMs: config.pollTimeoutMs, pollIntervalMs: config.pollIntervalSeconds * 1000, maxResultBytes: config.maxResultBytes, allowedResultHosts: config.resultAllowedHosts })
  } });
}

module.exports = { createConfiguredImageToImageRuntime };
