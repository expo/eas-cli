import downloadFile from '@expo/downloader';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { z } from 'zod';

import { Sentry } from '../../../sentry';

const DEFAULT_XCLOGPARSER_VERSION = 'v0.2.47';
const XCLOGPARSER_DOWNLOAD_URL = 'https://storage.googleapis.com/turtle-v2/xclogparser';
const XCLOGPARSER_DOWNLOAD_TIMEOUT_MS = 20_000;
const XCLOGPARSER_OUTPUT_FILENAME = 'xcactivitylog.json';

/**
 * Never throws — best-effort observability that does not affect build status.
 * Failures route to Sentry via `Sentry.capture` for engineering triage;
 * users see only a generic skip message.
 */
export async function parseAndReportXcactivitylog({
  derivedDataPath,
  workspacePath,
  xclogparserVersion,
  logger,
  proxyBaseUrl,
  env,
}: {
  derivedDataPath: string;
  workspacePath: string;
  xclogparserVersion?: string;
  logger: bunyan;
  proxyBaseUrl?: string;
  env: BuildStepEnv;
}): Promise<void> {
  let tempDir: string | undefined;
  let phase = 'creating_temp_directory';
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xclogparser-'));

    phase = 'resolving_xclogparser';
    const preinstalledVersion = await detectPreinstalledXclogparserVersion(env);
    let binaryPath: string;
    let resolvedVersion: string;
    if (
      preinstalledVersion &&
      (!xclogparserVersion || preinstalledVersion === xclogparserVersion)
    ) {
      binaryPath = 'xclogparser';
      resolvedVersion = preinstalledVersion;
      logger.info(`Using preinstalled xclogparser ${resolvedVersion}.`);
    } else {
      phase = 'downloading_xclogparser';
      resolvedVersion = xclogparserVersion ?? DEFAULT_XCLOGPARSER_VERSION;
      binaryPath = await downloadXclogparser({
        tempDir,
        version: resolvedVersion,
        logger,
        proxyBaseUrl,
        env,
      });
      logger.info(`Using downloaded xclogparser ${resolvedVersion}.`);
    }

    phase = 'running_xclogparser';
    const jsonOutputPath = await runXclogparser({
      binaryPath,
      derivedDataPath,
      workspacePath,
      outputDir: tempDir,
      env,
    });

    phase = 'parsing_xclogparser_output';
    const data = XcactivitylogDataSchemaZ.parse(
      JSON.parse(await fs.readFile(jsonOutputPath, 'utf8'))
    );

    logger.info(formatReport(data));
  } catch (err: any) {
    logger.info('Build performance analysis skipped.');
    const msg = `Build performance analysis failed during "${phase}"`;
    Sentry.capture(msg, err, {
      tags: { phase },
      extras: {
        exitStatus: err?.status,
        signal: err?.signal,
        stderr: err?.stderr?.slice(-4000),
        stdout: err?.stdout?.slice(-4000),
      },
    });
  } finally {
    if (tempDir) {
      await asyncResult(fs.rm(tempDir, { force: true, recursive: true }));
    }
  }
}

async function detectPreinstalledXclogparserVersion(env: BuildStepEnv): Promise<string | null> {
  const result = await asyncResult(spawn('xclogparser', ['version'], { stdio: 'pipe', env }));
  if (!result.ok) {
    return null;
  }
  const match = result.value.stdout.match(/(\d+\.\d+\.\d+)/);
  return match ? `v${match[1]}` : null;
}

async function downloadXclogparser({
  tempDir,
  version,
  logger,
  proxyBaseUrl,
  env,
}: {
  tempDir: string;
  version: string;
  logger: bunyan;
  proxyBaseUrl?: string;
  env: BuildStepEnv;
}): Promise<string> {
  const zipName = getXclogparserZipName(version);
  const zipPath = path.join(tempDir, zipName);
  const directUrl = `${XCLOGPARSER_DOWNLOAD_URL}/${zipName}`;
  const proxiedUrl = getProxiedDownloadUrl({ directUrl, proxyBaseUrl });

  if (proxiedUrl) {
    const proxiedDownloadResult = await asyncResult(
      downloadAndUnpackXclogparser({ tempDir, zipPath, sourceUrl: proxiedUrl, env })
    );
    if (!proxiedDownloadResult.ok) {
      logger.debug(
        { err: proxiedDownloadResult.reason },
        'Failed to prepare xclogparser via the proxy path; falling back to the direct URL'
      );
      await cleanupXclogparserArtifacts({ tempDir, zipPath });
    } else {
      return proxiedDownloadResult.value;
    }
  }

  return await downloadAndUnpackXclogparser({ tempDir, zipPath, sourceUrl: directUrl, env });
}

async function downloadAndUnpackXclogparser({
  tempDir,
  zipPath,
  sourceUrl,
  env,
}: {
  tempDir: string;
  zipPath: string;
  sourceUrl: string;
  env: BuildStepEnv;
}): Promise<string> {
  await downloadFile(sourceUrl, zipPath, { retry: 3, timeout: XCLOGPARSER_DOWNLOAD_TIMEOUT_MS });

  return await unpackXclogparser({ tempDir, zipPath, env });
}

