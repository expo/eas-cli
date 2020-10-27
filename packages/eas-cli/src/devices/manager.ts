import assert from 'assert';
import chalk from 'chalk';

import { AppleTeamMutation } from '../graphql/mutations/credentials/AppleTeamMutation';
import { AppleTeamQuery } from '../graphql/queries/credentials/AppleTeamQuery';
import { AppleTeam } from '../graphql/types/credentials/AppleTeam';
import log from '../log';
import { getProjectAccountNameAsync } from '../project/projectUtils';
import { Choice, confirmAsync, promptAsync } from '../prompts';
import { Account, findAccountByName } from '../user/Account';
import { User } from '../user/User';
import DeviceCreateAction from './actions/create/action';
import { DeviceManagerContext } from './context';

const CREATE_COMMAND_DESCRIPTION = `This command lets you register your Apple devices (iPhones and iPads) for internal distribution of your app.
Internal distribution means that you won't need upload your app archive to App Store / Testflight.
Your app archive (.ipa) will be installable on your equipment as long as you sign your application with an adhoc provisiong profile.
The provisioning profile needs to contain the UDIDs (unique identifiers) of your iPhones and iPads.

First of all, please choose the Expo account under which you want to register your devices.
Later, authenticate with Apple and choose your desired Apple Team (if you're Apple ID has access to multiple teams).`;

export default class DeviceManager {
  constructor(private ctx: DeviceManagerContext) {}

  public async createAsync(): Promise<void> {
    log(chalk.green(CREATE_COMMAND_DESCRIPTION));
    log.addNewLineIfNone();

    const account = await this.resolveAccountAsync();
    const { team } = await this.ctx.appStore.ensureAuthenticatedAsync();
    const appleTeam = await ensureAppleTeamExistsAsync(account.id, {
      appleTeamIdentifier: team.id,
      appleTeamName: team.name,
    });
    const action = new DeviceCreateAction(account, appleTeam);
    await action.runAsync();
  }

  private async resolveAccountAsync(): Promise<Account> {
    const resolver = new AccountResolver(this.ctx.projectDir, this.ctx.user);
    return await resolver.resolveAccountAsync();
  }
}

export class AccountResolver {
  constructor(private projectDir: string | null, private user: User) {}

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
      log.warn(
        `Your user (${this.user.username}) doesn't have access to the ${chalk.bold(
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

    if (useProjectAccount) {
      return projectAccount;
    }
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

async function ensureAppleTeamExistsAsync(
  accountId: string,
  { appleTeamIdentifier, appleTeamName }: { appleTeamIdentifier: string; appleTeamName: string }
): Promise<AppleTeam> {
  const appleTeam = await AppleTeamQuery.byAppleTeamIdentifierAsync(accountId, appleTeamIdentifier);
  if (appleTeam) {
    return appleTeam;
  } else {
    return await AppleTeamMutation.createAppleTeamAsync(
      {
        appleTeamIdentifier,
        appleTeamName,
      },
      accountId
    );
  }
}
