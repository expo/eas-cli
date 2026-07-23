import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionStatus } from '../../graphql/generated';
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
    let interrupted = false;
    const interruptHandler = (): void => {
      interrupted = true;
    };
    process.on('SIGINT', interruptHandler);

    try {
      do {
        const session = await DeviceRunSessionQuery.eventsByIdAsync(
          graphqlClient,
          deviceRunSessionId
        );
        const eventArtifact = session.artifacts.find(
          artifact => artifact.metadata?.__eas_type === 'session-events'
        );
        const events = eventArtifact
          ? await downloadDeviceRunSessionEventsAsync(eventArtifact.downloadUrl)
          : [];

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

        const shouldRefreshAgain = flags.follow && (isRunning || remainingPostStopRefreshes > 0);
        const displayEvents = projectDeviceRunSessionEventsForDisplay(events, {
          includeIncompleteOperations: interrupted || !shouldRefreshAgain,
        });
        const newDisplayEvents = displayEvents.filter(event => !printedEventIds.has(event.eventId));
        printEvents(newDisplayEvents);
        for (const event of newDisplayEvents) {
          printedEventIds.add(event.eventId);
        }

        if (!shouldRefreshAgain || interrupted) {
          if (events.length === 0) {
            Log.log('No simulator session activity has been recorded.');
          }
          return;
        }
        if (!isRunning) {
          remainingPostStopRefreshes -= 1;
        }
        await sleepAsync(POLL_INTERVAL_MS);
      } while (!interrupted);
    } finally {
      process.removeListener('SIGINT', interruptHandler);
    }
  }
}

function printEvents(events: DeviceRunSessionEvent[]): void {
  for (const event of events) {
    Log.log(formatDeviceRunSessionEvent(event));
  }
}
