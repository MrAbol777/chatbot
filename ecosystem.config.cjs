'use strict';

// No secret belongs in this file. PM2 inherits configuration from the service
// environment file managed on the host.
module.exports = {
  apps: [
    {
      name: 'danoa-api',
      cwd: './backend',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', VIDEO_GENERATION_WORKER_MODE: 'dedicated', VIDEO_GENERATION_ENABLED: '0' },
      out_file: '../logs/danoa-api.out.log',
      error_file: '../logs/danoa-api.error.log',
      merge_logs: true,
      kill_timeout: 15000
    },
    {
      name: 'danoa-video-worker',
      cwd: './backend',
      script: 'scripts/run-video-worker.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '384M',
      env: { NODE_ENV: 'production', VIDEO_GENERATION_WORKER_MODE: 'dedicated', VIDEO_GENERATION_ENABLED: '0' },
      out_file: '../logs/danoa-video-worker.out.log',
      error_file: '../logs/danoa-video-worker.error.log',
      merge_logs: true,
      kill_timeout: 15000
    }
  ]
};
