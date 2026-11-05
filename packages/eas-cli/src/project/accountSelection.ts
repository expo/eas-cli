import { SelectChoice } from '../prompts';
import { Actor, getCannotCreateProjectsOnAccountReason, getPersonalAccount } from '../user/User';

function getDisabledProps(
  account: Actor['accounts'][number]
): Pick<SelectChoice, 'disabled' | 'disabledReason'> {
  const disabledReason = getCannotCreateProjectsOnAccountReason(account);
  return disabledReason ? { disabled: true, disabledReason } : {};
}

export function getAccountChoices(actor: Actor): SelectChoice[] {
  const allAccounts = actor.accounts;

  if (actor.__typename !== 'Robot') {
    const personalAccount = getPersonalAccount(actor);

    const personalAccountChoice = personalAccount
      ? {
          title: personalAccount.name,
          value: personalAccount,
          description: '(Personal)',
          ...getDisabledProps(personalAccount),
        }
      : undefined;

    const userAccounts = allAccounts
      ?.filter(account => account.ownerUserActor && account.id !== personalAccount?.id)
      .map(account => ({
        title: account.name,
        value: account,
        description: '(Team)',
        ...getDisabledProps(account),
      }));

    const organizationAccounts = allAccounts
      ?.filter(account => account.id !== personalAccount?.id && !account.ownerUserActor)
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

    return [...choices, ...userAccounts, ...organizationAccounts];
  }

  return allAccounts.map(account => ({
    title: account.name,
    value: account,
    ...getDisabledProps(account),
  }));
}
