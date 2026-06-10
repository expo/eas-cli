import chalk from 'chalk';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionByIdQuery, JobRunStatus } from '../graphql/generated';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';
import Log from '../log';
import { ora } from '../ora';
import { formatBytes } from '../utils/files';
import { sleepAsync } from '../utils/promise';

const ARTIFACTS_POLL_INTERVAL_MS = 5_000; // 5 seconds
const ARTIFACTS_POLL_TIMEOUT_MS = 3 * 60 * 1_000; // 3 minutes

const FINAL_JOB_RUN_STATUSES: JobRunStatus[] = [
  JobRunStatus.Errored,
  JobRunStatus.Canceled,
  JobRunStatus.Finished,
];

export type DeviceRunSessionArtifact = NonNullable<
  DeviceRunSessionByIdQuery['deviceRunSessions']['byId']['turtleJobRun']
>['artifacts'][number];

export function getSimulatorArtifactsHint(deviceRunSessionId: string): string {
  return `Run ${chalk.bold(
    `eas simulator:artifacts --id ${deviceRunSessionId}`
  )} to list and download the session artifacts (screenshots and screen recordings).`;
}

export function printArtifactsSummary(artifacts: DeviceRunSessionArtifact[]): void {
  for (const artifact of artifacts) {
    Log.log(
      `  - ${artifact.name}${
        artifact.fileSizeBytes != null ? ` (${formatBytes(artifact.fileSizeBytes)})` : ''
      }`
    );
  }
}

/**
 * After a device run session is stopped, the session artifacts (screenshots
 * and screen recordings) are uploaded by the worker during the abort cleanup,
 * which finishes when the underlying turtle job run reaches a final status.
 * This waits (politely, skippable with Ctrl+C) for the job run to settle and
 * prints a summary of the artifacts. In non-interactive mode it only prints
 * the download hint.
 */
export async function maybeWaitForSessionArtifactsAndPrintSummaryAsync({
  graphqlClient,
  deviceRunSessionId,
  nonInteractive,
}: {
  graphqlClient: ExpoGraphqlClient;
  deviceRunSessionId: string;
  nonInteractive: boolean;
}): Promise<void> {
  if (nonInteractive) {
    Log.log(getSimulatorArtifactsHint(deviceRunSessionId));
    return;
  }

  const spinner = ora('Waiting for session artifacts to be saved — press Ctrl+C to skip').start();

  const abortController = new AbortController();
  const { signal } = abortController;
  const abortPromise = new Promise<void>(resolve => {
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true }
    );
  });
  const sigintHandler = (): void => {
    abortController.abort();
  };
  process.on('SIGINT', sigintHandler);

  try {
    const deadline = Date.now() + ARTIFACTS_POLL_TIMEOUT_MS;
    while (!signal.aborted && Date.now() < deadline) {
      let session;
      try {
        session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, deviceRunSessionId);
      } catch (err) {
        Log.debug(
          `Failed to poll device run session: ${err instanceof Error ? err.message : String(err)}`
        );
        await Promise.race([sleepAsync(ARTIFACTS_POLL_INTERVAL_MS), abortPromise]);
        continue;
      }

      const jobRunStatus = session.turtleJobRun?.status;
      if (
        !session.turtleJobRun ||
        (jobRunStatus && FINAL_JOB_RUN_STATUSES.includes(jobRunStatus))
      ) {
        const artifacts = session.turtleJobRun?.artifacts ?? [];
        if (artifacts.length === 0) {
          spinner.succeed('The session produced no artifacts');
        } else {
          spinner.succeed(
            `The session produced ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}:`
          );
          printArtifactsSummary(artifacts);
          Log.newLine();
          Log.log(getSimulatorArtifactsHint(deviceRunSessionId));
        }
        return;
      }

      await Promise.race([sleepAsync(ARTIFACTS_POLL_INTERVAL_MS), abortPromise]);
    }

    if (signal.aborted) {
      spinner.warn('Skipped waiting for session artifacts');
    } else {
      spinner.warn('Timed out waiting for session artifacts to be saved');
    }
    Log.log(getSimulatorArtifactsHint(deviceRunSessionId));
  } finally {
    process.removeListener('SIGINT', sigintHandler);
  }
}
