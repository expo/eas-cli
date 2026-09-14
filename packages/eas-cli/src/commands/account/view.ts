import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { Role } from '../../graphql/generated';
import Log from '../../log';
import { Actor, getActorDisplayName } from '../../user/User';
import { isMultiAccountEnabled } from '../../utils/easCli';

export default class AccountView extends EasCommand {
  static override description = 'show the username you are logged in as';
  static override aliases = ['whoami'];

  static override contextDefinition = {
    ...this.ContextOptions.MaybeLoggedIn,
    ...this.ContextOptions.SessionManagment,
  };

  async runAsync(): Promise<void> {
    const {
      maybeLoggedIn: { actor, authenticationInfo },
      sessionManager,
    } = await this.getContextAsync(AccountView, { nonInteractive: true });

    if (!actor) {
      Log.warn('Not logged in');
      process.exit(1);
    }

    const displayName = getActorDisplayName(actor);
    const loggedInAs = authenticationInfo.accessToken
      ? `${displayName} (authenticated using EXPO_TOKEN)`
      : displayName;
    Log.log(chalk.green(loggedInAs));
    if ('email' in actor) {
      Log.log(actor.email);
    }

    // Show other logged-in accounts if multi-account is enabled
    if (isMultiAccountEnabled() && !authenticationInfo.accessToken) {
      const accounts = sessionManager.getAllAccounts();
      const otherAccounts = accounts.filter(a => !a.isActive);

      if (otherAccounts.length > 0) {
        const otherUsernames = otherAccounts.map(a => a.username).join(', ');
        Log.log(chalk.dim(`Also logged in: ${otherUsernames}`));
      }
    }

    // personal account is included, only show if more accounts that personal account
    // but do show personal account in list if there are more
    const accountExcludingPersonalAccount = actor.accounts.filter(
      account => !('username' in actor) || account.name !== actor.username
    );
    if (accountExcludingPersonalAccount.length > 0) {
      Log.newLine();
      Log.log('Accounts:');
      actor.accounts.forEach(account => {
        const roleOnAccount = AccountView.getRoleOnAccount(actor, account);
        Log.log(`• ${account.name} (Role: ${AccountView.getLabelForRole(roleOnAccount)})`);
      });
    }
  }

  private static getRoleOnAccount(actor: Actor, account: Actor['accounts'][0]): Role {
    if ('username' in actor && account.name === actor.username) {
      return Role.Owner;
    }

    return account.viewerUserPermission.role;
  }

  private static getLabelForRole(role: Role): string {
    switch (role) {
      case Role.Owner:
        return 'Owner';
      case Role.Admin:
        return 'Admin';
      case Role.Developer:
        return 'Developer';
      case Role.ViewOnly:
        return 'Viewer';
      case Role.Custom:
      case Role.HasAdmin:
      case Role.NotAdmin:
        return 'Custom';
    }
  }
}
