import { Android, BuildTrigger } from '@expo/eas-build-job';

import { createTestAndroidJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { resolveEnvFromBuildProfileAsync, runEasBuildInternalAsync } from '../easBuildInternal';
import { runHookableBuildPhaseAsync } from '../hookableBuildPhase';
import { JobHooksRef, setupAsync } from '../setup';
import { ParsedJobHooks, parseJobHooksAsync } from '../jobHooks';
import { prepareProjectSourcesAsync } from '../projectSources';
import { runHookIfPresent } from '../../utils/hooks';

jest.mock('../projectSources', () => ({ prepareProjectSourcesAsync: jest.fn() }));
jest.mock('../easBuildInternal', () => ({
  resolveEnvFromBuildProfileAsync: jest.fn(),
  runEasBuildInternalAsync: jest.fn(),
}));
jest.mock('../hookableBuildPhase', () => ({ runHookableBuildPhaseAsync: jest.fn() }));
jest.mock('../jobHooks', () => ({ parseJobHooksAsync: jest.fn() }));
jest.mock('../../utils/npmrc', () => ({ setUpNpmrcAsync: jest.fn() }));
jest.mock('../../utils/hooks', () => ({
  Hook: { PRE_INSTALL: 'PRE_INSTALL' },
  runHookIfPresent: jest.fn(),
}));
jest.mock('../../utils/project', () => ({
  readAndLogPackageJson: jest.fn(() => ({})),
  readEasJsonContents: jest.fn(() => '{}'),
  readPackageJson: jest.fn(() => ({})),
}));
jest.mock('../../ios/xcodeEnv', () => ({ deleteXcodeEnvLocalIfExistsAsync: jest.fn() }));

// A sentinel the parse mock returns; the install wrapper must receive exactly it.
const PARSED = { sentinel: true } as unknown as ParsedJobHooks;

describe(setupAsync, () => {
  let order: string[];

  function createCtx(triggeredBy: BuildTrigger): BuildContext<Android.Job> {
    const ctx = new BuildContext<Android.Job>(
      { ...createTestAndroidJob(), triggeredBy },
      {
        env: { __API_SERVER_URL: 'http://api.expo.test' },
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        logger: createMockLogger(),
        uploadArtifact: jest.fn(),
        workingdir: '/workingdir',
      }
    );
    // Run each phase closure inline; skip the phase markers.
    jest
      .spyOn(ctx, 'runBuildPhase')
      .mockImplementation((_phase, fn: () => Promise<unknown>) => fn() as never);
    // READ_APP_CONFIG reads this; a minimal config passes validateAppConfigAsync
    // and the EAS_BUILD_INTERNAL bundle-id/package checks.
    jest.spyOn(ctx, 'appConfig', 'get').mockReturnValue(
      Promise.resolve({
        android: { package: 'com.test' },
        ios: { bundleIdentifier: 'com.test' },
      } as never)
    );
    return ctx;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    order = [];
    jest.mocked(prepareProjectSourcesAsync).mockImplementation(async () => {
      order.push('prepare-project');
      return { handled: false };
    });
    jest.mocked(resolveEnvFromBuildProfileAsync).mockImplementation(async () => {
      order.push('profile-env');
      return {};
    });
    jest.mocked(runHookIfPresent).mockImplementation(async () => {
      order.push('pre-install-hook');
    });
    jest.mocked(parseJobHooksAsync).mockImplementation(async () => {
      order.push('parse-hooks');
      return PARSED;
    });
    jest.mocked(runHookableBuildPhaseAsync).mockImplementation(async () => {
      // Record the wrapper call; deliberately do NOT run its `fn` so the install
      // internals stay out of the ordering test.
      order.push('install-wrapper');
      return undefined as never;
    });
    jest.mocked(runEasBuildInternalAsync).mockImplementation(async ({ job }) => ({
      newJob: job,
      newMetadata: {} as never,
    }));
  });

  it('parses hooks after project prep + profile-env + pre-install hook, and before the install wrapper', async () => {
    const jobHooksRef: JobHooksRef = { current: null };
    await setupAsync(createCtx(BuildTrigger.GIT_BASED_INTEGRATION), {
      wrappedAnchors: ['install_node_modules'],
      jobHooksRef,
    });
    const parseAt = order.indexOf('parse-hooks');
    expect(order.indexOf('prepare-project')).toBeLessThan(parseAt);
    expect(order.indexOf('profile-env')).toBeLessThan(parseAt);
    expect(order.indexOf('pre-install-hook')).toBeLessThan(parseAt);
    expect(parseAt).toBeLessThan(order.indexOf('install-wrapper'));
  });

  it('parses hooks unconditionally on a non-git-based build (never parked in the git-only branch)', async () => {
    const jobHooksRef: JobHooksRef = { current: null };
    await setupAsync(createCtx(BuildTrigger.EAS_CLI), {
      wrappedAnchors: ['install_node_modules'],
      jobHooksRef,
    });
    expect(parseJobHooksAsync).toHaveBeenCalledTimes(1);
    // The profile-env block is git-only; the parse must not be coupled to it.
    expect(resolveEnvFromBuildProfileAsync).not.toHaveBeenCalled();
    expect(order.indexOf('parse-hooks')).toBeLessThan(order.indexOf('install-wrapper'));
  });

  it('publishes the parsed hooks to the ref before the install wrapper runs', async () => {
    const jobHooksRef: JobHooksRef = { current: null };
    await setupAsync(createCtx(BuildTrigger.GIT_BASED_INTEGRATION), {
      wrappedAnchors: ['install_node_modules'],
      jobHooksRef,
    });
    expect(jobHooksRef.current).toBe(PARSED);
    // The wrapper received the same parsed hooks the ref holds.
    expect(runHookableBuildPhaseAsync).toHaveBeenCalledWith(
      expect.objectContaining({ hooks: PARSED, anchor: 'install_node_modules' })
    );
  });
});
