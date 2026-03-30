import { WorkflowJobResult } from './types';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

// This function is in a separate module for testing purposes

export async function fetchRawLogsForCustomJobAsync(
  job: WorkflowJobResult
): Promise<string | null> {
  const firstLogFileUrl = job.turtleJobRun?.logFileUrls?.[0];
  if (!firstLogFileUrl) {
    return null;
  }
  const response = await fetch(firstLogFileUrl, {
    method: 'GET',
  });
  const rawLogs = await response.text();
  return rawLogs;
}

export async function fetchRawLogsForBuildJobAsync(
  state: { graphqlClient: ExpoGraphqlClient },
  job: WorkflowJobResult
): Promise<string | null> {
  // Prefer turtleJobRun logs, which contain JSONL-formatted step logs
  // for both built-in and custom build steps
  const turtleLogFileUrl = job.turtleJobRun?.logFileUrls?.[0];
  if (turtleLogFileUrl) {
    const response = await fetch(turtleLogFileUrl, {
      method: 'GET',
    });
    return await response.text();
  }

  // Fall back to build logFiles
  const buildId = job.outputs?.build_id;
  if (!buildId) {
    return null;
  }
  const buildFragment = await BuildQuery.byIdAsync(state.graphqlClient, buildId, {
    useCache: false,
  });
  const firstLogFileUrl = buildFragment.logFiles?.[0];
  if (!firstLogFileUrl) {
    return null;
  }
  const response = await fetch(firstLogFileUrl, {
    method: 'GET',
  });
  return await response.text();
}
