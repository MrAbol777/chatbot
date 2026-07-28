'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createMetisVideoProviderInputPublisher, validateUploadBaseUrl } = require('../input-media/metis-video-provider-input.publisher');

const claims = { mediaId: 'media-1', jobId: 'job-1', attemptId: 'attempt-1', userId: 'user-1' };

function fixture({ uploadedUrl = 'https://api.metisai.ir/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/input.jpg' } = {}) {
  let requestedClaims;
  let post;
  const publisher = createMetisVideoProviderInputPublisher({
    httpClient: {
      post: async (url, _form, config) => {
        post = { url, config };
        return { data: { files: [{ url: uploadedUrl }] } };
      }
    },
    repository: {
      getForSubmissionUpload: async (value) => {
        requestedClaims = value;
        return { id: 'media-1', storage_key: 'input.jpg', mime_type: 'image/jpeg', size_bytes: 3 };
      }
    },
    storage: { createReadStream: () => Readable.from(Buffer.from([0xff, 0xd8, 0xff])) },
    baseUrl: 'https://api.metisai.ir',
    apiKey: 'fixture-key',
    allowedHosts: ['api.metisai.ir'],
    allowedPathPrefixes: ['/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/'],
    dnsResolver: async () => [{ address: '93.184.216.34', family: 4 }]
  });
  return { publisher, getRequestedClaims: () => requestedClaims, getPost: () => post };
}

test('remote input publisher uploads the bound image and returns only an allowlisted URL', async () => {
  const value = fixture();
  const url = await value.publisher.createUrl(claims);
  assert.equal(url, 'https://api.metisai.ir/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/input.jpg');
  assert.deepEqual(value.getRequestedClaims(), claims);
  assert.equal(value.getPost().url, 'https://api.metisai.ir/api/v1/storage');
  assert.match(value.getPost().config.headers.Authorization, /^Bearer /);
  assert.equal(value.getPost().config.maxRedirects, 0);
});

test('remote input publisher rejects an upload URL outside the exact host and path contract', async () => {
  const value = fixture({ uploadedUrl: 'https://example.com/input.jpg' });
  await assert.rejects(value.publisher.createUrl(claims), { code: 'VIDEO_INPUT_UPLOAD_URL_REJECTED', submissionOutcome: 'not_submitted' });
});

test('remote input publisher requires an HTTPS origin without credentials or paths', () => {
  assert.equal(validateUploadBaseUrl('https://api.metisai.ir'), 'https://api.metisai.ir');
  assert.throws(() => validateUploadBaseUrl('http://api.metisai.ir'), { code: 'VIDEO_INPUT_UPLOAD_NOT_CONFIGURED' });
  assert.throws(() => validateUploadBaseUrl('https://api.metisai.ir/api'), { code: 'VIDEO_INPUT_UPLOAD_NOT_CONFIGURED' });
});
