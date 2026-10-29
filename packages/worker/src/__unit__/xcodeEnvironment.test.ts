import { BuildContext, Builders, TurtleSshSession, runGenericJobAsync } from '@expo/build-tools';
import { BuildPhase, EnvironmentSecretType, Platform, Workflow } from '@expo/eas-build-job';
import spawn, { SpawnResult } from '@expo/turtle-spawn';

import { build } from '../build';
import { prepareRuntimeEnvironment, prepareXcodeBuildEnvAsync } from '../runtimeEnvironment';

jest.mock('@expo/turtle-spawn');
jest.mock('../runtimeEnvironment', () => ({
  ...jest.requireActual('../runtimeEnvironment'),
  prepareRuntimeEnvironment: jest.fn(),
}));
jest.mock('../displayRuntimeInfo');
jest.mock('../external/analytics', () => ({
  Event: {},
  logProjectDependenciesAsync: jest.fn(),
}));
jest.mock('@expo/build-tools', () => ({
  ...jest.requireActual('@expo/build-tools'),
  Builders: { androidBuilder: jest.fn(), iosBuilder: jest.fn() },
  runGenericJobAsync: jest.fn(),
}));

const key = 'DELIVER_ALTOOL_ADDITIONAL_UPLOAD_PARAMETERS';
const result: SpawnResult = {
  stdout: 'Xcode 26.0\nBuild version 17A324',
  stderr: '',
  output: [],
  status: 0,
  signal: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

function createContext(
  platform: Platform | undefined = undefined,
  env = {},
  jobOverrides = {}
): any {
  const logger: any = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  const ctx = new BuildContext(
    { platform, type: Workflow.GENERIC, builderEnvironment: { env }, ...jobOverrides } as any,
    {
      env: { __API_SERVER_URL: 'http://api.expo.test', PATH: '/original/bin', ...env },
      workingdir: '/tmp/build',
      logger,
      logBuffer: {},
      metadata: {},
    } as any
  );
  jest.spyOn(ctx, 'runBuildPhase').mockImplementation(async (_phase, body) => await body());
  return ctx;
}
const analytics: any = { logEvent: jest.fn(), flushEventsAsync: jest.fn(async () => {}) };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(spawn).mockReset().mockResolvedValue(result);
  jest.mocked(prepareRuntimeEnvironment).mockReset().mockResolvedValue();
  jest.spyOn(TurtleSshSession, 'isSshEnabled').mockReturnValue(false);
  jest.mocked(runGenericJobAsync).mockResolvedValue({ runResult: { ok: true } } as any);
  jest.mocked(Builders.iosBuilder).mockResolvedValue({});
  jest.mocked(Builders.androidBuilder).mockResolvedValue({});
});
afterEach(() => jest.restoreAllMocks());

it.each(['Xcode 26.0', 'Xcode 26.0.1', 'Xcode 26.6', 'Xcode 27.0'])(
  'retains the existing version match for %s',
  async version => {
    jest.mocked(spawn).mockResolvedValue({ ...result, stdout: version });
    const ctx = createContext(Platform.IOS);
    await prepareXcodeBuildEnvAsync(ctx.env);
    expect(ctx.env[key]).toBe(version.includes('Xcode 26.0') ? '--use-old-altool' : undefined);
    expect(spawn).toHaveBeenCalledWith('xcodebuild', ['-version'], {
      env: expect.objectContaining({ PATH: expect.any(String) }),
      stdio: 'pipe',
    });
  }
);

it.each([undefined, Platform.IOS, Platform.ANDROID])(
  'queries Xcode for jobs with platform %s',
  async platform => {
    const ctx = createContext(platform);
    await prepareXcodeBuildEnvAsync(ctx.env);
    expect(spawn).toHaveBeenCalledTimes(1);
  }
);

it.each(['--custom-upload-option', ''])('preserves an explicit job override %p', async value => {
  const ctx = createContext(Platform.IOS, { [key]: value });
  await prepareXcodeBuildEnvAsync(ctx.env);
  expect(ctx.env[key]).toBe(value);
});

it('preserves an environment secret override', async () => {
  const ctx = createContext(
    Platform.IOS,
    {},
    {
      secrets: {
        environmentSecrets: [
          { name: key, value: '--secret-option', type: EnvironmentSecretType.STRING },
        ],
      },
    }
  );
  await prepareXcodeBuildEnvAsync(ctx.env);
  expect(ctx.env[key]).toBe('--secret-option');
});

