#!/usr/bin/env node

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_WARMUP_RUNS = 1;
const DEFAULT_MEASURED_RUNS = 5;
const SCHEMA_VERSION = 1;

// Highlight changes that exceed typical CI runner jitter:
// at least 15ms AND 5%, or at least 25ms absolute change.
const SIGNIFICANT_MIN_DELTA_MS = 15;
const SIGNIFICANT_MIN_DELTA_PCT = 5;
const SIGNIFICANT_ABSOLUTE_DELTA_MS = 25;

const MODULE_LOAD_RESULT_PREFIX = 'BENCH_MODULE_LOAD_JSON:';

/**
 * Canonical list of all `eas simulator` commands to benchmark.
 * Kept in sync with `packages/eas-cli/src/commands/simulator/` by Jest test
 * `src/commands/simulator/__tests__/benchmarkCoverage.test.ts`.
 */
const SIMULATOR_COMMAND_BENCHMARKS = [
  {
    id: 'simulator',
    sourceFile: 'index.ts',
    modulePath: 'build/commands/simulator/index.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator --help',
        args: ['simulator', '--help'],
      },
    ],
  },
  {
    id: 'simulator:availability',
    sourceFile: 'availability.ts',
    modulePath: 'build/commands/simulator/availability.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:availability --help',
        args: ['simulator:availability', '--help'],
      },
    ],
  },
  {
    id: 'simulator:control',
    sourceFile: 'control.ts',
    modulePath: 'build/commands/simulator/control.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:control --help',
        args: ['simulator:control', '--help'],
      },
    ],
  },
  {
    id: 'simulator:control:connection',
    sourceFile: 'control/connection.ts',
    modulePath: 'build/commands/simulator/control/connection.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:control:connection --help',
        args: ['simulator:control:connection', '--help'],
      },
    ],
  },
  {
    id: 'simulator:devices',
    sourceFile: 'devices.ts',
    modulePath: 'build/commands/simulator/devices.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:devices --help',
        args: ['simulator:devices', '--help'],
      },
    ],
  },
  {
    id: 'simulator:egress',
    sourceFile: 'egress.ts',
    modulePath: 'build/commands/simulator/egress.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:egress --help',
        args: ['simulator:egress', '--help'],
      },
    ],
  },
  {
    id: 'simulator:events',
    sourceFile: 'events.ts',
    modulePath: 'build/commands/simulator/events.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:events --help',
        args: ['simulator:events', '--help'],
      },
    ],
  },
  {
    id: 'simulator:exec',
    sourceFile: 'exec.ts',
    modulePath: 'build/commands/simulator/exec.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:exec --help',
        args: ['simulator:exec', '--help'],
      },
      {
        name: 'exec',
        label: 'simulator:exec echo ok',
        args: ['simulator:exec', 'echo', 'ok'],
        useTempProjectDir: true,
        expectedStdoutIncludes: 'ok',
      },
    ],
  },
  {
    id: 'simulator:get',
    sourceFile: 'get.ts',
    modulePath: 'build/commands/simulator/get.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:get --help',
        args: ['simulator:get', '--help'],
      },
    ],
  },
  {
    id: 'simulator:list',
    sourceFile: 'list.ts',
    modulePath: 'build/commands/simulator/list.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:list --help',
        args: ['simulator:list', '--help'],
      },
    ],
  },
  {
    id: 'simulator:logs',
    sourceFile: 'logs.ts',
    modulePath: 'build/commands/simulator/logs.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:logs --help',
        args: ['simulator:logs', '--help'],
      },
    ],
  },
  {
    id: 'simulator:stop',
    sourceFile: 'stop.ts',
    modulePath: 'build/commands/simulator/stop.js',
    scenarios: [
      {
        name: 'help',
        label: 'simulator:stop --help',
        args: ['simulator:stop', '--help'],
      },
    ],
  },
];

function relativeCommandFileToId(relativeFilePath) {
  const normalized = relativeFilePath
    .split(path.sep)
    .join('/')
    .replace(/\.(ts|js)$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length > 0 && segments[segments.length - 1] === 'index') {
    segments.pop();
  }
  return segments.length === 0 ? 'simulator' : `simulator:${segments.join(':')}`;
}

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function computeStats(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('computeStats requires at least one sample');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;

  return {
    medianMs: roundMs(median),
    minMs: roundMs(sorted[0]),
    maxMs: roundMs(sorted[sorted.length - 1]),
    samplesMs: samples.map(roundMs),
  };
}

