import { ExpoError, SystemError, UserError } from '@expo/eas-build-job';
import { once } from 'node:events';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import {
  runServeSimActionAsync,
  runServeSimActionWithResultAsync,
  stageServeSimAppAsync,
} from '../serveSimActions';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

let server: WebSocketServer;
let port: number;
const token = 'test-session-token';
const request = () => ({
  port,
  token,
  action: 'app.install',
  params: { udid: 'device', path: '/tmp/App.app' },
  timeoutMs: 2_000,
});

beforeEach(async () => {
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  for (const socket of server.clients) {
    socket.terminate();
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
});

it('authenticates the upgrade, waits for ready, and sends the action once', async () => {
  const actions: unknown[] = [];
  const upgrades: unknown[] = [];
  server.on('connection', (socket, upgrade) => {
    upgrades.push({
      url: upgrade.url,
      protocol: upgrade.headers['sec-websocket-protocol'],
    });
    socket.on('message', raw => {
      actions.push(JSON.parse(raw.toString()));
      socket.send(JSON.stringify({ id: 1, stdout: '', stderr: '', exitCode: 0 }));
    });
    socket.send(JSON.stringify({ ready: true }));
    socket.send(JSON.stringify({ ready: true }));
  });
  await runServeSimActionAsync(request());
  expect(upgrades).toEqual([{ url: '/exec-ws', protocol: `serve-sim.token.${token}` }]);
  expect(actions).toEqual([{ id: 1, action: 'app.install', params: request().params }]);
});

it('returns stdout from an authenticated action for catalog inspection', async () => {
  server.on('connection', socket => {
    socket.on('message', () =>
      socket.send(JSON.stringify({ id: 1, stdout: '{"actions":[]}', exitCode: 0 }))
    );
    socket.send(JSON.stringify({ ready: true }));
  });
  await expect(
    runServeSimActionWithResultAsync({ ...request(), action: 'actions.describe', params: {} })
  ).resolves.toBe('{"actions":[]}');
});

it.each([
  [{ id: 1, exitCode: 1, stderr: 'install refused' }, 'install refused'],
  [{ id: 1, error: 'unknown action app.install' }, 'unknown action'],
  [{ id: 1, stdout: '' }, 'invalid response'],
  [{ id: 1, exitCode: 1, stderr: '' }, 'invalid response'],
])('rejects unsuccessful action replies without retrying', async (reply, message) => {
  let attempts = 0;
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => {
      attempts++;
      socket.send(JSON.stringify(reply));
    });
  });
  await expect(runServeSimActionAsync(request())).rejects.toThrow(message);
  expect(attempts).toBe(1);
});

// Shaped like `xcrun simctl install` output for an app whose minimum iOS version is above the Simulator runtime.
const NEWER_IOS_REQUIRED_STDERR = [
  'An error was encountered processing the command (domain=IXUserPresentableErrorDomain):',
  'Requires a Newer Version of iOS',
  '“Example” requires a newer version of iOS.',
].join('\n');

const INCOMPATIBLE_ARCH_STDERR = [
  'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=4):',
  'App installation failed: “AIRIS” Needs to Be Updated',
  'This app needs to be updated by the developer to work on this version of iOS.',
  'Failed to find matching arch for input file: /tmp/serve-sim-uploads/eas-app-123/AIRIS.app/AIRIS',
].join('\n');

const INCOMPATIBLE_ARCH_PLATFORM_STDERR = [
  'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=4):',
  'The bundle at /tmp/Example.app does not contain code for any platform and CPU architecture combination supported by this device.',
].join('\n');

const INCOMPATIBLE_ARCH_CODE_4_ONLY_STDERR = [
  'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=4):',
  'App installation failed: “Example” Needs to Be Updated',
  'This app needs to be updated by the developer to work on this version of iOS.',
].join('\n');

const INCOMPATIBLE_DEVICE_FAMILY_STDERR = [
  'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=6):',
  'App installation failed: Unable to Install “ClinicTVApp”',
  'This app is not made for this device.',
  'This app was not built to support this device family; app is compatible with (',
  '    3',
  ') but this device supports (',
  '    1',
  ')',
].join('\n');

