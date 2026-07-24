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
  const allAccounts = actor.accounts;

  const sortedAccounts =
    actor.__typename === 'Robot'
      ? allAccounts
      : [...allAccounts].sort((a, _b) =>
          actor.__typename === 'User' ? (a.name === actor.username ? -1 : 1) : 0
        );

  if (actor.__typename !== 'Robot') {
    const personalAccount = allAccounts?.find(account => account?.ownerUserActor?.id === actor.id);

    const personalAccountChoice = personalAccount
      ? {
          title: personalAccount.name,
          value: personalAccount,
          description: !namesWithSufficientPermissions.has(personalAccount.name)
            ? '(Personal) (Viewer Role)'
            : '(Personal)',
        }
      : undefined;

    const userAccounts = allAccounts
      ?.filter(account => account.ownerUserActor && account.name !== actor.username)
      .map(account => ({
        title: account.name,
        value: account,
        description: !namesWithSufficientPermissions.has(account.name)
          ? '(Team) (Viewer Role)'
          : '(Team)',
      }));

    const organizationAccounts = allAccounts
      ?.filter(account => account.name !== actor.username && !account.ownerUserActor)
      .map(account => ({
        title: account.name,
        value: account,
        description: !namesWithSufficientPermissions.has(account.name)
          ? '(Organization) (Viewer Role)'
          : '(Organization)',
      }));

    let choices: Choice[] = [];
    if (personalAccountChoice) {
      choices = [personalAccountChoice];
    }

    return [...choices, ...userAccounts, ...organizationAccounts].sort((a, _b) =>
      actor.__typename === 'User' ? (a.value.name === actor.username ? -1 : 1) : 0
    );
  }

  return sortedAccounts.map(account => ({
    title: account.name,
    value: account,
    description: !namesWithSufficientPermissions.has(account.name) ? '(Viewer Role)' : undefined,
  }));
}
