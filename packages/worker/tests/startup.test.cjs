const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function archive(t, main, shell) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-startup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worker = path.join(root, 'packages/worker');
  fs.mkdirSync(path.join(worker, 'dist'), { recursive: true });
  fs.cpSync(path.join(__dirname, '../bin'), path.join(worker, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(worker, 'dist/main.js'), main);
  if (shell) {
    fs.writeFileSync(path.join(worker, 'bin/start-worker.sh'), shell);
  }
  // Exercise the path that existing images run, including Node's symlink resolution.
  const legacy = path.join(root, 'src/services/worker/dist/main.js');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.symlinkSync('../../../../packages/worker/bin/bootstrap.cjs', legacy);
  return legacy;
}

function launch(t, entry, args = []) {
  const child = spawn(process.execPath, [entry, ...args], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  });
  return child;
}

test(
  'startup settings reach the worker before its first module runs',
  { timeout: 10000 },
  async t => {
    const entry = archive(
      t,
      'process.send({ ready: true, args: process.argv.slice(2), setting: process.env.STARTUP_TEST }); process.on("message", () => process.exit(7));',
      '#!/bin/bash\nset -euo pipefail\nexport STARTUP_TEST=installed\nexec "$@"\n'
    );
    const child = launch(t, entry, ['argument with spaces']);
    const exited = once(child, 'exit');
    assert.deepEqual((await once(child, 'message'))[0], {
      ready: true,
      args: ['argument with spaces'],
      setting: 'installed',
    });
    child.send('stop');
    assert.deepEqual(await exited, [7, null]);
  }
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`forwards ${signal} and preserves termination status`, { timeout: 10000 }, async t => {
    const entry = archive(t, 'process.send("ready"); setInterval(() => {}, 1000);');
    const child = launch(t, entry);
    const exited = once(child, 'exit');
    await once(child, 'message');
    child.kill(signal);
    assert.deepEqual(await exited, [null, signal]);
  });
}

test('startup failure prevents loading the worker', { timeout: 10000 }, async t => {
  const entry = archive(
    t,
    'process.send("must not start");',
    '#!/bin/bash\nset -euo pipefail\nexit 42\nexec "$@"\n'
  );
  const child = launch(t, entry);
  const messages = [];
  child.on('message', message => messages.push(message));
  assert.deepEqual(await once(child, 'exit'), [42, null]);
  assert.deepEqual(messages, []);
});

test('runs without IPC and retains stdout, stderr, and exit code', { timeout: 10000 }, async t => {
  const entry = archive(
    t,
    'console.log("worker output"); console.error("worker error"); process.exit(9);'
  );
  const child = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => {
    stdout += data;
  });
  child.stderr.on('data', data => {
    stderr += data;
  });
  assert.deepEqual(await once(child, 'close'), [9, null]);
  assert.equal(stdout, 'worker output\n');
  assert.equal(stderr, 'worker error\n');
});
