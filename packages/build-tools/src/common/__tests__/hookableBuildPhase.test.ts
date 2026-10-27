import { BuildPhase, BuildTrigger, Hooks, Ios } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { executeHookStepsAsync } from '@expo/steps';

import { createTestIosJob } from '../../__tests__/utils/job';
import { BuildContext } from '../../context';
import { runHookableBuildPhaseAsync } from '../hookableBuildPhase';
import { ParsedJobHooks, parseJobHooksAsync } from '../jobHooks';

// The primitive's step-execution rules (failure()/success(), no-if continuation,
// metric emission) are covered in @expo/steps. Here we mock it to unit-test the
// wrapper's own orchestration: ordering, error precedence, and the env bridge.
jest.mock('@expo/steps', () => ({
  ...jest.requireActual('@expo/steps'),
  executeHookStepsAsync: jest.fn(),
}));
const executeHookStepsMock = jest.mocked(executeHookStepsAsync);

async function setup(hooks: Hooks | undefined): Promise<{
  ctx: BuildContext<Ios.Job>;
  hooks: ParsedJobHooks | null;
}> {
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(() => logger),
  } as unknown as bunyan;
  const ctx = new BuildContext<Ios.Job>(
    { ...createTestIosJob({ triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION }), hooks },
    {
      env: { __API_SERVER_URL: 'http://api.expo.test' },
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger,
      uploadArtifact: jest.fn(),
      workingdir: '/tmp/wd',
    }
  );
  jest
    .spyOn(ctx, 'runBuildPhase')
    .mockImplementation((_phase: BuildPhase, fn: () => Promise<unknown>) => fn() as never);
  return { ctx, hooks: await parseJobHooksAsync(ctx, ['install_node_modules']) };
}

const runArgs = <TJob extends Ios.Job>(
  ctx: BuildContext<TJob>,
  hooks: ParsedJobHooks | null,
  fn: () => Promise<unknown>
): Parameters<typeof runHookableBuildPhaseAsync>[0] => ({
  ctx,
  hooks,
  buildPhase: BuildPhase.INSTALL_DEPENDENCIES,
  anchor: 'install_node_modules',
  fn,
});

describe(runHookableBuildPhaseAsync, () => {
  beforeEach(() => {
    executeHookStepsMock.mockReset();
    executeHookStepsMock.mockResolvedValue({ failedLocally: false, firstError: undefined });
  });

  it('runs the phase once with no hook execution when there are no hooks', async () => {
    const { ctx, hooks } = await setup(undefined);
    const fn = jest.fn().mockResolvedValue('ok');
    expect(await runHookableBuildPhaseAsync(runArgs(ctx, hooks, fn))).toBe('ok');
    expect(ctx.runBuildPhase).toHaveBeenCalledTimes(1);
    expect(executeHookStepsMock).not.toHaveBeenCalled();
  });

  it('runs before -> phase -> after in order and returns the phase result', async () => {
    const { ctx, hooks } = await setup({
      before_install_node_modules: [{ run: 'echo before' }],
      after_install_node_modules: [{ run: 'echo after' }],
    });
    const order: string[] = [];
    executeHookStepsMock.mockImplementation(async (_ctx, _entries, opts) => {
      order.push(opts.timing);
      return { failedLocally: false, firstError: undefined };
    });
    const fn = jest.fn().mockImplementation(async () => {
      order.push('phase');
      return 'result';
    });
    expect(await runHookableBuildPhaseAsync(runArgs(ctx, hooks, fn))).toBe('result');
    expect(order).toEqual(['before', 'phase', 'after']);
    expect(executeHookStepsMock).toHaveBeenLastCalledWith(hooks!.globalContext, expect.anything(), {
      anchor: 'install_node_modules',
      timing: 'after',
      anchorResult: 'success',
    });
  });

  it('skips the phase and after-hooks when a before-hook fails', async () => {
    const { ctx, hooks } = await setup({
      before_install_node_modules: [{ run: 'echo before' }],
      after_install_node_modules: [{ run: 'echo after' }],
    });
    executeHookStepsMock.mockResolvedValue({
      failedLocally: true,
      firstError: new Error('before boom'),
    });
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(runHookableBuildPhaseAsync(runArgs(ctx, hooks, fn))).rejects.toThrow(
      'Hook "before_install_node_modules" failed'
    );
    expect(fn).not.toHaveBeenCalled();
    expect(executeHookStepsMock).toHaveBeenCalledTimes(1);
  });

  it('throws the after-hook error when the phase succeeded but an after-hook fails', async () => {
    const { ctx, hooks } = await setup({
      after_install_node_modules: [{ run: 'echo after' }],
    });
    executeHookStepsMock.mockResolvedValue({
      failedLocally: true,
      firstError: new Error('after boom'),
    });
    await expect(
      runHookableBuildPhaseAsync(runArgs(ctx, hooks, jest.fn().mockResolvedValue('ok')))
    ).rejects.toThrow('Hook "after_install_node_modules" failed');
  });

  it('lets the phase error win over a failing after-hook, marking the context failed', async () => {
    const { ctx, hooks } = await setup({
      after_install_node_modules: [{ run: 'echo after' }],
    });
    const markAsFailed = jest.spyOn(hooks!.globalContext, 'markAsFailed');
    executeHookStepsMock.mockResolvedValue({
      failedLocally: true,
      firstError: new Error('after boom'),
    });
    await expect(
      runHookableBuildPhaseAsync(
        runArgs(ctx, hooks, jest.fn().mockRejectedValue(new Error('phase boom')))
      )
    ).rejects.toThrow('phase boom');
    // after ran against the failed anchor
    expect(markAsFailed).toHaveBeenCalled();
    expect(executeHookStepsMock).toHaveBeenLastCalledWith(hooks!.globalContext, expect.anything(), {
      anchor: 'install_node_modules',
      timing: 'after',
      anchorResult: 'failed',
    });
  });

  it('refreshes the hook context before and writes env back after each hook', async () => {
    const { ctx, hooks } = await setup({
      before_install_node_modules: [{ run: 'echo before' }],
    });
    const forwardRefresh = jest.spyOn(hooks!.customBuildContext, 'updateEnv');
    const writeBack = jest.spyOn(ctx, 'updateEnv');
    // Captured before the run: the reverse write-back replaces ctx.env, so
    // comparing the forward-refresh arg against the post-run ctx.env would drift.
    const envBeforeRun = ctx.env;
    await runHookableBuildPhaseAsync(runArgs(ctx, hooks, jest.fn().mockResolvedValue('ok')));
    expect(forwardRefresh).toHaveBeenCalledWith(envBeforeRun);
    // The job/metadata snapshot is synced onto the hook context before the hook.
    expect(hooks!.customBuildContext.job).toBe(ctx.job);
    expect(hooks!.customBuildContext.metadata).toBe(ctx.metadata);
    expect(writeBack).toHaveBeenCalled();
  });
});
