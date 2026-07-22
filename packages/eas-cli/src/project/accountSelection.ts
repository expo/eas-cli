import { Role } from '../graphql/generated';
import { Choice } from '../prompts';
import { Actor } from '../user/User';

export function getAccountNamesWhereUserHasSufficientPermissionsToCreateApp(
  actor: Actor
): Set<string> {
  return new Set(
    actor.accounts
      .filter(a => a.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly)
      .map(it => it.name)
  );
}

export function getAccountChoices(
  actor: Actor,
  namesWithSufficientPermissions: Set<string>
): Choice[] {
  // sorted by account creation date from newest to oldest
  const sortedAccounts = [...actor.accounts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (actor.__typename === 'Robot') {
    return sortedAccounts.map(account => ({
      title: account.name,
      value: account,
      description: !namesWithSufficientPermissions.has(account.name) ? '(Viewer Role)' : undefined,
    }));
  }

  return sortedAccounts.map(account => {
    const accountType =
      account.ownerUserActor?.id === actor.id
        ? '(Personal)'
        : account.ownerUserActor
          ? '(Team)'
          : '(Organization)';

    return {
      title: account.name,
      value: account,
      description: !namesWithSufficientPermissions.has(account.name)
        ? `${accountType} (Viewer Role)`
        : accountType,
    };
  });
}
