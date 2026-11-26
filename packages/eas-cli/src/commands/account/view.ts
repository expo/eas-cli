import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { getAccessToken } from '../../user/SessionManager';
import { Actor, getActorDisplayName } from '../../user/User';
import { logAccountPermissions } from '../../user/accountPermissions';

export default class AccountView extends EasCommand {
  static override description = 'show the username you are logged in as';
  static override aliases = ['whoami'];

  async runAsync(actor: Actor | undefined): Promise<void> {
    if (actor) {
      const displayName = getActorDisplayName(actor);
      const loggedInAs = getAccessToken()
        ? `${displayName} (authenticated using EXPO_TOKEN)`
        : displayName;
      Log.log(chalk.green(loggedInAs));
      if ('email' in actor) {
        Log.log(actor.email);
      }

      const { hasLimitedAccount } = logAccountPermissions(actor);
      if (hasLimitedAccount) {
        Log.newLine();
        Log.log(
          `The permissions granted during authentication limit your access to some accounts. Run ${chalk.bold(
            'eas login'
          )} to change the permission grant.`
        );
      }
    } else {
      Log.warn('Not logged in');
      process.exit(1);
    }
  }
}