it('preserves an existing worker value', async () => {
  const ctx = createContext(Platform.IOS);
  ctx.env[key] = '--inherited';
  await prepareXcodeBuildEnvAsync(ctx.env);
  expect(ctx.env[key]).toBe('--inherited');
});

it.each([
  new Error('ENOENT'),
  Object.assign(new Error('exit 1'), { stdout: 'not Xcode' }),
  Object.assign(new Error('exit 1'), { stdout: 'Xcode 26.0' }),
])('keeps query errors nonfatal', async error => {
  jest.mocked(spawn).mockRejectedValue(error);
  const ctx = createContext();
  await expect(prepareXcodeBuildEnvAsync(ctx.env)).resolves.toBeUndefined();
  expect(ctx.env[key]).toBeUndefined();
});

it.each([undefined, Platform.IOS, Platform.ANDROID])(
  'starts the Xcode query without blocking the %s builder',
  async platform => {
    const xcode = deferred<SpawnResult>();
    const tools = deferred<void>();
    jest.mocked(spawn).mockReturnValue(xcode.promise as any);
    jest.mocked(prepareRuntimeEnvironment).mockImplementation(async ctx => {
      await tools.promise;
      ctx.env.PATH = '/custom/bin';
    });
    const ctx = createContext(platform);
    const consume =
      platform === Platform.IOS
        ? Builders.iosBuilder
        : platform === Platform.ANDROID
          ? Builders.androidBuilder
          : runGenericJobAsync;
    let snapshot: Record<string, string | undefined> | undefined;
    jest.mocked(consume).mockImplementation(async context => {
      snapshot = { ...context.env };
      return platform ? {} : ({ runResult: { ok: true } } as any);
    });
    const building = build({ ctx, buildId: 'id', analytics });
    await new Promise(resolve => setImmediate(resolve));
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(prepareRuntimeEnvironment).toHaveBeenCalledTimes(1);
    tools.resolve();
    await building;
    expect(consume).toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ job: expect.anything() }),
      'Builder is ready, starting build'
    );
    expect(ctx.runBuildPhase).toHaveBeenCalledWith(
      BuildPhase.SPIN_UP_BUILDER,
      expect.any(Function),
      { doNotMarkStart: true }
    );
    expect(snapshot?.[key]).toBeUndefined();
    xcode.resolve(result);
    await new Promise(resolve => setImmediate(resolve));
    expect(ctx.env[key]).toBe('--use-old-altool');
    expect(snapshot?.[key]).toBeUndefined();
    expect(snapshot?.PATH).toBe('/custom/bin');
    expect(ctx.runBuildPhase).toHaveBeenCalledWith(
      BuildPhase.INSTALL_CUSTOM_TOOLS,
      expect.any(Function)
    );
  }
);

it('waits for tool preparation when the Xcode query finishes first', async () => {
  const tools = deferred<void>();
  jest.mocked(prepareRuntimeEnvironment).mockReturnValue(tools.promise);
  const ctx = createContext();
  const building = build({ ctx, buildId: 'id', analytics });
  await new Promise(resolve => setImmediate(resolve));
  expect(ctx.env[key]).toBe('--use-old-altool');
  expect(runGenericJobAsync).not.toHaveBeenCalled();
  tools.resolve();
  await building;
});

it('runs the query even without builder customizations', async () => {
  const ctx = createContext(undefined, {}, { builderEnvironment: undefined });
  await build({ ctx, buildId: 'id', analytics });
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(prepareRuntimeEnvironment).not.toHaveBeenCalled();
});

it('observes a late Xcode rejection when tool preparation has already failed', async () => {
  const xcode = deferred<SpawnResult>();
  jest.mocked(spawn).mockReturnValue(xcode.promise as any);
  jest.mocked(prepareRuntimeEnvironment).mockRejectedValue(new Error('tools failed'));
  await expect(build({ ctx: createContext(), buildId: 'id', analytics })).rejects.toThrow(
    'tools failed'
  );
  xcode.reject(new Error('xcodebuild unavailable'));
  await new Promise(resolve => setImmediate(resolve));
  expect(runGenericJobAsync).not.toHaveBeenCalled();
});
