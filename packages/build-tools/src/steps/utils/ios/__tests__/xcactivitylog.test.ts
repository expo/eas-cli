import downloadFile from '@expo/downloader';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import path from 'path';

import { createMockLogger } from '../../../../__tests__/utils/logger';
import { Sentry } from '../../../../sentry';
import {
  buildTargetMetrics,
  isCompileStep,
  collectTopLevelCompileSteps,
  formatReport,
  parseAndReportXcactivitylog,
} from '../xcactivitylog';

jest.mock('@expo/downloader');
jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../../../sentry', () => ({
  Sentry: {
    setup: jest.fn(),
    capture: jest.fn(),
    flush: jest.fn(),
  },
}));

// Minimal fixture: two modules with compile steps
const FIXTURE_TWO_MODULES = {
  schema: { name: 'TestProject' },
  subSteps: [
    {
      title: 'Build target ModuleA',
      subSteps: [
        {
          detailStepType: 'cCompilation',
          duration: 5.0,
          startTimestamp: 100.0,
          endTimestamp: 103.0,
          signature: 'CompileC foo.c',
          subSteps: [],
        },
        {
          detailStepType: 'other',
          signature: 'SwiftCompile normal bar.swift',
          duration: 3.0,
          startTimestamp: 101.0,
          endTimestamp: 104.0,
          subSteps: [],
        },
      ],
    },
    {
      title: 'Build target ModuleB',
      subSteps: [
        {
          detailStepType: 'compileAssetsCatalog',
          duration: 2.0,
          startTimestamp: 200.0,
          endTimestamp: 202.0,
          signature: 'CompileAssetCatalog',
          subSteps: [],
        },
      ],
    },
    {
      title: 'Build target TinyModule',
      subSteps: [
        {
          detailStepType: 'cCompilation',
          duration: 0.1,
          startTimestamp: 300.0,
          endTimestamp: 300.1,
          signature: 'CompileC tiny.c',
          subSteps: [],
        },
      ],
    },
  ],
};

// Fixture: empty data
const FIXTURE_EMPTY = {
  schema: { name: 'EmptyProject' },
  subSteps: [],
};

// Fixture: no compile steps (only non-compile sub-steps)
const FIXTURE_NO_COMPILE = {
  schema: { name: 'NoCompileProject' },
  subSteps: [
    {
      title: 'Build target SomeTarget',
      subSteps: [
        {
          detailStepType: 'linkCommand',
          duration: 5.0,
          startTimestamp: 100.0,
          endTimestamp: 105.0,
          signature: 'Ld something',
          subSteps: [],
        },
      ],
    },
  ],
};

// Fixture: missing timestamps
const FIXTURE_MISSING_TIMESTAMPS = {
  schema: { name: 'MissingTimestamps' },
  subSteps: [
    {
      title: 'Build target PartialModule',
      subSteps: [
        {
          detailStepType: 'cCompilation',
          duration: 3.0,
          signature: 'CompileC partial.c',
          subSteps: [],
          // no startTimestamp/endTimestamp
        },
      ],
    },
  ],
};

// Fixture: nested compile steps (compile step inside non-compile step)
const FIXTURE_NESTED = {
  schema: { name: 'NestedProject' },
  subSteps: [
    {
      title: 'Build target NestedModule',
      subSteps: [
        {
          detailStepType: 'scriptExecution',
          duration: 10.0,
          startTimestamp: 100.0,
          endTimestamp: 110.0,
          signature: 'PhaseScriptExecution',
          subSteps: [
            {
              detailStepType: 'cCompilation',
              duration: 2.0,
              startTimestamp: 101.0,
              endTimestamp: 103.0,
              signature: 'CompileC nested.c',
              subSteps: [],
            },
          ],
        },
      ],
    },
  ],
};

