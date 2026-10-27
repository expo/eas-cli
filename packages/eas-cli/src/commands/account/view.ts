import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { getActorDisplayName } from '../../user/User';
import { logAccountPermissions } from '../../user/accountPermissions';

export default class AccountView extends EasCommand {
  static override description = 'show the username you are logged in as';
  static override aliases = ['whoami'];

  static override contextDefinition = {
    ...this.ContextOptions.MaybeLoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      maybeLoggedIn: { actor, authenticationInfo },
    } = await this.getContextAsync(AccountView, { nonInteractive: true });
    if (actor) {
      const displayName = getActorDisplayName(actor);
      const loggedInAs = authenticationInfo.accessToken
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