function classifyDelta(beforeMs, afterMs) {
  if (beforeMs === null || beforeMs === undefined) {
    return {
      deltaMs: null,
      deltaPct: null,
      status: afterMs === null || afterMs === undefined ? 'neutral' : 'added',
    };
  }
  if (afterMs === null || afterMs === undefined) {
    return {
      deltaMs: null,
      deltaPct: null,
      status: 'removed',
    };
  }

  const deltaMs = roundMs(afterMs - beforeMs);
  const deltaPct = beforeMs > 0 ? roundMs((deltaMs / beforeMs) * 100) : null;
  const absDeltaMs = Math.abs(deltaMs);
  const absDeltaPct = deltaPct === null ? 0 : Math.abs(deltaPct);
  const isSignificant =
    absDeltaMs >= SIGNIFICANT_ABSOLUTE_DELTA_MS ||
    (absDeltaMs >= SIGNIFICANT_MIN_DELTA_MS && absDeltaPct >= SIGNIFICANT_MIN_DELTA_PCT);

  let status = 'neutral';
  if (isSignificant) {
    status = deltaMs > 0 ? 'regression' : 'improvement';
  }

  return {
    deltaMs,
    deltaPct,
    status,
  };
}

function formatMs(value) {
  if (value === null || value === undefined) {
    return '—';
  }
  return `${value.toFixed(1)} ms`;
}

function formatDeltaCell(delta) {
  if (!delta) {
    return '—';
  }
  if (delta.status === 'added') {
    return '🆕 Added';
  }
  if (delta.status === 'removed') {
    return '🗑️ Removed';
  }
  if (delta.deltaMs === null) {
    return '—';
  }

  const sign = delta.deltaMs > 0 ? '+' : '';
  const pctPart =
    delta.deltaPct === null
      ? ''
      : ` (${delta.deltaPct > 0 ? '+' : ''}${delta.deltaPct.toFixed(1)}%)`;
  const formatted = `${sign}${delta.deltaMs.toFixed(1)} ms${pctPart}`;

  if (delta.status === 'regression') {
    return `🔴 ${formatted}`;
  }
  if (delta.status === 'improvement') {
    return `🟢 ${formatted}`;
  }
  return formatted;
}

function formatMinMedianMax(stats) {
  if (!stats) {
    return '—';
  }
  return `${stats.minMs.toFixed(1)} / ${stats.medianMs.toFixed(1)} / ${stats.maxMs.toFixed(1)} ms`;
}

