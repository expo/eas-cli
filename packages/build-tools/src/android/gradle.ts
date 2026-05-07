import { Android, Env, Job, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';

import { BuildContext } from '../context';
import { getParentAndDescendantProcessPidsAsync } from '../utils/processes';

export async function ensureLFLineEndingsInGradlewScript<TJob extends Job>(
  ctx: BuildContext<TJob>
): Promise<void> {
  const gradlewPath = path.join(ctx.getReactNativeProjectDirectory(), 'android', 'gradlew');
  const gradlewContent = await fs.readFile(gradlewPath, 'utf8');
  if (gradlewContent.includes('\r')) {
    ctx.logger.info('Replacing CRLF line endings with LF in gradlew script');
    await fs.writeFile(gradlewPath, gradlewContent.replace(/\r\n/g, '\n'), 'utf8');
  }
}

export async function runGradleCommand(
  ctx: BuildContext<Job>,
  {
    logger,
    gradleCommand,
    androidDir,
    extraEnv,
  }: { logger: bunyan; gradleCommand: string; androidDir: string; extraEnv?: Env }
): Promise<void> {
  logger.info(`Running 'gradlew ${gradleCommand}' in ${androidDir}`);
  await fs.chmod(path.join(androidDir, 'gradlew'), 0o755);
  const verboseFlag = ctx.env['EAS_VERBOSE'] === '1' ? '--info' : '';
  const profileFlag = ctx.env['EXPERIMENTAL_GRADLE_PROFILE'] === '1' ? '--profile' : '';

  const spawnPromise = spawn(
    'bash',
    ['-c', `./gradlew ${gradleCommand} ${profileFlag} ${verboseFlag}`],
    {
      cwd: androidDir,
      logger,
      lineTransformer: (line?: string) => {
        if (!line || /^\.+$/.exec(line)) {
          return null;
        } else {
          return line;
        }
      },
      env: {
        ...ctx.env,
        ...extraEnv,
        ...resolveVersionOverridesEnvs(ctx),
        LC_ALL: 'C.UTF-8',
      },
    }
  );
  if (ctx.env.EAS_BUILD_RUNNER === 'eas-build' && process.platform === 'linux') {
    adjustOOMScore(spawnPromise, logger);
  }

  await spawnPromise;
}

/**
 * OOM Killer sometimes kills worker server while build is exceeding memory limits.
 * `oom_score_adj` is a value between -1000 and 1000 and it defaults to 0.
 * It defines which process is more likely to get killed (higher value more likely).
 *
 * This function sets oom_score_adj for Gradle process and all its child processes.
 */
function adjustOOMScore(spawnPromise: SpawnPromise<SpawnResult>, logger: bunyan): void {
  setTimeout(
    async () => {
      try {
        assert(spawnPromise.child.pid);
        const pids = await getParentAndDescendantProcessPidsAsync(spawnPromise.child.pid);
        await Promise.all(
          pids.map(async (pid: number) => {
            // Value 800 is just a guess here. It's probably higher than most other
            // process. I didn't want to set it any higher, because I'm not sure if OOM Killer
            // can start killing processes when there is still enough memory left.
            const oomScoreOverride = 800;
            await fs.writeFile(`/proc/${pid}/oom_score_adj`, `${oomScoreOverride}\n`);
          })
        );
      } catch (err: any) {
        logger.debug({ err, stderr: err?.stderr }, 'Failed to override oom_score_adj');
      }
    },
    // Wait 20 seconds to make sure all child processes are started
    20000
  );
}

// Version envs should be set at the beginning of the build, but when building
// from github those values are resolved later.
function resolveVersionOverridesEnvs(ctx: BuildContext<Job>): Env {
  const extraEnvs: Env = {};
  if (
    ctx.job.platform === Platform.ANDROID &&
    ctx.job.version?.versionCode &&
    !ctx.env.EAS_BUILD_ANDROID_VERSION_CODE
  ) {
    extraEnvs.EAS_BUILD_ANDROID_VERSION_CODE = ctx.job.version.versionCode;
  }
  if (
    ctx.job.platform === Platform.ANDROID &&
    ctx.job.version?.versionName &&
    !ctx.env.EAS_BUILD_ANDROID_VERSION_NAME
  ) {
    extraEnvs.EAS_BUILD_ANDROID_VERSION_NAME = ctx.job.version.versionName;
  }
  return extraEnvs;
}

export interface GradleProfileTask {
  path: string;
  durationMs: number;
  result: string;
}

export async function parseGradleProfile(
  androidDir: string,
  logger?: bunyan
): Promise<GradleProfileTask[] | null> {
  const profileDir = path.join(androidDir, 'build', 'reports', 'profile');
  if (!(await fs.pathExists(profileDir))) {
    logger?.info('Gradle profile directory not found at %s', profileDir);
    return null;
  }

  const files = await fs.readdir(profileDir);
  const htmlFile = files
    .filter(f => f.startsWith('profile-') && f.endsWith('.html'))
    .sort()
    .pop();

  if (!htmlFile) {
    logger?.info('No Gradle profile HTML found in %s', profileDir);
    return null;
  }

  const html = await fs.readFile(path.join(profileDir, htmlFile), 'utf8');

  // Find the "Task Execution" section - it's the last <table> in the "Task Execution" tab
  const taskExecMatch = html.match(/<h2[^>]*>\s*Task Execution\s*<\/h2>([\s\S]*?)(?:<\/div>)/i);
  if (!taskExecMatch) {
    logger?.info('Could not find Task Execution section in Gradle profile');
    return null;
  }

  const section = taskExecMatch[1];
  const tasks: GradleProfileTask[] = [];

  // Parse table rows: <td>task path</td><td>duration</td><td>result</td>
  const rowRegex =
    /<tr>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(section)) !== null) {
    const taskPath = match[1].trim();
    const durationStr = match[2].trim();
    const result = match[3].trim() || 'executed';

    const durationMs = parseDurationToMs(durationStr);
    tasks.push({ path: taskPath, durationMs, result: result.toLowerCase() });
  }

  return tasks.length > 0 ? tasks : null;
}

