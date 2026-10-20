import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { parseLogLines } from '../commandUtils/logs/parseLogs';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';
import Log, { learnMore } from '../log';

export type SimulatorSessionError = {
  errorCode: string;
  message: string;
  docsUrl?: string | null;
};

// ErrorCode.UNKNOWN_ERROR and ErrorCode.UNKNOWN_CUSTOM_BUILD_ERROR from @expo/eas-build-job.
const UNKNOWN_ERROR_CODES = new Set(['UNKNOWN_ERROR', 'UNKNOWN_CUSTOM_BUILD_ERROR']);
const MAX_LOGGED_JOB_RUN_ERRORS = 3;

// Returns why the session's job run failed, or an empty list when that is not available.
export async function fetchSimulatorSessionErrorsAsync(
  graphqlClient: ExpoGraphqlClient,
  deviceRunSessionId: string
): Promise<SimulatorSessionError[]> {
  let jobRun;
  try {
    jobRun = await DeviceRunSessionQuery.jobRunErrorsByIdAsync(graphqlClient, deviceRunSessionId);
  } catch (err) {
    Log.debug(`Failed to fetch simulator session errors: ${err}`);
    return [];
  }
  const errors = jobRun?.errors ?? [];
  // Uncategorized failures only say "Unknown error. See logs", so read the real cause from the job run logs.
  const logFileUrl = jobRun?.logFileUrls[0];
  if (logFileUrl && errors.every(error => UNKNOWN_ERROR_CODES.has(error.errorCode))) {
    const logErrors = await fetchJobRunLogErrorsAsync(logFileUrl);
    if (logErrors.length > 0) {
      const errorCode = errors[0]?.errorCode ?? 'UNKNOWN_ERROR';
      return logErrors.map(message => ({ errorCode, message }));
    }
  }
  return errors.map(({ errorCode, message, docsUrl }) => ({ errorCode, message, docsUrl }));
}

export function formatSimulatorSessionError(error: SimulatorSessionError): string {
  return `${error.message}${error.docsUrl ? ` ${learnMore(error.docsUrl)}` : ''}`;
}

async function fetchJobRunLogErrorsAsync(logFileUrl: string): Promise<string[]> {
  try {
    const response = await fetch(logFileUrl);
    const { logLines } = parseLogLines(await response.text());
    const messages = logLines
      .filter(line => typeof line.err?.message === 'string')
      .map(line =>
        line.buildStepDisplayName
          ? `${line.buildStepDisplayName}: ${line.err.message}`
          : line.err.message
      );
    return [...new Set(messages)].slice(-MAX_LOGGED_JOB_RUN_ERRORS);
  } catch (err) {
    Log.debug(`Failed to read simulator session logs: ${err}`);
    return [];
  }
}
