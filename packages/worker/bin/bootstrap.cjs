// This entry point must only load Node built-ins before the startup shell runs.
const { spawn } = require('node:child_process');
const path = require('node:path');

const worker = spawn(
  '/bin/bash',
  [
    path.join(__dirname, 'start-worker.sh'),
    process.execPath,
    ...process.execArgv,
    path.join(__dirname, '../dist/main.js'),
    ...process.argv.slice(2),
  ],
  { stdio: process.send ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit' }
);

const signals = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
  process.on(signal, () => worker.kill(signal));
}

// Retain the readiness channel used by process managers in development.
if (process.send) {
  worker.on('message', message => {
    if (process.connected) {
      process.send(message, () => {});
    }
  });
  process.on('message', message => {
    if (worker.connected) {
      worker.send(message, () => {});
    }
  });
  process.on('disconnect', () => {
    if (worker.connected) {
      worker.disconnect();
    }
  });
}

worker.on('error', error => {
  process.stderr.write(`Worker startup failed: ${error.stack ?? error}\n`, () => process.exit(1));
});
worker.on('exit', (code, signal) => {
  if (signal) {
    for (const forwarded of signals) {
      process.removeAllListeners(forwarded);
    }
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
