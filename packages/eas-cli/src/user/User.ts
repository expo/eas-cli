import { CurrentUserQuery, Robot, SsoUser, User } from '../graphql/generated';

export type Actor = NonNullable<CurrentUserQuery['meActor']>;

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
    | null
): string {
  switch (actor?.__typename) {
    case 'User':
      return actor.username;
    case 'Robot':
      return actor.firstName ? `${actor.firstName} (robot)` : 'robot';
    case 'SSOUser':
      return actor.username;
    case undefined:
      return 'unknown';
  }
}

export function getActorUsername(actor?: Actor): string | null {
  switch (actor?.__typename) {
    case 'User':
    case 'SSOUser':
      return actor.username;
    case 'Robot':
    case undefined:
      return null;
  }
}
