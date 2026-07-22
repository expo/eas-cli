import { CurrentUserQuery, PartnerActor, Robot, Role, SsoUser, User } from '../graphql/generated';

export type Actor = NonNullable<CurrentUserQuery['meActor']>;

/**
 * Names of the accounts where the actor can create projects (non-ViewOnly role),
 * sorted by account creation date from newest to oldest. Used for display in error messages.
 */
export function getCreatableAccountNamesNewestFirst(actor: Actor): string[] {
  return [...actor.accounts]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .filter(a => a.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly)
    .map(it => it.name);
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