// Overlapping + gapped intervals with pairwise-distinct totals
// (taskSeconds=11, wallSpan=12, activeWallTime=8). Distinct values catch a
// regression that leaks wallSpan or taskSeconds into the rendered Active cell.
const FIXTURE_OVERLAP_WITH_GAP = {
  schema: { name: 'OverlapWithGap' },
  subSteps: [
    {
      title: 'Build target GappedModule',
      subSteps: [
        {
          detailStepType: 'cCompilation',
          duration: 5.0,
          startTimestamp: 100.0,
          endTimestamp: 105.0,
          signature: 'CompileC a.c',
          subSteps: [],
        },
        {
          detailStepType: 'cCompilation',
          duration: 4.0,
          startTimestamp: 102.0,
          endTimestamp: 106.0,
          signature: 'CompileC b.c',
          subSteps: [],
        },
        {
          detailStepType: 'cCompilation',
          duration: 2.0,
          startTimestamp: 110.0,
          endTimestamp: 112.0,
          signature: 'CompileC c.c',
          subSteps: [],
        },
      ],
    },
  ],
};

const mockedDownloadFile = jest.mocked(downloadFile);
const mockedSpawn = jest.mocked(spawn);

const TEST_ENV = { PATH: '/custom/bin:/usr/bin' };

function mockFilesystem({
  tempDir = '/tmp/xclogparser-123',
  jsonOutput = JSON.stringify(FIXTURE_TWO_MODULES),
}: {
  tempDir?: string;
  jsonOutput?: string;
} = {}) {
  jest.spyOn(fs, 'mkdtemp').mockImplementation(async () => tempDir);
  jest.spyOn(fs, 'chmod').mockImplementation(async () => undefined);
  jest.spyOn(fs, 'readFile').mockImplementation(async () => jsonOutput);
  jest.spyOn(fs, 'rm').mockImplementation(async () => undefined);

  return {
    reportPath: path.join(tempDir, 'xcactivitylog.json'),
    tempDir,
  };
}