function compareBenchmarkReports(beforeReport, afterReport) {
  const beforeMap = new Map((beforeReport.commands ?? []).map(cmd => [cmd.id, cmd]));
  const afterMap = new Map((afterReport.commands ?? []).map(cmd => [cmd.id, cmd]));

  const allCommandIds = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort(
    (a, b) => a.localeCompare(b)
  );

  const rows = [];
  const summary = {
    totalCommands: allCommandIds.length,
    addedCommands: [],
    removedCommands: [],
    cliRegressions: [],
    cliImprovements: [],
    moduleLoadRegressions: [],
    moduleLoadImprovements: [],
  };

  for (const commandId of allCommandIds) {
    const beforeCmd = beforeMap.get(commandId) ?? null;
    const afterCmd = afterMap.get(commandId) ?? null;

    let commandStatus = 'both';
    if (!beforeCmd && afterCmd) {
      commandStatus = 'added';
      summary.addedCommands.push(commandId);
    } else if (beforeCmd && !afterCmd) {
      commandStatus = 'removed';
      summary.removedCommands.push(commandId);
    }

    const moduleLoadDelta = classifyDelta(
      beforeCmd?.moduleLoad?.medianMs ?? null,
      afterCmd?.moduleLoad?.medianMs ?? null
    );
    if (moduleLoadDelta.status === 'regression') {
      summary.moduleLoadRegressions.push({
        commandId,
        label: commandId,
        delta: moduleLoadDelta,
      });
    } else if (moduleLoadDelta.status === 'improvement') {
      summary.moduleLoadImprovements.push({
        commandId,
        label: commandId,
        delta: moduleLoadDelta,
      });
    }

    const beforeScenarios = new Map((beforeCmd?.scenarios ?? []).map(s => [s.name, s]));
    const afterScenarios = new Map((afterCmd?.scenarios ?? []).map(s => [s.name, s]));
    const scenarioNames = Array.from(
      new Set([...afterScenarios.keys(), ...beforeScenarios.keys()])
    ).sort((a, b) => {
      if (a === 'help') {
        return -1;
      }
      if (b === 'help') {
        return 1;
      }
      return a.localeCompare(b);
    });

    for (let index = 0; index < scenarioNames.length; index++) {
      const scenarioName = scenarioNames[index];
      const beforeScenario = beforeScenarios.get(scenarioName) ?? null;
      const afterScenario = afterScenarios.get(scenarioName) ?? null;
      const label =
        afterScenario?.label ?? beforeScenario?.label ?? `${commandId} (${scenarioName})`;
      const isPrimaryScenario = index === 0;

      const cliDelta = classifyDelta(
        beforeScenario?.stats?.medianMs ?? null,
        afterScenario?.stats?.medianMs ?? null
      );

      if (cliDelta.status === 'regression') {
        summary.cliRegressions.push({
          commandId,
          scenarioName,
          label,
          delta: cliDelta,
        });
      } else if (cliDelta.status === 'improvement') {
        summary.cliImprovements.push({
          commandId,
          scenarioName,
          label,
          delta: cliDelta,
        });
      }

      rows.push({
        commandId,
        commandStatus,
        scenarioName,
        label,
        isPrimaryScenario,
        cli: {
          before: beforeScenario?.stats ?? null,
          after: afterScenario?.stats ?? null,
          delta: cliDelta,
        },
        moduleLoad: isPrimaryScenario
          ? {
              before: beforeCmd?.moduleLoad ?? null,
              after: afterCmd?.moduleLoad ?? null,
              delta: moduleLoadDelta,
            }
          : null,
      });
    }
  }

  return {
    beforeMeta: beforeReport.meta ?? {},
    afterMeta: afterReport.meta ?? {},
    rows,
    summary,
  };
}

