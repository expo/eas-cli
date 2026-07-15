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
} from '../../simulator/events';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { sleepAsync } from '../../utils/promise';

const POLL_INTERVAL_MS = 5_000;

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
          artifact => artifact.metadata?.__eas_device_run_session_events === '1'
        );
        const events = eventArtifact
          ? await downloadDeviceRunSessionEventsAsync(eventArtifact.downloadUrl, deviceRunSessionId)
          : [];

        if (jsonFlag) {
          printJsonOnlyOutput({ deviceRunSessionId, events });
          return;
        }

        const newEvents = events.filter(event => !printedEventIds.has(event.eventId));
        printEvents(newEvents);
        for (const event of newEvents) {
          printedEventIds.add(event.eventId);
        }

        const isRunning =
          session.status === DeviceRunSessionStatus.New ||
          session.status === DeviceRunSessionStatus.InProgress;
        if (!flags.follow || !isRunning || interrupted) {
          if (events.length === 0) {
            Log.log('No simulator session activity has been recorded.');
          }
          return;
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
    Log.log(`${event.occurredAt}  ${event.producer}  ${event.summary}`);
  }
}
