import { SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'fs/promises';
import { vol } from 'memfs';
import path from 'path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import * as parser from '../maestroResultParser';
import { createRunMaestroTestsBuildFunction } from '../runMaestroTests';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../utils/retry', () => ({
  ...jest.requireActual('../../../utils/retry'),
  sleepAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockedSpawn = jest.mocked(spawn);

const SPAWN_SUCCESS = {
  status: 0,
  pid: 1,
  output: [''],
  stdout: '',
  stderr: '',
  signal: null,
} as any;

const rejectExit1 = (): Error => {
  const e: any = new Error('exit 1');
  e.status = 1;
  return e;
};

function createStep(
  callInputs?: Record<string, unknown>,
  options: { env?: Record<string, string | undefined> } = {}
): ReturnType<
  ReturnType<typeof createRunMaestroTestsBuildFunction>['createBuildStepFromFunctionCall']
> {
  const logger = createMockLogger();
  const fn = createRunMaestroTestsBuildFunction();
  const globalCtx = createGlobalContextMock({ logger });
  globalCtx.updateEnv(options.env ?? { HOME: '/home/expo' });
  return fn.createBuildStepFromFunctionCall(globalCtx, { callInputs });
}

describe('createRunMaestroTestsBuildFunction', () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
    // Phase 3 (copy-latest) runs after the retry loop for junit mode.
    // Default-stub it so tests that don't care about Phase 3 don't hit the
    // real disk. Individual tests override this via mockRejectedValue.
    jest.restoreAllMocks();
    jest.spyOn(parser, 'copyLatestAttemptXml').mockResolvedValue();
  });

  it('exports a factory that returns a BuildFunction instance', () => {
    expect(createRunMaestroTestsBuildFunction()).toBeDefined();
  });

  it('Phase 1 sets all outputs before running any flows', async () => {
    // Make spawn reject so the step still throws; we're locking in that outputs
    // are set BEFORE the spawn call (downstream `upload_artifact` fails if
    // `final_report_path` is empty).
    mockedSpawn.mockRejectedValue(new Error('stop'));

    const step = createStep({ flow_paths: ['flows/a.yaml'], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow();

    expect(step.getOutputValueByName('junit_report_directory')).toMatch(
      /\.maestro\/tests\/junit-reports$/
    );
    expect(step.getOutputValueByName('tests_directory')).toMatch(/\.maestro\/tests$/);
    expect(step.getOutputValueByName('final_report_path')).toMatch(
      /\.maestro\/tests\/android-maestro-junit\.xml$/
    );
  });

  it('succeeds when maestro exits 0 on first attempt', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const step = createStep({
      flow_paths: ['flows/a.yaml', 'flows/b.yaml'],
      output_format: 'junit',
      platform: 'android',
    });

    await step.executeAsync();

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = mockedSpawn.mock.calls[0];
    expect(cmd).toBe('maestro');
    expect(args).toEqual(expect.arrayContaining(['test', 'flows/a.yaml', 'flows/b.yaml']));
    expect(args).toEqual(expect.arrayContaining(['--format=JUNIT']));
    expect(args!.join(' ')).toMatch(/--output=.*android-maestro-junit-attempt-0\.xml/);
  });

  it('throws SystemError when spawn fails with ENOENT (binary missing)', async () => {
    mockedSpawn.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    const step = createStep({ flow_paths: ['a.yaml'], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow(SystemError);
  });

  it('throws SystemError for unknown-shape spawn rejections', async () => {
    mockedSpawn.mockRejectedValue(new Error('mystery'));
    const step = createStep({ flow_paths: ['a.yaml'], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow(SystemError);
  });

  it('throws SystemError on signal-only spawn rejections (OOM / SIGTERM)', async () => {
    mockedSpawn.mockRejectedValue(
      Object.assign(new Error('killed'), {
        status: null,
        signal: 'SIGKILL',
        stdout: '',
        stderr: '',
        output: ['', ''],
        pid: 1,
      })
    );
    const step = createStep({ flow_paths: ['a.yaml'], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow(SystemError);
  });

  it('treats reject-with-status as a retryable test failure', async () => {
    const rejectWithExit = (status: number): Error =>
      Object.assign(new Error(`maestro exited with non-zero code: ${status}`), {
        status,
        signal: null,
        stdout: '',
        stderr: '',
        output: ['', ''],
        pid: 1,
      });
    mockedSpawn.mockRejectedValueOnce(rejectWithExit(1)).mockResolvedValueOnce(SPAWN_SUCCESS);
    // Default `retries` is 0, so even though the first attempt rejects with
    // `status: 1`, no retry occurs and Phase 4 throws UserError. Spawn ran once.
    const step = createStep({ flow_paths: ['a.yaml'], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('retries all flows on failure (matching legacy bash behavior)', async () => {
    const spawnMock = mockedSpawn
      .mockRejectedValueOnce(rejectExit1())
      .mockResolvedValueOnce(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml', 'flows/b.yaml', 'flows/c.yaml'],
      retries: 1,
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml', 'flows/c.yaml'])
    );
    expect(spawnMock.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml', 'flows/c.yaml'])
    );
  });

  it('writes final report via copyLatestAttemptXml on success', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const copySpy = jest.spyOn(parser, 'copyLatestAttemptXml').mockResolvedValue();

    const step = createStep({
      flow_paths: ['a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    expect(copySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: expect.stringContaining('junit-reports'),
        outputPath: expect.stringContaining('android-maestro-junit.xml'),
      })
    );
  });

  it('throws SystemError when copyLatestAttemptXml fails', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    jest
      .spyOn(parser, 'copyLatestAttemptXml')
      .mockRejectedValue(Object.assign(new Error('no space'), { code: 'ENOSPC' }));

    const step = createStep({
      flow_paths: ['a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(SystemError);
  });

  it('throws UserError when retries are exhausted with a non-zero exit', async () => {
    mockedSpawn.mockRejectedValue(
      Object.assign(new Error('exit 1'), {
        status: 1,
        signal: null,
        stdout: '',
        stderr: '',
        output: ['', ''],
        pid: 1,
      })
    );

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      retries: 2,
      output_format: 'junit',
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError early on empty flow_paths', async () => {
    const step = createStep({ flow_paths: [], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('uses legacy $HOME/.maestro/tests output path for non-junit formats (e.g. html)', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: 'html',
      platform: 'android',
    });
    await step.executeAsync();

    const args = mockedSpawn.mock.calls[0][1] as string[];
    // Non-JUnit uses a fixed path inside $HOME/.maestro/tests so the
    // whole-directory upload picks it up. Matches legacy bash behavior.
    const outputArg = args.find(a => a.startsWith('--output='));
    expect(outputArg).toMatch(/\.maestro\/tests\/android-maestro-html\.html$/);
    expect(outputArg).not.toMatch(/junit-reports/);
  });

  it('uses lowercase extension for non-junit formats regardless of input casing', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: 'HTML',
      platform: 'ios',
    });
    await step.executeAsync();

    const args = mockedSpawn.mock.calls[0][1] as string[];
    const outputArg = args.find(a => a.startsWith('--output='));
    expect(outputArg).toMatch(/\.maestro\/tests\/ios-maestro-html\.html$/);
  });

  it('does not include --output when output_format is undefined', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: '',
      platform: 'android',
    });
    await step.executeAsync();

    const args = mockedSpawn.mock.calls[0][1] as string[];
    expect(args.some(a => a.startsWith('--output'))).toBe(false);
    expect(args).not.toContain('--output');
    expect(args).not.toContain('--output=undefined');
    expect(args).not.toContain('--output=null');
    expect(args).not.toContain('--output=');
  });

  it('cleans stale per-attempt JUnit files from junit-reports/ before running', async () => {
    // Pre-populate a stale attempt file from a previous run. On reused
    // runners (local builds, non-isolated workers) these files would
    // otherwise poison copyLatestAttemptXml (picks highest-N).
    // Paths derive from env.HOME (which createStep sets to '/home/expo')
    // rather than os.homedir(), matching the step's Phase-1 path derivation.
    const testsDir = path.join('/home/expo', '.maestro', 'tests');
    const junitDir = path.join(testsDir, 'junit-reports');
    const staleAttemptPath = path.join(junitDir, 'android-maestro-junit-attempt-5.xml');
    const staleFinalPath = path.join(testsDir, 'android-maestro-junit.xml');
    vol.fromJSON({
      [staleAttemptPath]:
        '<testsuites><testsuite><testcase name="STALE" status="SUCCESS"/></testsuite></testsuites>',
      [staleFinalPath]: '<stale-final/>',
    });

    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    await expect(fs.access(staleAttemptPath)).rejects.toThrow();
    await expect(fs.access(staleFinalPath)).rejects.toThrow();
  });

  it('removes attempt files from other platforms during cleanup', async () => {
    // junit-reports/ is per-run scratch space. A prior iOS run's stale
    // `ios-maestro-junit-attempt-*.xml` would otherwise poison
    // copyLatestAttemptXml (picks highest-N). Cleanup must wipe ALL stale
    // *.xml files, not just those for the current platform.
    // Paths derive from env.HOME (which createStep sets to '/home/expo')
    // rather than os.homedir(), matching the step's Phase-1 path derivation.
    const junitDir = path.join('/home/expo', '.maestro', 'tests', 'junit-reports');
    const androidStale = path.join(junitDir, 'android-maestro-junit-attempt-3.xml');
    const iosStale = path.join(junitDir, 'ios-maestro-junit-attempt-3.xml');
    vol.fromJSON({
      [androidStale]: '<testsuites><testsuite></testsuite></testsuites>',
      [iosStale]: '<testsuites><testsuite></testsuite></testsuites>',
    });

    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    // Both android and ios stale files are removed
    await expect(fs.access(androidStale)).rejects.toThrow();
    await expect(fs.access(iosStale)).rejects.toThrow();
  });

  it('accepts output_format casing variations (e.g. JUNIT) case-insensitively', async () => {
    // Old bash path normalized output_format via .toLowerCase(); this step
    // must match that behavior end-to-end: final_report_path populated,
    // per-attempt XMLs written into junit-reports/, Phase 3 copy invoked.
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const copySpy = jest.spyOn(parser, 'copyLatestAttemptXml').mockResolvedValue();

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: 'JUNIT',
      platform: 'android',
    });
    await step.executeAsync();

    expect(step.getOutputValueByName('final_report_path')).toMatch(
      /\.maestro\/tests\/android-maestro-junit\.xml$/
    );
    const args = mockedSpawn.mock.calls[0][1] as string[];
    const outputArg = args.find(a => a.startsWith('--output='));
    expect(outputArg).toMatch(/junit-reports\/android-maestro-junit-attempt-0\.xml$/);
    expect(copySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: expect.stringContaining('junit-reports'),
        outputPath: expect.stringContaining('android-maestro-junit.xml'),
      })
    );
  });

  it('passes include_tags, exclude_tags, and shards through to maestro argv', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: 'junit',
      platform: 'android',
      shards: 3,
      include_tags: 'smoke,critical',
      exclude_tags: 'slow',
    });
    await step.executeAsync();

    const args = mockedSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--shard-split=3');
    expect(args).toContain('--include-tags=smoke,critical');
    expect(args).toContain('--exclude-tags=slow');
  });

  it('passes cwd and env to spawn so relative flow paths resolve correctly', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    const spawnOptions = mockedSpawn.mock.calls[0][2] as {
      cwd?: string;
      env?: Record<string, string | undefined>;
    };
    expect(spawnOptions).toBeDefined();
    expect(typeof spawnOptions.cwd).toBe('string');
    expect(spawnOptions.cwd!.length).toBeGreaterThan(0);
    expect(spawnOptions.env).toBeDefined();
    expect(spawnOptions.env!.HOME).toBe('/home/expo');
  });

  it('exports MAESTRO_TESTS_DIR to maestro so flows can reference ${MAESTRO_TESTS_DIR}', async () => {
    // Public docs (EAS workflows pre-packaged-jobs) instruct users to write
    // screenshots/recordings into ${MAESTRO_TESTS_DIR}. The step must export
    // it in the spawn env, matching the legacy bash step's behavior.
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    const spawnOptions = mockedSpawn.mock.calls[0][2] as {
      env?: Record<string, string | undefined>;
    };
    expect(spawnOptions.env!.MAESTRO_TESTS_DIR).toBe('/home/expo/.maestro/tests');
  });

  it('uses env.HOME (not os.homedir()) for maestro tests output paths', async () => {
    // Even when os.homedir() differs, the step should derive paths from env.HOME
    // so maestro (which receives env) and the step (which inspects those paths)
    // agree on where reports land.
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep(
      {
        flow_paths: ['flows/a.yaml'],
        output_format: 'junit',
        platform: 'android',
      },
      { env: { HOME: '/custom/home' } }
    );
    await step.executeAsync();

    expect(step.getOutputValueByName('tests_directory')).toBe('/custom/home/.maestro/tests');
    expect(step.getOutputValueByName('junit_report_directory')).toBe(
      '/custom/home/.maestro/tests/junit-reports'
    );
    expect(step.getOutputValueByName('final_report_path')).toBe(
      '/custom/home/.maestro/tests/android-maestro-junit.xml'
    );
    const args = mockedSpawn.mock.calls[0][1] as string[];
    const outputArg = args.find(a => a.startsWith('--output='));
    expect(outputArg).toMatch(
      /^--output=\/custom\/home\/\.maestro\/tests\/junit-reports\/android-maestro-junit-attempt-0\.xml$/
    );
  });

  it('throws SystemError when env.HOME is unset', async () => {
    const step = createStep(
      {
        flow_paths: ['flows/a.yaml'],
        output_format: 'junit',
        platform: 'android',
      },
      { env: {} }
    );
    await expect(step.executeAsync()).rejects.toThrow(SystemError);
  });

  it('throws UserError on non-string entries in flow_paths', async () => {
    const step = createStep({
      flow_paths: ['flows/a.yaml', 2 as unknown as string],
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when retries is negative', async () => {
    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      retries: -1,
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when retries is a non-integer number', async () => {
    const step = createStep({
      flow_paths: ['flows/a.yaml'],
      retries: 1.5,
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when shards is zero', async () => {
    const step = createStep({ flow_paths: ['a.yaml'], platform: 'android', shards: 0 });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when shards is negative', async () => {
    const step = createStep({ flow_paths: ['a.yaml'], platform: 'android', shards: -1 });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when shards is a non-integer', async () => {
    const step = createStep({ flow_paths: ['a.yaml'], platform: 'android', shards: 1.5 });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('accepts shards: undefined (optional input)', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const step = createStep({ flow_paths: ['a.yaml'], platform: 'android' }); // no shards
    await step.executeAsync(); // should succeed, not throw
  });
});