describe('parseAndReportXcactivitylog', () => {
  beforeEach(() => {
    mockedDownloadFile.mockReset();
    mockedSpawn.mockReset();
    jest.mocked(Sentry.capture).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('downloads xclogparser from GCS and logs resolution + final report when no binary is preinstalled', async () => {
    const logger = createMockLogger();
    const { tempDir, reportPath } = mockFilesystem();

    mockedDownloadFile.mockResolvedValue(undefined);
    mockedSpawn.mockRejectedValueOnce(new Error('xclogparser not found'));
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

    await parseAndReportXcactivitylog({
      derivedDataPath: '/tmp/derived-data',
      workspacePath: '/tmp/workspace',
      logger,
      env: TEST_ENV,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(1, 'xclogparser', ['version'], {
      stdio: 'pipe',
      env: TEST_ENV,
    });
    expect(mockedDownloadFile).toHaveBeenCalledWith(
      'https://storage.googleapis.com/turtle-v2/xclogparser/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      path.join(tempDir, 'XCLogParser-macOS-x86-64-arm64-v0.2.47.zip'),
      { retry: 3, timeout: 20_000 }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'unzip',
      ['-q', path.join(tempDir, 'XCLogParser-macOS-x86-64-arm64-v0.2.47.zip'), '-d', tempDir],
      { stdio: 'pipe', env: TEST_ENV }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      3,
      path.join(tempDir, 'xclogparser'),
      [
        'parse',
        '--derived_data',
        '/tmp/derived-data',
        '--workspace',
        '/tmp/workspace',
        '--reporter',
        'json',
        '--output',
        reportPath,
      ],
      { stdio: 'pipe', env: TEST_ENV }
    );
    expect(fs.readFile).toHaveBeenCalledWith(reportPath, 'utf8');
    expect(logger.info).toHaveBeenCalledWith('Using downloaded xclogparser v0.2.47.');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Xcode Build — Compile Metrics by Module')
    );
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('tries the proxy URL first and falls back to the direct GCS URL', async () => {
    const logger = createMockLogger();
    mockFilesystem();

    mockedDownloadFile
      .mockRejectedValueOnce(new Error('proxy failed'))
      .mockResolvedValueOnce(undefined);
    mockedSpawn.mockRejectedValueOnce(new Error('xclogparser not found'));
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

    await parseAndReportXcactivitylog({
      derivedDataPath: '/tmp/derived-data',
      workspacePath: '/tmp/workspace',
      logger,
      proxyBaseUrl: 'https://cache.example.com',
      env: TEST_ENV,
    });

    expect(mockedDownloadFile).toHaveBeenNthCalledWith(
      1,
      'https://cache.example.com/storage.googleapis.com/turtle-v2/xclogparser/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      '/tmp/xclogparser-123/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      { retry: 3, timeout: 20_000 }
    );
    expect(mockedDownloadFile).toHaveBeenNthCalledWith(
      2,
      'https://storage.googleapis.com/turtle-v2/xclogparser/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      '/tmp/xclogparser-123/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      { retry: 3, timeout: 20_000 }
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to prepare xclogparser via the proxy path; falling back to the direct URL'
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the direct GCS URL when the proxy download succeeds but unpacking fails', async () => {
    const logger = createMockLogger();
    mockFilesystem();

    mockedDownloadFile.mockResolvedValue(undefined);
    mockedSpawn
      .mockRejectedValueOnce(new Error('xclogparser not found'))
      .mockRejectedValueOnce(new Error('invalid zip'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

    await parseAndReportXcactivitylog({
      derivedDataPath: '/tmp/derived-data',
      workspacePath: '/tmp/workspace',
      logger,
      proxyBaseUrl: 'https://cache.example.com',
      env: TEST_ENV,
    });

    expect(mockedDownloadFile).toHaveBeenNthCalledWith(
      1,
      'https://cache.example.com/storage.googleapis.com/turtle-v2/xclogparser/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      '/tmp/xclogparser-123/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      { retry: 3, timeout: 20_000 }
    );
    expect(mockedDownloadFile).toHaveBeenNthCalledWith(
      2,
      'https://storage.googleapis.com/turtle-v2/xclogparser/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      '/tmp/xclogparser-123/XCLogParser-macOS-x86-64-arm64-v0.2.47.zip',
      { retry: 3, timeout: 20_000 }
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to prepare xclogparser via the proxy path; falling back to the direct URL'
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Xcode Build — Compile Metrics by Module')
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reports phase "parsing_xclogparser_output" when the JSON output is invalid', async () => {
    const logger = createMockLogger();
    mockFilesystem({ jsonOutput: '{not valid json' });

    mockedDownloadFile.mockResolvedValue(undefined);
    mockedSpawn.mockRejectedValueOnce(new Error('xclogparser not found'));
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

    await expect(
      parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        logger,
        env: TEST_ENV,
      })
    ).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith('Build performance analysis skipped.');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Build performance analysis failed during "parsing_xclogparser_output"',
      expect.any(Error),
      { tags: { phase: 'parsing_xclogparser_output' } }
    );
  });

  it('reports phase "parsing_xclogparser_output" when the JSON output does not match the expected schema', async () => {
    const logger = createMockLogger();
    mockFilesystem({
      jsonOutput: JSON.stringify({
        schema: { name: 'BadProject' },
        subSteps: [{ title: 123, subSteps: [] }],
      }),
    });

    mockedDownloadFile.mockResolvedValue(undefined);
    mockedSpawn.mockRejectedValueOnce(new Error('xclogparser not found'));
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

    await expect(
      parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        logger,
        env: TEST_ENV,
      })
    ).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith('Build performance analysis skipped.');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Build performance analysis failed during "parsing_xclogparser_output"',
      expect.any(Error),
      { tags: { phase: 'parsing_xclogparser_output' } }
    );
  });

  it('reports phase "running_xclogparser" when the xclogparser invocation fails', async () => {
    const logger = createMockLogger();
    mockFilesystem();

    mockedDownloadFile.mockResolvedValue(undefined);
    mockedSpawn
      .mockRejectedValueOnce(new Error('xclogparser not found')) // version detect
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as any) // unzip
      .mockRejectedValueOnce(new Error('spawn xclogparser ENOENT')); // xclogparser run

    await expect(
      parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        logger,
        env: TEST_ENV,
      })
    ).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith('Build performance analysis skipped.');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Build performance analysis failed during "running_xclogparser"',
      expect.objectContaining({ message: 'spawn xclogparser ENOENT' }),
      { tags: { phase: 'running_xclogparser' } }
    );
  });

  it('reports phase "downloading_xclogparser" when the direct download fails', async () => {
    const logger = createMockLogger();
    mockFilesystem();

    mockedDownloadFile.mockRejectedValue(new Error('network unreachable'));
    mockedSpawn.mockRejectedValueOnce(new Error('xclogparser not found'));
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

    await expect(
      parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        logger,
        env: TEST_ENV,
      })
    ).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith('Build performance analysis skipped.');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Build performance analysis failed during "downloading_xclogparser"',
      expect.objectContaining({ message: 'network unreachable' }),
      { tags: { phase: 'downloading_xclogparser' } }
    );
  });

  it('swallows cleanup failures without emitting additional logs', async () => {
    const logger = createMockLogger();
    mockFilesystem();
    jest.spyOn(fs, 'rm').mockImplementation(async () => {
      throw new Error('cleanup failed');
    });

    mockedDownloadFile.mockResolvedValue(undefined);
    mockedSpawn.mockRejectedValueOnce(new Error('xclogparser not found'));
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

    await expect(
      parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        logger,
        env: TEST_ENV,
      })
    ).resolves.toBeUndefined();

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  describe('xclogparser version resolution', () => {
    it('uses preinstalled binary when no version is requested', async () => {
      const logger = createMockLogger();
      const { reportPath } = mockFilesystem();

      mockedSpawn
        .mockResolvedValueOnce({ stdout: 'XCLogParser 0.2.50\n', stderr: '' } as any) // version detect
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any); // xclogparser parse

      await parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        logger,
        env: TEST_ENV,
      });

      expect(mockedDownloadFile).not.toHaveBeenCalled();
      expect(mockedSpawn).not.toHaveBeenCalledWith('unzip', expect.any(Array), expect.any(Object));
      expect(mockedSpawn).toHaveBeenNthCalledWith(
        2,
        'xclogparser',
        [
          'parse',
          '--derived_data',
          '/tmp/derived-data',
          '--workspace',
          '/tmp/workspace',
          '--reporter',
          'json',
          '--output',
          reportPath,
        ],
        { stdio: 'pipe', env: TEST_ENV }
      );
      expect(logger.info).toHaveBeenCalledWith('Using preinstalled xclogparser v0.2.50.');
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('downloaded'));
      expect(Sentry.capture).not.toHaveBeenCalled();
    });

    it('downloads default version when no version requested and no preinstall found', async () => {
      const logger = createMockLogger();
      mockFilesystem();

      mockedDownloadFile.mockResolvedValue(undefined);
      mockedSpawn.mockRejectedValueOnce(new Error('xclogparser not found'));
      mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

      await parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        logger,
        env: TEST_ENV,
      });

      expect(mockedDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining('XCLogParser-macOS-x86-64-arm64-v0.2.47.zip'),
        expect.any(String),
        expect.any(Object)
      );
      expect(logger.info).toHaveBeenCalledWith('Using downloaded xclogparser v0.2.47.');
    });

    it('uses preinstalled binary when requested version matches', async () => {
      const logger = createMockLogger();
      mockFilesystem();

      mockedSpawn
        .mockResolvedValueOnce({ stdout: 'XCLogParser 0.2.50\n', stderr: '' } as any) // version detect
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any); // xclogparser parse

      await parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        xclogparserVersion: 'v0.2.50',
        logger,
        env: TEST_ENV,
      });

      expect(mockedDownloadFile).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Using preinstalled xclogparser v0.2.50.');
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('downloaded'));
    });

    it('downloads requested version when it does not match the preinstalled binary', async () => {
      const logger = createMockLogger();
      mockFilesystem();

      mockedDownloadFile.mockResolvedValue(undefined);
      mockedSpawn
        .mockResolvedValueOnce({ stdout: 'XCLogParser 0.2.48\n', stderr: '' } as any) // version detect
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any) // unzip
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any); // xclogparser parse

      await parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        xclogparserVersion: 'v0.2.50',
        logger,
        env: TEST_ENV,
      });

      expect(mockedDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining('XCLogParser-macOS-x86-64-arm64-v0.2.50.zip'),
        expect.any(String),
        expect.any(Object)
      );
      expect(logger.info).toHaveBeenCalledWith('Using downloaded xclogparser v0.2.50.');
    });

    it('downloads requested version when no preinstall is found', async () => {
      const logger = createMockLogger();
      mockFilesystem();

      mockedDownloadFile.mockResolvedValue(undefined);
      mockedSpawn.mockRejectedValueOnce(new Error('xclogparser not found'));
      mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);

      await parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        xclogparserVersion: 'v0.2.50',
        logger,
        env: TEST_ENV,
      });

      expect(mockedDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining('XCLogParser-macOS-x86-64-arm64-v0.2.50.zip'),
        expect.any(String),
        expect.any(Object)
      );
      expect(logger.info).toHaveBeenCalledWith('Using downloaded xclogparser v0.2.50.');
    });

    it('falls back to download when the version output cannot be parsed', async () => {
      const logger = createMockLogger();
      mockFilesystem();

      mockedDownloadFile.mockResolvedValue(undefined);
      mockedSpawn
        .mockResolvedValueOnce({ stdout: 'something unexpected', stderr: '' } as any) // version detect
        .mockResolvedValue({ stdout: '', stderr: '' } as any);

      await parseAndReportXcactivitylog({
        derivedDataPath: '/tmp/derived-data',
        workspacePath: '/tmp/workspace',
        logger,
        env: TEST_ENV,
      });

      expect(mockedDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining('XCLogParser-macOS-x86-64-arm64-v0.2.47.zip'),
        expect.any(String),
        expect.any(Object)
      );
      expect(logger.info).toHaveBeenCalledWith('Using downloaded xclogparser v0.2.47.');
    });
  });
});

