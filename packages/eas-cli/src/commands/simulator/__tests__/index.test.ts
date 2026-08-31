import { Config } from '@oclif/core';
import * as fs from 'fs-extra';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  CreateDeviceRunSessionMutation,
  DeviceRunSessionByIdQuery,
  DeviceRunSessionResourceClass,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
  JobRunStatus,
} from '../../../graphql/generated';
import { DeviceRunSessionMutation } from '../../../graphql/mutations/DeviceRunSessionMutation';
import { DeviceRunSessionAvailabilityQuery } from '../../../graphql/queries/DeviceRunSessionAvailabilityQuery';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { promptAsync } from '../../../prompts';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_HEADER,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
  resetSimulatorEnvAsync,
} from '../../../simulator/env';
import { resolveExpoGoSdkVersionAsync } from '../../../simulator/expoGo';
import Simulator from '../index';

jest.mock('fs-extra');
jest.mock('../../../graphql/mutations/DeviceRunSessionMutation');
jest.mock('../../../graphql/queries/DeviceRunSessionAvailabilityQuery');
jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    log: jest.fn(),
    newLine: jest.fn(),
    warn: jest.fn(),
    withTick: jest.fn(),
  },
  link: jest.fn((url: string) => url),
}));
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
  resetSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../simulator/expoGo');
jest.mock('../../../prompts');
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

type CreatedDeviceRunSession =
  CreateDeviceRunSessionMutation['deviceRunSession']['createDeviceRunSession'];
type DeviceRunSessionById = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];

const graphqlClient = {} as ExpoGraphqlClient;
const projectDir = '/test/project';
const simulatorDotenvPath = `${projectDir}/.env.eas-simulator`;
const deviceRunSessionUrl =
  'https://expo.dev/accounts/testuser/projects/testapp/simulator-sessions/session-123';

const mockCreateDeviceRunSessionAsync = jest.mocked(
  DeviceRunSessionMutation.createDeviceRunSessionAsync
);
const mockEnsureDeviceRunSessionStoppedAsync = jest.mocked(
  DeviceRunSessionMutation.ensureDeviceRunSessionStoppedAsync
);
const mockAvailabilityByAppIdAsync = jest.mocked(DeviceRunSessionAvailabilityQuery.byAppIdAsync);
const mockByIdAsync = jest.mocked(DeviceRunSessionQuery.byIdAsync);
const mockLoadSimulatorEnvAsync = jest.mocked(loadSimulatorEnvAsync);
const mockResetSimulatorEnvAsync = jest.mocked(resetSimulatorEnvAsync);
const mockResolveExpoGoSdkVersionAsync = jest.mocked(resolveExpoGoSdkVersionAsync);
const mockOra = jest.mocked(ora);
const mockPromptAsync = jest.mocked(promptAsync);

function makeCreatedDeviceRunSession(
  overrides: Partial<CreatedDeviceRunSession> = {}
): CreatedDeviceRunSession {
  return {
    id: 'session-123',
    status: DeviceRunSessionStatus.InProgress,
    app: {
      id: 'app-123',
      slug: 'testapp',
      ownerAccount: {
        id: 'account-123',
        name: 'testuser',
      },
    },
    turtleJobRun: {
      id: 'job-123',
    },
    ...overrides,
  };
}

