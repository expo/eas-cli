import {
  AccountFragment,
  CurrentUserQuery,
  PartnerActor,
  Permission,
  Robot,
  SsoUser,
  User,
} from '../graphql/generated';

export type Actor = NonNullable<CurrentUserQuery['meActor']>;

/**
 * Whether the actor can create projects on the account with the credential used for this command.
 * Creating a project requires the PUBLISH permission, and the scopes of a scoped credential cap
 * `effectivePermissions`.
 */
export function canCreateProjectsOnAccount(account: Actor['accounts'][number]): boolean {
  return account.viewerUserPermission2.effectivePermissions.includes(Permission.Publish);
}

/**
 * Why the actor cannot create projects on the account, or null if they can. Tells apart a role
 * without the PUBLISH permission from a credential whose scopes remove it.
 */
export function getCannotCreateProjectsOnAccountReason(
  account: Actor['accounts'][number]
): string | null {
  if (canCreateProjectsOnAccount(account)) {
    return null;
  }
  if (account.viewerUserPermission2.permissions.includes(Permission.Publish)) {
    return `The permissions granted during authentication do not allow you to create projects on the "${account.name}" account. Run eas login to change the permission grant.`;
  }
  return `You do not have the required permissions to create projects on the "${account.name}" account.`;
}

/**
 * `getCannotCreateProjectsOnAccountReason` for an account given by name, which may not be one of
 * the actor's accounts.
 */
export function getCannotCreateProjectsOnAccountNameReason(
  actor: Actor,
  accountName: string
): string | null {
  const account = actor.accounts.find(a => a.name === accountName);
  if (!account) {
    return `You do not have access to the "${accountName}" account.`;
  }
  return getCannotCreateProjectsOnAccountReason(account);
}

/**
 * Names of the accounts where the actor can create projects, listed in the
 * same order as account selection prompts: the personal account first, then team accounts,
 * then organization accounts.
 */
export function getCreatableAccountNames(actor: Actor): string[] {
  const creatableAccounts = actor.accounts.filter(canCreateProjectsOnAccount);
  if (actor.__typename === 'Robot') {
    return creatableAccounts.map(it => it.name);
  }
  const personalAccountId = getPersonalAccount(actor)?.id;
  return [
    ...creatableAccounts.filter(a => a.id === personalAccountId),
    ...creatableAccounts.filter(a => a.ownerUserActor && a.id !== personalAccountId),
    ...creatableAccounts.filter(a => !a.ownerUserActor && a.id !== personalAccountId),
  ].map(it => it.name);
}

/**
 * Resolve the name of the actor, either normal user, sso user or robot user.
 * This should be used whenever the "current user" needs to be displayed.
 * The display name CANNOT be used as project owner.
 */
export function getActorDisplayName(
  actor?:
    | Pick<Robot, '__typename' | 'firstName'>
    | Pick<User, '__typename' | 'username'>
    | Pick<SsoUser, '__typename' | 'username'>
    | Pick<PartnerActor, '__typename' | 'username'>
    | null
): string {
  switch (actor?.__typename) {
    case 'User':
      return actor.username;
    case 'Robot':
      return actor.firstName ? `${actor.firstName} (robot)` : 'robot';
    case 'SSOUser':
      return actor.username;
    case 'PartnerActor':
      return actor.username;
    case undefined:
      return 'unknown';
  }
}

export function getActorUsername(actor?: Actor): string | null {
  switch (actor?.__typename) {
    case 'User':
    case 'SSOUser':
    case 'PartnerActor':
      return actor.username;
    case 'Robot':
    case undefined:
      return null;
  }
}

/**
 * Resolve the personal account of an actor. Use this helper instead of
 * assuming that a user's personal account name equals their username.
 *
 * Returns `null` for actors without a personal account (e.g. robots), and when the session's
 * scope doesn't include the personal account.
 */
export function getPersonalAccount(actor?: Actor): AccountFragment | null {
  switch (actor?.__typename) {
    case 'User':
    case 'SSOUser':
      return actor.accounts.find(account => account.ownerUserActor?.id === actor.id) ?? null;
    case 'PartnerActor':
      // ownerUserActor only resolves to a User or SSOUser, so match on the primary account id
      return actor.accounts.find(account => account.id === actor.primaryAccount.id) ?? null;
    case 'Robot':
    case undefined:
      return null;
  }
}
