import { WorkflowJobResult } from '../types';
import { BuildQuery } from '../../../graphql/queries/BuildQuery';
import { ExpoGraphqlClient } from '../../context/contextUtils/createGraphqlClient';

export async function fetchRawLogsForJobAsync(
  state: { graphqlClient: ExpoGraphqlClient },
  job: WorkflowJobResult
): Promise<string | null> {
  const turtleLogFileUrl = job.turtleJobRun?.logFileUrls?.[0];
  if (turtleLogFileUrl) {
    const response = await fetch(turtleLogFileUrl);
    return await response.text();
  }

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
  const response = await fetch(firstLogFileUrl);
  return await response.text();
}