describe('isCompileStep', () => {
  it('identifies cCompilation', () => {
    expect(isCompileStep({ detailStepType: 'cCompilation', signature: '' })).toBe(true);
  });

  it('identifies compileAssetsCatalog', () => {
    expect(isCompileStep({ detailStepType: 'compileAssetsCatalog', signature: '' })).toBe(true);
  });

  it('identifies compileStoryboard', () => {
    expect(isCompileStep({ detailStepType: 'compileStoryboard', signature: '' })).toBe(true);
  });

  it('identifies SwiftCompile by signature prefix', () => {
    expect(
      isCompileStep({ detailStepType: 'other', signature: 'SwiftCompile normal foo.swift' })
    ).toBe(true);
  });

  it('identifies SwiftGeneratePch by signature prefix', () => {
    expect(isCompileStep({ detailStepType: 'other', signature: 'SwiftGeneratePch normal' })).toBe(
      true
    );
  });

  it('rejects non-compile steps', () => {
    expect(isCompileStep({ detailStepType: 'linkCommand', signature: 'Ld something' })).toBe(false);
  });

  it('handles missing fields gracefully', () => {
    expect(isCompileStep({})).toBe(false);
  });
});

describe('collectTopLevelCompileSteps', () => {
  it('collects direct compile children', () => {
    const target = FIXTURE_TWO_MODULES.subSteps[0]; // ModuleA
    const result = collectTopLevelCompileSteps(target);
    expect(result).toHaveLength(2);
  });

  it('finds nested compile steps through non-compile parents', () => {
    const target = FIXTURE_NESTED.subSteps[0]; // NestedModule
    const result = collectTopLevelCompileSteps(target);
    expect(result).toHaveLength(1);
    expect(result[0].detailStepType).toBe('cCompilation');
  });

  it('returns empty array when no compile steps', () => {
    const target = FIXTURE_NO_COMPILE.subSteps[0];
    const result = collectTopLevelCompileSteps(target);
    expect(result).toHaveLength(0);
  });
});

