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
import { loadSimulatorEnvAsync } from '../../../simulator/env';
import {
  HostActionCatalog,
  HostActionResult,
  connectHostActionsAsync,
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
jest.mock('fs-extra', () => {
  const actual = jest.requireActual<typeof import('fs-extra')>('fs-extra');
  return { ...actual, stat: jest.fn(actual.stat) };
});

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
    mockConnectHostActionsAsync.mockResolvedValue({ requestAsync, close });
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

  it.each([['--id='], ['--id', '']])('refuses an empty session ID in %j', async (...flags) => {
    const env = jest.replaceProperty(process, 'env', {
      ...process.env,
      EAS_SIMULATOR_SESSION_ID: 'env-session',
    });
    try {
      await expect(
        createCommand(['hardwareKeyboard.set', 'off', ...flags]).runAsync()
      ).rejects.toThrow('--id needs a simulator session ID.');
      expect(loadSimulatorEnvAsync).not.toHaveBeenCalled();
      expect(mockByIdAsync).not.toHaveBeenCalled();
      expect(mockConnectHostActionsAsync).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it('uses the environment session when --id is absent', async () => {
    const env = jest.replaceProperty(process, 'env', {
      ...process.env,
      EAS_SIMULATOR_SESSION_ID: 'env-session',
    });
    try {
      await createCommand(['hardwareKeyboard.set', 'off']).runAsync();
      expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'env-session');
    } finally {
      env.restore();
    }
  });

  it.each(['text=hello', '--', '--help', ''])(
    'preserves the literal value after the separator: %s',
    async value => {
      served = {
        ...catalog,
        'clipboard.write': {
          type: 'object',
          properties: { udid: { type: 'string' }, text: { type: 'string' } },
          required: ['udid', 'text'],
        },
      };
      await createCommand(['clipboard.write', '--id', 'session-123', '--', value]).runAsync();
      expect(actionRequests()).toEqual([['clipboard.write', { text: value }]]);
    }
  );

  it.each([
    {
      argv: ['permissions.set', '--id', 's', 'action=grant', '--', 's', 'camera'],
      params: { action: 'grant', service: 's', bundleId: 'camera' },
    },
    {
      argv: ['permissions.set', '--id', 's', '--', 'grant', '--', 'com.app'],
      params: { action: 'grant', service: '--', bundleId: 'com.app' },
    },
    {
      argv: ['permissions.set', '--id', 's', '--', 'grant', 'permissions.set', 'com.app'],
      params: { action: 'grant', service: 'permissions.set', bundleId: 'com.app' },
    },
    {
      argv: ['permissions.set', '--id', 'camera', 'grant', 'microphone', 'camera'],
      params: { action: 'grant', service: 'microphone', bundleId: 'camera' },
    },
  ])(
    'preserves input order when positional tokens repeat earlier input: $argv',
    async ({ argv, params }) => {
      await createCommand(argv).runAsync();
      expect(actionRequests()).toEqual([['permissions.set', params]]);
    }
  );

  it('treats values as literal when the separator precedes the action', async () => {
    served = {
      ...catalog,
      'clipboard.write': {
        type: 'object',
        properties: { udid: { type: 'string' }, text: { type: 'string' } },
        required: ['udid', 'text'],
      },
    };
    await createCommand(['--id', 'session-123', '--', 'clipboard.write', 'text=hello']).runAsync();
    expect(actionRequests()).toEqual([['clipboard.write', { text: 'text=hello' }]]);
  });

  it('does not treat a flag value of -- as the literal separator', async () => {
    served = {
      ...catalog,
      'clipboard.write': {
        type: 'object',
        properties: { udid: { type: 'string' }, text: { type: 'string' } },
        required: ['udid', 'text'],
      },
    };
    await createCommand(['clipboard.write', 'text=hello', '--id', '--']).runAsync();
    expect(actionRequests()).toEqual([['clipboard.write', { text: 'hello' }]]);
  });

  it('keeps named arguments before the separator and positional values after it', async () => {
    await createCommand([
      'permissions.set',
      'action=grant',
      '--id',
      'session-123',
      '--',
      'service=camera',
      'bundleId=literal',
    ]).runAsync();
    expect(actionRequests()).toEqual([
      [
        'permissions.set',
        { action: 'grant', service: 'service=camera', bundleId: 'bundleId=literal' },
      ],
    ]);
  });

  it('runs an action from the catalog with its values and prints the output', async () => {
    await createCommand(['hardwareKeyboard.set', 'off', '--id', 'session-123']).runAsync();

    expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-123');
    expect(mockConnectHostActionsAsync).toHaveBeenCalledWith({
      apiUrl: 'https://sim.example.test',
      token: 'preview-token',
    });
    expect(actionRequests()).toEqual([['hardwareKeyboard.set', { value: 'off' }]]);
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith('off');
    expect(close).toHaveBeenCalled();
  });

  it.each([false, true])('lists the actions of the session with --list=%s', async list => {
    await createCommand([...(list ? ['--list'] : []), '--id', 'session-123']).runAsync();

    const lines = jest.mocked(Log.log).mock.calls.map(([line]) => String(line));
    expect(lines.pop()).toBe('For action usage: eas simulator:control <action> --help');
    expect(lines.flatMap(line => line.trim().split(/\s+/)).sort()).toEqual(
      Object.keys(catalog).sort()
    );
    expect(actionRequests()).toEqual([]);
  });

  it.each(['--help', '-h'])('shows action help with %s without running the action', async help => {
    await createCommand(['permissions.set', help, '--id', 'session-123']).runAsync();

    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      '  Grant, revoke or reset one permission for an app.'
    );
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      '    eas simulator:control permissions.set <action> <service> <bundleId>'
    );
    const lines = jest.mocked(Log.log).mock.calls.map(([line]) => String(line));
    const usage = lines.indexOf(
      '    eas simulator:control permissions.set <action> <service> <bundleId>'
    );
    expect(lines[usage + 1]).toBe('      [--id <session-id>] [--json]');
    expect(lines.indexOf('  Values after -- are positional literals.')).toBeGreaterThan(usage + 1);
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('shows local file guidance without validating output or uploading files', async () => {
    await createCommand([
      'screenshot.capture',
      '--help',
      '--output',
      '/missing/folder/screen.png',
      '--id',
      'session-123',
    ]).runAsync();

    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      '    eas simulator:control screenshot.capture [fileName]'
    );
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      '    --output <path>    Local filename or existing directory.'
    );
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('explains local and explicit host upload paths without running an action', async () => {
    await createCommand(['media.add', '--help', '--id', 'session-123']).runAsync();

    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      '  File paths are local. Use host:/absolute/path for files on the simulator host.'
    );
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('prints the host action schema as JSON for help', async () => {
    await createCommand(['app.install', '--help', '--json', '--id', 'session-123']).runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      action: 'app.install',
      ...catalog['app.install'],
      description: expect.stringContaining('host:/absolute/path'),
    });
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown actions in help and closes the connection', async () => {
    await expect(
      createCommand(['unknown.action', '--help', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('Unknown simulator action "unknown.action"');
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('prints parsed JSON output', async () => {
    actionResult = ok('{"voiceover":"off"}\n');

    await createCommand(['permissions.list', '--id', 'session-123', '--json']).runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      id: 'session-123',
      action: 'permissions.list',
      output: { voiceover: 'off' },
      file: null,
    });
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

  it('rejects host paths for ID-only uploads and does not advertise them', async () => {
    served = {
      ...catalog,
      'app.file.upload': {
        type: 'object',
        properties: { uploadId: { type: 'string' } },
        upload: 'uploadId',
        uploadAs: 'id',
      },
    };
    await expect(
      createCommand(['app.file.upload', 'host:/tmp/a.json', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('requires a local file');
    expect(actionRequests()).toEqual([]);
    await createCommand(['app.file.upload', '--help', '--id', 'session-123']).runAsync();
    const lines = jest.mocked(Log.log).mock.calls.map(([line]) => String(line));
    expect(lines.join('\n')).not.toContain('host:/absolute/path');
    expect(lines.join('\n')).toContain('requires a local file');
    await createCommand(['app.file.upload', '--help', '--json', '--id', 'session-123']).runAsync();
    expect(mockPrintJsonOnlyOutput).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('requires a local file'),
      })
    );
  });

  it('explains how to upload a local filename beginning with host:', async () => {
    await expect(
      createCommand(['media.add', 'host:photo.png', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('./host:photo.png');
    expect(actionRequests()).toEqual([]);
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

  it('refuses a missing absolute local file without running an action', async () => {
    const missing = path.join(tmpDir, 'missing.png');
    await expect(
      createCommand(['media.add', missing, '--id', 'session-123']).runAsync()
    ).rejects.toThrow('does not exist on this computer');
    expect(actionRequests()).toEqual([]);
  });

  it('preserves a local filesystem failure without sending an action', async () => {
    const denied = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    const stat = jest
      .mocked<(path: string) => Promise<fs.Stats>>(fs.stat)
      .mockRejectedValueOnce(denied);
    try {
      await expect(
        createCommand([
          'media.add',
          path.join(tmpDir, 'private.png'),
          '--id',
          'session-123',
        ]).runAsync()
      ).rejects.toBe(denied);
      expect(actionRequests()).toEqual([]);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      stat
        .mockReset()
        .mockImplementation(jest.requireActual<typeof import('fs-extra')>('fs-extra').stat);
    }
  });

  it('passes an explicit host path through without uploading a matching local file', async () => {
    const localFile = path.join(tmpDir, 'existing.png');
    await fs.writeFile(localFile, 'local bytes');
    await createCommand(['media.add', `host:${localFile}`, '--id', 'session-123']).runAsync();
    expect(actionRequests()).toEqual([['media.add', { path: localFile }]]);
  });

  it.each(['host:relative.png', 'host:'])('rejects a non-absolute host path: %s', async value => {
    await expect(
      createCommand(['media.add', value, '--id', 'session-123']).runAsync()
    ).rejects.toThrow('absolute');
    expect(actionRequests()).toEqual([]);
  });

  it('uploads a local filename beginning with host: when explicitly relative', async () => {
    const previous = process.cwd();
    await fs.writeFile(path.join(tmpDir, 'host:photo.png'), 'png bytes');
    try {
      process.chdir(tmpDir);
      await createCommand(['media.add', './host:photo.png', '--id', 'session-123']).runAsync();
      expect(actionRequests().map(([action]) => action)).toEqual([
        'upload.append',
        'media.add',
        'upload.remove',
      ]);
    } finally {
      process.chdir(previous);
    }
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
      'Unknown simulator action "server.kill". Run `eas simulator:control` to see the actions.'
    );
    expect(actionRequests()).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it('closes an established connection when catalog setup fails', async () => {
    requestAsync.mockImplementationOnce(async () => ok('not a catalog'));
    await expect(createCommand(['--list', '--id', 'session-123']).runAsync()).rejects.toThrow(
      'did not return its list of actions'
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('lists the actions as JSON when no action is provided', async () => {
    await createCommand(['--id', 'session-123', '--json']).runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        'app.install': expect.objectContaining({
          description: expect.stringContaining('host:/absolute/path'),
        }),
        'hardwareKeyboard.set': catalog['hardwareKeyboard.set'],
      })
    );
    expect(actionRequests()).toEqual([]);
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
