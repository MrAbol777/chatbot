'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { DatabaseClient } = require('../src/repositories/DatabaseClient');
const { createVideoInputMediaModule } = require('../src/modules/video-generation/input-media/video-input-media.module');

function gatewayPort(env = process.env) {
  const value = Number(env.VIDEO_PROVIDER_GATEWAY_PORT || 3100);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535) throw new Error('VIDEO_PROVIDER_GATEWAY_PORT must be between 1024 and 65535.');
  return value;
}

function createGatewayApp({ db, env = process.env }) {
  const app = express();
  const inputMedia = createVideoInputMediaModule({ db, env });
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: () => 'signed-video-provider-input'
  }));
  app.use('/api/video-provider-input', inputMedia.publicRouter);
  app.use((_req, res) => res.status(404).end());
  return app;
}

async function main({ env = process.env } = {}) {
  const db = new DatabaseClient({ databaseUrl: String(env.DATABASE_URL || '').trim() });
  const port = gatewayPort(env);
  const app = createGatewayApp({ db, env });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  console.log(JSON.stringify({ event: 'video_provider_input_gateway_started', bind: '127.0.0.1', port, exposedRoutes: ['/api/video-provider-input/:opaqueToken'] }));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void close().finally(() => process.exit(0)));
  return { app, server, db, close };
}

if (require.main === module) {
  dotenv.config({ path: path.join(__dirname, '../.env') });
  main({ env: process.env }).catch((error) => { console.error(`Video provider input gateway failed: ${error.message}`); process.exitCode = 1; });
}
module.exports = { createGatewayApp, gatewayPort, main };