function formatComparisonMarkdown(comparison) {
  const { beforeMeta, afterMeta, rows, summary } = comparison;
  const lines = [];

  lines.push('## ⚡ EAS Simulator Commands Speed Benchmark');
  lines.push('');

  const beforeLabel =
    beforeMeta.label ?? (beforeMeta.gitSha ? `\`${beforeMeta.gitSha.slice(0, 7)}\`` : 'base');
  const afterLabel =
    afterMeta.label ?? (afterMeta.gitSha ? `\`${afterMeta.gitSha.slice(0, 7)}\`` : 'head');
  const warmup = afterMeta.warmupRuns ?? beforeMeta.warmupRuns ?? DEFAULT_WARMUP_RUNS;
  const runs = afterMeta.measuredRuns ?? beforeMeta.measuredRuns ?? DEFAULT_MEASURED_RUNS;
  const envDetails = [
    `Comparing **${beforeLabel}** → **${afterLabel}**`,
    `${warmup} warmup + ${runs} measured runs (median)`,
  ];
  if (afterMeta.nodeVersion) {
    envDetails.push(`Node ${afterMeta.nodeVersion}`);
  }
  if (afterMeta.platform && afterMeta.arch) {
    envDetails.push(`${afterMeta.platform}/${afterMeta.arch}`);
  }
  lines.push(envDetails.join(' · '));
  lines.push('');

  const totalRegressions = summary.cliRegressions.length + summary.moduleLoadRegressions.length;
  const totalImprovements = summary.cliImprovements.length + summary.moduleLoadImprovements.length;

  const statusNotes = [];
  if (totalRegressions > 0) {
    statusNotes.push(
      `🔴 **${totalRegressions} regression${totalRegressions === 1 ? '' : 's'}** detected (threshold: ≥${SIGNIFICANT_MIN_DELTA_MS} ms & ≥${SIGNIFICANT_MIN_DELTA_PCT}%, or ≥${SIGNIFICANT_ABSOLUTE_DELTA_MS} ms).`
    );
  }
  if (totalImprovements > 0) {
    statusNotes.push(
      `🟢 **${totalImprovements} improvement${totalImprovements === 1 ? '' : 's'}** detected.`
    );
  }
  if (summary.addedCommands.length > 0) {
    statusNotes.push(
      `🆕 Added command${summary.addedCommands.length === 1 ? '' : 's'}: ${summary.addedCommands.map(id => `\`${id}\``).join(', ')}.`
    );
  }
  if (summary.removedCommands.length > 0) {
    statusNotes.push(
      `🗑️ Removed command${summary.removedCommands.length === 1 ? '' : 's'}: ${summary.removedCommands.map(id => `\`${id}\``).join(', ')}.`
    );
  }
  if (statusNotes.length === 0) {
    statusNotes.push(
      `✅ No significant regressions or improvements detected (threshold: ±${SIGNIFICANT_MIN_DELTA_MS} ms & ±${SIGNIFICANT_MIN_DELTA_PCT}%, or ±${SIGNIFICANT_ABSOLUTE_DELTA_MS} ms).`
    );
  }
  for (const note of statusNotes) {
    lines.push(note);
  }
  lines.push('');

  if (beforeMeta.hasOclifManifest === false || afterMeta.hasOclifManifest === false) {
    lines.push(
      '> [!NOTE]',
      '> `oclif.manifest.json` was missing in at least one run; CLI timings may include oclif command discovery overhead.'
    );
    lines.push('');
  }

  lines.push(
    '| Command | CLI Before | CLI After | CLI Delta | Module Load Before | Module Load After | Module Load Delta |'
  );
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');

  for (const row of rows) {
    const cliBefore = formatMs(row.cli.before?.medianMs);
    const cliAfter = formatMs(row.cli.after?.medianMs);
    const cliDelta = formatDeltaCell(row.cli.delta);
    const modBefore = row.moduleLoad ? formatMs(row.moduleLoad.before?.medianMs) : '—';
    const modAfter = row.moduleLoad ? formatMs(row.moduleLoad.after?.medianMs) : '—';
    const modDelta = row.moduleLoad ? formatDeltaCell(row.moduleLoad.delta) : '—';

    lines.push(
      `| \`${row.label}\` | ${cliBefore} | ${cliAfter} | ${cliDelta} | ${modBefore} | ${modAfter} | ${modDelta} |`
    );
  }

  lines.push('');
  lines.push('<details>');
  lines.push('<summary>Detailed spread (min / median / max)</summary>');
  lines.push('');
  lines.push(
    '| Command | CLI Before (min / med / max) | CLI After (min / med / max) | Module Load Before (min / med / max) | Module Load After (min / med / max) |'
  );
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    lines.push(
      `| \`${row.label}\` | ${formatMinMedianMax(row.cli.before)} | ${formatMinMedianMax(row.cli.after)} | ${row.moduleLoad ? formatMinMedianMax(row.moduleLoad.before) : '—'} | ${row.moduleLoad ? formatMinMedianMax(row.moduleLoad.after) : '—'} |`
    );
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}

