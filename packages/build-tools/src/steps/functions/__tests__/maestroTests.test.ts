import { GenericArtifactType, SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { CustomBuildContext } from '../../../customBuildContext';
import * as discovery from '../maestroFlowDiscovery';
import * as parser from '../maestroResultParser';
import * as maestroScreenshots from '../maestroScreenshots';
import { createMaestroTestsBuildFunction } from '../maestroTests';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../utils/retry', () => ({
  ...jest.requireActual('../../../utils/retry'),
  sleepAsync: jest.fn().mockResolvedValue(undefined),
}));

// Partial mock: stub the harvest (filesystem) but keep the real reduction helpers
// (computePureFailureFlowNames / selectFailureScreenshots) the step now calls post-loop.
jest.mock('../maestroScreenshots', () => ({
  ...jest.requireActual('../maestroScreenshots'),
  harvestFailureScreenshotsAsync: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const mockedHarvest = jest.mocked(maestroScreenshots.harvestFailureScreenshotsAsync);
const mockUploadArtifact = jest.fn();

function makeShot(index: number): maestroScreenshots.HarvestedScreenshot {
  return {
    fileAbsPath: path.join(os.tmpdir(), `src-screenshot-${index}.png`),
    displayName: 'Failure Screenshot: Login (attempt 1)',
    metadata: {
      kind: 'maestro-test-screenshot',
      flowName: 'Login',
      attemptIndex: 0,
      capturedAtMs: 1781186692250,
    },
  };
}

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
  ReturnType<typeof createMaestroTestsBuildFunction>['createBuildStepFromFunctionCall']
> {
  const logger = createMockLogger();
  const ctx = {
    runtimeApi: { uploadArtifact: mockUploadArtifact },
  } as unknown as CustomBuildContext;
  const fn = createMaestroTestsBuildFunction(ctx);
  const globalCtx = createGlobalContextMock({ logger });
  globalCtx.updateEnv(options.env ?? { HOME: '/home/expo' });
  return fn.createBuildStepFromFunctionCall(globalCtx, { callInputs });
}

describe('createMaestroTestsBuildFunction', () => {
  beforeEach(() => {
    mockedSpawn.mockReset();
    // Default-stub the merge helper so tests that don't care about it don't
    // hit the real disk. Individual tests override this.
    jest.restoreAllMocks();
    jest.spyOn(parser, 'mergeJUnitReports').mockResolvedValue();
    mockedHarvest.mockReset();
    mockedHarvest.mockResolvedValue([]);
    mockUploadArtifact.mockReset();
    mockUploadArtifact.mockResolvedValue({ artifactId: 'artifact-1' });
  });

  it('exports a factory that returns a BuildFunction instance', () => {
    expect(
      createMaestroTestsBuildFunction({
        runtimeApi: { uploadArtifact: mockUploadArtifact },
      } as unknown as CustomBuildContext)
    ).toBeDefined();
  });

  it('sets all outputs before running any flows', async () => {
    // Make spawn reject so the step still throws; we're locking in that outputs
    // are set BEFORE the spawn call (downstream `upload_artifact` fails if
    // `final_report_path` is empty).
    mockedSpawn.mockRejectedValue(new Error('stop'));

    const step = createStep({ flow_path: ['flows/a.yaml'], platform: 'android' });
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
      flow_path: ['flows/a.yaml', 'flows/b.yaml'],
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
    const step = createStep({ flow_path: ['a.yaml'], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow(SystemError);
  });

  it('throws SystemError for unknown-shape spawn rejections', async () => {
    mockedSpawn.mockRejectedValue(new Error('mystery'));
    const step = createStep({ flow_path: ['a.yaml'], platform: 'android' });
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
    const step = createStep({ flow_path: ['a.yaml'], platform: 'android' });
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
    // `status: 1`, no retry occurs and the post-loop check throws UserError.
    // Spawn ran once.
    const step = createStep({ flow_path: ['a.yaml'], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('retries only the failed flows on the next attempt (junit mode)', async () => {
    mockedSpawn.mockRejectedValueOnce(rejectExit1()).mockResolvedValueOnce(SPAWN_SUCCESS);
    jest.spyOn(parser, 'parseFailedFlowsFromJUnit').mockResolvedValue(['flows/b.yaml']);

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml', 'flows/c.yaml'],
      retries: 1,
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    // Attempt 0 saw all 3
    expect(mockedSpawn.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml', 'flows/c.yaml'])
    );
    // Attempt 1 saw only the failed one
    const a1Args = mockedSpawn.mock.calls[1][1]!;
    expect(a1Args).toContain('flows/b.yaml');
    expect(a1Args).not.toContain('flows/a.yaml');
    expect(a1Args).not.toContain('flows/c.yaml');
  });

  it('retries all flows when parseFailedFlowsFromJUnit returns null', async () => {
    const spawnMock = mockedSpawn
      .mockRejectedValueOnce(rejectExit1())
      .mockResolvedValueOnce(SPAWN_SUCCESS);
    jest.spyOn(parser, 'parseFailedFlowsFromJUnit').mockResolvedValue(null);

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml', 'flows/c.yaml'],
      retries: 1,
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    // Both attempts saw all 3 flows
    expect(spawnMock.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml', 'flows/c.yaml'])
    );
    expect(spawnMock.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml', 'flows/c.yaml'])
    );
  });

  it('always retries all flows when output_format is not junit', async () => {
    const spawnMock = mockedSpawn
      .mockRejectedValueOnce(rejectExit1())
      .mockResolvedValueOnce(SPAWN_SUCCESS);
    const parseSpy = jest.spyOn(parser, 'parseFailedFlowsFromJUnit');

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml'],
      retries: 1,
      output_format: 'html',
      platform: 'android',
    });
    await step.executeAsync();

    expect(parseSpy).not.toHaveBeenCalled();
    expect(spawnMock.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml'])
    );
  });

  it('runs all original flows on every retry when retry_failed_only=false', async () => {
    mockedSpawn.mockRejectedValueOnce(rejectExit1()).mockResolvedValueOnce(SPAWN_SUCCESS);
    const parseSpy = jest
      .spyOn(parser, 'parseFailedFlowsFromJUnit')
      .mockResolvedValue(['flows/b.yaml']);

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml'],
      retries: 1,
      output_format: 'junit',
      retry_failed_only: false,
      platform: 'android',
    });
    await step.executeAsync();

    // Both attempts must see both flows in the original input order. Tail-slice
    // equality locks order, not just membership — guards against any future
    // failed-first reshuffling of the dumb-retry list.
    const a0 = mockedSpawn.mock.calls[0][1]!;
    const a1 = mockedSpawn.mock.calls[1][1]!;
    expect(a0.slice(-2)).toEqual(['flows/a.yaml', 'flows/b.yaml']);
    expect(a1.slice(-2)).toEqual(['flows/a.yaml', 'flows/b.yaml']);
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('subsets to failing flows on retry when retry_failed_only=true (default behaviour)', async () => {
    mockedSpawn.mockRejectedValueOnce(rejectExit1()).mockResolvedValueOnce(SPAWN_SUCCESS);
    jest.spyOn(parser, 'parseFailedFlowsFromJUnit').mockResolvedValue(['flows/b.yaml']);

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml'],
      retries: 1,
      output_format: 'junit',
      retry_failed_only: true,
      platform: 'android',
    });
    await step.executeAsync();

    expect(mockedSpawn.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml'])
    );
    const a1 = mockedSpawn.mock.calls[1][1]!;
    expect(a1).toContain('flows/b.yaml');
    expect(a1).not.toContain('flows/a.yaml');
  });

  it('falls back to all-flows retry when retry_failed_only=true but output_format!=junit', async () => {
    mockedSpawn.mockRejectedValueOnce(rejectExit1()).mockResolvedValueOnce(SPAWN_SUCCESS);
    const parseSpy = jest.spyOn(parser, 'parseFailedFlowsFromJUnit');

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml'],
      retries: 1,
      output_format: 'html',
      retry_failed_only: true,
      platform: 'android',
    });
    await step.executeAsync();

    expect(parseSpy).not.toHaveBeenCalled();
    expect(mockedSpawn.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml'])
    );
  });

  it('uses the file= path on reports that carry it, without scanning flow files', async () => {
    mockedSpawn.mockRejectedValueOnce(rejectExit1()).mockResolvedValueOnce(SPAWN_SUCCESS);
    jest.spyOn(parser, 'junitFileHasFileAttrs').mockResolvedValue(true);
    const discoverySpy = jest.spyOn(discovery, 'buildFlowNameToPathMap');
    const legacyParseSpy = jest.spyOn(parser, 'parseFailedFlowsFromJUnit');
    const newParseSpy = jest
      .spyOn(parser, 'parseFailedFlowsFromFileAttrs')
      .mockResolvedValue(['flows/b.yaml']);

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml'],
      retries: 1,
      output_format: 'junit',
      retry_failed_only: true,
      platform: 'android',
    });
    await step.executeAsync();

    expect(newParseSpy).toHaveBeenCalledTimes(1);
    // The new branch needs no name→path map: no scan, no legacy parser.
    expect(discoverySpy).not.toHaveBeenCalled();
    expect(legacyParseSpy).not.toHaveBeenCalled();
    const a1 = mockedSpawn.mock.calls[1][1]!;
    expect(a1).toContain('flows/b.yaml');
    expect(a1).not.toContain('flows/a.yaml');
  });

  it('falls back to all-flows retry when nameToPath is null (duplicate flow names)', async () => {
    mockedSpawn.mockRejectedValueOnce(rejectExit1()).mockResolvedValueOnce(SPAWN_SUCCESS);
    jest.spyOn(discovery, 'buildFlowNameToPathMap').mockResolvedValue(null);
    const parseSpy = jest.spyOn(parser, 'parseFailedFlowsFromJUnit');

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml'],
      retries: 1,
      output_format: 'junit',
      retry_failed_only: true,
      platform: 'android',
    });
    await step.executeAsync();

    expect(parseSpy).not.toHaveBeenCalled();
    expect(mockedSpawn.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['flows/a.yaml', 'flows/b.yaml'])
    );
  });

  it('never scans flow files when all attempts succeed', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const discoverySpy = jest.spyOn(discovery, 'buildFlowNameToPathMap');

    const step = createStep({ flow_path: ['flows/a.yaml'], platform: 'android' });
    await step.executeAsync();

    expect(discoverySpy).not.toHaveBeenCalled();
  });

  it('memoizes the flow scan across retries (legacy reports)', async () => {
    // Routing note: the step lands in the legacy arm because the real
    // junitFileHasFileAttrs returns false — the attempt XML does not exist on
    // the mock fs. Creating that file with file= attrs would flip the branch.
    mockedSpawn
      .mockRejectedValueOnce(rejectExit1())
      .mockRejectedValueOnce(rejectExit1())
      .mockResolvedValueOnce(SPAWN_SUCCESS);
    const discoverySpy = jest
      .spyOn(discovery, 'buildFlowNameToPathMap')
      .mockResolvedValue(new Map([['a', 'flows/a.yaml']]));
    const parseSpy = jest
      .spyOn(parser, 'parseFailedFlowsFromJUnit')
      .mockResolvedValue(['flows/a.yaml']);

    const step = createStep({
      flow_path: ['flows/a.yaml'],
      retries: 2,
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    // Two failed attempts hit the legacy branch twice; the scan runs once.
    expect(parseSpy).toHaveBeenCalledTimes(2);
    expect(discoverySpy).toHaveBeenCalledTimes(1);
  });

  it('defaults retry_failed_only to true when omitted from inputs', async () => {
    mockedSpawn.mockRejectedValueOnce(rejectExit1()).mockResolvedValueOnce(SPAWN_SUCCESS);
    jest.spyOn(parser, 'parseFailedFlowsFromJUnit').mockResolvedValue(['flows/b.yaml']);

    const step = createStep({
      flow_path: ['flows/a.yaml', 'flows/b.yaml'],
      retries: 1,
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    const a1 = mockedSpawn.mock.calls[1][1]!;
    expect(a1).toContain('flows/b.yaml');
    expect(a1).not.toContain('flows/a.yaml');
  });

  it('writes merged junit on success', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const mergeSpy = jest.spyOn(parser, 'mergeJUnitReports').mockResolvedValue();

    const step = createStep({
      flow_path: ['a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    expect(mergeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: expect.stringContaining('junit-reports'),
        outputPath: expect.stringContaining('android-maestro-junit.xml'),
      })
    );
  });

  it('falls back to copyLatestAttemptXml when mergeJUnitReports throws a data error', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    jest.spyOn(parser, 'mergeJUnitReports').mockRejectedValue(new Error('bad xml'));
    const copySpy = jest.spyOn(parser, 'copyLatestAttemptXml').mockResolvedValue();

    const step = createStep({
      flow_path: ['a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await step.executeAsync();

    expect(copySpy).toHaveBeenCalled();
  });

  it('swallows merge and copy-latest failures when maestro succeeded', async () => {
    // Throwing on copy failure would mask the real reason for early-failing
    // maestro runs (bad YAML writes no *.xml) and would also wrap a user-side
    // failure as SystemError, which cancels the build's billing.
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    jest.spyOn(parser, 'mergeJUnitReports').mockRejectedValue(new Error('bad xml'));
    jest
      .spyOn(parser, 'copyLatestAttemptXml')
      .mockRejectedValue(Object.assign(new Error('no space'), { code: 'ENOSPC' }));

    const step = createStep({
      flow_path: ['a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await expect(step.executeAsync()).resolves.toBeUndefined();
  });

  it('surfaces ERR_MAESTRO_TESTS_FAILED (not copy error) when maestro fails and copy fails', async () => {
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
    jest.spyOn(parser, 'copyLatestAttemptXml').mockRejectedValue(new Error('No *.xml files found'));

    const step = createStep({
      flow_path: ['a.yaml'],
      output_format: 'junit',
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
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
    jest.spyOn(parser, 'parseFailedFlowsFromJUnit').mockResolvedValue(['flows/a.yaml']);
    jest.spyOn(parser, 'mergeJUnitReports').mockResolvedValue();

    const step = createStep({
      flow_path: ['flows/a.yaml'],
      retries: 2,
      output_format: 'junit',
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError early on empty flow_path', async () => {
    const step = createStep({ flow_path: [], platform: 'android' });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('uses $HOME/.maestro/tests output path for non-junit formats (e.g. html)', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_path: ['flows/a.yaml'],
      output_format: 'html',
      platform: 'android',
    });
    await step.executeAsync();

    const args = mockedSpawn.mock.calls[0][1] as string[];
    // Non-JUnit uses a fixed path inside $HOME/.maestro/tests so the
    // whole-directory upload picks it up.
    const outputArg = args.find(a => a.startsWith('--output='));
    expect(outputArg).toMatch(/\.maestro\/tests\/android-maestro-html\.html$/);
    expect(outputArg).not.toMatch(/junit-reports/);
  });

  it('uses lowercase extension for non-junit formats regardless of input casing', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_path: ['flows/a.yaml'],
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
      flow_path: ['flows/a.yaml'],
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

  it('accepts output_format casing variations (e.g. JUNIT) case-insensitively', async () => {
    // output_format.toLowerCase() must propagate end-to-end: final_report_path
    // populated, per-attempt XMLs written into junit-reports/, merge invoked.
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const mergeSpy = jest.spyOn(parser, 'mergeJUnitReports').mockResolvedValue();

    const step = createStep({
      flow_path: ['flows/a.yaml'],
      output_format: 'JUNIT',
      platform: 'android',
    });
    await step.executeAsync();

    // Phase 1: final_report_path populated
    expect(step.getOutputValueByName('final_report_path')).toMatch(
      /\.maestro\/tests\/android-maestro-junit\.xml$/
    );
    // Retry loop: --output written into junit-reports/ (not legacy path)
    const args = mockedSpawn.mock.calls[0][1] as string[];
    const outputArg = args.find(a => a.startsWith('--output='));
    expect(outputArg).toMatch(/junit-reports\/android-maestro-junit-attempt-0\.xml$/);
    // Phase 3: merge invoked
    expect(mergeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: expect.stringContaining('junit-reports'),
        outputPath: expect.stringContaining('android-maestro-junit.xml'),
      })
    );
  });

  it('passes include_tags, exclude_tags, and shards through to maestro argv', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_path: ['flows/a.yaml'],
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
      flow_path: ['flows/a.yaml'],
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
    // it in the spawn env.
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({
      flow_path: ['flows/a.yaml'],
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
        flow_path: ['flows/a.yaml'],
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
        flow_path: ['flows/a.yaml'],
        output_format: 'junit',
        platform: 'android',
      },
      { env: {} }
    );
    await expect(step.executeAsync()).rejects.toThrow(SystemError);
  });

  it('throws UserError on non-string entries in flow_path', async () => {
    const step = createStep({
      flow_path: ['flows/a.yaml', 2 as unknown as string],
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when retries is negative', async () => {
    const step = createStep({
      flow_path: ['flows/a.yaml'],
      retries: -1,
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when retries is a non-integer number', async () => {
    const step = createStep({
      flow_path: ['flows/a.yaml'],
      retries: 1.5,
      platform: 'android',
    });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when shards is zero', async () => {
    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', shards: 0 });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when shards is negative', async () => {
    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', shards: -1 });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('throws UserError when shards is a non-integer', async () => {
    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', shards: 1.5 });
    await expect(step.executeAsync()).rejects.toThrow(UserError);
  });

  it('accepts shards: undefined (optional input)', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const step = createStep({ flow_path: ['a.yaml'], platform: 'android' }); // no shards
    await step.executeAsync(); // should succeed, not throw
  });

  it('uploads harvested screenshots after the retry loop with metadata', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const shot = makeShot(0);
    await fs.writeFile(shot.fileAbsPath, '');
    mockedHarvest.mockResolvedValue([shot]);

    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', output_format: 'junit' });
    await step.executeAsync();

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1);
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: expect.objectContaining({
          type: GenericArtifactType.OTHER,
          name: shot.displayName,
          metadata: shot.metadata,
        }),
      })
    );
  });

  it('uploads screenshots even when all attempts fail, before throwing ERR_MAESTRO_TESTS_FAILED', async () => {
    mockedSpawn.mockRejectedValue(rejectExit1());
    const shot = makeShot(0);
    await fs.writeFile(shot.fileAbsPath, '');
    mockedHarvest.mockResolvedValue([shot]);

    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', output_format: 'junit' });
    await expect(step.executeAsync()).rejects.toThrow(UserError);

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1);
  });

  it('swallows upload errors without affecting the test verdict', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const shot = makeShot(0);
    await fs.writeFile(shot.fileAbsPath, '');
    mockedHarvest.mockResolvedValue([shot]);
    mockUploadArtifact.mockRejectedValue(new Error('upload boom'));

    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', output_format: 'junit' });
    await step.executeAsync();

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1);
  });

  it('skips screenshot upload but preserves the verdict when the JUnit re-parse throws', async () => {
    mockedSpawn.mockRejectedValue(rejectExit1());
    mockedHarvest.mockResolvedValue([makeShot(0)]);
    jest.spyOn(parser, 'parseJUnitTestCases').mockRejectedValue(new Error('malformed junit'));

    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', output_format: 'junit' });

    // The classify throw is swallowed; the maestro failure verdict still surfaces.
    await expect(step.executeAsync()).rejects.toThrow(UserError);
    expect(mockUploadArtifact).not.toHaveBeenCalled();
  });

  it('skips screenshot upload but preserves the verdict when the staging dir cannot be created', async () => {
    mockedSpawn.mockRejectedValue(rejectExit1());
    mockedHarvest.mockResolvedValue([makeShot(0)]);
    jest.spyOn(parser, 'parseJUnitTestCases').mockResolvedValue([]);
    jest.spyOn(fs, 'mkdtemp').mockRejectedValue(new Error('no tmp space'));

    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', output_format: 'junit' });

    // mkdtemp failure is swallowed; the maestro failure verdict still surfaces.
    await expect(step.executeAsync()).rejects.toThrow(UserError);
    expect(mockUploadArtifact).not.toHaveBeenCalled();
  });

  it('caps uploads at 30 screenshots (excess dropped)', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const shots = Array.from({ length: 35 }, (_, index) => makeShot(index));
    await Promise.all(shots.map(shot => fs.writeFile(shot.fileAbsPath, '')));
    mockedHarvest.mockResolvedValue(shots);

    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', output_format: 'junit' });
    await step.executeAsync();

    expect(mockUploadArtifact).toHaveBeenCalledTimes(30);
  });

  it('does not harvest or upload screenshots when output_format is not junit', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);

    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', output_format: 'html' });
    await step.executeAsync();

    expect(mockedHarvest).not.toHaveBeenCalled();
    expect(mockUploadArtifact).not.toHaveBeenCalled();
  });

  it('uploads only the final attempt for a pure-failure flow, but every attempt for a flaky flow', async () => {
    mockedSpawn.mockResolvedValue(SPAWN_SUCCESS);
    const tc = (name: string, status: 'passed' | 'failed'): parser.JUnitTestCaseResult => ({
      name,
      file: undefined,
      status,
      duration: 0,
      errorMessage: null,
      tags: [],
      properties: {},
    });
    jest
      .spyOn(parser, 'parseJUnitTestCases')
      .mockResolvedValue([
        tc('PureFlow', 'failed'),
        tc('FlakyFlow', 'failed'),
        tc('FlakyFlow', 'passed'),
      ]);

    const makeShotFor = (
      flowName: string,
      attemptIndex: number
    ): maestroScreenshots.HarvestedScreenshot => ({
      fileAbsPath: path.join(os.tmpdir(), `wiring-${flowName}-${attemptIndex}.png`),
      displayName: `Failure Screenshot: ${flowName} (attempt ${attemptIndex + 1})`,
      metadata: {
        kind: 'maestro-test-screenshot',
        flowName,
        attemptIndex,
        capturedAtMs: 1781186692250 + attemptIndex,
      },
    });
    const shots = [
      makeShotFor('PureFlow', 0),
      makeShotFor('PureFlow', 1),
      makeShotFor('FlakyFlow', 0),
      makeShotFor('FlakyFlow', 1),
    ];
    await Promise.all(shots.map(shot => fs.writeFile(shot.fileAbsPath, '')));
    mockedHarvest.mockResolvedValue(shots);

    const step = createStep({ flow_path: ['a.yaml'], platform: 'android', output_format: 'junit' });
    await step.executeAsync();

    // PureFlow keeps only its final attempt (1); FlakyFlow keeps every failed attempt.
    // Uploads run concurrently, so compare the set, not the order.
    const uploaded = mockUploadArtifact.mock.calls
      .map(([arg]) => `${arg.artifact.metadata.flowName}#${arg.artifact.metadata.attemptIndex}`)
      .sort();
    expect(uploaded).toEqual(['FlakyFlow#0', 'FlakyFlow#1', 'PureFlow#1']);
  });
});
