import { BuildContext, Builders } from '@expo/build-tools';
import { Platform } from '@expo/eas-build-job';

import { build, warnOnUnknownEnvironment } from '../build';
import { Analytics } from '../external/analytics';

jest.mock('@expo/build-tools', () => {
  const actual = jest.requireActual('@expo/build-tools');
  return {
    ...actual,
    Builders: {
      androidBuilder: jest.fn(async () => ({})),
      iosBuilder: jest.fn(async () => ({})),
    },
  };
});
jest.mock('../displayRuntimeInfo', () => ({ displayWorkerRuntimeInfo: jest.fn() }));
jest.mock('../workingdir', () => ({ cleanUpWorkingdir: jest.fn() }));
jest.mock('../external/analytics', () => ({
  ...jest.requireActual('../external/analytics'),
  logProjectDependenciesAsync: jest.fn(),
}));

function createEnvironmentWarningCtx(environment?: string) {
  return {
    metadata: environment === undefined ? undefined : { environment },
    markBuildPhaseHasWarnings: jest.fn(),
    logger: { warn: jest.fn() },
  };
}

describe(warnOnUnknownEnvironment.name, () => {
  it('warns and marks the phase for an unknown environment', () => {
    const ctx = createEnvironmentWarningCtx('staging');
    warnOnUnknownEnvironment(ctx);
    expect(ctx.markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown environment "staging"')
    );
  });

  it.each(['development', 'preview', 'production'])('does not warn for %s', environment => {
    const ctx = createEnvironmentWarningCtx(environment);
    warnOnUnknownEnvironment(ctx);
    expect(ctx.markBuildPhaseHasWarnings).not.toHaveBeenCalled();
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  it('does not warn when no environment is set', () => {
    const ctx = createEnvironmentWarningCtx(undefined);
    warnOnUnknownEnvironment(ctx);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });
});

describe(build.name, () => {
  it('warns during spin-up when the job environment is unknown', async () => {
    const warn = jest.fn();
    const markBuildPhaseHasWarnings = jest.fn();
    const ctx = {
      metadata: { environment: 'staging' },
      job: { platform: Platform.ANDROID },
      logger: { info: jest.fn(), warn, child: jest.fn() },
      markBuildPhaseHasWarnings,
      runBuildPhase: jest.fn(async (_phase, callback) => callback()),
    } as unknown as BuildContext;
    const analytics = { logEvent: jest.fn(), flushEventsAsync: jest.fn() } as unknown as Analytics;

    await build({ ctx, buildId: 'build-id', analytics });

    expect(Builders.androidBuilder).toHaveBeenCalled();
    expect(markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown environment "staging"'));
  });
});
