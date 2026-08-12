const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');
const logFilePath = path.join(logsDir, 'terminal.txt');

fs.mkdirSync(logsDir, { recursive: true });
const logStream = fs.createWriteStream(logFilePath, { flags: 'w' });

const requestedBackendPort = Number.parseInt(process.env.BACKEND_PORT || '3000', 10);
const backendPort = Number.isInteger(requestedBackendPort) && requestedBackendPort > 0 && requestedBackendPort <= 65535
  ? requestedBackendPort
  : 3000;
const npmCli = process.env.npm_execpath || path.join(
  path.dirname(process.execPath),
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js'
);
const devEnvironment = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development',
  // The `mysql` hostname in backend/.env is the Docker service name. When the
  // backend runs directly on the developer machine, use the published local port.
  LOCAL_DATABASE_HOST: process.env.LOCAL_DATABASE_HOST || '127.0.0.1'
};

const children = new Set();
let shuttingDown = false;

const timestamp = () => {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
};

const writeLine = (name, line, writer = process.stdout) => {
  const output = `[${timestamp()}] ${name}${line ? ` ${line}` : ''}\n`;
  writer.write(output);
  logStream.write(output);
};

const attachOutput = (child, name) => {
  let pending = '';
  const flush = (chunk, writer) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) writeLine(name, line, writer);
  };

  child.stdout.on('data', (chunk) => flush(chunk, process.stdout));
  child.stderr.on('data', (chunk) => flush(chunk, process.stderr));
  child.on('close', () => {
    if (pending) writeLine(name, pending);
  });
};

const startProcess = (name, args, env, { inheritStdin = false } = {}) => {
  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd: rootDir,
    env,
    stdio: [inheritStdin ? 'inherit' : 'ignore', 'pipe', 'pipe']
  });
  children.add(child);
  attachOutput(child, name);
  child.on('error', (error) => {
    writeLine(name, `process error: ${error.message}`, process.stderr);
  });
  child.on('close', () => children.delete(child));
  return child;
};

const isPortOpen = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const finish = (open) => {
    socket.destroy();
    resolve(open);
  };

  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.setTimeout(500, () => finish(false));
});

const waitForPort = (child, port, timeoutMs = 120_000) => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs;
  let settled = false;

  const onClose = (code) => {
    finish(new Error(`Backend exited before becoming ready (code ${code ?? 'unknown'}).`));
  };

  const finish = (error) => {
    if (settled) return;
    settled = true;
    child.removeListener('close', onClose);
    if (error) reject(error);
    else resolve();
  };

  const check = () => {
    if (settled) return;
    if (Date.now() >= deadline) {
      finish(new Error(`Backend did not open port ${port} within ${timeoutMs / 1000} seconds.`));
      return;
    }

    const socket = net.createConnection({ host: '127.0.0.1', port });
    let retried = false;
    const retry = () => {
      if (retried || settled) return;
      retried = true;
      socket.destroy();
      setTimeout(check, 250);
    };

    socket.once('connect', () => {
      socket.destroy();
      finish();
    });
    socket.once('error', retry);
    socket.once('timeout', retry);
    socket.setTimeout(500);
  };

  child.once('close', onClose);
  check();
});

const stopChildren = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
};

process.once('SIGINT', () => {
  stopChildren();
  logStream.end(() => process.exit(130));
});

process.once('SIGTERM', () => {
  stopChildren();
  logStream.end(() => process.exit(143));
});

const run = async () => {
  try {
    if (await isPortOpen(backendPort)) {
      throw new Error(`Port ${backendPort} is already in use. Stop the existing backend before running dev.`);
    }

    const backend = startProcess(
      'BACKEND',
      ['run', 'dev', '--prefix', 'backend'],
      { ...devEnvironment, PORT: String(backendPort) },
      { inheritStdin: true }
    );

    writeLine('DEV', `waiting for backend on http://127.0.0.1:${backendPort}...`);
    await waitForPort(backend, backendPort);
    writeLine('DEV', 'backend is ready; starting frontend');
    const frontend = startProcess('FRONTEND', ['run', 'dev', '--prefix', 'frontend'], devEnvironment);

    await new Promise((resolve) => {
      frontend.once('close', resolve);
      backend.once('close', resolve);
    });
  } catch (error) {
    writeLine('DEV', error instanceof Error ? error.message : String(error), process.stderr);
    process.exitCode = 1;
  } finally {
    stopChildren();
    logStream.end();
  }
};

run().catch((error) => {
  writeLine('DEV', error instanceof Error ? error.message : String(error), process.stderr);
  stopChildren();
  logStream.end(() => process.exit(1));
});
