/* eslint-disable no-console -- This standalone demo prints CLI exchanges. */
// Runs the built CLI with simulated HTTP responses and an isolated temporary home.
// Every step is a new process with stdin closed, like separate agent tool calls.
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-device-demo-'));
const preload = path.join(__dirname, 'fixtures/device-login-preload.cjs');
const binary = path.join(__dirname, '../bin/run');
let time = Date.now();

function run(phase, flags = [], expectedExit = 0) {
  const args = ['--require', preload, binary, 'login', ...flags];
  console.log(`\n$ eas login ${flags.join(' ')}`);
  let stdout;
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      env: {
        ...process.env,
        EXPO_TOKEN: '',
        EXPO_STAGING: '',
        EXPO_LOCAL: '1',
        DISABLE_EAS_ANALYTICS: '1',
        EAS_DEVICE_DEMO_DIRECTORY: directory,
        EAS_DEVICE_DEMO_PHASE: phase,
        EAS_DEVICE_DEMO_TIME: String((time += 10000)),
      },
    });
  } catch (error) {
    code = error.status;
    stdout = error.stdout;
    if (code !== expectedExit) {
      process.stderr.write(error.stderr || '');
    }
  }
  assert.equal(code, expectedExit);
  if (expectedExit && !stdout.trim().startsWith('{')) {
    console.log(`Expected validation failure (exit ${code}).`);
    return;
  }
  assert(!stdout.includes('DEMO_PRIVATE'));
  const result = JSON.parse(stdout);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

try {
  console.log(
    'OFFLINE DEMO — simulated browser/API, real built CLI, a fresh process for each step.'
  );
  const start = run('start', ['--device', '--json']);
  assert.equal(start.status, 'authorization_pending');
  const resumeFlags = ['--device', '--json', '--resume', start.request_id];
  assert.equal(run('pending', resumeFlags).status, 'authorization_pending');
  console.log('\nSimulated user approves in the browser, which displays 42.');
  assert.equal(run('matching', resumeFlags).status, 'matching_required');
  console.log('\nSimulated next chat turn: user replies “42”.');
  assert.equal(run('finish', [...resumeFlags, '--match', '42']).status, 'authenticated');
  const state = JSON.parse(fs.readFileSync(path.join(directory, '.expo-local/state.json'), 'utf8'));
  assert.equal(state.auth.username, 'demo-user');
  assert.equal(state.auth.sessionSecret, 'DEMO_PRIVATE_SESSION');
  assert.deepEqual(fs.readdirSync(path.join(directory, '.expo-local/device-login')), []);
  // Reset only the fixture session, then exercise command failure contracts.
  delete state.auth;
  fs.writeFileSync(path.join(directory, '.expo-local/state.json'), JSON.stringify(state));
  const denied = run('start', ['--device', '--json']);
  assert.equal(
    run('denied', ['--device', '--json', '--resume', denied.request_id, '--match', '12'], 1).status,
    'access_denied'
  );
  run('start', ['--device'], 1);
  run('start', ['--json'], 1);
  console.log(
    '\nPASS: process restart, number matching, saved session, cleanup, terminal failure, and non-TTY/flag validation.'
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