async function unpackXclogparser({
  tempDir,
  zipPath,
  env,
}: {
  tempDir: string;
  zipPath: string;
  env: BuildStepEnv;
}): Promise<string> {
  await spawn('unzip', ['-q', zipPath, '-d', tempDir], { stdio: 'pipe', env });

  const binaryPath = path.join(tempDir, 'xclogparser');
  await fs.chmod(binaryPath, 0o755);
  return binaryPath;
}

async function cleanupXclogparserArtifacts({
  tempDir,
  zipPath,
}: {
  tempDir: string;
  zipPath: string;
}): Promise<void> {
  await asyncResult(fs.rm(zipPath, { force: true }));
  await asyncResult(fs.rm(path.join(tempDir, 'xclogparser'), { force: true }));
}

async function runXclogparser({
  binaryPath,
  derivedDataPath,
  workspacePath,
  outputDir,
  env,
}: {
  binaryPath: string;
  derivedDataPath: string;
  workspacePath: string;
  outputDir: string;
  env: BuildStepEnv;
}): Promise<string> {
  const outputPath = path.join(outputDir, XCLOGPARSER_OUTPUT_FILENAME);

  await spawn(
    binaryPath,
    [
      'parse',
      '--derived_data',
      derivedDataPath,
      '--workspace',
      workspacePath,
      '--reporter',
      'json',
      '--omit_warnings',
      '--omit_notes',
      '--trunc_large_issues',
      '--output',
      outputPath,
    ],
    { stdio: 'pipe', env }
  );

  return outputPath;
}

const XcactivitylogStepSchemaZ = z.object({
  title: z.string().optional(),
  detailStepType: z.string().optional(),
  signature: z.string().optional(),
  duration: z.number().optional(),
  startTimestamp: z.number().optional(),
  endTimestamp: z.number().optional(),
  get subSteps() {
    return z.array(XcactivitylogStepSchemaZ).optional();
  },
});

const XcactivitylogDataSchemaZ = z.object({
  schema: z.union([z.string(), z.object({ name: z.string().optional() })]).optional(),
  subSteps: z.array(XcactivitylogStepSchemaZ).optional(),
});

type XcactivitylogStep = z.infer<typeof XcactivitylogStepSchemaZ>;
type XcactivitylogData = z.infer<typeof XcactivitylogDataSchemaZ>;

interface TargetMetric {
  moduleName: string;
  taskSeconds: number;
  // Not rendered; retained as secondary sort tie-breaker in buildTargetMetrics.
  wallSpan: number;
  activeWallTime: number;
}

interface Interval {
  start: number;
  end: number;
}

const COMPILE_DETAIL_TYPES = new Set(['cCompilation', 'compileAssetsCatalog', 'compileStoryboard']);

const COMPILE_SIGNATURE_PREFIXES = ['SwiftCompile ', 'SwiftGeneratePch '];

function getXclogparserZipName(version: string): string {
  return `XCLogParser-macOS-x86-64-arm64-${version}.zip`;
}

function getProxiedDownloadUrl({
  directUrl,
  proxyBaseUrl,
}: {
  directUrl: string;
  proxyBaseUrl?: string;
}): string | null {
  if (!proxyBaseUrl) {
    return null;
  }

  const parsedUrl = new URL(directUrl);
  return directUrl.replace(
    `${parsedUrl.protocol}//${parsedUrl.host}`,
    `${proxyBaseUrl}/${parsedUrl.host}`
  );
}

export function isCompileStep(step: Partial<XcactivitylogStep>): boolean {
  const detailStepType = step.detailStepType ?? '';
  const signature = step.signature ?? '';

  if (COMPILE_DETAIL_TYPES.has(detailStepType)) {
    return true;
  }

  return COMPILE_SIGNATURE_PREFIXES.some(prefix => signature.startsWith(prefix));
}

export function collectTopLevelCompileSteps(
  step: XcactivitylogStep,
  results: XcactivitylogStep[] = []
): XcactivitylogStep[] {
  for (const child of step.subSteps ?? []) {
    if (isCompileStep(child)) {
      results.push(child);
      continue;
    }
    collectTopLevelCompileSteps(child, results);
  }
  return results;
}

function intervalFromStep(step: XcactivitylogStep): Interval | null {
  if (typeof step.startTimestamp !== 'number' || typeof step.endTimestamp !== 'number') {
    return null;
  }
  return { start: step.startTimestamp, end: step.endTimestamp };
}

function computeActiveWallTime(intervals: Interval[]): number {
  if (intervals.length === 0) {
    return 0;
  }

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let activeWallTime = 0;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].end;

  for (const interval of sorted.slice(1)) {
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    activeWallTime += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }

  activeWallTime += currentEnd - currentStart;
  return activeWallTime;
}

