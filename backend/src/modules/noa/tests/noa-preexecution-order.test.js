const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiController } = require('../../ai/ai.controller');
const { createImageGenerationController } = require('../../image-generation/image-generation.controller');

const createJsonResponse = () => ({
  locals: { requestId: 'request-test-1' },
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
  end() {
    return this;
  }
});

const createChatTurnRepository = () => {
  const turns = new Map();
  return {
    async getTurn(turnId) {
      return turns.get(turnId) || null;
    },
    async beginTurn(input) {
      const turn = {
        turn_id: input.turnId,
        user_id: input.userId,
        conversation_id: input.conversationId || 'default',
        user_message: input.userMessage,
        intent: input.intent,
        status: 'streaming'
      };
      turns.set(input.turnId, turn);
      return { turn, created: true };
    },
    async setNoaReservation(turnId, reservationId) {
      turns.get(turnId).noa_reservation_id = reservationId;
      return true;
    },
    async setIntent(turnId, intent) {
      turns.get(turnId).intent = intent;
      return true;
    },
    async markTurn({ turnId, status, errorCode = null }) {
      const turn = turns.get(turnId);
      if (turn) Object.assign(turn, { status, error_code: errorCode });
    }
  };
};

const createImageRuntimeSettingsResolver = () => ({
  async getRuntimeSettings() {
    return {
      modelAdminValue: 'test-image-model',
      modelSource: 'test',
      provider: 'test',
      baseUrl: 'https://provider.invalid',
      resolution: '1K',
      aspectRatio: '1:1',
      outputFormat: 'png',
      safetyFilterLevel: 'block_only_high',
      runtimeProviderName: 'test',
      runtimeModel: 'test-image-model',
      operation: 'generate',
      promptEnhancerEnabled: true,
      defaultNegativePrompt: '',
      pollIntervalMs: 10,
      pollTimeoutMs: 100,
      maxDownloadMb: 1,
      editEnabled: true,
      enabled: true,
      customArgs: {},
      customArgsJson: '{}',
      lastValidationStatus: 'valid'
    };
  }
});

test('chat rejects insufficient Noa before calling optimizer or intent router', async () => {
  const calls = [];
  const insufficient = Object.assign(new Error('NOA_INSUFFICIENT_FUNDS'), {
    code: 'NOA_INSUFFICIENT_FUNDS',
    statusCode: 402,
    details: { requiredNoa: '0.120000', availableNoa: '0.000000' }
  });
  const controller = createAiController({
    aiService: {},
    errorsRepository: { logError: async () => undefined },
    usersRepository: { findUserById: async () => ({ user_id: 'user-1' }) },
    chatTurnsRepository: createChatTurnRepository(),
    conversationsRepository: {},
    inputOptimizerService: {
      optimizeInput: async () => {
        calls.push('optimizer');
        throw new Error('optimizer must not run');
      }
    },
    intentRouterService: {
      route: async () => {
        calls.push('router');
        throw new Error('router must not run');
      }
    },
    noaBillingService: {
      reserve: async () => {
        calls.push('reserve');
        throw insufficient;
      },
      capture: async () => undefined,
      release: async () => undefined
    },
    jwt: { verify: () => ({ sub: 'user-1' }) },
    jwtSecret: 'test-secret'
  });
  const req = {
    headers: { authorization: 'Bearer valid' },
    body: {
      message: 'سلام، حالت چطوره؟',
      conversationId: 'conversation-1',
      clientMessageId: 'client-message-1'
    }
  };
  const res = createJsonResponse();

  await controller.postChat(req, res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'NOA_INSUFFICIENT_FUNDS');
  assert.deepEqual(calls, ['reserve']);
});

test('unauthenticated chat is rejected before billing or any AI service is called', async () => {
  const calls = [];
  const controller = createAiController({
    aiService: {},
    errorsRepository: { logError: async () => undefined },
    usersRepository: { findUserById: async () => null },
    inputOptimizerService: {
      optimizeInput: async () => calls.push('optimizer')
    },
    intentRouterService: {
      route: async () => calls.push('router')
    },
    noaBillingService: {
      reserve: async () => calls.push('reserve'),
      capture: async () => undefined,
      release: async () => undefined
    },
    jwt: { verify: () => ({}) },
    jwtSecret: 'test-secret'
  });
  const req = {
    headers: {},
    body: {
      message: 'سلام',
      clientMessageId: 'unauthenticated-message-1'
    }
  };
  const res = createJsonResponse();

  await controller.postChat(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'AUTHENTICATION_REQUIRED');
  assert.deepEqual(calls, []);
});