const UNREGISTERED_URL_SCHEME_STDERR = [
  'simctl openurl: An error was encountered processing the command (domain=LSApplicationWorkspaceErrorDomain, code=115):',
  'Simulator device failed to open exp+clad-next://expo-development-client/?url=https%3A%2F%2Fexample.test',
  'Underlying error (domain=LSApplicationWorkspaceErrorDomain, code=115):',
  '    The operation couldn’t be completed. (LSApplicationWorkspaceErrorDomain error 115.)',
].join('\n');

async function rejectActionAsync(action: string, stderr: string): Promise<ExpoError> {
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => socket.send(JSON.stringify({ id: 1, exitCode: 1, stderr })));
  });
  const error = await runServeSimActionAsync({ ...request(), action }).catch(err => err);
  expect(error).toBeInstanceOf(ExpoError);
  return error;
}

it.each([
  ['unprefixed title', NEWER_IOS_REQUIRED_STDERR],
  [
    'quoted app name title',
    [
      'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=2):',
      'App installation failed: “Example” Requires a Newer Version of iOS',
      '“Example” requires a newer version of iOS.',
    ].join('\n'),
  ],
])(
  'classifies an app install that requires a newer iOS version (%s) as a user error',
  async (_, stderr) => {
    const error = await rejectActionAsync('app.install', stderr);
    expect(error).toBeInstanceOf(UserError);
    expect(error.toExternalExpoError()).toMatchObject({
      errorCode: 'EAS_INSTALL_APPLICATION_REQUIRES_NEWER_IOS',
      message: expect.stringContaining('Choose an iOS Simulator device whose iOS version meets'),
    });
    expect((error.cause as Error).message).toContain('Requires a Newer Version of iOS');
  }
);

it.each([
  ['matching arch failure', INCOMPATIBLE_ARCH_STDERR],
  ['missing platform/arch combination', INCOMPATIBLE_ARCH_PLATFORM_STDERR],
  ['IXUserPresentableErrorDomain code=4 Needs to Be Updated', INCOMPATIBLE_ARCH_CODE_4_ONLY_STDERR],
  [
    'IXUserPresentableErrorDomain error 4 Needs to Be Updated',
    'App installation failed: “Example” Needs to Be Updated (IXUserPresentableErrorDomain error 4.)',
  ],
])(
  'classifies an incompatible architecture app install (%s) as a user error',
  async (_, stderr) => {
    const error = await rejectActionAsync('app.install', stderr);
    expect(error).toBeInstanceOf(UserError);
    expect(error.toExternalExpoError()).toMatchObject({
      errorCode: 'EAS_INSTALL_APPLICATION_INCOMPATIBLE_ARCH',
      message: expect.stringContaining('compatible iOS Simulator CPU architecture'),
    });
    expect((error.cause as Error).message).toBe(`serve-sim app.install failed: ${stderr}`);
  }
);

it.each([
  ['full device family stderr', INCOMPATIBLE_DEVICE_FAMILY_STDERR],
  [
    'not made for this device only',
    'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=6):\nThis app is not made for this device.',
  ],
  [
    'not built to support device family only',
    'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=6):\nThis app was not built to support this device family; app is compatible with (2) but this device supports (1)',
  ],
  [
    'app name containing incompatible arch phrase',
    [
      'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=6):',
      'App installation failed: Unable to Install “Failed to find matching arch”',
      'This app is not made for this device.',
    ].join('\n'),
  ],
  [
    'app name containing newer iOS phrase',
    [
      'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=6):',
      'App installation failed: Unable to Install “Requires a Newer Version of iOS”',
      'This app is not made for this device.',
    ].join('\n'),
  ],
  [
    'app name containing IXUserPresentableErrorDomain code 4 and Needs to Be Updated',
    [
      'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=6):',
      'App installation failed: Unable to Install “IXUserPresentableErrorDomain error 4 Needs to Be Updated”',
      'This app is not made for this device.',
    ].join('\n'),
  ],
  [
    'indented Unable to Install title containing platform/arch phrase',
    [
      'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=6):',
      '    Unable to Install “does not contain code for any platform and CPU architecture combination”',
      'This app is not made for this device.',
    ].join('\n'),
  ],
])(
  'classifies an incompatible device family app install (%s) as a user error',
  async (_, stderr) => {
    const error = await rejectActionAsync('app.install', stderr);
    expect(error).toBeInstanceOf(UserError);
    expect(error.toExternalExpoError()).toMatchObject({
      errorCode: 'EAS_INSTALL_APPLICATION_INCOMPATIBLE_DEVICE_FAMILY',
      message: expect.stringContaining('selected iOS Simulator device family'),
    });
    expect((error.cause as Error).message).toBe(`serve-sim app.install failed: ${stderr}`);
  }
);

