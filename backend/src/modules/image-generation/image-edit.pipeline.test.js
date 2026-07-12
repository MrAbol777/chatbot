const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFinalImageEditPrompt } = require('./image-generation.controller');
const {
  DEFAULT_IMAGE_RUNTIME_SETTINGS,
  buildMetisRequestBody
} = require('./image-runtime-settings');

test('builds the documented Metis Nano Banana image edit request', () => {
  const body = buildMetisRequestBody({
    prompt: 'remove the button',
    runtimeSettings: {
      ...DEFAULT_IMAGE_RUNTIME_SETTINGS,
      runtimeProviderName: 'google',
      runtimeModel: 'nano-banana',
      operation: 'Imagine',
      editEnabled: true
    },
    imageInput: ['https://storage.example/source.jpg']
  });

  assert.equal(body.model.name, 'google');
  assert.equal(body.model.model, 'nano-banana');
  assert.equal(body.operation, 'Imagine');
  assert.equal(body.args.image_input, 'https://storage.example/source.jpg');
});

test('keeps up to four ordered references and rejects more', () => {
  const runtimeSettings = { ...DEFAULT_IMAGE_RUNTIME_SETTINGS, editEnabled: true };
  const references = ['one', 'two', 'three', 'four'];
  const body = buildMetisRequestBody({ prompt: 'compose them', runtimeSettings, imageInput: references });
  assert.deepEqual(body.args.image_input, references);

  assert.throws(
    () => buildMetisRequestBody({ prompt: 'too many', runtimeSettings, imageInput: [...references, 'five'] }),
    /at most 4/
  );
});

test('edit prompt makes the first image primary and protects identities', () => {
  const prompt = buildFinalImageEditPrompt('من را کنار دوستم قرار بده', {
    referenceCount: 2,
    defaultNegativePrompt: 'no watermark'
  });

  assert.match(prompt, /input image 1 as the primary base image and identity source/i);
  assert.match(prompt, /images 2 through 2 are secondary visual references/i);
  assert.match(prompt, /never blend, swap, or average their faces/i);
  assert.match(prompt, /من را کنار دوستم قرار بده/);
});
