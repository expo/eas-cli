import { BuildPhase, buildPhaseDisplayName } from "@expo/eas-build-job";
import chalk from "chalk";

import { ExpoGraphqlClient } from "../commandUtils/context/contextUtils/createGraphqlClient";
import fetch, { RequestError } from "../fetch";
import { AppPlatform, BuildFragment, BuildStatus } from "../graphql/generated";
import { BuildQuery } from "../graphql/queries/BuildQuery";
import Log from "../log";
import { ora } from "../ora";
import { appPlatformDisplayNames } from "../platform";
import { sleepAsync } from "../utils/promise";

const DEFAULT_POLL_INTERVAL_MS = 1_000;

interface BuildLogLine {
  marker?: string;
  msg?: string;
  phase?: string;
}

interface StreamBuildLogsOptions {
  pollIntervalMs?: number;
  label?: string;
}

export async function streamBuildLogsAsync(
  graphqlClient: ExpoGraphqlClient,
  build: BuildFragment,
  options: StreamBuildLogsOptions = {},
): Promise<BuildFragment> {
  Log.newLine();
  return await streamBuildLogsInternalAsync(graphqlClient, build, options);
}

export async function streamBuildsLogsAsync(
  graphqlClient: ExpoGraphqlClient,
  builds: BuildFragment[],
  {
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  }: { pollIntervalMs?: number } = {},
): Promise<BuildFragment[]> {
  Log.newLine();
  return await Promise.all(
    builds.map((build) =>
      streamBuildLogsInternalAsync(graphqlClient, build, {
        pollIntervalMs,
        label: formatBuildLabel(build.platform),
      }),
    ),
  );
}

async function streamBuildLogsInternalAsync(
  graphqlClient: ExpoGraphqlClient,
  build: BuildFragment,
  { pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, label }: StreamBuildLogsOptions,
): Promise<BuildFragment> {
  const spinner = ora(
    "Streaming build logs. You can press Ctrl+C to exit.",
  ).start();
  const cursors = new Map<string, number>();
  const announcedPhases = new Set<string>();
  let currentBuild = build;

  while (true) {
    await printBuildLogsAsync(currentBuild, cursors, announcedPhases, label);

    if (isTerminalBuildStatus(currentBuild.status)) {
      if (currentBuild.status === BuildStatus.Finished) {
        spinner.succeed("Build finished");
      } else if (currentBuild.status === BuildStatus.Errored) {
        spinner.fail("Build failed");
      } else {
        spinner.warn("Build canceled");
      }
      return currentBuild;
    }

    await sleepAsync(pollIntervalMs);
    currentBuild = await BuildQuery.byIdAsync(graphqlClient, currentBuild.id, {
      useCache: false,
    });
  }
}

async function printBuildLogsAsync(
  build: BuildFragment,
  cursors: Map<string, number>,
  announcedPhases: Set<string>,
  label?: string,
): Promise<void> {
  for (const logFileUrl of build.logFiles) {
    const logFileId = getLogFileId(logFileUrl);
    const rawLogs = await fetchBuildLogFileAsync(logFileUrl);
    if (!rawLogs) {
      continue;
    }

    const parsedLines = parseBuildLogLines(rawLogs);
    const nextLineIndex = cursors.get(logFileId) ?? 0;
    const freshLines = parsedLines.slice(nextLineIndex);

    for (const line of freshLines) {
      printBuildLogLine(line, announcedPhases, label);
    }

    cursors.set(logFileId, parsedLines.length);
  }
}

async function fetchBuildLogFileAsync(
  logFileUrl: string,
): Promise<string | null> {
  try {
    const response = await fetch(logFileUrl, {
      method: "GET",
    });
    return await response.text();
  } catch (error: unknown) {
    if (
      error instanceof RequestError &&
      [403, 404].includes(error.response.status)
    ) {
      Log.debug(
        `Failed to fetch build log file ${logFileUrl}: ${error.message}`,
      );
      return null;
    }

    throw error;
  }
}

function printBuildLogLine(
  line: BuildLogLine,
  announcedPhases: Set<string>,
  label?: string,
): void {
  const phase = line.phase?.trim();
  if (phase && !announcedPhases.has(phase)) {
    announcedPhases.add(phase);
    const displayName = buildPhaseDisplayName[phase as BuildPhase] ?? phase;
    Log.log(withLabel(chalk.bold(displayName), label));
  }

  if (
    !line.msg ||
    line.marker === "START_PHASE" ||
    line.marker === "END_PHASE"
  ) {
    return;
  }

  for (const messageLine of line.msg.split("\n")) {
    if (messageLine.length > 0) {
      Log.log(withLabel(`  ${messageLine}`, label));
    }
  }
}

function withLabel(message: string, label?: string): string {
  return label ? `${chalk.dim(`[${label}]`)} ${message}` : message;
}

function formatBuildLabel(platform: AppPlatform): string {
  return appPlatformDisplayNames[platform];
}

function getLogFileId(logFileUrl: string): string {
  return new URL(logFileUrl).pathname;
}

function isTerminalBuildStatus(status: BuildFragment["status"]): boolean {
  return [
    BuildStatus.Finished,
    BuildStatus.Errored,
    BuildStatus.Canceled,
  ].includes(status);
}

export function parseBuildLogLines(rawLogs: string): BuildLogLine[] {
  const result: BuildLogLine[] = [];

  for (const line of rawLogs.split("\n")) {
    try {
      const parsedLine = JSON.parse(line) as BuildLogLine;
      result.push(parsedLine);
    } catch {
      continue;
    }
  }

  return result;
}
