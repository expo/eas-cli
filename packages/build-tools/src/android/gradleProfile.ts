import { bunyan } from '@expo/logger';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs-extra';
import path from 'path';

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

  // Locate the <h2>Task Execution</h2> heading and extract its <table>
  const headingMatch = html.match(/<h2[^>]*>\s*Task Execution\s*<\/h2>/i);
  if (!headingMatch || headingMatch.index === undefined) {
    logger?.info('Could not find Task Execution section in Gradle profile');
    return null;
  }

  const sectionStart = headingMatch.index;
  const tableStart = html.indexOf('<table', sectionStart);
  const tableEnd = html.indexOf('</table>', tableStart);
  if (tableStart === -1 || tableEnd === -1) {
    logger?.info('Could not find task execution table in Gradle profile');
    return null;
  }

  const tableHtml = html.slice(tableStart, tableEnd + '</table>'.length);
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: name => name === 'tr' || name === 'td',
    trimValues: true,
  });

  const parsed = parser.parse(tableHtml);
  const rows: any[] = parsed?.table?.tbody?.tr ?? parsed?.table?.tr ?? [];

  const tasks: GradleProfileTask[] = [];
  for (const row of rows) {
    const cells: any[] = row?.td;
    if (!cells || cells.length < 2) {
      continue;
    }

    const taskPath = String(cells[0] ?? '').trim();
    const durationStr = String(cells[1] ?? '').trim();
    const result = String(cells[2] ?? '').trim() || 'executed';

    if (!taskPath || !durationStr) {
      continue;
    }

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
