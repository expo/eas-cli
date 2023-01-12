import { CurrentUserQuery } from '../graphql/generated';

export type Actor = NonNullable<CurrentUserQuery['meActor']>;

/**
 * Resolve the name of the actor, either normal user or robot user.
 * This should be used whenever the "current user" needs to be displayed.
 * The display name CANNOT be used as project owner.
 */
export function getActorDisplayName(user?: Actor): string {
  switch (user?.__typename) {
    case 'User':
      return user.username;
    case 'Robot':
      return user.firstName ? `${user.firstName} (robot)` : 'robot';
    case 'SSOUser':
      return user.username ? `${user.username} (sso user)` : 'sso user';
    default:
      return 'anonymous';
  }
}