function makeDeviceRunSession(overrides: Partial<DeviceRunSessionById> = {}): DeviceRunSessionById {
  return {
    id: 'session-123',
    name: null,
    tags: [],
    status: DeviceRunSessionStatus.InProgress,
    type: DeviceRunSessionType.AgentDevice,
    platform: AppPlatform.Ios,
    createdAt: '2025-01-01T00:00:00.000Z',
    startedAt: '2025-01-01T00:00:05.000Z',
    finishedAt: null,
    updatedAt: '2025-01-01T00:01:00.000Z',
    app: {
      id: 'app-123',
      slug: 'testapp',
      ownerAccount: {
        id: 'account-123',
        name: 'testuser',
      },
    },
    artifacts: [],
    remoteConfig: {
      __typename: 'AgentDeviceRunSessionRemoteConfig',
      agentDeviceRemoteSessionUrl: 'https://agent.example.com',
      agentDeviceRemoteSessionToken: 'token-123',
      webPreviewUrl: 'https://preview.example.com',
    },
    turtleJobRun: {
      id: 'job-123',
      status: JobRunStatus.InProgress,
    },
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

describe(Simulator, () => {
  const mockConfig = getMockOclifConfig();
  const previousDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[EAS_SIMULATOR_SESSION_ID];
    mockAvailabilityByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: true });
    mockCreateDeviceRunSessionAsync.mockResolvedValue(makeCreatedDeviceRunSession());
    mockEnsureDeviceRunSessionStoppedAsync.mockResolvedValue({
      id: 'session-123',
      status: DeviceRunSessionStatus.Stopped,
    });
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession());
    mockLoadSimulatorEnvAsync.mockResolvedValue();
    mockResetSimulatorEnvAsync.mockResolvedValue();
    mockResolveExpoGoSdkVersionAsync.mockResolvedValue('55.0.0');
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
  });

  afterAll(() => {
    if (previousDeviceRunSessionId === undefined) {
      delete process.env[EAS_SIMULATOR_SESSION_ID];
    } else {
      process.env[EAS_SIMULATOR_SESSION_ID] = previousDeviceRunSessionId;
    }
  });

  function createCommand(
    argv: string[],
    { isExpoAdmin = false }: { isExpoAdmin?: boolean } = {}
  ): {
    command: Simulator;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new Simulator(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { actor: { isExpoAdmin }, graphqlClient },
      projectDir,
      projectId: 'project-123',
    });
    return { command, getContextAsync };
  }

  it('fails with the waitlist link without creating a session when the account is gated', async () => {
    mockAvailabilityByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: false });

    const { command } = createCommand(['--platform', 'ios', '--non-interactive']);

    await expect(command.runAsync()).rejects.toThrow(
      "EAS Simulator isn't available on testuser yet — it's coming soon.\n" +
        'Join the waitlist to get access: https://expo.dev/services/simulators'
    );
    expect(mockAvailabilityByAppIdAsync).toHaveBeenCalledWith(graphqlClient, 'project-123');
    expect(mockCreateDeviceRunSessionAsync).not.toHaveBeenCalled();
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });

  it('skips the gate check for Expo admins on a gated account', async () => {
    mockAvailabilityByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: false });

    const { command } = createCommand(['--platform', 'ios', '--non-interactive'], {
      isExpoAdmin: true,
    });
    await command.runAsync();

    expect(mockAvailabilityByAppIdAsync).not.toHaveBeenCalled();
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalled();
  });

  it('prints environment variables without saving when outputting env', async () => {
    const { command, getContextAsync } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--out-config-type',
      'env',
    ]);
    await command.runAsync();

    expect(getContextAsync).toHaveBeenCalledWith(Simulator, {
      nonInteractive: true,
    });
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      name: undefined,
      packageVersion: undefined,
      platform: AppPlatform.Ios,
      type: DeviceRunSessionType.AgentDevice,
    });
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(mockOra.mock.results[0]?.value.succeed).toHaveBeenCalledWith(
      `Simulator session created (id: session-123) ${deviceRunSessionUrl}`
    );
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining("export AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'")
    );
  });

  it('writes .env.eas-simulator with the environment variables by default', async () => {
    const { command } = createCommand(['--platform', 'ios', '--non-interactive']);
    await command.runAsync();

    expect(mockLoadSimulatorEnvAsync).toHaveBeenCalledWith(projectDir);
    expect(fs.writeFile).toHaveBeenNthCalledWith(
      1,
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER + `${EAS_SIMULATOR_SESSION_ID}='session-123'\n`
    );
    expect(fs.writeFile).toHaveBeenNthCalledWith(
      2,
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER +
        "AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'\n" +
        "AGENT_DEVICE_DAEMON_AUTH_TOKEN='token-123'\n" +
        `${EAS_SIMULATOR_SESSION_ID}='session-123'\n`
    );
    expect(jest.mocked(fs.writeFile).mock.invocationCallOrder[0]).toBeLessThan(
      mockByIdAsync.mock.invocationCallOrder[0]
    );
    expect(mockOra.mock.results[0]?.value.succeed).toHaveBeenCalledWith(
      `Simulator session created (id: session-123, saved to ${SIMULATOR_DOTENV_FILE_NAME}) ${deviceRunSessionUrl}`
    );
    expect(Log.withTick).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(
      [
        '🔑 Run the following to use agent-device with the simulator:',
        '',
        'eas simulator:exec npx agent-device <command>',
        '',
        '🌐 Open the following URL in your browser to preview the simulator:',
        '',
        'https://preview.example.com',
      ].join('\n')
    );
  });

  it('writes the Appium environment and capabilities to the simulator dotenv', async () => {
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({
        type: DeviceRunSessionType.Appium,
        platform: AppPlatform.Ios,
        remoteConfig: {
          __typename: 'AppiumRunSessionRemoteConfig',
          appiumUrl: 'https://appium.example.test',
          capabilities: {
            platformName: 'iOS',
            'appium:automationName': 'XCUITest',
            'appium:udid': 'simulator-id',
          },
          webPreviewUrl: 'https://preview.example.test',
        },
      })
    );

    const { command } = createCommand([
      '--platform',
      'ios',
      '--type',
      'appium',
      '--non-interactive',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ type: DeviceRunSessionType.Appium })
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      simulatorDotenvPath,
      expect.stringContaining(
        `APPIUM_CAPS='{"platformName":"iOS","appium:automationName":"XCUITest","appium:udid":"simulator-id"}'`
      )
    );
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining('eas simulator:exec <appium-client> [args...]')
    );
    expect(Log.log).not.toHaveBeenCalledWith(
      expect.stringContaining('https://appium.example.test')
    );
  });

  it('creates a WebPreviewOnly session for --type web-preview-only', async () => {
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({
        type: DeviceRunSessionType.WebPreviewOnly,
        remoteConfig: {
          __typename: 'WebPreviewOnlyRunSessionRemoteConfig',
          previewUrl: 'https://preview.example.test',
        },
      })
    );

    const { command } = createCommand([
      '--platform',
      'ios',
      '--type',
      'web-preview-only',
      '--non-interactive',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ type: DeviceRunSessionType.WebPreviewOnly })
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('https://preview.example.test'));
  });

  it('overwrites .env.eas-simulator when outputting dotenv and the file exists', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--out-config-type',
      'dotenv',
    ]);
    await command.runAsync();

    expect(fs.writeFile).toHaveBeenNthCalledWith(
      1,
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER + `${EAS_SIMULATOR_SESSION_ID}='session-123'\n`
    );
    expect(fs.writeFile).toHaveBeenNthCalledWith(
      2,
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER +
        "AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'\n" +
        "AGENT_DEVICE_DAEMON_AUTH_TOKEN='token-123'\n" +
        `${EAS_SIMULATOR_SESSION_ID}='session-123'\n`
    );
  });

  it(`warns and creates a new session when ${EAS_SIMULATOR_SESSION_ID} is already present by default`, async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'existing-session';

    const { command } = createCommand(['--platform', 'ios', '--non-interactive']);
    await command.runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      '  Overwriting previous simulator session (id: existing-session). ' +
        'The previous remote session will continue running until stopped. ' +
        'To stop it, run: eas simulator:stop --id existing-session'
    );
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      name: undefined,
      packageVersion: undefined,
      platform: AppPlatform.Ios,
      type: DeviceRunSessionType.AgentDevice,
    });
  });

  it(`creates a new session when ${EAS_SIMULATOR_SESSION_ID} is present with --force`, async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'existing-session';

    const { command } = createCommand(['--platform', 'ios', '--non-interactive', '--force']);
    await command.runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      '  Overwriting previous simulator session (id: existing-session). ' +
        'The previous remote session will continue running until stopped. ' +
        'To stop it, run: eas simulator:stop --id existing-session'
    );
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      name: undefined,
      packageVersion: undefined,
      platform: AppPlatform.Ios,
      type: DeviceRunSessionType.AgentDevice,
    });
  });

  it('passes --max-idle-time-minutes to the createDeviceRunSession mutation', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--max-idle-time-minutes',
      '30',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      name: undefined,
      packageVersion: undefined,
      platform: AppPlatform.Ios,
      type: DeviceRunSessionType.AgentDevice,
      maxIdleTimeMinutes: 30,
    });
  });

  it(`throws when ${EAS_SIMULATOR_SESSION_ID} is already present with --no-force`, async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'existing-session';

    const { command } = createCommand(['--platform', 'ios', '--non-interactive', '--no-force']);
    await expect(command.runAsync()).rejects.toThrow(
      'Existing simulator session in environment. Use --force to create a new simulator session.'
    );

    expect(mockCreateDeviceRunSessionAsync).not.toHaveBeenCalled();
  });

  it('resets .env.eas-simulator when the interactive wait observes the session end', async () => {
    mockByIdAsync
      .mockResolvedValueOnce(makeDeviceRunSession())
      .mockResolvedValueOnce(makeDeviceRunSession({ status: DeviceRunSessionStatus.Stopped }));

    const { command } = createCommand(['--platform', 'ios']);
    await command.runAsync();

    expect(mockResetSimulatorEnvAsync).toHaveBeenCalledWith(projectDir, 'session-123');
  });

  it('forwards --name to the create mutation', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--name',
      'Checkout regression',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ name: 'Checkout regression' })
    );
  });

  it('trims --name before sending it', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--name',
      '  Checkout regression  ',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ name: 'Checkout regression' })
    );
  });

  it('omits a blank --name instead of letting the server reject it', async () => {
    const { command } = createCommand(['--platform', 'ios', '--non-interactive', '--name', '   ']);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ name: undefined })
    );
  });

  it('forwards --device to the create mutation as deviceIdentifier', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--device',
      'iPhone 16 Pro',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ deviceIdentifier: 'iPhone 16 Pro' })
    );
  });

  it('trims --device before sending it', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--device',
      '  iPhone 16 Pro  ',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ deviceIdentifier: 'iPhone 16 Pro' })
    );
  });

  it('omits a blank --device', async () => {
    const { command } = createCommand(['--platform', 'ios', '--non-interactive', '--device', '  ']);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ deviceIdentifier: undefined })
    );
  });

  it('omits resourceClass when --resource-class is not set', async () => {
    const { command } = createCommand(['--platform', 'ios', '--non-interactive']);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync.mock.calls[0][1]).not.toHaveProperty('resourceClass');
  });

  it.each([
    ['large', DeviceRunSessionResourceClass.Large],
    ['medium', DeviceRunSessionResourceClass.Medium],
  ] as const)(
    'forwards --resource-class %s to the create mutation',
    async (flag, resourceClass) => {
      const { command } = createCommand([
        '--platform',
        'ios',
        '--non-interactive',
        '--resource-class',
        flag,
      ]);
      await command.runAsync();

      expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
        graphqlClient,
        expect.objectContaining({ resourceClass })
      );
    }
  );

  it('forwards --build-id to the create mutation', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--build-id',
      '  8d8b713c-1834-4bd3-91e6-46f895422cbc  ',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ buildId: '8d8b713c-1834-4bd3-91e6-46f895422cbc' })
    );
  });

  it('forwards --application-archive-url to the create mutation', async () => {
    const { command } = createCommand([
      '--platform',
      'android',
      '--non-interactive',
      '--application-archive-url',
      '  https://example.test/builds/app.apk  ',
    ]);
    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        applicationArchiveUrl: 'https://example.test/builds/app.apk',
      })
    );
  });

  it('warns that Android emulator support is still in development before creating a session', async () => {
    const { command } = createCommand(['--platform', 'android', '--non-interactive']);

    await command.runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      'Android emulator support in EAS Simulator is still in development. Some features available on iOS may not work on Android yet. Full parity with iOS is coming soon.'
    );
    expect(jest.mocked(Log.warn).mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateDeviceRunSessionAsync.mock.invocationCallOrder[0]
    );
  });

  it.each([
    ['ios', AppPlatform.Ios],
    ['android', AppPlatform.Android],
  ] as const)(
    'forwards Expo Go and the project SDK for %s when --expo-go is passed',
    async (platformFlag, appPlatform) => {
      const { command } = createCommand([
        '--platform',
        platformFlag,
        '--non-interactive',
        '--expo-go',
      ]);

      await command.runAsync();

      expect(mockResolveExpoGoSdkVersionAsync).toHaveBeenCalledWith({
        projectDir,
        sdkVersion: undefined,
      });
      expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
        graphqlClient,
        expect.objectContaining({
          expoGo: true,
          sdkVersion: '55.0.0',
          platform: appPlatform,
        })
      );
      expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
        graphqlClient,
        expect.not.objectContaining({ applicationArchiveUrl: expect.anything() })
      );
    }
  );

  it('uses --sdk-version to select Expo Go', async () => {
    mockResolveExpoGoSdkVersionAsync.mockResolvedValueOnce('57.0.0');
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--expo-go',
      '--sdk-version',
      '57.0.0',
    ]);

    await command.runAsync();

    expect(mockResolveExpoGoSdkVersionAsync).toHaveBeenCalledWith({
      projectDir,
      sdkVersion: '57.0.0',
    });
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ expoGo: true, sdkVersion: '57.0.0' })
    );
  });

  it('forwards repeated launch arguments and a URL to open', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--build-id',
      '8d8b713c-1834-4bd3-91e6-46f895422cbc',
      '--launch-arg',
      '--uitesting',
      '--launch-arg',
      'true',
      '--open-url',
      '  exp://example.test  ',
    ]);

    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        launchArgs: ['--uitesting', 'true'],
        openUrl: 'exp://example.test',
      })
    );
  });

  it('forwards repeated tags', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--tag',
      'variant:pro',
      '--tag',
      '  nightly  ',
    ]);

    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ tags: ['variant:pro', 'nightly'] })
    );
  });

  it('omits tags when every tag is blank', async () => {
    const { command } = createCommand(['--platform', 'ios', '--non-interactive', '--tag', '   ']);

    await command.runAsync();

    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.not.objectContaining({ tags: expect.anything() })
    );
  });

  it.each([
    ['--launch-arg', '--uitesting'],
    ['--open-url', 'exp://example.test'],
  ])('rejects %s without an application source', async (launchFlag, launchValue) => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      launchFlag,
      launchValue,
    ]);

    await expect(command.runAsync()).rejects.toThrow(
      'Launch options require an application source.'
    );
    expect(mockCreateDeviceRunSessionAsync).not.toHaveBeenCalled();
  });

  it('rejects --sdk-version without --expo-go', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--sdk-version',
      '57',
    ]);

    await expect(command.runAsync()).rejects.toThrow(
      'The --sdk-version flag can only be used with --expo-go.'
    );
    expect(mockResolveExpoGoSdkVersionAsync).not.toHaveBeenCalled();
    expect(mockCreateDeviceRunSessionAsync).not.toHaveBeenCalled();
  });

  it('rejects passing --build-id and --application-archive-url together', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--build-id',
      '8d8b713c-1834-4bd3-91e6-46f895422cbc',
      '--application-archive-url',
      'https://example.test/builds/app.tar.gz',
    ]);

    await expect(command.runAsync()).rejects.toThrow();
    expect(mockCreateDeviceRunSessionAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['--build-id', '8d8b713c-1834-4bd3-91e6-46f895422cbc'],
    ['--application-archive-url', 'https://example.test/builds/app.tar.gz'],
  ])('rejects passing --expo-go with %s', async (sourceFlag, sourceValue) => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--expo-go',
      sourceFlag,
      sourceValue,
    ]);

    await expect(command.runAsync()).rejects.toThrow();
    expect(mockResolveExpoGoSdkVersionAsync).not.toHaveBeenCalled();
    expect(mockCreateDeviceRunSessionAsync).not.toHaveBeenCalled();
  });

  it('stops the simulator session when interrupted before the session is ready', async () => {
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });
    let notifyQueryStarted: () => void = () => {};
    const queryStarted = new Promise<void>(resolve => {
      notifyQueryStarted = resolve;
    });
    mockByIdAsync.mockImplementationOnce(
      () =>
        new Promise(() => {
          notifyQueryStarted();
        })
    );
    const existingSigintListeners = new Set(process.listeners('SIGINT'));

    const { command } = createCommand(['--platform', 'ios', '--non-interactive']);
    const commandPromise = command.runAsync();
    await queryStarted;

    const sigintHandler = process
      .listeners('SIGINT')
      .find(listener => !existingSigintListeners.has(listener));
    expect(sigintHandler).toBeDefined();
    sigintHandler?.('SIGINT');
    await expect(commandPromise).rejects.toThrow('process.exit(130)');

    expect(mockEnsureDeviceRunSessionStoppedAsync).toHaveBeenCalledWith(
      graphqlClient,
      'session-123'
    );
    expect(mockResetSimulatorEnvAsync).toHaveBeenCalledWith(projectDir, 'session-123');
    expect(process.listeners('SIGINT')).toEqual([...existingSigintListeners]);
    processExitSpy.mockRestore();
  });

  it('prompts to select the platform when --platform is omitted', async () => {
    mockPromptAsync.mockResolvedValueOnce({ selectedPlatform: AppPlatform.Android });
    mockByIdAsync
      .mockResolvedValueOnce(makeDeviceRunSession())
      .mockResolvedValueOnce(makeDeviceRunSession({ status: DeviceRunSessionStatus.Stopped }));

    const { command } = createCommand([]);
    await command.runAsync();

    expect(mockPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'select', message: 'Select platform' })
    );
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ platform: AppPlatform.Android })
    );
  });

  it('prompts for the platform before warning about overwriting an existing session', async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'existing-session';
    mockPromptAsync.mockResolvedValueOnce({ selectedPlatform: AppPlatform.Ios });
    mockByIdAsync
      .mockResolvedValueOnce(makeDeviceRunSession())
      .mockResolvedValueOnce(makeDeviceRunSession({ status: DeviceRunSessionStatus.Stopped }));

    const { command } = createCommand([]);
    await command.runAsync();

    expect(mockPromptAsync).toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('Overwriting previous'));
    expect(mockPromptAsync.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(Log.warn).mock.invocationCallOrder[0]
    );
  });

  it('throws instead of prompting when --platform is omitted in non-interactive mode', async () => {
    const { command } = createCommand(['--non-interactive']);
    await expect(command.runAsync()).rejects.toThrow(
      'The --platform flag must be set when running in non-interactive mode.'
    );

    expect(mockPromptAsync).not.toHaveBeenCalled();
    expect(mockCreateDeviceRunSessionAsync).not.toHaveBeenCalled();
  });
});
