import assert from 'assert';
import chalk from 'chalk';

import { Account as GraphQLAccount } from '../graphql/generated';

import { getProjectAccountNameAsync } from '../project/projectUtils';
import { Choice, confirmAsync, promptAsync } from '../prompts';
import { Actor } from '../user/User';
import { getActorDisplayName } from '../user/actions';
import Log from '../log';

export type Account = Pick<GraphQLAccount, 'id' | 'name'>;

export function findAccountByName(accounts: Account[], needle: string): Account | undefined {
  return accounts.find(({ name }) => name === needle);
}

export class AccountResolver {
  constructor(private projectDir: string | null, private user: Actor) {}

  public async resolveAccountAsync(): Promise<Account> {
    if (this.projectDir) {
      const account = await this.resolveProjectAccountAsync();
      if (account) {
        return account;
      }
    }
    return await this.promptForAccountAsync();
  }

  private async resolveProjectAccountAsync(): Promise<Account | undefined> {
    assert(this.projectDir, 'project directory is not set ');

    const projectAccountName = await getProjectAccountNameAsync(this.projectDir);
    const projectAccount = findAccountByName(this.user.accounts, projectAccountName);
    if (!projectAccount) {
      Log.warn(
        `Your account (${getActorDisplayName(this.user)}) doesn't have access to the ${chalk.bold(
          projectAccountName
        )} account`
      );
      return;
    }

    const useProjectAccount = await confirmAsync({
      message: `You're inside the project directory. Would you like to use ${chalk.underline(
        projectAccountName
      )} account?`,
    });

    return useProjectAccount ? projectAccount : undefined;
  }

  private async promptForAccountAsync(): Promise<Account> {
    const choices: Choice[] = this.user.accounts.map(account => ({
      title: account.name,
      value: account,
    }));
    const { account } = await promptAsync({
      type: 'select',
      name: 'account',
      message: 'Which account to use?',
      choices,
    });
    return account;
  }
}