test('chat image routing charges only the final image action path', async () => {
  const calls = [];
  const controller = createAiController({
    aiService: {
      enhanceImagePrompt: async () => {
        calls.push('legacy-image-enhancer');
        throw new Error('legacy enhancer must not run');
      },
      persistImageChatTurn: async () => ({ messages: [] })
    },
    errorsRepository: { logError: async () => undefined },
    usersRepository: { findUserById: async () => ({ user_id: 'user-1' }) },
    chatTurnsRepository: createChatTurnRepository(),
    conversationsRepository: {},
    inputOptimizerService: {
      optimizeInput: async () => {
        calls.push('chat-optimizer');
        throw new Error('chat optimizer must not run for an image action');
      }
    },
    imageGenerationService: { supportsImageEdit: () => true },
    imageGenerationController: {
      createImageTask: async (_req, _res, input) => {
        calls.push('image-task');
        assert.equal(input.enhancedPrompt, '');
        return {
          userId: 'user-1',
          taskId: 'image-task-1',
          status: 'QUEUE',
          noaReservationId: 'image-reservation-1'
        };
      }
    },
    noaBillingService: {
      reserve: async () => {
        calls.push('chat-reserve');
        throw new Error('chat Noa must not be reserved for an image action');
      },
      capture: async () => undefined,
      release: async () => undefined
    },
    jwt: { verify: () => ({ sub: 'user-1' }) },
    jwtSecret: 'test-secret'
  });
  const req = {
    headers: { authorization: 'Bearer valid' },
    body: {
      message: 'یک تصویر گربه فضانورد بساز',
      conversationId: 'conversation-1',
      clientMessageId: 'client-image-1',
      turnId: 'turn-image-1',
      imageIds: []
    }
  };
  const res = createJsonResponse();

  await controller.postChat(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.taskId, 'image-task-1');
  assert.deepEqual(calls, ['image-task']);
});

test('image task reserves and claims idempotency before optimizer and refiner', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      if (sql.includes('SELECT id, task_id, status, noa_reservation_id')) {
        calls.push('lookup');
        return [[]];
      }
      if (sql.includes('INSERT INTO image_generations')) {
        calls.push(sql.includes("'WAITING'") ? 'insert-waiting' : 'insert-wrong-status');
        return [{ insertId: 17 }];
      }
      if (sql.includes("SET prompt = ?, refined_prompt = ?, status = 'QUEUE'")) {
        calls.push('mark-queue');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  };
  const controller = createImageGenerationController({
    imageGenerationService: {},
    imagePromptRefinerService: {
      refine: async () => {
        calls.push('refiner');
        return {
          ok: true,
          refinedPrompt: 'A cat astronaut',
          negativePrompt: '',
          status: 'success',
          metadata: { enabled: true }
        };
      },
      getSettings: async () => ({ storeMetadata: true }),
      mergeNegativePrompts: (...values) => values.filter(Boolean).join(', ')
    },
    inputOptimizerService: {
      optimizeInput: async () => {
        calls.push('optimizer');
        return {
          optimizedTextEn: 'A cat astronaut',
          needsClarification: false,
          status: 'success',
          fallbackUsed: false,
          ambiguityLevel: 'none'
        };
      }
    },
    db,
    noaBillingService: {
      reserve: async () => {
        calls.push('reserve');
        return {
          reservationId: 'image-reservation-1',
          status: 'reserved',
          amountNoa: '1.700000',
          unitPriceNoa: '1.700000'
        };
      },
      capture: async () => undefined,
      release: async () => undefined
    },
    imageRuntimeSettingsResolver: createImageRuntimeSettingsResolver(),
    taskScheduler: () => {
      calls.push('schedule');
    }
  });

  const result = await controller.createImageTask(
    {
      user: { id: 'user-1' },
      headers: {},
      body: { aspectRatio: '1:1' }
    },
    createJsonResponse(),
    {
      prompt: 'یک گربه فضانورد',
      idempotencyKey: 'image-operation-1'
    }
  );

  assert.equal(result.status, 'QUEUE');
  assert.deepEqual(calls, [
    'lookup',
    'reserve',
    'insert-waiting',
    'optimizer',
    'refiner',
    'mark-queue',
    'schedule'
  ]);
});

test('image task releases its Noa reservation when prompt preparation fails', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      if (sql.includes('SELECT id, task_id, status, noa_reservation_id')) return [[]];
      if (sql.includes('INSERT INTO image_generations')) return [{ insertId: 18 }];
      if (sql.includes("SET status = 'ERROR'")) {
        calls.push('mark-error');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  };
  const controller = createImageGenerationController({
    imageGenerationService: {},
    imagePromptRefinerService: {
      refine: async () => {
        calls.push('refiner');
        throw Object.assign(new Error('refiner failed'), { code: 'REFINER_FAILED' });
      }
    },
    db,
    noaBillingService: {
      reserve: async () => ({
        reservationId: 'image-reservation-2',
        status: 'reserved',
        amountNoa: '1.700000',
        unitPriceNoa: '1.700000'
      }),
      capture: async () => undefined,
      release: async (reservationId, options) => {
        calls.push(`release:${reservationId}:${options.reason}`);
        return { status: 'released' };
      }
    },
    imageRuntimeSettingsResolver: createImageRuntimeSettingsResolver(),
    taskScheduler: () => undefined
  });

  await assert.rejects(
    () => controller.createImageTask(
      {
        user: { id: 'user-1' },
        headers: {},
        body: {}
      },
      createJsonResponse(),
      {
        prompt: 'یک منظره آرام',
        optimizerResult: {
          optimizedTextEn: 'A calm landscape',
          needsClarification: false,
          status: 'success',
          fallbackUsed: false
        },
        idempotencyKey: 'image-operation-2'
      }
    ),
    /refiner failed/
  );

  assert.deepEqual(calls, [
    'refiner',
    'release:image-reservation-2:image_preparation_failed',
    'mark-error'
  ]);
});
