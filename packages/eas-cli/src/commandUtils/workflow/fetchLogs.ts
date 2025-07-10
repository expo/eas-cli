import { WorkflowJobResult } from './types';

// This function is in a separate module for testing purposes

export async function fetchRawLogsForJobAsync(job: WorkflowJobResult): Promise<string | null> {
  if (!job.turtleJobRun?.logFileUrls?.length) {
    return null;
  }
  const response = await fetch(job?.turtleJobRun?.logFileUrls[0], {
    method: 'GET',
  });
  const rawLogs = await response.text();
  return rawLogs;
}
