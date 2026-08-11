const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');
const logFilePath = path.join(logsDir, 'terminal.txt');

fs.mkdirSync(logsDir, { recursive: true });
const logStream = fs.createWriteStream(logFilePath, { flags: 'w' });

const concurrentlyBin = path.join(rootDir, 'node_modules', '.bin', 'concurrently');
const concurrentlyCmd = process.platform === 'win32' ? `${concurrentlyBin}.cmd` : concurrentlyBin;
const requestedBackendPort = Number.parseInt(process.env.BACKEND_PORT || '3000', 10);
const backendPort = Number.isInteger(requestedBackendPort) && requestedBackendPort > 0 && requestedBackendPort <= 65535
  ? String(requestedBackendPort)
  : '3000';
const backendCommand = process.platform === 'win32'
  ? `set PORT=${backendPort}&& npm run dev --prefix backend`
  : `PORT=${backendPort} npm run dev --prefix backend`;
const command = `"${concurrentlyCmd}" --names "FRONTEND,BACKEND" --prefix "[{time}] {name}" --timestamp-format "HH:mm:ss" "npm run dev --prefix frontend" "${backendCommand}"`;
const devEnvironment = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development',
  // The `mysql` hostname in backend/.env is the Docker service name. When the
  // backend runs directly on the developer machine, use the published local port.
  LOCAL_DATABASE_HOST: process.env.LOCAL_DATABASE_HOST || '127.0.0.1'
};

const child = spawn(command, {
  cwd: rootDir,
  env: devEnvironment,
  shell: true,
  stdio: ['inherit', 'pipe', 'pipe']
});

const writeChunk = (chunk, writer) => {
  writer.write(chunk);
  logStream.write(chunk);
};

child.stdout.on('data', (chunk) => writeChunk(chunk, process.stdout));
child.stderr.on('data', (chunk) => writeChunk(chunk, process.stderr));

child.on('error', (error) => {
  const message = `[dev-with-logs] Failed to start concurrently: ${error.message}\n`;
  process.stderr.write(message);
  logStream.write(message);
  logStream.end();
  process.exit(1);
});

child.on('close', (code) => {
  logStream.end();
  process.exit(code ?? 0);
});
