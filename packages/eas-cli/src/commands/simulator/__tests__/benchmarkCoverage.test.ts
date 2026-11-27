import fs from 'node:fs/promises';
import path from 'node:path';

interface BenchmarkScenario {
  name: string;
  label: string;
  args: string[];
  useTempProjectDir?: boolean;
  expectedStdoutIncludes?: string;
}

interface SimulatorCommandBenchmarkConfig {
  id: string;
  sourceFile: string;
  modulePath: string;
  scenarios: BenchmarkScenario[];
}

interface BenchmarkStats {
  medianMs: number;
  minMs: number;
  maxMs: number;
  samplesMs: number[];
}

interface DeltaInfo {
  deltaMs: number | null;
  deltaPct: number | null;
  status: 'regression' | 'improvement' | 'neutral' | 'added' | 'removed';
}

interface BenchmarkReport {
  schemaVersion: number;
  meta: {
    generatedAt?: string;
    label?: string | null;
    gitSha?: string | null;
    nodeVersion?: string;
    platform?: string;
    arch?: string;
    warmupRuns?: number;
    measuredRuns?: number;
    hasOclifManifest?: boolean;
  };
  commands: {
    id: string;
    modulePath: string;
    moduleLoad: BenchmarkStats;
    scenarios: {
      name: string;
      label: string;
      args: string[];
      stats: BenchmarkStats;
    }[];
  }[];
}

interface BenchmarkModule {
  SIMULATOR_COMMAND_BENCHMARKS: SimulatorCommandBenchmarkConfig[];
  classifyDelta: (beforeMs: number | null, afterMs: number | null) => DeltaInfo;
  compareBenchmarkReports: (
    beforeReport: BenchmarkReport,
    afterReport: BenchmarkReport
  ) => {
    beforeMeta: BenchmarkReport['meta'];
    afterMeta: BenchmarkReport['meta'];
    rows: {
      commandId: string;
      commandStatus: 'both' | 'added' | 'removed';
      scenarioName: string;
      label: string;
      isPrimaryScenario: boolean;
      cli: {
        before: BenchmarkStats | null;
        after: BenchmarkStats | null;
        delta: DeltaInfo;
      };
      moduleLoad: {
        before: BenchmarkStats | null;
        after: BenchmarkStats | null;
        delta: DeltaInfo;
      } | null;
    }[];
    summary: {
      totalCommands: number;
      addedCommands: string[];
      removedCommands: string[];
      cliRegressions: {
        commandId: string;
        scenarioName: string;
        label: string;
        delta: DeltaInfo;
      }[];
      cliImprovements: {
        commandId: string;
        scenarioName: string;
        label: string;
        delta: DeltaInfo;
      }[];
      moduleLoadRegressions: { commandId: string; label: string; delta: DeltaInfo }[];
      moduleLoadImprovements: { commandId: string; label: string; delta: DeltaInfo }[];
    };
  };
  computeStats: (samples: number[]) => BenchmarkStats;
  formatComparisonMarkdown: (
    comparison: ReturnType<BenchmarkModule['compareBenchmarkReports']>
  ) => string;
  parseCliArgs: (argv: string[]) => Record<string, unknown>;
  relativeCommandFileToId: (relativeFilePath: string) => string;
}

const benchmarkModule: BenchmarkModule = require('../../../../scripts/benchmark-simulator-commands.js');

async function findCommandSourceFilesAsync(dirPath: string, rootDir = dirPath): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === '__tests__' || entry.name === '__mocks__') {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findCommandSourceFilesAsync(fullPath, rootDir)));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(path.relative(rootDir, fullPath).split(path.sep).join('/'));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function makeStats(medianMs: number, spread = 5): BenchmarkStats {
  return {
    medianMs,
    minMs: Math.max(0, medianMs - spread),
    maxMs: medianMs + spread,
    samplesMs: [Math.max(0, medianMs - spread), medianMs, medianMs + spread],
  };
}

