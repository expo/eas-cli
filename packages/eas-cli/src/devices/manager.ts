import assert from 'assert';
import chalk from 'chalk';

import { AppleTeamMutation } from '../credentials/ios/api/graphql/mutations/AppleTeamMutation';
import { AppleTeamQuery } from '../credentials/ios/api/graphql/queries/AppleTeamQuery';
import { AccountFragment, AppleTeamFragment } from '../graphql/generated';
import Log from '../log';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import { Choice, confirmAsync, promptAsync } from '../prompts';
import { Actor } from '../user/User';
import DeviceCreateAction from './actions/create/action';
import { DeviceManagerContext } from './context';

const CREATE_COMMAND_DESCRIPTION = `This command lets you register your Apple devices (iPhones and iPads) for internal distribution of your app.
Internal distribution means that you won't need to upload your app archive to App Store / Testflight.
Your app archive (.ipa) will be installable on your equipment as long as you sign your application with an adhoc provisiong profile.
The provisioning profile needs to contain the UDIDs (unique identifiers) of your iPhones and iPads.

First of all, choose the Expo account under which you want to register your devices.
Later, authenticate with Apple and choose your desired Apple Team (if your Apple ID has access to multiple teams).`;

export default class DeviceManager {
  constructor(private ctx: DeviceManagerContext) {}

  public async createAsync(): Promise<void> {
    Log.log(chalk.green(CREATE_COMMAND_DESCRIPTION));
    Log.addNewLineIfNone();

    const account = await this.resolveAccountAsync();
    const appleAuthCtx = await this.ctx.appStore.ensureAuthenticatedAsync();
    const appleTeam = await ensureAppleTeamExistsAsync(account.id, {
      appleTeamIdentifier: appleAuthCtx.team.id,
      appleTeamName: appleAuthCtx.team.name,
    });
    const action = new DeviceCreateAction(this.ctx.appStore, account, appleTeam);
    await action.runAsync();
  }

  private async resolveAccountAsync(): Promise<AccountFragment> {
    const resolver = new AccountResolver(this.ctx.projectId, this.ctx.user);
    return await resolver.resolveAccountAsync();
  }
}

export class AccountResolver {
  constructor(private projectId: string | null, private user: Actor) {}

  public async resolveAccountAsync(): Promise<AccountFragment> {
    const account = await this.resolveProjectAccountAsync();
    if (account) {
      return account;
    }
    return await this.promptForAccountAsync();
  }

  private async resolveProjectAccountAsync(): Promise<AccountFragment | undefined> {
    assert(this.projectId, 'expo config is not set');
    const account = await getOwnerAccountForProjectIdAsync(this.projectId);

    const useProjectAccount = await confirmAsync({
      message: `You're inside the project directory. Would you like to use the ${chalk.underline(
        account.name
      )} account?`,
    });

    return useProjectAccount ? account : undefined;
  }

  private async promptForAccountAsync(): Promise<AccountFragment> {
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
  { appleTeamIdentifier, appleTeamName }: { appleTeamIdentifier: string; appleTeamName?: string }
): Promise<AppleTeamFragment> {
  const appleTeam = await AppleTeamQuery.getByAppleTeamIdentifierAsync(
    accountId,
    appleTeamIdentifier
  );
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
