import { stripVTControlCharacters } from 'util';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { parseLogLines } from '../commandUtils/logs/parseLogs';
import { RawLogLine } from '../commandUtils/logs/types';
import fetch from '../fetch';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';
import Log, { learnMore } from '../log';
import { sanitizeTerminalText } from '../utils/terminalText';

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
const MAX_LOGGED_ERRORS = 4;
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
      return logErrors.map(message => ({ errorCode: errors[0].errorCode, message, docsUrl: null }));
    }
  }
  return errors.map(({ errorCode, message, docsUrl }) => ({
    errorCode,
    message: formatMessage(message),
    docsUrl,
  }));
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
    // node-fetch's error messages include the signed log URL, so leave the message out.
    Log.debug(
      `Failed to read simulator session logs: ${err instanceof Error ? err.name : 'unknown error'}`
    );
    return [];
  } finally {
    controller.abort();
  }
}

// Describes the steps that failed, the first one first: its last error line, preceded by the stderr
// line that names the cause and the line after it. Later failed steps only add their error line.
// Uses the log message rather than err.message because only the message has secrets masked.
export function selectFailedStepErrors(logLines: JobRunLogLine[]): string[] {
  const failedStepIds = [
    ...new Set(
      logLines
        .filter(line => line.marker === 'end-step' && line.result === 'fail' && line.buildStepId)
        .map(line => line.buildStepId as string)
    ),
  ];
  const messages = failedStepIds.flatMap((stepId, index) => {
    const lines = selectStepFailureLines(logLines.filter(line => line.buildStepId === stepId));
    return (index === 0 ? lines : lines.slice(-1)).map(formatLogLine);
  });
  return [...new Set(messages)].slice(0, MAX_LOGGED_ERRORS);
}

function selectStepFailureLines(stepLines: JobRunLogLine[]): JobRunLogLine[] {
  let selected: JobRunLogLine[] = [];
  let stderrCause: JobRunLogLine[] = [];
  for (const [index, line] of stepLines.entries()) {
    const text = toPlainText(line.msg ?? '');
    if (line.source === 'stderr') {
      if (STDERR_CAUSE_PATTERN.test(text)) {
        stderrCause = [line];
      } else if (stderrCause.length === 1 && stepLines[index - 1] === stderrCause[0]) {
        stderrCause.push(line);
      }
    } else if (line.err && (line.level ?? 0) >= ERROR_LOG_LEVEL && text) {
      selected = [...stderrCause, line];
      stderrCause = [];
    }
  }
  return selected;
}

function formatLogLine(line: JobRunLogLine): string {
  return formatMessage(
    line.buildStepDisplayName ? `${line.buildStepDisplayName}: ${line.msg}` : String(line.msg)
  );
}

// Log text comes from commands run in the session, so strip escape sequences and control
// characters that could clear the terminal or spoof output.
function toPlainText(message: string): string {
  return sanitizeTerminalText(stripVTControlCharacters(message));
}

function formatMessage(message: string): string {
  const text = toPlainText(message);
  return text.length > MAX_LOGGED_ERROR_LENGTH
    ? `${text.slice(0, MAX_LOGGED_ERROR_LENGTH)}…`
    : text;
}
