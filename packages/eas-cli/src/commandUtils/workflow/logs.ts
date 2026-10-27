import { fetchRawLogsForJobAsync } from './fetchLogs';
import { WorkflowJobResult } from './types';
import {
  RealtimeLogsTargetInput,
  RealtimeLogsTargetType,
  WorkflowJobStatus,
} from '../../graphql/generated';
import Log from '../../log';
import { groupLogLinesIntoSteps, parseLogLines } from '../logs/parseLogs';
import { JobLogs, RawLogLine } from '../logs/types';
import { LogSource } from '../logs/watcher';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

async function fetchAndParseLogsFromJobAsync(
  state: { graphqlClient: ExpoGraphqlClient },
  job: WorkflowJobResult
): Promise<RawLogLine[] | null> {
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
): Promise<JobLogs | null> {
  const logLines = await fetchAndParseLogsFromJobAsync(state, job);
  return logLines && groupLogLinesIntoSteps(logLines);
}

export function logSourceForWorkflowJob(
  graphqlClient: ExpoGraphqlClient,
  job: WorkflowJobResult
): LogSource {
  return {
    key: job.id,
    realtimeTarget: realtimeLogsTargetForJob(job),
    isInProgress: job.status === WorkflowJobStatus.InProgress,
    fetchRawLogLinesAsync: async () => await fetchAndParseLogsFromJobAsync({ graphqlClient }, job),
  };
}

function realtimeLogsTargetForJob(job: WorkflowJobResult): RealtimeLogsTargetInput | null {
  if (job.turtleJobRun?.id) {
    return { type: RealtimeLogsTargetType.JobRun, id: job.turtleJobRun.id };
  }
  const buildId = job.turtleBuild?.id ?? job.outputs?.build_id;
  if (buildId) {
    return { type: RealtimeLogsTargetType.Build, id: buildId };
  }
  return null;
}
