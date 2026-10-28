import chalk from 'chalk';

import { Permission, Role } from '../graphql/generated';
import Log from '../log';
import { Actor } from './User';
import { getRoleForPermissions } from './roles';

/**
 * Logs the actor's role on each account, and whether the credentials used for this command limit
 * it. The list is skipped when it only contains the personal account and the credentials do not
 * limit it.
 *
 * @returns whether the credentials limit the permissions on any account
 */
export function logAccountPermissions(actor: Actor): { hasLimitedAccount: boolean } {
  // personal account is included, only show if more accounts that personal account
  // but do show personal account in list if there are more, or if the credentials used for
  // this command limit the permissions on it
  const accountExcludingPersonalAccount = actor.accounts.filter(
    account => !('username' in actor) || account.name !== actor.username
  );
  const hasLimitedAccount = actor.accounts.some(isLimitedByCredentials);
  if (accountExcludingPersonalAccount.length === 0 && !hasLimitedAccount) {
    return { hasLimitedAccount };
  }

  Log.newLine();
  Log.log('Accounts:');
  actor.accounts.forEach(account => {
    const { permissions, effectivePermissions } = account.viewerUserPermission2;
    const roleLabel = getLabelForPermissions(permissions);
    if (isLimitedByCredentials(account)) {
      const effectiveRoleLabel = getLabelForPermissions(effectivePermissions);
      Log.log(
        `• ${account.name} (Role: ${roleLabel}, ${chalk.yellow(
          `limited to ${effectiveRoleLabel} by the current credentials`
        )})`
      );
    } else {
      Log.log(`• ${account.name} (Role: ${roleLabel})`);
    }
  });
  return { hasLimitedAccount };
}

/**
 * Whether the scopes of the credential used for this command remove any of the permissions that
 * the viewer's role grants on the account.
 */
function isLimitedByCredentials(account: Actor['accounts'][0]): boolean {
  const { permissions, effectivePermissions } = account.viewerUserPermission2;
  return permissions.some(permission => !effectivePermissions.includes(permission));
}

function getLabelForPermissions(permissions: readonly Permission[]): string {
  const role = getRoleForPermissions(permissions);
  if (role !== Role.Custom) {
    return getLabelForRole(role);
  }
  if (permissions.length === 0) {
    return 'No permissions';
  }
  return `Custom: ${permissions
    .map(permission => permission.toLowerCase().replaceAll('_', ' '))
    .join(', ')}`;
}

function getLabelForRole(role: Role): string {
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
