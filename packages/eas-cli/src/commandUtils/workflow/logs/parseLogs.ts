import { fetchRawLogsForBuildJobAsync, fetchRawLogsForCustomJobAsync } from './fetchLogs';
import { WorkflowJobResult, WorkflowLogs, WorkflowRawLogLine } from '../types';
import { WorkflowJobType } from '../../../graphql/generated';
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

export function groupLogLinesIntoSteps(logLines: WorkflowRawLogLine[]): WorkflowLogs {
  const logs: WorkflowLogs = new Map();

  for (const logLine of logLines) {
    const { buildStepDisplayName, buildStepId, phase, time, msg, result, marker, err } = logLine;
    const stepKey = buildStepId ?? buildStepDisplayName ?? phase;
    const stepLabel = buildStepDisplayName ?? buildStepId ?? phase;
    if (!stepKey || !stepLabel) {
      continue;
    }

    let logGroup = logs.get(stepKey);
    if (!logGroup) {
      logGroup = { key: stepKey, label: stepLabel, logLines: [] };
      logs.set(stepKey, logGroup);
    }
    if (buildStepDisplayName) {
      logGroup.label = buildStepDisplayName;
    }
    logGroup.logLines.push({ time, msg, result, marker, err });
  }

  return logs;
}

export async function fetchAndParseLogsFromJobAsync(
  state: { graphqlClient: ExpoGraphqlClient },
  job: WorkflowJobResult
): Promise<WorkflowRawLogLine[] | null> {
  let rawLogs: string | null;
  switch (job.type) {
    case WorkflowJobType.Build:
    case WorkflowJobType.Repack:
      rawLogs = await fetchRawLogsForBuildJobAsync(state, job);
      break;
    default:
      rawLogs = await fetchRawLogsForCustomJobAsync(job);
      break;
  }
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
