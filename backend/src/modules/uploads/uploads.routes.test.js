const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const express = require('express');

const { createUploadsReadRouter } = require('./uploads.routes');

const IMAGE_ID = '550e8400-e29b-41d4-a716-446655440000';

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('upload image contract rejects an unauthenticated read before it touches ownership or storage', async () => {
  let ownershipRead = false;
  let storageRead = false;
  const app = express();
  app.use('/api/uploads', createUploadsReadRouter({
    requireAuthenticated: (_req, res) => res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' }),
    ownershipRepository: {
      isOwnedBy: async () => {
        ownershipRead = true;
        return true;
      },
      registerMany: async () => []
    },
    getUploadedImageById: async () => {
      storageRead = true;
      return null;
    }
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/uploads/images/${IMAGE_ID}`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'AUTHENTICATION_REQUIRED');
    assert.equal(ownershipRead, false);
    assert.equal(storageRead, false);
  });
});

test('upload image contract returns an image only to its authenticated owner', async () => {
  const app = express();
  app.use('/api/uploads', createUploadsReadRouter({
    requireAuthenticated: (req, _res, next) => {
      req.user = { id: 'user-1' };
      next();
    },
    ownershipRepository: {
      isOwnedBy: async (imageId, userId) => imageId === IMAGE_ID && userId === 'user-1',
      registerMany: async () => []
    },
    getUploadedImageById: async () => ({
      mimeType: 'image/png',
      base64: Buffer.from('safe-image').toString('base64')
    })
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/uploads/images/${IMAGE_ID}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), 'safe-image');
  });
});

test('upload image contract hides another users image and never reads the file', async () => {
  let storageRead = false;
  const app = express();
  app.use('/api/uploads', createUploadsReadRouter({
    requireAuthenticated: (req, _res, next) => {
      req.user = { id: 'user-2' };
      next();
    },
    ownershipRepository: {
      isOwnedBy: async () => false,
      registerMany: async () => []
    },
    getUploadedImageById: async () => {
      storageRead = true;
      return null;
    }
  }));

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/uploads/images/${IMAGE_ID}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'UPLOAD_NOT_FOUND');
    assert.equal(storageRead, false);
  });
});
