import chalk from 'chalk';

import { AppleTeamMutation } from '../credentials/ios/api/graphql/mutations/AppleTeamMutation';
import { AppleTeamQuery } from '../credentials/ios/api/graphql/queries/AppleTeamQuery';
import { AppleTeamFragment } from '../graphql/generated';
import Log from '../log';
import { Account, AccountResolver } from '../user/Account';
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
    Log.log(chalk.green(CREATE_COMMAND_DESCRIPTION));
    Log.addNewLineIfNone();

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

async function ensureAppleTeamExistsAsync(
  accountId: string,
  { appleTeamIdentifier, appleTeamName }: { appleTeamIdentifier: string; appleTeamName: string }
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