describe('simulator commands benchmark coverage', () => {
  const simulatorCommandsDir = path.resolve(__dirname, '..');

  it('lists every simulator command under src/commands/simulator/ with no stale entries', async () => {
    const sourceFiles = await findCommandSourceFilesAsync(simulatorCommandsDir);
    const expectedEntries = sourceFiles
      .map(sourceFile => ({
        id: benchmarkModule.relativeCommandFileToId(sourceFile),
        sourceFile,
        modulePath: `build/commands/simulator/${sourceFile.replace(/\.ts$/, '.js')}`,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const configuredEntries = benchmarkModule.SIMULATOR_COMMAND_BENCHMARKS.map(entry => ({
      id: entry.id,
      sourceFile: entry.sourceFile,
      modulePath: entry.modulePath,
    }));

    // Ensure no duplicate IDs exist in benchmark configuration.
    const uniqueIds = new Set(configuredEntries.map(entry => entry.id));
    expect(uniqueIds.size).toBe(configuredEntries.length);

    expect([...configuredEntries].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      expectedEntries
    );
  });

  it('includes a --help scenario for every simulator command and an end-to-end scenario for simulator:exec', () => {
    for (const entry of benchmarkModule.SIMULATOR_COMMAND_BENCHMARKS) {
      const helpScenario = entry.scenarios.find(scenario => scenario.name === 'help');
      expect(helpScenario).toBeDefined();
      expect(helpScenario?.args).toEqual([entry.id, '--help']);
    }

    const execEntry = benchmarkModule.SIMULATOR_COMMAND_BENCHMARKS.find(
      entry => entry.id === 'simulator:exec'
    );
    expect(execEntry).toBeDefined();
    const e2eScenario = execEntry?.scenarios.find(scenario => scenario.name === 'exec');
    expect(e2eScenario).toEqual(
      expect.objectContaining({
        args: ['simulator:exec', 'echo', 'ok'],
        useTempProjectDir: true,
        expectedStdoutIncludes: 'ok',
      })
    );
  });
});

describe('benchmark statistics and delta classification', () => {
  it('computes median, min, and max for odd and even sample counts', () => {
    expect(benchmarkModule.computeStats([210.4, 195.2, 200.1, 220.6, 205.3])).toEqual({
      medianMs: 205.3,
      minMs: 195.2,
      maxMs: 220.6,
      samplesMs: [210.4, 195.2, 200.1, 220.6, 205.3],
    });

    expect(benchmarkModule.computeStats([100, 120, 140, 160])).toEqual({
      medianMs: 130,
      minMs: 100,
      maxMs: 160,
      samplesMs: [100, 120, 140, 160],
    });
  });

  it('maps relative command source paths to oclif command IDs', () => {
    expect(benchmarkModule.relativeCommandFileToId('index.ts')).toBe('simulator');
    expect(benchmarkModule.relativeCommandFileToId('exec.ts')).toBe('simulator:exec');
    expect(benchmarkModule.relativeCommandFileToId('control/connection.ts')).toBe(
      'simulator:control:connection'
    );
    expect(benchmarkModule.relativeCommandFileToId('control/index.ts')).toBe('simulator:control');
  });

  it('classifies regressions, improvements, neutral jitter, added, and removed deltas', () => {
    expect(benchmarkModule.classifyDelta(200, 204)).toEqual({
      deltaMs: 4,
      deltaPct: 2,
      status: 'neutral',
    });
    expect(benchmarkModule.classifyDelta(200, 220)).toEqual({
      deltaMs: 20,
      deltaPct: 10,
      status: 'regression',
    });
    expect(benchmarkModule.classifyDelta(1000, 1030)).toEqual({
      deltaMs: 30,
      deltaPct: 3,
      status: 'regression',
    });
    expect(benchmarkModule.classifyDelta(240, 60)).toEqual({
      deltaMs: -180,
      deltaPct: -75,
      status: 'improvement',
    });
    expect(benchmarkModule.classifyDelta(null, 150)).toEqual({
      deltaMs: null,
      deltaPct: null,
      status: 'added',
    });
    expect(benchmarkModule.classifyDelta(150, null)).toEqual({
      deltaMs: null,
      deltaPct: null,
      status: 'removed',
    });
  });
});

describe('benchmark comparison and markdown formatter', () => {
  it('formats before-vs-after markdown with regressions, improvements, added, and removed commands', () => {
    const beforeReport: BenchmarkReport = {
      schemaVersion: 1,
      meta: {
        label: 'origin/main',
        gitSha: '1111111abcdef',
        nodeVersion: 'v22.23.5',
        platform: 'linux',
        arch: 'x64',
        warmupRuns: 1,
        measuredRuns: 5,
        hasOclifManifest: true,
      },
      commands: [
        {
          id: 'simulator:exec',
          modulePath: 'build/commands/simulator/exec.js',
          moduleLoad: makeStats(100),
          scenarios: [
            {
              name: 'help',
              label: 'simulator:exec --help',
              args: ['simulator:exec', '--help'],
              stats: makeStats(200),
            },
            {
              name: 'exec',
              label: 'simulator:exec echo ok',
              args: ['simulator:exec', 'echo', 'ok'],
              stats: makeStats(250),
            },
          ],
        },
        {
          id: 'simulator:list',
          modulePath: 'build/commands/simulator/list.js',
          moduleLoad: makeStats(120),
          scenarios: [
            {
              name: 'help',
              label: 'simulator:list --help',
              args: ['simulator:list', '--help'],
              stats: makeStats(210),
            },
          ],
        },
        {
          id: 'simulator:old',
          modulePath: 'build/commands/simulator/old.js',
          moduleLoad: makeStats(90),
          scenarios: [
            {
              name: 'help',
              label: 'simulator:old --help',
              args: ['simulator:old', '--help'],
              stats: makeStats(180),
            },
          ],
        },
      ],
    };

    const afterReport: BenchmarkReport = {
      schemaVersion: 1,
      meta: {
        label: 'PR head',
        gitSha: '2222222fedcba',
        nodeVersion: 'v22.23.5',
        platform: 'linux',
        arch: 'x64',
        warmupRuns: 1,
        measuredRuns: 5,
        hasOclifManifest: true,
      },
      commands: [
        {
          id: 'simulator:exec',
          modulePath: 'build/commands/simulator/exec.js',
          moduleLoad: makeStats(98),
          scenarios: [
            {
              name: 'help',
              label: 'simulator:exec --help',
              args: ['simulator:exec', '--help'],
              stats: makeStats(198),
            },
            {
              name: 'exec',
              label: 'simulator:exec echo ok',
              args: ['simulator:exec', 'echo', 'ok'],
              stats: makeStats(50),
            },
          ],
        },
        {
          id: 'simulator:list',
          modulePath: 'build/commands/simulator/list.js',
          moduleLoad: makeStats(160),
          scenarios: [
            {
              name: 'help',
              label: 'simulator:list --help',
              args: ['simulator:list', '--help'],
              stats: makeStats(255),
            },
          ],
        },
        {
          id: 'simulator:new',
          modulePath: 'build/commands/simulator/new.js',
          moduleLoad: makeStats(85),
          scenarios: [
            {
              name: 'help',
              label: 'simulator:new --help',
              args: ['simulator:new', '--help'],
              stats: makeStats(175),
            },
          ],
        },
      ],
    };

    const comparison = benchmarkModule.compareBenchmarkReports(beforeReport, afterReport);
    expect(comparison.summary.addedCommands).toEqual(['simulator:new']);
    expect(comparison.summary.removedCommands).toEqual(['simulator:old']);
    expect(comparison.summary.cliImprovements.map(item => item.label)).toEqual([
      'simulator:exec echo ok',
    ]);
    expect(comparison.summary.cliRegressions.map(item => item.label)).toEqual([
      'simulator:list --help',
    ]);
    expect(comparison.summary.moduleLoadRegressions.map(item => item.commandId)).toEqual([
      'simulator:list',
    ]);

    const markdown = benchmarkModule.formatComparisonMarkdown(comparison);
    expect(markdown).toContain('## ⚡ EAS Simulator Commands Speed Benchmark');
    expect(markdown).toContain('Comparing **origin/main** → **PR head**');
    expect(markdown).toContain('🔴 **2 regressions** detected');
    expect(markdown).toContain('🟢 **1 improvement** detected');
    expect(markdown).toContain('🆕 Added command: `simulator:new`.');
    expect(markdown).toContain('🗑️ Removed command: `simulator:old`.');
    expect(markdown).toContain(
      '| `simulator:exec echo ok` | 250.0 ms | 50.0 ms | 🟢 -200.0 ms (-80.0%) | — | — | — |'
    );
    expect(markdown).toContain(
      '| `simulator:list --help` | 210.0 ms | 255.0 ms | 🔴 +45.0 ms (+21.4%) | 120.0 ms | 160.0 ms | 🔴 +40.0 ms (+33.3%) |'
    );
    expect(markdown).toContain(
      '| `simulator:new --help` | — | 175.0 ms | 🆕 Added | — | 85.0 ms | 🆕 Added |'
    );
    expect(markdown).toContain(
      '| `simulator:old --help` | 180.0 ms | — | 🗑️ Removed | 90.0 ms | — | 🗑️ Removed |'
    );
    expect(markdown).toContain('<summary>Detailed spread (min / median / max)</summary>');
  });

  it('reports neutral status and notes missing manifest when applicable', () => {
    const report: BenchmarkReport = {
      schemaVersion: 1,
      meta: {
        label: 'run',
        warmupRuns: 1,
        measuredRuns: 5,
        hasOclifManifest: false,
      },
      commands: [
        {
          id: 'simulator:stop',
          modulePath: 'build/commands/simulator/stop.js',
          moduleLoad: makeStats(100),
          scenarios: [
            {
              name: 'help',
              label: 'simulator:stop --help',
              args: ['simulator:stop', '--help'],
              stats: makeStats(200),
            },
          ],
        },
      ],
    };

    const comparison = benchmarkModule.compareBenchmarkReports(report, report);
    const markdown = benchmarkModule.formatComparisonMarkdown(comparison);

    expect(markdown).toContain('✅ No significant regressions or improvements detected');
    expect(markdown).toContain('`oclif.manifest.json` was missing in at least one run');
  });

  it('parses CLI arguments for run and compare modes', () => {
    expect(
      benchmarkModule.parseCliArgs([
        '--eas-cli-dir',
        '/tmp/eas-cli',
        '--warmup',
        '2',
        '--runs',
        '7',
        '--out',
        '/tmp/out.json',
        '--label',
        'base',
        '--git-sha',
        'abcdef1',
        '--require-manifest',
        '--filter',
        'simulator:exec,simulator:list',
      ])
    ).toEqual(
      expect.objectContaining({
        easCliDir: '/tmp/eas-cli',
        warmupRuns: 2,
        measuredRuns: 7,
        out: '/tmp/out.json',
        label: 'base',
        gitSha: 'abcdef1',
        requireManifest: true,
        filterIds: ['simulator:exec', 'simulator:list'],
      })
    );

    expect(
      benchmarkModule.parseCliArgs([
        '--compare',
        'before.json',
        'after.json',
        '--markdown-out',
        'report.md',
      ])
    ).toEqual(
      expect.objectContaining({
        compare: ['before.json', 'after.json'],
        markdownOut: 'report.md',
      })
    );
  });
});
