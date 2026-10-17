import { Config } from '@oclif/core';
import * as fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  DeviceRunSessionByIdQuery,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
  JobRunStatus,
} from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { EAS_SIMULATOR_SESSION_ID, loadSimulatorEnvAsync } from '../../../simulator/env';
import * as controlSession from '../../../simulator/controlSession';
import { runControlMenuAsync } from '../../../simulator/controlInteractive';
import { ControlPromptCancelledError } from '../../../simulator/controlPrompts';
import {
  HostActionCatalog,
  HostActionResult,
  connectHostActionsAsync,
  fetchHostActionDeviceAsync,
} from '../../../simulator/hostActions';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorControl from '../control';

jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../simulator/hostActions', () => ({
  ...jest.requireActual('../../../simulator/hostActions'),
  connectHostActionsAsync: jest.fn(),
  fetchHostActionDeviceAsync: jest.fn(),
}));
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => {
    const spinner = {
      fail: jest.fn(),
      start: jest.fn(),
      succeed: jest.fn(),
    };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));
jest.mock('../../../utils/json');
jest.mock('../../../simulator/controlInteractive');

type DeviceRunSessionById = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];

const catalog: HostActionCatalog = require('../../../simulator/__tests__/fixtures/hostActionCatalog.json');

const mockByIdAsync = jest.mocked(DeviceRunSessionQuery.byIdAsync);
const mockConnectHostActionsAsync = jest.mocked(connectHostActionsAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function makeDeviceRunSession(
  overrides: Partial<DeviceRunSessionById> = {}
): DeviceRunSessionById & { publicPreview: boolean } {
  return {
    id: 'session-123',
    name: null,
    tags: [],
    publicPreview: false,
    status: DeviceRunSessionStatus.InProgress,
    type: DeviceRunSessionType.WebPreviewOnly,
    platform: AppPlatform.Ios,
    createdAt: '2025-01-01T00:00:00.000Z',
    startedAt: '2025-01-01T00:00:05.000Z',
    finishedAt: null,
    updatedAt: '2025-01-01T00:01:00.000Z',
    app: {
      id: 'app-123',
      slug: 'testapp',
      ownerAccount: { id: 'account-123', name: 'testuser' },
    },
    artifacts: [],
    remoteConfig: {
      __typename: 'WebPreviewOnlyRunSessionRemoteConfig',
      previewUrl: 'https://expo.dev/preview',
      previewToken: 'preview-token',
      previewApiUrl: 'https://sim.example.test',
    },
    turtleJobRun: { id: 'job-123', status: JobRunStatus.InProgress },
    ...overrides,
  };
}

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(SimulatorControl, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectDir = '/test/project';
  const ok = (stdout: string): HostActionResult => ({ stdout, stderr: '', exitCode: 0 });
  let actionResult: HostActionResult;
  let served: HostActionCatalog;
  let tmpDir: string;
  let connectionController: AbortController;
  const requestAsync = jest.fn(
    async (action: string, params: Record<string, unknown> = {}): Promise<HostActionResult> => {
      switch (action) {
        case 'actions.describe':
          return ok(JSON.stringify(served));
        case 'upload.append':
          return ok(`/tmp/serve-sim-uploads/${params.uploadId}\n`);
        case 'upload.remove':
          return ok('');
        case 'file.readBase64':
          return ok(Buffer.from('png bytes').toString('base64'));
        default:
          return actionResult;
      }
    }
  );
  const close = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.mocked(loadSimulatorEnvAsync).mockResolvedValue();
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession());
    jest
      .mocked(fetchHostActionDeviceAsync)
      .mockResolvedValue({ udid: 'simulator-udid', name: 'iPhone 17 Pro', runtime: 'iOS-26-4' });
    connectionController = new AbortController();
    mockConnectHostActionsAsync.mockResolvedValue({
      requestAsync,
      close,
      udid: 'simulator-udid',
      signal: connectionController.signal,
    });
    jest.mocked(runControlMenuAsync).mockResolvedValue(undefined);
    actionResult = ok('off\n');
    served = catalog;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'simulator-control-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  function createCommand(argv: string[]): SimulatorControl {
    const command = new SimulatorControl(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir,
    });
    return command;
  }

  function actionRequests(): Parameters<typeof requestAsync>[] {
    return requestAsync.mock.calls.filter(([action]) => action !== 'actions.describe');
  }

  async function writeImportAsync(actions: unknown[]): Promise<string> {
    const filePath = path.join(tmpDir, 'control.json');
    await fs.writeJson(filePath, { version: 1, actions });
    return filePath;
  }

  it('imports an ordered config without prompts over the existing connection', async () => {
    const filePath = await writeImportAsync([
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
      { action: 'hardwareKeyboard.set', params: { value: 'on' } },
    ]);
    await createCommand([
      '--import',
      filePath,
      '--id',
      'session-123',
      '--non-interactive',
    ]).runAsync();
    expect(actionRequests()).toEqual([
      ['hardwareKeyboard.set', { value: 'off' }],
      ['hardwareKeyboard.set', { value: 'on' }],
    ]);
    expect(mockConnectHostActionsAsync).toHaveBeenCalledTimes(1);
    expect(runControlMenuAsync).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('iPhone 17 Pro · iOS 26.4'));
    expect(Log.log).toHaveBeenCalledWith('  off');
    const spinner = jest.mocked(ora).mock.results[1].value;
    expect(spinner.start).toHaveBeenCalledWith('[1/2] hardwareKeyboard.set');
    expect(spinner.start).toHaveBeenCalledWith('[2/2] hardwareKeyboard.set');
    expect(Log.succeed).toHaveBeenCalledWith(
      expect.stringContaining('Import complete · 2 actions')
    );
  });

  it('prints one JSON result for a successful imported batch', async () => {
    const filePath = await writeImportAsync([
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
    ]);
    actionResult = ok('{"enabled":false}\n');
    await createCommand(['--import', filePath, '--id', 'session-123', '--json']).runAsync();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      id: 'session-123',
      session: expect.objectContaining({
        id: 'session-123',
        device: { udid: 'simulator-udid', name: 'iPhone 17 Pro', runtime: 'iOS-26-4' },
      }),
      config: filePath,
      results: [{ action: 'hardwareKeyboard.set', output: { enabled: false }, file: null }],
    });
    expect(runControlMenuAsync).not.toHaveBeenCalled();
    expect(ora).toHaveBeenCalledTimes(1);
    expect(Log.log).not.toHaveBeenCalled();
    expect(Log.succeed).not.toHaveBeenCalled();
  });

  it('retains completed results and failure metadata in JSON and stops the imported batch', async () => {
    const filePath = await writeImportAsync([
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
      { action: 'hardwareKeyboard.set', params: { value: 'on' } },
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
    ]);
    requestAsync
      .mockImplementationOnce(async () => ok(JSON.stringify(served)))
      .mockResolvedValueOnce(ok('first completed'))
      .mockResolvedValueOnce({ stdout: '', stderr: 'Permission denied', exitCode: 1 });
    const previous = process.exitCode;
    try {
      await createCommand(['--import', filePath, '--id', 'session-123', '--json']).runAsync();
      expect(process.exitCode).toBe(1);
      expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
        id: 'session-123',
        session: expect.objectContaining({
          id: 'session-123',
          device: { udid: 'simulator-udid', name: 'iPhone 17 Pro', runtime: 'iOS-26-4' },
        }),
        config: filePath,
        results: [{ action: 'hardwareKeyboard.set', output: 'first completed', file: null }],
        error: {
          step: 2,
          action: 'hardwareKeyboard.set',
          message: expect.stringContaining('Permission denied'),
        },
      });
      expect(actionRequests()).toHaveLength(2);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      process.exitCode = previous;
    }
  });

  it('preflights every imported step before running the first action', async () => {
    const filePath = await writeImportAsync([
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
      { action: 'hardwareKeyboard.set', params: { value: 'invalid' } },
    ]);
    await expect(
      createCommand(['--import', filePath, '--id', 'session-123']).runAsync()
    ).rejects.toThrow('Config step 2');
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(jest.mocked(ora).mock.results[1].value.fail).toHaveBeenCalledWith(
      'Validation failed. No actions were run.'
    );
  });

  it.each([
    { args: ['hardwareKeyboard.set', 'off'] },
    { args: ['--list'] },
    { args: ['--output', './out.png'] },
  ])('rejects conflicting import options before connecting: %j', async ({ args }) => {
    await expect(
      createCommand(['--import', './control.json', '--id', 'session-123', ...args]).runAsync()
    ).rejects.toThrow('--import cannot be combined');
    expect(mockByIdAsync).not.toHaveBeenCalled();
    expect(mockConnectHostActionsAsync).not.toHaveBeenCalled();
  });

  it('refuses Android imports before connecting or reading the config file', async () => {
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession({ platform: AppPlatform.Android }));
    await expect(
      createCommand(['--import', './missing.json', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('not supported yet');
    expect(mockConnectHostActionsAsync).not.toHaveBeenCalled();
    expect(runControlMenuAsync).not.toHaveBeenCalled();
  });

  it('prints completed steps before a non-JSON import failure', async () => {
    const filePath = await writeImportAsync([
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
      { action: 'hardwareKeyboard.set', params: { value: 'on' } },
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
    ]);
    requestAsync
      .mockImplementationOnce(async () => ok(JSON.stringify(served)))
      .mockResolvedValueOnce(ok('first done'))
      .mockResolvedValueOnce({ stdout: '', stderr: 'Native action failed', exitCode: 1 });
    await expect(
      createCommand(['--import', filePath, '--id', 'session-123']).runAsync()
    ).rejects.toThrow('Config step 2');
    expect(Log.log).toHaveBeenCalledWith('  first done');
    expect(Log.log).toHaveBeenCalledWith('1 completed · 1 failed · 1 skipped');
    expect(Log.gray).toHaveBeenCalledWith('  [3/3] hardwareKeyboard.set skipped');
    expect(actionRequests()).toHaveLength(2);
    expect(runControlMenuAsync).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('downloads config-relative outputs and reports each saved file', async () => {
    const filePath = await writeImportAsync([
      { action: 'screenshot.capture', output: './shot.png' },
    ]);
    actionResult = ok('/remote/screenshot.png');
    await createCommand(['--import', filePath, '--id', 'session-123']).runAsync();
    const savedPath = path.join(tmpDir, 'shot.png');
    expect(await fs.readFile(savedPath, 'utf8')).toBe('png bytes');
    expect(Log.log).toHaveBeenCalledWith(`  Saved: ${savedPath}`);
    expect(Log.gray).toHaveBeenCalledWith(`  Write: ${savedPath} (overwrites if it exists)`);
    expect(jest.mocked(Log.gray).mock.invocationCallOrder[0]).toBeLessThan(
      requestAsync.mock.invocationCallOrder[1]
    );
  });

  it('reports completion for actions with empty output', async () => {
    const filePath = await writeImportAsync([
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
    ]);
    actionResult = ok('');
    await createCommand(['--import', filePath, '--id', 'session-123']).runAsync();
    expect(jest.mocked(ora).mock.results[1].value.succeed).toHaveBeenCalledWith(
      expect.stringMatching(/^\[1\/1\] hardwareKeyboard\.set /)
    );
  });

  it('formats structured results without opening a picker', async () => {
    const filePath = await writeImportAsync([
      { action: 'hardwareKeyboard.set', params: { value: 'off' } },
    ]);
    actionResult = ok('{"text":"Imported text"}');
    await createCommand(['--import', filePath, '--id', 'session-123']).runAsync();
    expect(Log.log).toHaveBeenCalledWith('  {\n    "text": "Imported text"\n  }');
    expect(runControlMenuAsync).not.toHaveBeenCalled();
  });

  it('runs an action from the catalog with its values and prints the output', async () => {
    await createCommand(['hardwareKeyboard.set', 'off', '--id', 'session-123']).runAsync();

    expect(fetchHostActionDeviceAsync).not.toHaveBeenCalled();
    expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-123');
    expect(mockConnectHostActionsAsync).toHaveBeenCalledWith({
      apiUrl: 'https://sim.example.test',
      token: 'preview-token',
    });
    expect(actionRequests()).toEqual([['hardwareKeyboard.set', { value: 'off' }]]);
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith('off');
    expect(close).toHaveBeenCalled();
  });

  it('lists the actions of the session', async () => {
    await createCommand(['--list', '--id', 'session-123']).runAsync();

    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      'permissions.set <action> <service> <bundleId>'
    );
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      '    Grant, revoke or reset one permission for an app.'
    );
    expect(actionRequests()).toEqual([]);
    expect(fetchHostActionDeviceAsync).not.toHaveBeenCalled();
  });

  it('prints parsed JSON output', async () => {
    actionResult = ok('{"voiceover":"off"}\n');

    await createCommand(['permissions.list', '--id', 'session-123', '--json']).runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      id: 'session-123',
      session: expect.objectContaining({
        id: 'session-123',
        device: expect.objectContaining({ udid: 'simulator-udid' }),
      }),
      action: 'permissions.list',
      output: { voiceover: 'off' },
      file: null,
    });
  });

  it('prints plain text as a JSON string and lists a catalog as JSON without opening the menu', async () => {
    await createCommand([
      'hardwareKeyboard.set',
      'off',
      '--id',
      'session-123',
      '--json',
    ]).runAsync();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      id: 'session-123',
      session: expect.objectContaining({
        id: 'session-123',
        project: '@testuser/testapp',
        device: { udid: 'simulator-udid', name: 'iPhone 17 Pro', runtime: 'iOS-26-4' },
      }),
      action: 'hardwareKeyboard.set',
      output: 'off',
      file: null,
    });
    mockPrintJsonOnlyOutput.mockClear();
    jest.mocked(fetchHostActionDeviceAsync).mockClear();
    await createCommand(['--list', '--id', 'session-123', '--json']).runAsync();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith(catalog);
    expect(fetchHostActionDeviceAsync).not.toHaveBeenCalled();
    expect(runControlMenuAsync).not.toHaveBeenCalled();
  });

  it('uploads a local file for an action that takes one and removes it after', async () => {
    const localFile = path.join(tmpDir, 'MyApp.ipa');
    await fs.writeFile(localFile, 'app bytes');
    actionResult = ok('');

    await createCommand(['app.install', localFile, '--id', 'session-123']).runAsync();

    const requests = actionRequests();
    const uploadId = requests[0][1]?.uploadId;
    expect(requests).toEqual([
      [
        'upload.append',
        { uploadId, data: Buffer.from('app bytes').toString('base64'), first: true },
      ],
      ['app.install', { path: `/tmp/serve-sim-uploads/${uploadId}` }],
      ['upload.remove', { uploadId }],
    ]);
  });

  it('sends the upload ID to an action that asks for it', async () => {
    const localFile = path.join(tmpDir, 'session.json');
    await fs.writeFile(localFile, '{}');
    actionResult = ok('');
    served = {
      ...catalog,
      'app.file.upload': {
        type: 'object',
        properties: {
          udid: { type: 'string' },
          bundleId: { type: 'string' },
          relativePath: { type: 'string' },
          uploadId: { type: 'string' },
        },
        upload: 'uploadId',
        uploadAs: 'id',
      },
    };

    await createCommand([
      'app.file.upload',
      'com.example.app',
      'Documents/session.json',
      localFile,
      '--id',
      'session-123',
    ]).runAsync();

    const requests = actionRequests();
    const uploadId = requests[0][1]?.uploadId;
    expect(requests).toEqual([
      ['upload.append', { uploadId, data: Buffer.from('{}').toString('base64'), first: true }],
      [
        'app.file.upload',
        { bundleId: 'com.example.app', relativePath: 'Documents/session.json', uploadId },
      ],
      ['upload.remove', { uploadId }],
    ]);
  });

  it('keeps an upload that the action goes on reading', async () => {
    const localFile = path.join(tmpDir, 'feed.mp4');
    await fs.writeFile(localFile, 'video bytes');
    actionResult = ok('');

    await createCommand(['camera.switch', 'file', localFile, '--id', 'session-123']).runAsync();

    const requests = actionRequests();
    expect(requests.map(([action]) => action)).toEqual(['upload.append', 'camera.switch']);
    expect(requests[1][1]).toEqual({
      source: 'file',
      target: `/tmp/serve-sim-uploads/${requests[0][1]?.uploadId}`,
    });
  });

  it('removes a kept upload when the action fails', async () => {
    const localFile = path.join(tmpDir, 'feed.mp4');
    await fs.writeFile(localFile, 'video bytes');
    actionResult = { stdout: '', stderr: 'No such app.\n', exitCode: 1 };

    await expect(
      createCommand(['camera.switch', 'file', localFile, '--id', 'session-123']).runAsync()
    ).rejects.toThrow('The simulator could not run camera.switch: No such app.');
    expect(actionRequests().map(([action]) => action)).toEqual([
      'upload.append',
      'camera.switch',
      'upload.remove',
    ]);
  });

  it('passes a webcam name through without looking for a local file', async () => {
    actionResult = ok('');

    await createCommand([
      'camera.switch',
      'webcam',
      'FaceTime HD Camera',
      '--id',
      'session-123',
    ]).runAsync();

    expect(actionRequests()).toEqual([
      ['camera.switch', { source: 'webcam', target: 'FaceTime HD Camera' }],
    ]);
  });

  it('refuses a relative file that does not exist on this computer', async () => {
    await expect(
      createCommand(['app.install', './MyAp.ipa', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('./MyAp.ipa does not exist on this computer.');
    expect(actionRequests()).toEqual([]);
  });

  it('refuses --output for an action that returns no file before it runs', async () => {
    await expect(
      createCommand([
        'hardwareKeyboard.set',
        'off',
        '--output',
        './out',
        '--id',
        'session-123',
      ]).runAsync()
    ).rejects.toThrow('hardwareKeyboard.set does not return a file, so --output does not apply.');
    expect(actionRequests()).toEqual([]);
  });

  it('passes a path that is not a local file through unchanged', async () => {
    actionResult = ok('');

    await createCommand([
      'app.install',
      '/Users/runner/MyApp.ipa',
      '--id',
      'session-123',
    ]).runAsync();

    expect(actionRequests()).toEqual([['app.install', { path: '/Users/runner/MyApp.ipa' }]]);
  });

  it('downloads the file an action returns', async () => {
    const outputPath = path.join(tmpDir, 'shot.png');
    actionResult = ok('/tmp/serve-sim-screenshots/serve-sim-screenshot-1.png\n');

    await createCommand([
      'screenshot.capture',
      '--output',
      outputPath,
      '--id',
      'session-123',
    ]).runAsync();

    expect(await fs.readFile(outputPath, 'utf8')).toBe('png bytes');
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(`Saved ${outputPath}`);
  });

  it('refuses an action that the session does not list', async () => {
    await expect(createCommand(['server.kill', '--id', 'session-123']).runAsync()).rejects.toThrow(
      'Unknown simulator action "server.kill". Run `eas simulator:control --list` to see the actions.'
    );
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it('opens the interactive menu with one connection and catalog', async () => {
    await createCommand(['--id', 'session-123']).runAsync();
    expect(runControlMenuAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        catalog,
        runActionAsync: expect.any(Function),
        signal: expect.any(AbortSignal),
      })
    );
    expect(mockConnectHostActionsAsync).toHaveBeenCalledTimes(1);
    expect(requestAsync).toHaveBeenCalledTimes(1);
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['--json', '--non-interactive'])('requires an action in scripted mode %s', async flag => {
    await expect(createCommand(['--id', 'session-123', flag]).runAsync()).rejects.toThrow(
      'No action provided.'
    );
    expect(mockByIdAsync).not.toHaveBeenCalled();
    expect(runControlMenuAsync).not.toHaveBeenCalled();
  });

  it('requires an action without a TTY before it loads the session', async () => {
    process.stdin.isTTY = false;
    try {
      await expect(createCommand(['--id', 'session-123']).runAsync()).rejects.toThrow(
        'No action provided.'
      );
      expect(mockByIdAsync).not.toHaveBeenCalled();
    } finally {
      process.stdin.isTTY = true;
    }
  });

  it('rejects --output without an action before connecting', async () => {
    await expect(
      createCommand(['--id', 'session-123', '--output', './out.png']).runAsync()
    ).rejects.toThrow('--output requires an action');
    expect(mockConnectHostActionsAsync).not.toHaveBeenCalled();
  });

  it('closes an established connection when catalog setup fails', async () => {
    requestAsync.mockImplementationOnce(async () => ok('not a catalog'));
    await expect(createCommand(['--list', '--id', 'session-123']).runAsync()).rejects.toThrow(
      'did not return its list of actions'
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('runs an interactive selection through the shared execution path', async () => {
    jest.mocked(runControlMenuAsync).mockImplementationOnce(async ({ runActionAsync }) => {
      await runActionAsync({ action: 'hardwareKeyboard.set', params: { value: 'off' } });
    });
    await createCommand(['--id', 'session-123']).runAsync();
    expect(actionRequests()).toEqual([['hardwareKeyboard.set', { value: 'off' }]]);
    expect(Log.log).toHaveBeenCalledWith('off');
  });

  it('cleans up before returning Ctrl-C status', async () => {
    const previousExitCode = process.exitCode;
    jest.mocked(runControlMenuAsync).mockRejectedValueOnce(new ControlPromptCancelledError());
    try {
      await createCommand(['--id', 'session-123']).runAsync();
      expect(process.exitCode).toBe(130);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('detaches on SIGINT while the menu is idle and removes its handler', async () => {
    const previousExitCode = process.exitCode;
    const listeners = process.listenerCount('SIGINT');
    jest.mocked(runControlMenuAsync).mockImplementationOnce(async ({ signal }) => {
      const interrupted = new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(signal.reason);
          },
          { once: true }
        );
      });
      process.emit('SIGINT');
      await interrupted;
    });
    try {
      await createCommand(['--id', 'session-123']).runAsync();
      expect(process.exitCode).toBe(130);
      expect(close).toHaveBeenCalled();
      expect(process.listenerCount('SIGINT')).toBe(listeners);
      expect(actionRequests()).toEqual([]);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('reports connection loss while idle and restores its listeners', async () => {
    const listeners = process.listenerCount('SIGINT');
    const reason = new Error('Connection lost; the action may still have run.');
    jest.mocked(runControlMenuAsync).mockImplementationOnce(async ({ signal }) => {
      const lost = new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(signal.reason);
          },
          { once: true }
        );
      });
      connectionController.abort(reason);
      await lost;
    });
    await expect(createCommand(['--id', 'session-123']).runAsync()).rejects.toBe(reason);
    expect(close).toHaveBeenCalled();
    expect(process.listenerCount('SIGINT')).toBe(listeners);
    expect(actionRequests()).toEqual([]);
  });

  it('does not run an action when the socket closes immediately after catalog setup', async () => {
    const reason = new Error('Connection closed after catalog');
    requestAsync.mockImplementationOnce(async () => {
      queueMicrotask(() => {
        connectionController.abort(reason);
      });
      return ok(JSON.stringify(served));
    });
    jest.mocked(runControlMenuAsync).mockImplementationOnce(async ({ signal }) => {
      signal.throwIfAborted();
    });
    await expect(createCommand(['--id', 'session-123']).runAsync()).rejects.toBe(reason);
    expect(close).toHaveBeenCalledTimes(1);
    expect(actionRequests()).toEqual([]);
  });

  it('ends the idle menu on confirmed session completion without stopping the remote session', async () => {
    const watcher = new AbortController();
    const dispose = jest.fn();
    const watch = jest
      .spyOn(controlSession, 'watchControlSession')
      .mockReturnValueOnce({ signal: watcher.signal, dispose });
    const listeners = process.listenerCount('SIGINT');
    jest.mocked(runControlMenuAsync).mockImplementationOnce(async ({ signal }) => {
      const ended = new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(signal.reason);
          },
          { once: true }
        );
      });
      watcher.abort(new controlSession.ControlSessionEndedError('session-123'));
      await ended;
    });
    try {
      await createCommand(['--id', 'session-123']).runAsync();
      expect(Log.log).toHaveBeenCalledWith('Simulator session session-123 has ended.');
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalled();
      expect(process.listenerCount('SIGINT')).toBe(listeners);
      expect(actionRequests()).toEqual([]);
      expect(mockByIdAsync).toHaveBeenCalledTimes(1);
    } finally {
      watch.mockRestore();
    }
  });

  it('propagates an errored session instead of reporting a successful end', async () => {
    jest
      .mocked(runControlMenuAsync)
      .mockRejectedValueOnce(
        new controlSession.ControlSessionEndedError('session-123', /* failed */ true)
      );
    await expect(createCommand(['--id', 'session-123']).runAsync()).rejects.toThrow(
      'session-123 errored'
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(Log.log).not.toHaveBeenCalledWith('Simulator session session-123 has ended.');
  });

  it('shows session and device details without terminal escape sequences', async () => {
    mockByIdAsync.mockResolvedValueOnce(
      makeDeviceRunSession({ name: '\x1b[31mCheckout QA\x1b[0m\nSpoofed' })
    );
    await createCommand(['--id', 'session-123']).runAsync();
    const text = jest
      .mocked(Log.log)
      .mock.calls.map(([value]) => String(value))
      .join('\n');
    expect(text).toContain('Checkout QA Spoofed');
    expect(text).toContain('@testuser/testapp');
    expect(text).toContain('iPhone 17 Pro · iOS 26.4');
    expect(text).toContain('session-123');
    expect(text).toContain('simulator-udid');
    expect(text).not.toContain('\x1b[31m');
    expect(text).not.toContain('preview-token');
  });

  it('shows fallback names when optional details are unavailable or blank', async () => {
    mockByIdAsync.mockResolvedValueOnce(makeDeviceRunSession({ name: ' \n ' }));
    jest.mocked(fetchHostActionDeviceAsync).mockResolvedValueOnce({ udid: 'simulator-udid' });
    await createCommand(['--id', 'session-123']).runAsync();
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Unnamed session'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('iOS Simulator'));
  });

  it('closes the connection if the interactive controller fails unexpectedly', async () => {
    const reason = new Error('Terminal output failed');
    jest.mocked(runControlMenuAsync).mockRejectedValueOnce(reason);
    await expect(createCommand(['--id', 'session-123']).runAsync()).rejects.toBe(reason);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('requires a session ID before opening a connection', async () => {
    const previous = process.env[EAS_SIMULATOR_SESSION_ID];
    delete process.env[EAS_SIMULATOR_SESSION_ID];
    try {
      await expect(createCommand([]).runAsync()).rejects.toThrow(
        'No simulator session ID provided.'
      );
      expect(mockByIdAsync).not.toHaveBeenCalled();
      expect(mockConnectHostActionsAsync).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env[EAS_SIMULATOR_SESSION_ID];
      } else {
        process.env[EAS_SIMULATOR_SESSION_ID] = previous;
      }
    }
  });

  it('uses the session ID loaded into the simulator environment', async () => {
    const previous = process.env[EAS_SIMULATOR_SESSION_ID];
    process.env[EAS_SIMULATOR_SESSION_ID] = 'dotenv-session';
    try {
      await createCommand([]).runAsync();
      expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'dotenv-session');
      expect(runControlMenuAsync).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) {
        delete process.env[EAS_SIMULATOR_SESSION_ID];
      } else {
        process.env[EAS_SIMULATOR_SESSION_ID] = previous;
      }
    }
  });

  it('refuses Android before an interactive prompt or connection', async () => {
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession({ platform: AppPlatform.Android }));
    await expect(createCommand(['--id', 'session-123']).runAsync()).rejects.toThrow(
      'not supported yet'
    );
    expect(runControlMenuAsync).not.toHaveBeenCalled();
    expect(mockConnectHostActionsAsync).not.toHaveBeenCalled();
  });

  it('refuses a session that is not running', async () => {
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({ status: DeviceRunSessionStatus.Stopped })
    );

    await expect(
      createCommand(['memoryWarning', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('Simulator session session-123 is stopped');
    expect(mockConnectHostActionsAsync).not.toHaveBeenCalled();
  });

  it('refuses an Android session', async () => {
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession({ platform: AppPlatform.Android }));

    await expect(
      createCommand(['memoryWarning', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('available only for iOS sessions');
    expect(mockConnectHostActionsAsync).not.toHaveBeenCalled();
  });

  it('refuses a session without a preview server API', async () => {
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({
        remoteConfig: {
          __typename: 'ServeSimRunSessionRemoteConfig',
          previewUrl: 'https://sim.example.test',
          previewToken: 'preview-token',
        },
      })
    );

    await expect(
      createCommand(['memoryWarning', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('does not expose a preview server');
  });

  it('reports the simulator error when the action fails', async () => {
    actionResult = {
      stdout: '',
      stderr: 'Simulator could not change the hinge angle.\n',
      exitCode: 1,
    };

    await expect(
      createCommand(['hinge.set', 'half', '--id', 'session-123']).runAsync()
    ).rejects.toThrow(
      'The simulator could not run hinge.set: Simulator could not change the hinge angle.'
    );
  });
});
