import { Flags } from '@oclif/core';

import { getBareJobRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { DeviceRunSessionStatus } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import { formatRemoteConfigShellSnippet } from '../../simulator/utils';

export default class SimulatorGet extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] get info about a remote simulator session on EAS by its device run session ID';

  static override flags = {
    id: Flags.string({
      description: 'Device run session ID',
      required: true,
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorGet);

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorGet, {
      nonInteractive: flags['non-interactive'],
    });

    const fetchSpinner = ora(`Fetching device run session ${flags.id}`).start();
    let session;
    try {
      session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, flags.id);
      fetchSpinner.succeed(`Fetched device run session ${session.id}`);
    } catch (err) {
      fetchSpinner.fail(`Failed to fetch device run session ${flags.id}`);
      throw err;
    }

    const jobRunUrl = session.turtleJobRun
      ? getBareJobRunUrl(session.app.ownerAccount.name, session.app.slug, session.turtleJobRun.id)
      : '';

    Log.newLine();
    Log.log(`ID:       ${session.id}`);
    Log.log(`Type:     ${session.type}`);
    Log.log(`Status:   ${session.status}`);
    Log.log(`URL:      ${jobRunUrl ? link(jobRunUrl) : ''}`);

    if (session.status === DeviceRunSessionStatus.InProgress) {
      Log.newLine();
      if (session.remoteConfig) {
        Log.log('🔑 Run the following in your shell to attach to the session:');
        Log.newLine();
        Log.log(formatRemoteConfigShellSnippet(session.remoteConfig));
      } else {
        Log.log(
          '⏳ Session is starting up — remote config is not available yet. Re-run this command in a moment.'
        );
      }
    }
  }
}
