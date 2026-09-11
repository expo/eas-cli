import { fetchRawLogsForJobAsync } from './fetchLogs';
import { WorkflowJobResult, WorkflowLogs, WorkflowRawLogLine } from '../types';
import Log from '../../../log';
import uniqBy from '../../../utils/expodash/uniqBy';
import { ExpoGraphqlClient } from '../../context/contextUtils/createGraphqlClient';

export function parseLogLines(rawLogs: string): {
  logLines: WorkflowRawLogLine[];
  errors: Error[];
} {
  const logLines: WorkflowRawLogLine[] = [];
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

export function mergeLogLines<T extends WorkflowRawLogLine>(...logLineGroups: T[][]): T[] {
  return uniqBy(logLineGroups.flat().reverse(), logLine => logLine.logId ?? Symbol()).reverse();
}

export function groupLogLinesIntoSteps(
  logLines: WorkflowRawLogLine[],
  accumulator: WorkflowLogs = new Map()
): WorkflowLogs {
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

export async function fetchAndParseLogsFromJobAsync(
  state: { graphqlClient: ExpoGraphqlClient },
  job: WorkflowJobResult
): Promise<WorkflowRawLogLine[] | null> {
  const rawLogs = await fetchRawLogsForJobAsync(state, job);
  if (!rawLogs) {
    return null;
  }
  Log.debug(`rawLogs = ${JSON.stringify(rawLogs, null, 2)}`);
  const { logLines, errors } = parseLogLines(rawLogs);
  for (const error of errors) {
    Log.debug(`Failed to parse a log line: ${error.message}`);
  }
  return logLines;
}

export async function fetchAndProcessLogsFromJobAsync(
  state: { graphqlClient: ExpoGraphqlClient },
  job: WorkflowJobResult
): Promise<WorkflowLogs | null> {
  const logLines = await fetchAndParseLogsFromJobAsync(state, job);
  return logLines && groupLogLinesIntoSteps(logLines);
}
