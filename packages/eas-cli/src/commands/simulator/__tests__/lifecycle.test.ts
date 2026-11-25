import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// CI typechecks the workspace before Jest, emitting the packaged command. Local runs
// use the dev entrypoint so a stale build cannot hide changes to the TypeScript source.
const cli = path.resolve(__dirname, '../../../..');
const bin = path.join(cli, 'bin', process.env.GITHUB_ACTIONS === 'true' ? 'run' : 'dev');
const api = path.join(__dirname, 'fixtures/lifecycle-api.cjs');
const start = { event: 'start' };
const allocated = { event: 'allocated', id: 'session-123' };
const requestId = '86c52eaa-ef2c-42b0-b638-d93c68c6af5a';
const prefix = `EAS_SIMULATOR_LIFECYCLE ${requestId} `;

function runStart(scenario: string, { enabled = true, json = true } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-start-'));
  try {
    fs.writeFileSync(path.join(cwd, 'package.json'), '{}');
    fs.writeFileSync(
      path.join(cwd, 'app.json'),
      JSON.stringify({
        expo: {
          name: 'testapp',
          slug: 'testapp',
          sdkVersion: '55.0.0',
          extra: { eas: { projectId: 'app-123' } },
        },
      })
    );
    const result = spawnSync(
      process.execPath,
      [
        '-r',
        api,
        bin,
        'simulator',
        '--platform',
        'ios',
        '--type',
        'agent-device',
        '--non-interactive',
        ...(json ? ['--json'] : []),
      ],
      {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          PATH: process.env.PATH,
          HOME: cwd,
          USERPROFILE: cwd,
          SystemRoot: process.env.SystemRoot,
          EXPO_LOCAL: '1',
          EXPO_TOKEN: 'fixture',
          EAS_NO_VCS: '1',
          EAS_PROJECT_ROOT: cwd,
          DISABLE_EAS_ANALYTICS: '1',
          EAS_SIMULATOR_LIFECYCLE: enabled ? requestId : '',
          FIXTURE_SCENARIO: scenario,
        },
      }
    );
    if (result.error) {
      throw result.error;
    }
    const events = result.stderr
      .split('\n')
      .filter(line => line.startsWith(prefix))
      .map(line => JSON.parse(line.slice(prefix.length)));
    const dotenv = path.join(cwd, '.env.eas-simulator');
    return {
      ...result,
      events,
      dotenv: fs.existsSync(dotenv) ? fs.readFileSync(dotenv, 'utf8') : '',
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

it.each([
  ['auth-error', 'fixture auth error'],
  ['create-error', 'fixture create error'],
])('reports no allocation on %s', (scenario, message) => {
  const result = runStart(scenario);
  expect(result.stderr).toContain(message);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.events).toEqual([start]);
});

it('reports the allocation even when the create response is missing the job', () => {
  const result = runStart('missing-job');
  expect(result.stderr).toContain('Expected simulator session to start');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.events).toEqual([start, allocated]);
});

it.each([
  ['poll-error', 'stopped'],
  ['stop-error', 'unknown'],
  ['still-running', 'unknown'],
])('reports the allocation before polling and the cleanup outcome on %s', (scenario, outcome) => {
  const json = scenario === 'still-running';
  const result = runStart(scenario, { json });
  expect(result.stderr).toContain('fixture readiness error');
  expect(result.status).toBe(1);
  if (json) {
    expect(result.stdout).toBe('');
  } else {
    expect(result.dotenv.includes('session-123')).toBe(outcome === 'unknown');
  }
  expect(result.events).toEqual([
    start,
    allocated,
    { event: 'cleanup', id: 'session-123', outcome },
  ]);
  expect(result.stderr.indexOf(prefix + JSON.stringify(allocated))).toBeLessThan(
    result.stderr.indexOf('fixture: polling readiness')
  );
});

it('preserves the final JSON result with and without lifecycle output', () => {
  const enabled = runStart('ready');
  const disabled = runStart('ready', { enabled: false });
  expect(enabled.status).toBe(0);
  expect(disabled.status).toBe(0);
  expect(enabled.events).toEqual([start, allocated]);
  expect(disabled.events).toEqual([]);
  expect(JSON.parse(enabled.stdout)).toMatchObject({
    id: 'session-123',
    type: 'agent-device',
    remoteConfig: { agentDeviceRemoteSessionUrl: 'https://agent.example.com' },
  });
  expect(enabled.stdout).toBe(disabled.stdout);
});
