const now = () => new Date().toISOString();

const log = (scope, message, meta) => {
  if (meta && typeof meta === 'object') {
    console.log(`[${now()}] [${scope}] ${message} ${JSON.stringify(meta)}`);
    return;
  }
  console.log(`[${now()}] [${scope}] ${message}`);
};

function attachProcessErrorLogging() {
  process.on('uncaughtException', (error) => {
    console.error('[FATAL] uncaughtException', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection', reason);
  });
}

module.exports = {
  now,
  log,
  attachProcessErrorLogging
};
