import { Role } from '../graphql/generated';
import { Choice } from '../prompts';
import { Actor, getPersonalAccount } from '../user/User';

export function getAccountNamesWhereUserHasSufficientPermissionsToCreateApp(
  actor: Actor
): Set<string> {
  return new Set(
    actor.accounts.filter(a => a.viewerUserPermission.role !== Role.ViewOnly).map(it => it.name)
  );
}

export function getAccountChoices(
  actor: Actor,
  namesWithSufficientPermissions: Set<string>
): Choice[] {
  const allAccounts = actor.accounts;

  if (actor.__typename !== 'Robot') {
    const personalAccount = getPersonalAccount(actor);

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
      ?.filter(account => account.ownerUserActor && account.id !== personalAccount?.id)
      .map(account => ({
        title: account.name,
        value: account,
        description: !namesWithSufficientPermissions.has(account.name)
          ? '(Team) (Viewer Role)'
          : '(Team)',
      }));

    const organizationAccounts = allAccounts
      ?.filter(account => account.id !== personalAccount?.id && !account.ownerUserActor)
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
      a.value.id === personalAccount?.id ? -1 : 1
    );
  }

  return allAccounts.map(account => ({
    title: account.name,
    value: account,
    description: !namesWithSufficientPermissions.has(account.name) ? '(Viewer Role)' : undefined,
  }));
}
