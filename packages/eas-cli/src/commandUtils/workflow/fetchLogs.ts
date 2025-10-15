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
  const rawLogs = await response.text();
  return rawLogs;
}
