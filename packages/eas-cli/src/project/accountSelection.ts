import { SelectChoice } from '../prompts';
import { Actor, getCannotCreateProjectsOnAccountReason } from '../user/User';

function getDisabledProps(
  account: Actor['accounts'][number]
): Pick<SelectChoice, 'disabled' | 'disabledReason'> {
  const disabledReason = getCannotCreateProjectsOnAccountReason(account);
  return disabledReason ? { disabled: true, disabledReason } : {};
}

export function getAccountChoices(actor: Actor): SelectChoice[] {
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
          description: '(Personal)',
          ...getDisabledProps(personalAccount),
        }
      : undefined;

    const userAccounts = allAccounts
      ?.filter(account => account.ownerUserActor && account.name !== actor.username)
      .map(account => ({
        title: account.name,
        value: account,
        description: '(Team)',
        ...getDisabledProps(account),
      }));

    const organizationAccounts = allAccounts
      ?.filter(account => account.name !== actor.username && !account.ownerUserActor)
      .map(account => ({
        title: account.name,
        value: account,
        description: '(Organization)',
        ...getDisabledProps(account),
      }));

    let choices: SelectChoice[] = [];
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
    ...getDisabledProps(account),
  }));
}
