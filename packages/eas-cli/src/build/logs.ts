import { BuildPhase, buildPhaseDisplayName } from '@expo/eas-build-job';

import { choicesFromJobLogs, stepLogTail } from '../commandUtils/logs/format';
import { parseLogLines } from '../commandUtils/logs/parseLogs';
import { JobLogs, RawLogLine } from '../commandUtils/logs/types';
import { LogSource } from '../commandUtils/logs/watcher';
import { BuildFragment, BuildStatus, RealtimeLogsTargetType } from '../graphql/generated';
import Log from '../log';
import { appPlatformDisplayNames, appPlatformEmojis } from '../platform';
import formatFields, { FormatFieldsItem } from '../utils/formatFields';

const SINGLE_BUILD_MAX_LOG_LINES = 5;
const MULTIPLE_BUILDS_MAX_LOG_LINES = 3;

async function fetchAndParseLogsForBuildAsync(build: BuildFragment): Promise<RawLogLine[] | null> {
  const logFileUrl = build.logFiles[0];
  if (!logFileUrl) {
    return null;
  }
  const response = await fetch(logFileUrl);
  const rawLogs = await response.text();
  if (!rawLogs) {
    return null;
  }
  const { logLines, errors } = parseLogLines(rawLogs);
  for (const error of errors) {
    Log.debug(`Failed to parse a log line: ${error.message}`);
  }
  return logLines;
}

export function logSourceForBuild(build: BuildFragment): LogSource {
  return {
    key: build.id,
    realtimeTarget: { type: RealtimeLogsTargetType.Build, id: build.id },
    isInProgress: build.status === BuildStatus.InProgress,
    fetchRawLogLinesAsync: async () => await fetchAndParseLogsForBuildAsync(build),
  };
}

export function isBuildCompleted(status: BuildStatus): boolean {
  switch (status) {
    case BuildStatus.Finished:
    case BuildStatus.Errored:
    case BuildStatus.Canceled:
      return true;
    case BuildStatus.New:
    case BuildStatus.InQueue:
    case BuildStatus.InProgress:
    case BuildStatus.PendingCancel:
      return false;
  }
}

function stepDisplayName(label: string): string {
  return Object.hasOwn(buildPhaseDisplayName, label)
    ? buildPhaseDisplayName[label as BuildPhase]
    : label;
}

function activeBuildFields(
  logs: JobLogs,
  maxLogLines: number,
  buildLabel: string | null
): FormatFieldsItem[] {
  const steps = choicesFromJobLogs(logs);
  if (steps.length === 0) {
    return [];
  }
  const currentStep = steps[steps.length - 1];

  const fields: FormatFieldsItem[] = [{ label: '', value: '' }];
  if (buildLabel !== null) {
    fields.push({ label: '  Build', value: buildLabel });
  }
  fields.push({ label: '  Current phase', value: stepDisplayName(currentStep.name) });
  if (currentStep.logLines?.length) {
    fields.push({ label: '  Current logs', value: '' });
    for (const logLine of stepLogTail(currentStep, maxLogLines)) {
      fields.push({ label: '', value: logLine });
    }
  }
  return fields;
}

function appendFields(baseText: string, fields: FormatFieldsItem[]): string {
  if (fields.length === 0) {
    return baseText;
  }
  return `${baseText}\n${formatFields(fields)}`;
}

export function formatActiveBuildText(baseText: string, logs: JobLogs): string {
  return appendFields(baseText, activeBuildFields(logs, SINGLE_BUILD_MAX_LOG_LINES, null));
}

export function formatActiveBuildsText(
  baseText: string,
  buildsWithLogs: { build: BuildFragment; logs: JobLogs }[]
): string {
  return appendFields(
    baseText,
    buildsWithLogs.flatMap(({ build, logs }) =>
      activeBuildFields(
        logs,
        MULTIPLE_BUILDS_MAX_LOG_LINES,
        `${appPlatformEmojis[build.platform]} ${appPlatformDisplayNames[build.platform]}`
      )
    )
  );
}