export function buildTargetMetrics(
  data: XcactivitylogData,
  { minTaskSeconds = 0.5 }: { minTaskSeconds?: number } = {}
): { results: TargetMetric[]; totalTaskSeconds: number } {
  const results: TargetMetric[] = [];

  for (const step of data.subSteps ?? []) {
    const title = step.title ?? '';
    if (!title.startsWith('Build target ')) {
      continue;
    }

    const moduleName = title.replace('Build target ', '');
    const compileSteps = collectTopLevelCompileSteps(step);
    const taskSeconds = compileSteps.reduce((sum, s) => sum + (s.duration ?? 0), 0);

    if (taskSeconds < minTaskSeconds) {
      continue;
    }

    const intervals = compileSteps.map(intervalFromStep).filter((i): i is Interval => i !== null);
    const minStart = intervals.length > 0 ? Math.min(...intervals.map(i => i.start)) : 0;
    const maxEnd = intervals.length > 0 ? Math.max(...intervals.map(i => i.end)) : 0;
    const wallSpan = intervals.length > 0 ? maxEnd - minStart : 0;
    const activeWallTime = computeActiveWallTime(intervals);

    results.push({ moduleName, taskSeconds, wallSpan, activeWallTime });
  }

  results.sort((a, b) => {
    if (b.taskSeconds !== a.taskSeconds) {
      return b.taskSeconds - a.taskSeconds;
    }
    if (b.wallSpan !== a.wallSpan) {
      return b.wallSpan - a.wallSpan;
    }
    return a.moduleName.localeCompare(b.moduleName);
  });

  const totalTaskSeconds = results.reduce((sum, r) => sum + r.taskSeconds, 0);

  return { results, totalTaskSeconds };
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

export function formatReport(data: XcactivitylogData): string {
  const { results, totalTaskSeconds } = buildTargetMetrics(data);

  const nameWidth = Math.max(6, ...results.map(r => r.moduleName.length)) + 2;
  const taskWidth = 10;
  const pctWidth = 8;
  const wallWidth = 10;
  const barMaxWidth = 20;
  const maxTaskSeconds = results[0]?.taskSeconds ?? 1;

  const header =
    '┌─' +
    '─'.repeat(nameWidth) +
    '─┬────────────┬──────────┬────────────┬─' +
    '─'.repeat(barMaxWidth) +
    '─┐';
  const divider =
    '├─' +
    '─'.repeat(nameWidth) +
    '─┼────────────┼──────────┼────────────┼─' +
    '─'.repeat(barMaxWidth) +
    '─┤';
  const footer =
    '└─' +
    '─'.repeat(nameWidth) +
    '─┴────────────┴──────────┴────────────┴─' +
    '─'.repeat(barMaxWidth) +
    '─┘';

  const lines: string[] = [];

  lines.push('');
  lines.push('Xcode Build — Compile Metrics by Module');
  lines.push(
    `Schema: ${typeof data.schema === 'string' ? data.schema : (data.schema?.name ?? 'unknown')}`
  );
  lines.push(
    'Sum = sum of compile-step wall durations within the target; overlapping steps are counted separately'
  );
  lines.push('% Sum = share of total Sum');
  lines.push('Active = merged compile-step wall time, excluding idle gaps between compile steps');
  lines.push('');
  lines.push(header);
  lines.push(
    '│ ' +
      'Module'.padEnd(nameWidth) +
      ' │ ' +
      'Sum'.padStart(taskWidth) +
      ' │ ' +
      '% Sum'.padStart(pctWidth) +
      ' │ ' +
      'Active'.padStart(wallWidth) +
      ' │ ' +
      ' '.repeat(barMaxWidth) +
      ' │'
  );
  lines.push(divider);

  for (const result of results) {
    const pct = totalTaskSeconds === 0 ? 0 : (result.taskSeconds / totalTaskSeconds) * 100;
    const barLength = Math.round((result.taskSeconds / maxTaskSeconds) * barMaxWidth);
    const bar = '█'.repeat(barLength) + '░'.repeat(barMaxWidth - barLength);

    lines.push(
      '│ ' +
        result.moduleName.padEnd(nameWidth) +
        ' │ ' +
        formatSeconds(result.taskSeconds).padStart(taskWidth) +
        ' │ ' +
        `${pct.toFixed(1)}%`.padStart(pctWidth) +
        ' │ ' +
        formatSeconds(result.activeWallTime).padStart(wallWidth) +
        ' │ ' +
        bar +
        ' │'
    );
  }

  lines.push(divider);
  lines.push(
    '│ ' +
      'TOTAL'.padEnd(nameWidth) +
      ' │ ' +
      formatSeconds(totalTaskSeconds).padStart(taskWidth) +
      ' │ ' +
      '100.0%'.padStart(pctWidth) +
      ' │ ' +
      ' '.repeat(wallWidth) +
      ' │ ' +
      ' '.repeat(barMaxWidth) +
      ' │'
  );
  lines.push(footer);
  lines.push('');

  return lines.join('\n');
}
