import { JobLogs, LogLine } from './types';
import { Choice } from '../../prompts';

export function choicesFromJobLogs(
  logs: JobLogs
): (Choice & { name: string; status: string; logLines: LogLine[] | undefined })[] {
  return Array.from(logs.values())
    .map(({ key, label, result, logLines }) => ({
      title: `${label} - ${result ?? ''}`,
      name: label,
      status: result ?? '',
      value: key,
      logLines,
    }))
    .filter(step => step.status !== 'skipped');
}

export function stepLogTail(
  step: { logLines?: LogLine[] },
  maxLogLines: number // -1 means no limit
): string[] {
  const logLines = step.logLines ?? [];
  const tail = maxLogLines === -1 ? logLines : logLines.slice(-maxLogLines);
  return tail.map(line => line.msg);
}
