'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHealthService } = require('./health.service');

function createDb() {
  return {
    async query(sql) {
      const text = String(sql);
      if (text.includes('GROUP BY status')) {
        return [[
          { status: 'queued', count: 2 },
          { status: 'submitted', count: 1 },
          { status: 'succeeded', count: 7 },
          { status: 'failed', count: 3 }
        ]];
      }
      if (text.includes('worker_lease_until>NOW()')) return [[{ count: 1 }]];
      if (text.includes('updated_at<DATE_SUB')) return [[{ count: 1 }]];
      if (text.includes('expires_at<=NOW()')) return [[{ count: 0 }]];
      throw new Error(`Unexpected health query: ${text}`);
    }
  };
}

test('image-to-image health reports worker, queue and storage readiness', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danoa-i2i-health-'));
  try {
    const service = createHealthService({
      metisBaseUrl: 'https://api.example.test',
      metisApiKey: 'key',
      defaultModel: 'model',
      db: createDb(),
      env: {
        NODE_ENV: 'test',
        IMAGE_TO_IMAGE_ENABLED: 'true',
        IMAGE_TO_IMAGE_WORKER_MODE: 'embedded',
        IMAGE_TO_IMAGE_STORAGE_DIR: storageRoot
      }
    });

    const health = await service.getImageToImageHealth();
    assert.equal(health.ok, true);
    assert.equal(health.featureEnabled, true);
    assert.equal(health.workerMode, 'embedded');
    assert.equal(health.activeLeases, 1);
    assert.equal(health.queueCount, 2);
    assert.equal(health.submittedCount, 1);
    assert.equal(health.succeededCount, 7);
    assert.equal(health.failedCount, 3);
    assert.equal(health.stalePendingCount, 1);
    assert.equal(health.expiredPendingCount, 0);
    assert.equal(health.storageWritable, true);
  } finally {
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});

test('enabled image-to-image with disabled worker is not ready', async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danoa-i2i-health-disabled-'));
  try {
    const service = createHealthService({
      metisBaseUrl: 'https://api.example.test',
      metisApiKey: 'key',
      defaultModel: 'model',
      db: createDb(),
      env: {
        NODE_ENV: 'test',
        IMAGE_TO_IMAGE_ENABLED: 'true',
        IMAGE_TO_IMAGE_WORKER_MODE: 'disabled',
        IMAGE_TO_IMAGE_STORAGE_DIR: storageRoot
      }
    });

    const health = await service.getImageToImageHealth();
    assert.equal(health.ok, false);
    assert.equal(health.configurationReady, false);
    assert.equal(health.workerMode, 'disabled');
  } finally {
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
