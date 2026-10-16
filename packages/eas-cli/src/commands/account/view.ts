import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { Permission, Role } from '../../graphql/generated';
import Log from '../../log';
import { Actor, getActorDisplayName } from '../../user/User';
import { getRoleForPermissions } from '../../user/roles';

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

      // personal account is included, only show if more accounts that personal account
      // but do show personal account in list if there are more, or if the credentials used for
      // this command limit the permissions on it
      const accountExcludingPersonalAccount = actor.accounts.filter(
        account => !('username' in actor) || account.name !== actor.username
      );
      const hasLimitedAccount = actor.accounts.some(AccountView.isLimitedByCredentials);
      if (accountExcludingPersonalAccount.length > 0 || hasLimitedAccount) {
        Log.newLine();
        Log.log('Accounts:');
        actor.accounts.forEach(account => {
          const { permissions, effectivePermissions } = account.viewerUserPermission2;
          const roleLabel = AccountView.getLabelForPermissions(permissions);
          if (AccountView.isLimitedByCredentials(account)) {
            const effectiveRoleLabel = AccountView.getLabelForPermissions(effectivePermissions);
            Log.log(
              `• ${account.name} (Role: ${roleLabel}, ${chalk.yellow(
                `limited to ${effectiveRoleLabel} by the current credentials`
              )})`
            );
          } else {
            Log.log(`• ${account.name} (Role: ${roleLabel})`);
          }
        });
        if (hasLimitedAccount) {
          Log.newLine();
          Log.log(
            `The permissions granted during authentication limit your access to some accounts. Run ${chalk.bold(
              'eas login'
            )} to change the permission grant.`
          );
        }
      }
    } else {
      Log.warn('Not logged in');
      process.exit(1);
    }
  }

  /**
   * Whether the scopes of the credential used for this command remove any of the permissions that
   * the viewer's role grants on the account.
   */
  private static isLimitedByCredentials(account: Actor['accounts'][0]): boolean {
    const { permissions, effectivePermissions } = account.viewerUserPermission2;
    return permissions.some(permission => !effectivePermissions.includes(permission));
  }

  private static getLabelForPermissions(permissions: readonly Permission[]): string {
    const role = getRoleForPermissions(permissions);
    if (role !== Role.Custom) {
      return AccountView.getLabelForRole(role);
    }
    if (permissions.length === 0) {
      return 'No permissions';
    }
    return `Custom: ${permissions
      .map(permission => permission.toLowerCase().replaceAll('_', ' '))
      .join(', ')}`;
  }

  private static getLabelForRole(role: Role): string {
    switch (role) {
      case Role.Owner:
        return 'Owner';
      case Role.Admin:
        return 'Admin';
      case Role.Developer:
        return 'Developer';
      case Role.ReleaseManager:
        return 'Release Manager';
      case Role.Runner:
        return 'Runner';
      case Role.ViewOnly:
        return 'Viewer';
      case Role.Custom:
      case Role.HasAdmin:
      case Role.NotAdmin:
        return 'Custom';
      // A role added to the API after this version of the CLI was published. TypeScript narrows
      // `role` to `never` here, but the server can still send one, so render its name rather than
      // returning undefined.
      default: {
        const unknownRole: string = role;
        return unknownRole
          .split('_')
          .map(word => word.charAt(0) + word.slice(1).toLowerCase())
          .join(' ');
      }
    }
  }
}