function parseDurationToMs(duration: string): number {
  // Gradle profile durations can be like "1.234s", "0.045s", "12.5s"
  const secondsMatch = duration.match(/^([\d.]+)s$/);
  if (secondsMatch) {
    return Math.round(parseFloat(secondsMatch[1]) * 1000);
  }
  return 0;
}

function formatSeconds(ms: number): string {
  const s = ms / 1000;
  if (s < 0.1) {
    return `${ms}ms`;
  }
  return `${s.toFixed(1)}s`;
}

export function formatGradleProfileReport(tasks: GradleProfileTask[]): string {
  // Filter out tasks under 1 second
  const significantTasks = tasks.filter(t => t.durationMs >= 1000);

  // Separate module totals from individual tasks
  const moduleTotals = significantTasks.filter(t => t.result === '(total)');
  const individualTasks = significantTasks.filter(t => t.result !== '(total)');

  // Group individual tasks by their module prefix
  const moduleChildren = new Map<string, GradleProfileTask[]>();
  const orphanTasks: GradleProfileTask[] = [];

  for (const task of individualTasks) {
    const parent = moduleTotals.find(m => task.path.startsWith(m.path + ':'));
    if (parent) {
      const children = moduleChildren.get(parent.path) ?? [];
      children.push(task);
      moduleChildren.set(parent.path, children);
    } else {
      orphanTasks.push(task);
    }
  }

  // Sort module totals by duration, sort children within each module
  const sortedModules = [...moduleTotals].sort((a, b) => b.durationMs - a.durationMs);
  for (const children of moduleChildren.values()) {
    children.sort((a, b) => b.durationMs - a.durationMs);
  }
  orphanTasks.sort((a, b) => b.durationMs - a.durationMs);

  // Build display rows: [displayName, task]
  const rows: { displayName: string; task: GradleProfileTask }[] = [];

  for (const mod of sortedModules) {
    rows.push({ displayName: mod.path, task: mod });
    const children = moduleChildren.get(mod.path) ?? [];
    for (let i = 0; i < children.length; i++) {
      const isLast = i === children.length - 1;
      const prefix = isLast ? '  └─ ' : '  ├─ ';
      const shortName = children[i].path.slice(mod.path.length + 1);
      rows.push({ displayName: prefix + shortName, task: children[i] });
    }
  }

  for (const task of orphanTasks) {
    rows.push({ displayName: task.path, task });
  }

  // Compute totals from individual tasks only (avoid double-counting)
  const totalMs = individualTasks.reduce((sum, t) => sum + t.durationMs, 0);
  const maxMs = totalMs || 1;

  const nameWidth = Math.max(4, ...rows.map(r => r.displayName.length)) + 2;
  const barMaxWidth = 20;

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

  const taskCount = individualTasks.length;
  const cachedCount = individualTasks.filter(t => t.result !== 'executed').length;
  const lines: string[] = [];

  lines.push('Gradle Build — Task Execution Profile');
  const cachedSuffix = cachedCount > 0 ? ` (${cachedCount} cached/up-to-date)` : '';
  lines.push(`${taskCount} tasks${cachedSuffix}, total task time: ${formatSeconds(totalMs)}`);
  lines.push('% Time = share of total task execution time');
  lines.push('');
  lines.push(header);
  lines.push(
    '│ ' +
      'Task'.padEnd(nameWidth) +
      ' │ ' +
      'Duration'.padStart(10) +
      ' │ ' +
      '% Time'.padStart(8) +
      ' │ ' +
      'Result'.padEnd(10) +
      ' │ ' +
      ' '.repeat(barMaxWidth) +
      ' │'
  );
  lines.push(divider);

  for (const row of rows) {
    const pct = totalMs === 0 ? 0 : (row.task.durationMs / totalMs) * 100;
    const barLength = Math.round((row.task.durationMs / maxMs) * barMaxWidth);
    const bar = '█'.repeat(barLength) + '░'.repeat(barMaxWidth - barLength);
    const result = row.task.result === '(total)' ? 'total' : row.task.result;

    lines.push(
      '│ ' +
        row.displayName.padEnd(nameWidth) +
        ' │ ' +
        formatSeconds(row.task.durationMs).padStart(10) +
        ' │ ' +
        `${pct.toFixed(1)}%`.padStart(8) +
        ' │ ' +
        result.padEnd(10) +
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
      formatSeconds(totalMs).padStart(10) +
      ' │ ' +
      '100.0%'.padStart(8) +
      ' │ ' +
      ' '.repeat(10) +
      ' │ ' +
      ' '.repeat(barMaxWidth) +
      ' │'
  );
  lines.push(footer);
  lines.push('');

  return lines.join('\n');
}

export function resolveGradleCommand(job: Android.Job): string {
  if (job.gradleCommand) {
    return job.gradleCommand;
  } else if (job.developmentClient) {
    return ':app:assembleDebug';
  } else if (!job.buildType) {
    return ':app:bundleRelease';
  } else if (job.buildType === Android.BuildType.APK) {
    return ':app:assembleRelease';
  } else {
    return ':app:bundleRelease';
  }
}
