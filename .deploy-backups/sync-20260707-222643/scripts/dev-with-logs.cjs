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
const command = `"${concurrentlyCmd}" --names "FRONTEND,BACKEND" --prefix "[{time}] {name}" --timestamp-format "HH:mm:ss" "npm run dev --prefix frontend" "npm run dev --prefix backend"`;

const child = spawn(command, {
  cwd: rootDir,
  env: process.env,
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
