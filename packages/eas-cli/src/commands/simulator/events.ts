import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import {
  type DeviceRunSessionEventsByIdQuery,
  DeviceRunSessionStatus,
} from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../log';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  type DeviceRunSessionEvent,
  downloadDeviceRunSessionEventsAsync,
  formatDeviceRunSessionEvent,
  projectDeviceRunSessionEventsForDisplay,
} from '../../simulator/events';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { sleepAsync } from '../../utils/promise';

const POLL_INTERVAL_MS = 5_000;
const POST_STOP_REFRESH_COUNT = 2;

export default class SimulatorEvents extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] show activity events from a remote simulator session';

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Keep watching for new events until the session ends.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorEvents);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag && flags.follow) {
      throw new Error('Use either --json or --follow, not both.');
    }
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorEvents, { nonInteractive });
    await loadSimulatorEnvAsync(projectDir);
    const deviceRunSessionId = flags.id ?? process.env[EAS_SIMULATOR_SESSION_ID];
    if (!deviceRunSessionId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }

    const printedEventIds = new Set<string>();
    let observedRunningSession = false;
    let remainingPostStopRefreshes = 0;
    let latestEvents: DeviceRunSessionEvent[] = [];
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
    const interruptHandler = (): void => {
      if (signal.aborted) {
        process.exit(130);
      }
      abortController.abort();
    };
    if (flags.follow) {
      process.on('SIGINT', interruptHandler);
    }

    try {
      while (!signal.aborted) {
        let session: DeviceRunSessionEventsByIdQuery['deviceRunSessions']['byId'];
        let events: DeviceRunSessionEvent[];
        try {
          session = await DeviceRunSessionQuery.eventsByIdAsync(graphqlClient, deviceRunSessionId);
          const eventArtifact = session.artifacts.find(
            artifact => artifact.metadata?.__eas_type === 'session-events'
          );
          events = eventArtifact
            ? await downloadDeviceRunSessionEventsAsync(eventArtifact.downloadUrl)
            : [];
        } catch (err) {
          if (!flags.follow) {
            throw err;
          }
          Log.debug(
            `Failed to poll simulator session events: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          await Promise.race([sleepAsync(POLL_INTERVAL_MS), abortPromise]);
          continue;
        }
        latestEvents = events;

        if (jsonFlag) {
          printJsonOnlyOutput({ deviceRunSessionId, events });
          return;
        }

        const isRunning =
          session.status === DeviceRunSessionStatus.New ||
          session.status === DeviceRunSessionStatus.InProgress;
        if (isRunning) {
          observedRunningSession = true;
          remainingPostStopRefreshes = 0;
        } else if (observedRunningSession) {
          observedRunningSession = false;
          remainingPostStopRefreshes = POST_STOP_REFRESH_COUNT;
        }

        const shouldRefreshAgain =
          flags.follow && !signal.aborted && (isRunning || remainingPostStopRefreshes > 0);
        printNewEvents(events, printedEventIds, !shouldRefreshAgain);

        if (!shouldRefreshAgain) {
          if (events.length === 0) {
            Log.log('No simulator session activity has been recorded.');
          }
          return;
        }
        if (!isRunning) {
          remainingPostStopRefreshes -= 1;
        }
        await Promise.race([sleepAsync(POLL_INTERVAL_MS), abortPromise]);
      }
      printNewEvents(latestEvents, printedEventIds, true);
    } finally {
      if (flags.follow) {
        process.removeListener('SIGINT', interruptHandler);
      }
    }
  }
}

function printNewEvents(
  events: DeviceRunSessionEvent[],
  printedEventIds: Set<string>,
  includeIncompleteOperations: boolean
): void {
  const displayEvents = projectDeviceRunSessionEventsForDisplay(events, {
    includeIncompleteOperations,
  });
  for (const event of displayEvents) {
    if (printedEventIds.has(event.eventId)) {
      continue;
    }
    Log.log(formatDeviceRunSessionEvent(event));
    printedEventIds.add(event.eventId);
  }
}