function formatSingleReportSummary(report) {
  const lines = [];
  lines.push(
    `EAS Simulator Commands Benchmark (${report.meta.warmupRuns} warmup + ${report.meta.measuredRuns} runs, manifest: ${report.meta.hasOclifManifest ? 'present' : 'missing'})`
  );
  lines.push('');
  lines.push('| Command | CLI Median | CLI Min..Max | Module Load Median | Module Load Min..Max |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const cmd of report.commands) {
    for (let index = 0; index < cmd.scenarios.length; index++) {
      const scenario = cmd.scenarios[index];
      const isPrimary = index === 0;
      const cliMinMax = `${scenario.stats.minMs.toFixed(1)}..${scenario.stats.maxMs.toFixed(1)} ms`;
      const modMedian = isPrimary ? formatMs(cmd.moduleLoad.medianMs) : '—';
      const modMinMax = isPrimary
        ? `${cmd.moduleLoad.minMs.toFixed(1)}..${cmd.moduleLoad.maxMs.toFixed(1)} ms`
        : '—';
      lines.push(
        `| \`${scenario.label}\` | ${formatMs(scenario.stats.medianMs)} | ${cliMinMax} | ${modMedian} | ${modMinMax} |`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function fileExistsAsync(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFilesRecursivelyAsync(dirPath, rootDir = dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name === '__tests__' || entry.name === '__mocks__') {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFilesRecursivelyAsync(fullPath, rootDir);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, fullPath));
    }
  }
  return files;
}

async function discoverExtraBuiltCommandsAsync(easCliDir, knownIds) {
  const simulatorBuildDir = path.join(easCliDir, 'build', 'commands', 'simulator');
  const files = await collectFilesRecursivelyAsync(simulatorBuildDir);
  const extras = [];

  for (const relFile of files) {
    if (!relFile.endsWith('.js') || relFile.endsWith('.d.ts')) {
      continue;
    }
    const id = relativeCommandFileToId(relFile);
    if (knownIds.has(id)) {
      continue;
    }
    const normalizedRel = relFile.split(path.sep).join('/');
    extras.push({
      id,
      sourceFile: normalizedRel.replace(/\.js$/, '.ts'),
      modulePath: `build/commands/simulator/${normalizedRel}`,
      scenarios: [
        {
          name: 'help',
          label: `${id} --help`,
          args: [id, '--help'],
        },
      ],
    });
  }

  return extras.sort((a, b) => a.id.localeCompare(b.id));
}

async function spawnTimedAsync(command, args, { cwd, env }) {
  return await new Promise((resolve, reject) => {
    const startNs = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', chunk => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrChunks.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolve({
        code,
        signal,
        elapsedMs,
        stdout,
        stderr,
      });
    });
  });
}

function buildIsolatedEnv(tempHomeDir) {
  const env = { ...process.env };
  delete env.EXPO_STAGING;
  delete env.EXPO_LOCAL;
  delete env.EXPO_DEBUG;
  delete env.EAS_SIMULATOR_SESSION_ID;
  env.HOME = tempHomeDir;
  env.XDG_CONFIG_HOME = path.join(tempHomeDir, '.config');
  env.XDG_CACHE_HOME = path.join(tempHomeDir, '.cache');
  env.XDG_DATA_HOME = path.join(tempHomeDir, '.local', 'share');
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  return env;
}

async function createTempFixtureProjectAsync(baseTempDir) {
  const projectDir = path.join(baseTempDir, 'project');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: 'eas-simulator-benchmark-fixture',
        version: '1.0.0',
        private: true,
      },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(projectDir, '.env.eas-simulator'),
    [
      '# Benchmark fixture simulator session env',
      "EAS_SIMULATOR_SESSION_ID='benchmark-session-id'",
      "AGENT_DEVICE_DAEMON_BASE_URL='http://127.0.0.1:12345'",
      "AGENT_DEVICE_DAEMON_AUTH_TOKEN='benchmark-token'",
      '',
    ].join('\n')
  );
  return projectDir;
}

