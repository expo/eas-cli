import { WorkflowJobResult } from './types';

// This function is in a separate module for testing purposes

export async function fetchRawLogsForJobAsync(job: WorkflowJobResult): Promise<string | null> {
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