it.each([
  ['app.launch', UNREGISTERED_URL_SCHEME_STDERR],
  [
    'app.launch',
    'An error was encountered processing the command (domain=LSApplicationWorkspaceErrorDomain, code=115):\nSimulator device failed to open myapp://home',
  ],
  [
    'app.launch',
    'simctl openurl: The operation couldn’t be completed. (LSApplicationWorkspaceErrorDomain error 115.)',
  ],
  ['app.openurl', UNREGISTERED_URL_SCHEME_STDERR],
])('classifies an unregistered URL scheme on %s as a user error', async (action, stderr) => {
  const error = await rejectActionAsync(action, stderr);
  expect(error).toBeInstanceOf(UserError);
  expect(error.toExternalExpoError()).toMatchObject({
    errorCode: 'EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME',
    message: expect.stringContaining('registers the URL scheme specified in open_url'),
  });
  expect((error.cause as Error).message).toBe(`serve-sim ${action} failed: ${stderr}`);
});

it.each([
  [
    'app.install',
    'An error was encountered processing the command (domain=IXUserPresentableErrorDomain):\nThis app could not be installed at this time.',
  ],
  [
    'app.install',
    'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=4):\nThis app could not be installed at this time.',
  ],
  [
    'app.install',
    'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=40):\nApp installation failed: “Example” Needs to Be Updated',
  ],
  [
    'app.install',
    'An error was encountered processing the command (domain=IXUserPresentableErrorDomain, code=6):\nThis app could not be installed at this time.',
  ],
  ['app.install', UNREGISTERED_URL_SCHEME_STDERR],
  ['app.install', 'install refused'],
  ['app.launch', NEWER_IOS_REQUIRED_STDERR],
  ['app.launch', INCOMPATIBLE_ARCH_STDERR],
  ['app.launch', INCOMPATIBLE_DEVICE_FAMILY_STDERR],
  [
    'app.launch',
    'simctl openurl: An error was encountered processing the command (domain=LSApplicationWorkspaceErrorDomain, code=114):\nSimulator device failed to open myapp://home',
  ],
  [
    'app.launch',
    'simctl openurl: An error was encountered processing the command (domain=LSApplicationWorkspaceErrorDomain, code=1150):\nSimulator device failed to open myapp://home',
  ],
  [
    'app.launch',
    [
      'simctl openurl: An error was encountered processing the command (domain=LSApplicationWorkspaceErrorDomain, code=114):',
      'Simulator device failed to open myapp://host/?domain=LSApplicationWorkspaceErrorDomain,code=115&(domain=LSApplicationWorkspaceErrorDomain, code=115)',
      'Underlying error (domain=LSApplicationWorkspaceErrorDomain, code=114):',
      '    The operation couldn’t be completed. (LSApplicationWorkspaceErrorDomain error 114.)',
    ].join('\n'),
  ],
])('keeps other %s failures as server errors', async (action, stderr) => {
  const error = await rejectActionAsync(action, stderr);
  expect(error).toBeInstanceOf(SystemError);
  expect(error.toExternalExpoError()).toMatchObject({
    errorCode: 'SERVER_ERROR',
    message: `serve-sim ${action} failed: ${stderr}`,
  });
});

it('rejects a connection that closes before its action finishes', async () => {
  server.on('connection', socket => socket.close());
  await expect(runServeSimActionAsync(request())).rejects.toThrow('closed before completion');
});

