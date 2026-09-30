import { JobLogs, RawLogLine } from './types';
import uniqBy from '../../utils/expodash/uniqBy';

export function parseLogLines(rawLogs: string): {
  logLines: RawLogLine[];
  errors: Error[];
} {
  const logLines: RawLogLine[] = [];
  const errors: Error[] = [];

  for (const rawLogLine of rawLogs.split('\n')) {
    if (!rawLogLine) {
      continue;
    }
    try {
      logLines.push(JSON.parse(rawLogLine));
    } catch (err) {
      errors.push(err as Error);
    }
  }

  return { logLines, errors };
}

export function mergeLogLines<T extends RawLogLine>(...logLineGroups: T[][]): T[] {
  return uniqBy(logLineGroups.flat().reverse(), logLine => logLine.logId ?? Symbol()).reverse();
}

export function groupLogLinesIntoSteps(
  logLines: RawLogLine[],
  accumulator: JobLogs = new Map()
): JobLogs {
  for (const logLine of logLines) {
    const { buildStepDisplayName, buildStepId, phase, time, msg, result, marker, err } = logLine;
    const stepKey = buildStepId ?? buildStepDisplayName ?? phase;
    const stepLabel = buildStepDisplayName ?? buildStepId ?? phase;
    if (!stepKey || !stepLabel || !msg) {
      continue;
    }

    let logGroup = accumulator.get(stepKey);
    if (!logGroup) {
      logGroup = { key: stepKey, label: stepLabel, logLines: [] };
      accumulator.set(stepKey, logGroup);
    }
    if (buildStepDisplayName) {
      logGroup.label = buildStepDisplayName;
    }
    if (logGroup.result === undefined && (marker === 'end-step' || marker === 'END_PHASE')) {
      logGroup.result = result ?? '';
    }
    logGroup.logLines.push({ time, msg, result, marker, err });
  }

  return accumulator;
}
