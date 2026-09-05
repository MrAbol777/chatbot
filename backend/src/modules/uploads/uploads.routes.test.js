const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const express = require('express');

const { createUploadsReadRouter } = require('./uploads.routes');

const IMAGE_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

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

function authenticated(req, _res, next) {
  req.user = { id: 'user-1' };
  next();
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
    requireAuthenticated: authenticated,
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

test('upload registration validates actual image bytes before persisting ownership', async () => {
  const registered = [];
  const app = express();
  app.use('/api/uploads', createUploadsReadRouter({
    requireAuthenticated: authenticated,
    ownershipRepository: {
      isOwnedBy: async () => false,
      registerMany: async (value) => registered.push(value)
    },
    getUploadedImageById: async () => null
  }));
  app.post('/api/uploads/images', (req, res) => {
    req.files = [{ buffer: VALID_PNG, mimetype: 'image/png' }];
    res.json({ images: [{ imageId: IMAGE_ID }] });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/uploads/images`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].userId, 'user-1');
  });
});

test('upload registration rejects fake image bytes', async () => {
  let registered = false;
  const app = express();
  app.use('/api/uploads', createUploadsReadRouter({
    requireAuthenticated: authenticated,
    ownershipRepository: {
      isOwnedBy: async () => false,
      registerMany: async () => {
        registered = true;
      }
    },
    getUploadedImageById: async () => null
  }));
  app.post('/api/uploads/images', (req, res) => {
    req.files = [{ buffer: Buffer.from('<script>not an image</script>'), mimetype: 'image/png' }];
    res.json({ images: [{ imageId: IMAGE_ID }] });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/uploads/images`, { method: 'POST' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_IMAGE_CONTENT');
    assert.equal(registered, false);
  });
});

test('upload endpoint rate limits repeated authenticated posts', async () => {
  const previous = process.env.UPLOAD_IMAGE_RATE_LIMIT_PER_MINUTE;
  process.env.UPLOAD_IMAGE_RATE_LIMIT_PER_MINUTE = '1';
  try {
    const app = express();
    app.use('/api/uploads', createUploadsReadRouter({
      requireAuthenticated: authenticated,
      ownershipRepository: {
        isOwnedBy: async () => false,
        registerMany: async () => []
      },
      getUploadedImageById: async () => null
    }));
    app.post('/api/uploads/images', (req, res) => {
      req.files = [{ buffer: VALID_PNG, mimetype: 'image/png' }];
      res.json({ images: [{ imageId: IMAGE_ID }] });
    });

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/uploads/images`, { method: 'POST' });
      assert.equal(first.status, 200);
      const second = await fetch(`${baseUrl}/api/uploads/images`, { method: 'POST' });
      assert.equal(second.status, 429);
      assert.equal((await second.json()).code, 'UPLOAD_RATE_LIMITED');
    });
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_IMAGE_RATE_LIMIT_PER_MINUTE;
    else process.env.UPLOAD_IMAGE_RATE_LIMIT_PER_MINUTE = previous;
  }
});
