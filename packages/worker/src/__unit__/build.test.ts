import { BuildContext, Builders } from '@expo/build-tools';
import { NativeBuilder, Platform, Workflow } from '@expo/eas-build-job';

import { build } from '../build';
import { logProjectDependenciesAsync } from '../external/analytics';

jest.mock('../runtimeEnvironment');
jest.mock('../displayRuntimeInfo');
jest.mock('../external/analytics', () => ({
  Event: {},
  logProjectDependenciesAsync: jest.fn(),
}));
jest.mock('@expo/build-tools', () => ({
  ...jest.requireActual('@expo/build-tools'),
  Builders: { androidBuilder: jest.fn(async () => ({})), iosBuilder: jest.fn(async () => ({})) },
}));

const analytics: any = { logEvent: jest.fn(), flushEventsAsync: jest.fn(async () => {}) };

function createContext(jobOverrides: Record<string, unknown>): any {
  const logger: any = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  const ctx = new BuildContext(
    { type: Workflow.GENERIC, ...jobOverrides } as any,
    {
      env: { __API_SERVER_URL: 'http://api.expo.test' },
      workingdir: '/tmp/build',
      logger,
      logBuffer: {},
      metadata: {},
    } as any
  );
  jest.spyOn(ctx, 'runBuildPhase').mockImplementation(async (_phase, body) => await body());
  return ctx;
}

describe(build, () => {
  it('reports the project dependencies of a build job', async () => {
    const ctx = createContext({ platform: Platform.IOS });

    await build({ ctx, buildId: 'id', analytics });

    expect(Builders.iosBuilder).toHaveBeenCalledWith(ctx);
    expect(logProjectDependenciesAsync).toHaveBeenCalledTimes(1);
  });

  it('does not read the project dependencies of a build job that carries a builder', async () => {
    const ctx = createContext({ platform: Platform.IOS, builder: NativeBuilder.XCODE });

    await build({ ctx, buildId: 'id', analytics });

    expect(Builders.iosBuilder).toHaveBeenCalledWith(ctx);
    expect(logProjectDependenciesAsync).not.toHaveBeenCalled();
  });
});