describe('buildTargetMetrics', () => {
  it('returns metrics sorted by taskSeconds descending', () => {
    const { results } = buildTargetMetrics(FIXTURE_TWO_MODULES);
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].taskSeconds).toBeGreaterThanOrEqual(results[i].taskSeconds);
    }
  });

  it('computes correct taskSeconds for ModuleA', () => {
    const { results } = buildTargetMetrics(FIXTURE_TWO_MODULES);
    const moduleA = results.find(r => r.moduleName === 'ModuleA');
    expect(moduleA).toBeDefined();
    expect(moduleA!.taskSeconds).toBeCloseTo(8.0); // 5.0 + 3.0
  });

  it('computes correct wallSpan for ModuleA with overlapping intervals', () => {
    const { results } = buildTargetMetrics(FIXTURE_TWO_MODULES);
    const moduleA = results.find(r => r.moduleName === 'ModuleA');
    expect(moduleA).toBeDefined();
    // intervals: [100, 103] and [101, 104] → wall span = 104 - 100 = 4.0
    expect(moduleA!.wallSpan).toBeCloseTo(4.0);
  });

  it('filters out modules below minTaskSeconds threshold', () => {
    const { results } = buildTargetMetrics(FIXTURE_TWO_MODULES);
    const tinyModule = results.find(r => r.moduleName === 'TinyModule');
    expect(tinyModule).toBeUndefined(); // 0.1s < 0.5s default threshold
  });

  it('allows custom minTaskSeconds threshold', () => {
    const { results } = buildTargetMetrics(FIXTURE_TWO_MODULES, { minTaskSeconds: 0 });
    const tinyModule = results.find(r => r.moduleName === 'TinyModule');
    expect(tinyModule).toBeDefined();
  });

  it('returns empty results for empty data', () => {
    const { results, totalTaskSeconds } = buildTargetMetrics(FIXTURE_EMPTY);
    expect(results).toHaveLength(0);
    expect(totalTaskSeconds).toBe(0);
  });

  it('handles missing timestamps gracefully', () => {
    const { results } = buildTargetMetrics(FIXTURE_MISSING_TIMESTAMPS);
    const mod = results.find(r => r.moduleName === 'PartialModule');
    expect(mod).toBeDefined();
    expect(mod!.taskSeconds).toBeCloseTo(3.0);
    expect(mod!.wallSpan).toBe(0); // no valid intervals
    expect(mod!.activeWallTime).toBe(0); // no valid intervals
  });

  it('computes activeWallTime by merging overlapping intervals and excluding gaps', () => {
    const { results } = buildTargetMetrics(FIXTURE_OVERLAP_WITH_GAP);
    const mod = results.find(r => r.moduleName === 'GappedModule');
    expect(mod).toBeDefined();
    expect(mod!.taskSeconds).toBeCloseTo(11.0); // 5 + 4 + 2
    expect(mod!.wallSpan).toBeCloseTo(12.0); // 112 - 100
    expect(mod!.activeWallTime).toBeCloseTo(8.0); // (106-100) + (112-110)
  });
});

