import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { parseLogLines } from '../commandUtils/logs/parseLogs';
import { RawLogLine } from '../commandUtils/logs/types';
import fetch from '../fetch';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';
import Log, { learnMore } from '../log';

export type SimulatorSessionError = {
  errorCode: string;
  message: string;
  docsUrl?: string | null;
};

export type FetchSimulatorSessionErrorsOptions = {
  /** Aborts the lookup, e.g. on Ctrl+C. */
  signal?: AbortSignal;
  queryTimeoutMs?: number;
  logDownloadTimeoutMs?: number;
  maxLogSizeBytes?: number;
};

// ErrorCode.UNKNOWN_ERROR and ErrorCode.UNKNOWN_CUSTOM_BUILD_ERROR from @expo/eas-build-job.
const UNKNOWN_ERROR_CODES = new Set(['UNKNOWN_ERROR', 'UNKNOWN_CUSTOM_BUILD_ERROR']);
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const DEFAULT_LOG_DOWNLOAD_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_LOG_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_LOGGED_ERRORS = 3;
const MAX_LOGGED_ERROR_LENGTH = 500;
// Bunyan's "error" level.
const ERROR_LOG_LEVEL = 50;
const STDERR_CAUSE_PATTERN = /\b(error|exception|fatal)\b/i;

type JobRunLogLine = RawLogLine & { level?: number; source?: string };

// Returns why the session's job run failed, or an empty list when that is not available.
export async function fetchSimulatorSessionErrorsAsync(
  graphqlClient: ExpoGraphqlClient,
  deviceRunSessionId: string,
  {
    signal,
    queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
    logDownloadTimeoutMs = DEFAULT_LOG_DOWNLOAD_TIMEOUT_MS,
    maxLogSizeBytes = DEFAULT_MAX_LOG_SIZE_BYTES,
  }: FetchSimulatorSessionErrorsOptions = {}
): Promise<SimulatorSessionError[]> {
  if (signal?.aborted) {
    return [];
  }
  let jobRun;
  try {
    jobRun = await DeviceRunSessionQuery.jobRunErrorsByIdAsync(graphqlClient, deviceRunSessionId, {
      signal: withTimeout(signal, queryTimeoutMs),
    });
  } catch (err) {
    Log.debug(`Failed to fetch simulator session errors: ${err}`);
    return [];
  }
  const errors = jobRun?.errors ?? [];
  // Uncategorized failures only say "Unknown error. See logs", so read the real cause from the job run logs.
  const logFileUrl = jobRun?.logFileUrls[0];
  if (
    logFileUrl &&
    errors.length > 0 &&
    errors.every(error => UNKNOWN_ERROR_CODES.has(error.errorCode))
  ) {
    const logErrors = await fetchJobRunLogErrorsAsync(logFileUrl, {
      signal: withTimeout(signal, logDownloadTimeoutMs),
      maxLogSizeBytes,
    });
    if (logErrors.length > 0) {
      return logErrors.map(message => ({ errorCode: errors[0].errorCode, message }));
    }
  }
  return errors.map(({ errorCode, message, docsUrl }) => ({ errorCode, message, docsUrl }));
}

export function formatSimulatorSessionError(error: SimulatorSessionError): string {
  return `${error.message}${error.docsUrl ? ` ${learnMore(error.docsUrl)}` : ''}`;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function fetchJobRunLogErrorsAsync(
  logFileUrl: string,
  { signal, maxLogSizeBytes }: { signal: AbortSignal; maxLogSizeBytes: number }
): Promise<string[]> {
  // node-fetch stops reading on its own only when the body ends, so abort to close the connection
  // after an error, an oversized body or a timeout.
  const controller = new AbortController();
  try {
    const response = await fetch(logFileUrl, {
      size: maxLogSizeBytes,
      signal: AbortSignal.any([signal, controller.signal]),
    });
    const { logLines } = parseLogLines(await response.text());
    return selectFailedStepErrors(logLines);
  } catch (err) {
    Log.debug(`Failed to read simulator session logs: ${err}`);
    return [];
  } finally {
    controller.abort();
  }
}

// Picks the error lines of the steps that failed, each preceded by the step's last stderr line that
// looks like a cause, falling back to any error line. Uses the log message rather than err.message
// because only the message has secrets masked.
export function selectFailedStepErrors(logLines: JobRunLogLine[]): string[] {
  const isErrorLine = (line: JobRunLogLine): boolean =>
    !!line.err && (line.level ?? 0) >= ERROR_LOG_LEVEL && !!line.msg?.trim();
  const failedStepIds = new Set(
    logLines
      .filter(line => line.marker === 'end-step' && line.result === 'fail' && line.buildStepId)
      .map(line => line.buildStepId)
  );

  const failedStepEntries: JobRunLogLine[] = [];
  const lastStderrCauseByStepId = new Map<string, JobRunLogLine>();
  for (const line of logLines) {
    if (!line.buildStepId || !failedStepIds.has(line.buildStepId)) {
      continue;
    }
    if (line.source === 'stderr' && STDERR_CAUSE_PATTERN.test(line.msg ?? '')) {
      lastStderrCauseByStepId.set(line.buildStepId, line);
    } else if (isErrorLine(line)) {
      const stderrCause = lastStderrCauseByStepId.get(line.buildStepId);
      if (stderrCause) {
        failedStepEntries.push(stderrCause);
        lastStderrCauseByStepId.delete(line.buildStepId);
      }
      failedStepEntries.push(line);
    }
  }
  const selectedLines = failedStepEntries.some(isErrorLine)
    ? failedStepEntries
    : logLines.filter(isErrorLine);

  // Keep the latest occurrence of each message, since the last failure is usually the cause.
  const messages = selectedLines.map(formatLogLine);
  const latestFirst = [...new Set([...messages].reverse())];
  return latestFirst.slice(0, MAX_LOGGED_ERRORS).reverse();
}

function formatLogLine(line: JobRunLogLine): string {
  const message = line.buildStepDisplayName
    ? `${line.buildStepDisplayName}: ${line.msg}`
    : String(line.msg);
  return message.length > MAX_LOGGED_ERROR_LENGTH
    ? `${message.slice(0, MAX_LOGGED_ERROR_LENGTH)}…`
    : message;
}