it('rejects an upgrade refused by the server without executing an action', async () => {
  const connected = jest.fn();
  server.options.verifyClient = () => false;
  server.on('connection', connected);
  await expect(runServeSimActionAsync(request())).rejects.toThrow('connection failed');
  expect(connected).not.toHaveBeenCalled();
});

it('rejects malformed replies without resending the action', async () => {
  const actions = jest.fn();
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => {
      actions();
      socket.send('not JSON');
    });
  });
  await expect(runServeSimActionAsync(request())).rejects.toThrow('returned invalid JSON');
  expect(actions).toHaveBeenCalledTimes(1);
});

it('times out and closes a socket that never becomes ready', async () => {
  const disconnected = new Promise(resolve =>
    server.on('connection', socket => socket.on('close', resolve))
  );
  await expect(runServeSimActionAsync({ ...request(), timeoutMs: 30 })).rejects.toThrow(
    'timed out'
  );
  await disconnected;
});

it('aborts an in-flight action without resending it', async () => {
  const controller = new AbortController();
  let attempts = 0;
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => {
      attempts++;
      controller.abort(new Error('session stopped'));
    });
  });
  await expect(runServeSimActionAsync({ ...request(), signal: controller.signal })).rejects.toThrow(
    'session stopped'
  );
  expect(attempts).toBe(1);
});

it('cancels before dispatch while waiting for ready in drain mode', async () => {
  const controller = new AbortController();
  const actions = jest.fn();
  server.on('connection', socket => {
    socket.on('message', actions);
    controller.abort(new Error('stopped before ready'));
    socket.send(JSON.stringify({ ready: true }));
  });
  await expect(
    runServeSimActionAsync({
      ...request(),
      signal: controller.signal,
      drainAfterDispatch: true,
    })
  ).rejects.toThrow('stopped before ready');
  expect(actions).not.toHaveBeenCalled();
});

it('drains dispatched actions after cancellation in drain mode', async () => {
  const controller = new AbortController();
  let reply!: () => void;
  let dispatched!: () => void;
  const ready = new Promise<void>(resolve => {
    dispatched = resolve;
  });
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => {
      reply = () => socket.send(JSON.stringify({ id: 1, stdout: 'completed', exitCode: 0 }));
      dispatched();
    });
  });
  let settled = false;
  const action = runServeSimActionAsync({
    ...request(),
    signal: controller.signal,
    drainAfterDispatch: true,
  });
  void action.finally(() => {
    settled = true;
  });
  await ready;
  controller.abort(new Error('stopped after dispatch'));
  await new Promise(resolve => setImmediate(resolve));
  expect(settled).toBe(false);
  reply();
  await expect(action).resolves.toBeUndefined();
});

it('does not connect when already aborted', async () => {
  const connected = jest.fn();
  server.on('connection', connected);
  await expect(
    runServeSimActionAsync({
      ...request(),
      signal: AbortSignal.abort(new Error('already stopped')),
    })
  ).rejects.toThrow('already stopped');
  expect(connected).not.toHaveBeenCalled();
});

it("stages a local app without consuming the caller's original", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-stage-test-'));
  try {
    const source = path.join(root, 'downloaded', 'App.app');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'marker'), 'app');
    await symlink('marker', path.join(source, 'current'));
    const alias = path.join(root, 'Alias.app');
    await symlink(source, alias);
    const staged = await stageServeSimAppAsync(alias, root);
    expect(staged.path).toMatch(/serve-sim-uploads\/eas-app-[^/]+\/Alias.app$/);
    expect((await lstat(staged.path)).isDirectory()).toBe(true);
    await access(path.join(staged.path, 'marker'));
    expect(await readlink(path.join(staged.path, 'current'))).toBe('marker');
    expect((await stat(path.join(root, 'serve-sim-uploads'))).mode & 0o777).toBe(0o700);
    await rm(staged.directory, { recursive: true, force: true });
    expect(await readFile(path.join(source, 'marker'), 'utf8')).toBe('app');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('removes its staging directory when the source app cannot be read', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-stage-test-'));
  try {
    await expect(stageServeSimAppAsync(path.join(root, 'Missing.app'), root)).rejects.toThrow(
      'ENOENT'
    );
    expect(await readdir(path.join(root, 'serve-sim-uploads'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