describe('formatReport', () => {
  it('produces table with header, legend, and module rows', () => {
    const report = formatReport(FIXTURE_TWO_MODULES);
    expect(report).toContain('Xcode Build — Compile Metrics by Module');
    expect(report).toContain('ModuleA');
    expect(report).toContain('ModuleB');
    expect(report).toContain('TOTAL');
    expect(report).toContain('% Sum');
    expect(report).toContain('Sum = sum of compile-step wall durations');
    expect(report).toContain('Active = merged compile-step wall time');
    expect(report).not.toContain('% Task');
    expect(report).not.toContain('Wall = ');
  });

  it('renders Active using activeWallTime, not wallSpan', () => {
    const report = formatReport(FIXTURE_OVERLAP_WITH_GAP);
    expect(report).toContain('11.0s');
    expect(report).toContain('8.0s');
    expect(report).not.toContain('12.0s');
  });

  it('does not include modules below threshold', () => {
    const report = formatReport(FIXTURE_TWO_MODULES);
    expect(report).not.toContain('TinyModule');
  });

  it('handles empty data without crashing', () => {
    const report = formatReport(FIXTURE_EMPTY);
    expect(report).toContain('Xcode Build — Compile Metrics by Module');
    expect(report).toContain('TOTAL');
  });
});