async function measureCliScenarioAsync({
  binRunPath,
  scenario,
  cwd,
  env,
  warmupRuns,
  measuredRuns,
}) {
  const totalRuns = warmupRuns + measuredRuns;
  const samples = [];

  for (let i = 0; i < totalRuns; i++) {
    const result = await spawnTimedAsync(process.execPath, [binRunPath, ...scenario.args], {
      cwd,
      env,
    });
    if (result.code !== 0) {
      throw new Error(
        `Command "${scenario.label}" exited with code ${result.code} (signal: ${result.signal ?? 'none'}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    }
    if (
      scenario.expectedStdoutIncludes &&
      !result.stdout.includes(scenario.expectedStdoutIncludes)
    ) {
      throw new Error(
        `Command "${scenario.label}" stdout did not include expected "${scenario.expectedStdoutIncludes}".\nstdout:\n${result.stdout}`
      );
    }
    if (i >= warmupRuns) {
      samples.push(result.elapsedMs);
    }
  }

  return computeStats(samples);
}

async function measureModuleLoadAsync({ moduleAbsPath, cwd, env, warmupRuns, measuredRuns }) {
  const totalRuns = warmupRuns + measuredRuns;
  const samples = [];
  const evalCode = [
    'const startNs = process.hrtime.bigint();',
    'require(process.argv[1]);',
    'const loadMs = Number(process.hrtime.bigint() - startNs) / 1e6;',
    `process.stdout.write(${JSON.stringify(MODULE_LOAD_RESULT_PREFIX)} + JSON.stringify({ loadMs }) + '\\n');`,
  ].join(' ');

  for (let i = 0; i < totalRuns; i++) {
    const result = await spawnTimedAsync(process.execPath, ['-e', evalCode, moduleAbsPath], {
      cwd,
      env,
    });
    if (result.code !== 0) {
      throw new Error(
        `Module load benchmark for "${moduleAbsPath}" exited with code ${result.code}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    }
    const markerLine = result.stdout
      .split('\n')
      .find(line => line.startsWith(MODULE_LOAD_RESULT_PREFIX));
    if (!markerLine) {
      throw new Error(
        `Module load benchmark for "${moduleAbsPath}" did not emit timing marker.\nstdout:\n${result.stdout}`
      );
    }
    const parsed = JSON.parse(markerLine.slice(MODULE_LOAD_RESULT_PREFIX.length));
    if (typeof parsed.loadMs !== 'number' || Number.isNaN(parsed.loadMs)) {
      throw new Error(`Invalid module load measurement for "${moduleAbsPath}": ${markerLine}`);
    }
    if (i >= warmupRuns) {
      samples.push(parsed.loadMs);
    }
  }

  return computeStats(samples);
}

async function maybeGenerateTemporaryManifestAsync(easCliDir) {
  const manifestPath = path.join(easCliDir, 'oclif.manifest.json');
  if (await fileExistsAsync(manifestPath)) {
    return { hasOclifManifest: true, cleanupAsync: async () => {} };
  }

  let oclifRunPath;
  try {
    oclifRunPath = require.resolve('oclif/bin/run.js', {
      paths: [easCliDir, path.resolve(easCliDir, '../..')],
    });
  } catch {
    return { hasOclifManifest: false, cleanupAsync: async () => {} };
  }

  const result = await spawnTimedAsync(process.execPath, [oclifRunPath, 'manifest'], {
    cwd: easCliDir,
    env: process.env,
  });
  if (result.code !== 0 || !(await fileExistsAsync(manifestPath))) {
    throw new Error(
      `Failed to generate oclif.manifest.json in ${easCliDir} (code ${result.code}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return {
    hasOclifManifest: true,
    cleanupAsync: async () => {
      await fs.rm(manifestPath, { force: true });
    },
  };
}

async function runBenchmarkAsync({
  easCliDir,
  warmupRuns = DEFAULT_WARMUP_RUNS,
  measuredRuns = DEFAULT_MEASURED_RUNS,
  label = null,
  gitSha = null,
  requireManifest = false,
  autoManifest = true,
  filterIds = null,
}) {
  const resolvedEasCliDir = path.resolve(easCliDir);
  const binRunPath = path.join(resolvedEasCliDir, 'bin', 'run');
  const manifestPath = path.join(resolvedEasCliDir, 'oclif.manifest.json');

  if (!(await fileExistsAsync(binRunPath))) {
    throw new Error(`Could not find eas-cli binary at ${binRunPath}`);
  }

  const buildCommandsDir = path.join(resolvedEasCliDir, 'build', 'commands', 'simulator');
  if (!(await fileExistsAsync(buildCommandsDir))) {
    throw new Error(
      `Built simulator commands directory not found at ${buildCommandsDir}. Run \`yarn build\` first.`
    );
  }

  let hasOclifManifest = await fileExistsAsync(manifestPath);
  let cleanupManifestAsync = async () => {};

  if (!hasOclifManifest) {
    if (requireManifest) {
      throw new Error(
        `Missing ${manifestPath}. Generate it first (e.g. \`yarn run -T oclif manifest\`) before running with --require-manifest.`
      );
    }
    if (autoManifest) {
      const generated = await maybeGenerateTemporaryManifestAsync(resolvedEasCliDir);
      hasOclifManifest = generated.hasOclifManifest;
      cleanupManifestAsync = generated.cleanupAsync;
    }
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-sim-bench-'));
  const tempHomeDir = path.join(tempRoot, 'home');
  await fs.mkdir(tempHomeDir, { recursive: true });
  const tempProjectDir = await createTempFixtureProjectAsync(tempRoot);
  const isolatedEnv = buildIsolatedEnv(tempHomeDir);

  try {
    const knownIds = new Set(SIMULATOR_COMMAND_BENCHMARKS.map(entry => entry.id));
    const extraCommands = await discoverExtraBuiltCommandsAsync(resolvedEasCliDir, knownIds);
    const allDefinitions = [...SIMULATOR_COMMAND_BENCHMARKS, ...extraCommands].sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    const filterSet = filterIds ? new Set(filterIds) : null;
    const commandResults = [];

    for (const def of allDefinitions) {
      if (filterSet && !filterSet.has(def.id)) {
        continue;
      }

      const moduleAbsPath = path.join(resolvedEasCliDir, def.modulePath);
      if (!(await fileExistsAsync(moduleAbsPath))) {
        // Command does not exist in this build (e.g., new command added in PR head, absent in base).
        continue;
      }

      process.stderr.write(`Benchmarking ${def.id}...\n`);
      const moduleLoad = await measureModuleLoadAsync({
        moduleAbsPath,
        cwd: tempRoot,
        env: isolatedEnv,
        warmupRuns,
        measuredRuns,
      });

      const scenarioResults = [];
      for (const scenario of def.scenarios) {
        const stats = await measureCliScenarioAsync({
          binRunPath,
          scenario,
          cwd: scenario.useTempProjectDir ? tempProjectDir : tempRoot,
          env: isolatedEnv,
          warmupRuns,
          measuredRuns,
        });
        scenarioResults.push({
          name: scenario.name,
          label: scenario.label,
          args: scenario.args,
          stats,
        });
      }

      commandResults.push({
        id: def.id,
        modulePath: def.modulePath,
        moduleLoad,
        scenarios: scenarioResults,
      });
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      meta: {
        generatedAt: new Date().toISOString(),
        label,
        gitSha,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        warmupRuns,
        measuredRuns,
        hasOclifManifest,
      },
      commands: commandResults,
    };
  } finally {
    await cleanupManifestAsync();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function parsePositiveInt(rawValue, flagName, allowZero = false) {
  const parsed = Number.parseInt(rawValue, 10);
  const min = allowZero ? 0 : 1;
  if (!Number.isFinite(parsed) || parsed < min || String(parsed) !== rawValue) {
    throw new Error(`${flagName} must be an integer >= ${min}, received "${rawValue}"`);
  }
  return parsed;
}

function parseCliArgs(argv) {
  const options = {
    help: false,
    easCliDir: path.resolve(__dirname, '..'),
    out: null,
    compare: null,
    markdownOut: null,
    warmupRuns: DEFAULT_WARMUP_RUNS,
    measuredRuns: DEFAULT_MEASURED_RUNS,
    label: null,
    gitSha: null,
    requireManifest: false,
    autoManifest: true,
    filterIds: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--out') {
      options.out = argv[++i];
      if (!options.out) {
        throw new Error('--out requires a file path');
      }
    } else if (arg === '--eas-cli-dir') {
      options.easCliDir = argv[++i];
      if (!options.easCliDir) {
        throw new Error('--eas-cli-dir requires a directory path');
      }
    } else if (arg === '--compare') {
      const beforePath = argv[++i];
      const afterPath = argv[++i];
      if (!beforePath || !afterPath) {
        throw new Error('--compare requires two JSON file paths: <before.json> <after.json>');
      }
      options.compare = [beforePath, afterPath];
    } else if (arg === '--markdown-out') {
      options.markdownOut = argv[++i];
      if (!options.markdownOut) {
        throw new Error('--markdown-out requires a file path');
      }
    } else if (arg === '--runs') {
      options.measuredRuns = parsePositiveInt(argv[++i], '--runs', false);
    } else if (arg === '--warmup') {
      options.warmupRuns = parsePositiveInt(argv[++i], '--warmup', true);
    } else if (arg === '--label') {
      options.label = argv[++i];
      if (!options.label) {
        throw new Error('--label requires a value');
      }
    } else if (arg === '--git-sha') {
      options.gitSha = argv[++i];
      if (!options.gitSha) {
        throw new Error('--git-sha requires a value');
      }
    } else if (arg === '--require-manifest') {
      options.requireManifest = true;
    } else if (arg === '--no-auto-manifest') {
      options.autoManifest = false;
    } else if (arg === '--filter') {
      const raw = argv[++i];
      if (!raw) {
        throw new Error('--filter requires a comma-separated list of command IDs');
      }
      options.filterIds = raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function getUsageText() {
  return [
    'Usage:',
    '  node scripts/benchmark-simulator-commands.js [options]',
    '  node scripts/benchmark-simulator-commands.js --compare <before.json> <after.json> [--markdown-out <file.md>]',
    '',
    'Run options:',
    '  --out <file.json>        Write benchmark results JSON to a file',
    '  --eas-cli-dir <dir>      Path to packages/eas-cli to benchmark (default: current package)',
    `  --warmup <n>             Warmup runs per measurement (default: ${DEFAULT_WARMUP_RUNS})`,
    `  --runs <n>               Measured runs per measurement (default: ${DEFAULT_MEASURED_RUNS})`,
    '  --label <name>           Label stored in report metadata (e.g. base, head)',
    '  --git-sha <sha>          Git commit SHA stored in report metadata',
    '  --require-manifest       Fail if oclif.manifest.json does not exist',
    '  --no-auto-manifest       Do not auto-generate a temporary oclif.manifest.json when missing',
    '  --filter <ids>           Comma-separated simulator command IDs to benchmark',
    '',
    'Compare options:',
    '  --compare <before> <after>   Compare two JSON reports',
    '  --markdown-out <file.md>     Write Markdown comparison table to a file',
    '',
  ].join('\n');
}

async function mainAsync(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  if (options.help) {
    process.stdout.write(getUsageText());
    return;
  }

  if (options.compare) {
    const [beforePath, afterPath] = options.compare;
    const [beforeRaw, afterRaw] = await Promise.all([
      fs.readFile(beforePath, 'utf8'),
      fs.readFile(afterPath, 'utf8'),
    ]);
    const beforeReport = JSON.parse(beforeRaw);
    const afterReport = JSON.parse(afterRaw);
    const comparison = compareBenchmarkReports(beforeReport, afterReport);
    const markdown = formatComparisonMarkdown(comparison);

    if (options.markdownOut) {
      await fs.mkdir(path.dirname(path.resolve(options.markdownOut)), { recursive: true });
      await fs.writeFile(options.markdownOut, markdown, 'utf8');
      process.stderr.write(`Wrote comparison report to ${options.markdownOut}\n`);
    } else {
      process.stdout.write(markdown);
    }
    return;
  }

  const report = await runBenchmarkAsync({
    easCliDir: options.easCliDir,
    warmupRuns: options.warmupRuns,
    measuredRuns: options.measuredRuns,
    label: options.label,
    gitSha: options.gitSha,
    requireManifest: options.requireManifest,
    autoManifest: options.autoManifest,
    filterIds: options.filterIds,
  });

  if (options.out) {
    await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
    await fs.writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stderr.write(`Wrote benchmark results to ${options.out}\n`);
  }

  process.stdout.write(formatSingleReportSummary(report));
}

if (require.main === module) {
  mainAsync().catch(err => {
    process.stderr.write(`${err instanceof Error ? err.stack || err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MEASURED_RUNS,
  DEFAULT_WARMUP_RUNS,
  SIGNIFICANT_ABSOLUTE_DELTA_MS,
  SIGNIFICANT_MIN_DELTA_MS,
  SIGNIFICANT_MIN_DELTA_PCT,
  SIMULATOR_COMMAND_BENCHMARKS,
  classifyDelta,
  compareBenchmarkReports,
  computeStats,
  discoverExtraBuiltCommandsAsync,
  formatComparisonMarkdown,
  formatDeltaCell,
  formatSingleReportSummary,
  parseCliArgs,
  relativeCommandFileToId,
  runBenchmarkAsync,
};
