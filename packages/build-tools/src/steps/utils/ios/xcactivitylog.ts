import downloadFile from '@expo/downloader';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { z } from 'zod';

const DEFAULT_XCLOGPARSER_VERSION = 'v0.2.46';
const XCLOGPARSER_DOWNLOAD_URL = 'https://storage.googleapis.com/turtle-v2/xclogparser';
const XCLOGPARSER_DOWNLOAD_TIMEOUT_MS = 20_000;
const XCLOGPARSER_OUTPUT_FILENAME = 'xcactivitylog.json';

/**
 * Download xclogparser, parse xcactivitylog from derived data, and log a
 * compile metrics report. Never throws — all errors are logged at debug level.
 *
 * Can be called from both the step-based flow (BuildFunction) and the
 * traditional builder flow (runBuildPhase).
 */
export async function parseAndReportXcactivitylog({
  derivedDataPath,
  workspacePath,
  xclogparserVersion = DEFAULT_XCLOGPARSER_VERSION,
  logger,
  proxyBaseUrl,
}: {
  derivedDataPath: string;
  workspacePath: string;
  xclogparserVersion?: string;
  logger: bunyan;
  proxyBaseUrl?: string;
}): Promise<void> {
  let tempDir: string | undefined;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xclogparser-'));
    const xclogparserPath = await downloadXclogparser(
      tempDir,
      xclogparserVersion,
      logger,
      proxyBaseUrl
    );
    const jsonOutputPath = await runXclogparser({
      binaryPath: xclogparserPath,
      derivedDataPath,
      workspacePath,
      outputDir: tempDir,
    });
    const data = XcactivitylogDataSchemaZ.parse(
      JSON.parse(await fs.readFile(jsonOutputPath, 'utf8'))
    );
    logger.info(formatReport(data));
  } catch (err: unknown) {
    logger.debug({ err }, 'Failed to analyze build performance; continuing without a report');
  } finally {
    if (tempDir) {
      await asyncResult(fs.rm(tempDir, { force: true, recursive: true }));
    }
  }
}

async function downloadXclogparser(
  tempDir: string,
  version: string,
  logger: bunyan,
  proxyBaseUrl?: string
): Promise<string> {
  const zipName = getXclogparserZipName(version);
  const zipPath = path.join(tempDir, zipName);
  const directUrl = `${XCLOGPARSER_DOWNLOAD_URL}/${zipName}`;
  const proxiedUrl = getProxiedDownloadUrl({ directUrl, proxyBaseUrl });

  if (proxiedUrl) {
    const proxiedDownloadResult = await asyncResult(
      downloadAndUnpackXclogparser({ tempDir, zipPath, sourceUrl: proxiedUrl })
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

  return await downloadAndUnpackXclogparser({ tempDir, zipPath, sourceUrl: directUrl });
}

async function downloadAndUnpackXclogparser({
  tempDir,
  zipPath,
  sourceUrl,
}: {
  tempDir: string;
  zipPath: string;
  sourceUrl: string;
}): Promise<string> {
  await downloadFile(sourceUrl, zipPath, { retry: 3, timeout: XCLOGPARSER_DOWNLOAD_TIMEOUT_MS });

  return await unpackXclogparser({ tempDir, zipPath });
}

async function unpackXclogparser({
  tempDir,
  zipPath,
}: {
  tempDir: string;
  zipPath: string;
}): Promise<string> {
  await spawn('unzip', ['-q', zipPath, '-d', tempDir], { stdio: 'pipe' });

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
}: {
  binaryPath: string;
  derivedDataPath: string;
  workspacePath: string;
  outputDir: string;
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
      '--output',
      outputPath,
    ],
    { stdio: 'pipe' }
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
  lines.push('% Task = share of total Compile Task Seconds');
  lines.push('Wall = first compile start to last compile end');
  lines.push('');
  lines.push(header);
  lines.push(
    '│ ' +
      'Module'.padEnd(nameWidth) +
      ' │ ' +
      'Task'.padStart(taskWidth) +
      ' │ ' +
      '% Task'.padStart(pctWidth) +
      ' │ ' +
      'Wall'.padStart(wallWidth) +
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
        formatSeconds(result.wallSpan).padStart(wallWidth) +
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
      'n/a'.padStart(wallWidth) +
      ' │ ' +
      ' '.repeat(barMaxWidth) +
      ' │'
  );
  lines.push(footer);
  lines.push('');

  return lines.join('\n');
}
