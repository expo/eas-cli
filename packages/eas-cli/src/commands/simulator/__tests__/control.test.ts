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

type DeviceRunSessionById = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];

const catalog: HostActionCatalog = require('../../../simulator/__tests__/fixtures/hostActionCatalog.json');

const mockByIdAsync = jest.mocked(DeviceRunSessionQuery.byIdAsync);
const mockConnectHostActionsAsync = jest.mocked(connectHostActionsAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function makeDeviceRunSession(overrides: Partial<DeviceRunSessionById> = {}): DeviceRunSessionById {
  return {
    id: 'session-123',
    name: null,
    tags: [],
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
  let tmpDir: string;
  const requestAsync = jest.fn(
    async (action: string, params: Record<string, unknown> = {}): Promise<HostActionResult> => {
      switch (action) {
        case 'actions.describe':
          return ok(JSON.stringify(catalog));
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

  it('lists the actions of the session', async () => {
    await createCommand(['--list', '--id', 'session-123']).runAsync();

    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      'permissions.set <action> <service> <bundleId>\n    Grant, revoke or reset one permission for an app.'
    );
    expect(actionRequests()).toEqual([]);
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

  it('asks for an action before it loads the session', async () => {
    await expect(createCommand(['--id', 'session-123']).runAsync()).rejects.toThrow(
      'No action provided.'
    );
    expect(mockByIdAsync).not.toHaveBeenCalled();
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
