import { BuildTrigger, ErrorCode, Hooks, Ios, UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';

import { createTestIosJob } from '../../__tests__/utils/job';
import { BuildContext } from '../../context';
import { parseJobHooksAsync } from '../jobHooks';

const INSTALL: ['install_node_modules'] = ['install_node_modules'];

function createCtx(hooks: Hooks | undefined): {
  ctx: BuildContext<Ios.Job>;
  warn: jest.Mock;
} {
  const warn = jest.fn();
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn,
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
  return { ctx, warn };
}

describe(parseJobHooksAsync, () => {
  it('returns null when the job has no hooks', async () => {
    const { ctx } = createCtx(undefined);
    expect(await parseJobHooksAsync(ctx, INSTALL)).toBeNull();
  });

  it('parses a wrapped-anchor hook into one entry in a checked-out context', async () => {
    const { ctx } = createCtx({
      before_install_node_modules: [{ run: 'echo hi' }],
    });
    const parsed = await parseJobHooksAsync(ctx, INSTALL);
    expect(parsed).not.toBeNull();
    expect(parsed!.hookEntriesByKey.before_install_node_modules).toHaveLength(1);
    expect(parsed!.globalContext.wasCheckedOut()).toBe(true);
  });

  it('throws a shape error for a malformed step, tagged with the hooks error code', async () => {
    const { ctx } = createCtx({
      before_install_node_modules: [{} as never],
    });
    await expect(parseJobHooksAsync(ctx, INSTALL)).rejects.toThrow(
      'Invalid steps in "hooks.before_install_node_modules"'
    );
    await expect(parseJobHooksAsync(ctx, INSTALL)).rejects.toMatchObject({
      errorCode: ErrorCode.HOOKS_ERROR,
    });
  });

  it('treats an unknown hook key as inert and warns', async () => {
    const { ctx, warn } = createCtx({
      before_bogus: [{ run: 'echo hi' }],
    });
    const parsed = await parseJobHooksAsync(ctx, INSTALL);
    expect(parsed!.hookEntriesByKey).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown hook key "before_bogus"'));
  });

  it('shape-checks a registered-but-unwrapped key, then warns and skips it', async () => {
    const { ctx, warn } = createCtx({
      before_submit: [{ run: 'echo hi' }],
    });
    const parsed = await parseJobHooksAsync(ctx, INSTALL);
    expect(parsed!.hookEntriesByKey.before_submit).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hooks.before_submit'));
  });

  it('shape-validates a registered-but-unwrapped key even though it is skipped', async () => {
    const { ctx } = createCtx({
      before_submit: [{} as never],
    });
    await expect(parseJobHooksAsync(ctx, INSTALL)).rejects.toThrow(
      'Invalid steps in "hooks.before_submit"'
    );
  });

  it('accepts an empty-array opt-out without validating or constructing it', async () => {
    const { ctx } = createCtx({
      before_install_node_modules: [],
    });
    const parsed = await parseJobHooksAsync(ctx, INSTALL);
    expect(parsed!.hookEntriesByKey.before_install_node_modules).toBeUndefined();
  });

  it('errors on an unknown function under a wrapped key (construction, not shape)', async () => {
    const { ctx } = createCtx({
      before_install_node_modules: [{ uses: 'eas/nonexistent' }],
    });
    await expect(parseJobHooksAsync(ctx, INSTALL)).rejects.toThrow(
      'Failed to parse hooks.before_install_node_modules'
    );
  });

  it('parses a function group in an after-hook (no after-hook fence)', async () => {
    const { ctx } = createCtx({
      after_install_node_modules: [{ uses: 'eas/checkout' }],
    });
    const parsed = await parseJobHooksAsync(ctx, INSTALL);
    expect(parsed!.hookEntriesByKey.after_install_node_modules).toHaveLength(1);
  });

  it('shares one global context across the before and after entries of an anchor', async () => {
    const { ctx } = createCtx({
      before_install_node_modules: [{ run: 'echo before' }],
      after_install_node_modules: [{ run: 'echo after' }],
    });
    const parsed = await parseJobHooksAsync(ctx, INSTALL);
    const before = parsed!.hookEntriesByKey.before_install_node_modules![0];
    const after = parsed!.hookEntriesByKey.after_install_node_modules![0];
    expect(before.steps[0].ctx.global).toBe(parsed!.globalContext);
    expect(after.steps[0].ctx.global).toBe(parsed!.globalContext);
  });

  it('wraps a cross-key duplicate step id in the aggregate error', async () => {
    const { ctx } = createCtx({
      before_install_node_modules: [{ id: 'dup', run: 'echo a' }],
      after_install_node_modules: [{ id: 'dup', run: 'echo b' }],
    });
    const result = parseJobHooksAsync(ctx, INSTALL);
    await expect(result).rejects.toThrow(UserError);
    await expect(result).rejects.toMatchObject({
      errorCode: ErrorCode.HOOKS_ERROR,
      message: expect.stringContaining("The job's hooks are invalid"),
    });
  });
});
