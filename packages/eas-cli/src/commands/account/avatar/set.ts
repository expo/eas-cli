import { Args } from '@oclif/core';
import chalk from 'chalk';

import { getExpoWebsiteBaseUrl } from '../../../api';
import EasCommand from '../../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../../commandUtils/flags';
import { AccountUploadSessionType } from '../../../graphql/generated';
import { AccountQuery } from '../../../graphql/queries/AccountQuery';
import Log, { link } from '../../../log';
import { ora } from '../../../ora';
import { selectAsync } from '../../../prompts';
import { uploadAccountScopedFileAtPathToGCSAsync } from '../../../uploads';
import {
  pollForProfileImageChangeAsync,
  validateProfileImageAsync,
} from '../../../utils/profileImages';

export default class AccountAvatarSet extends EasCommand {
  static override description =
    'set the avatar for an account (for a personal account, this is your user avatar)';

  static override args = {
    path: Args.string({
      required: true,
      description:
        'Path to the avatar image (PNG or JPEG, at most 10 MB). Non-square images are center-cropped to a square.',
    }),
    account_name: Args.string({
      required: false,
      description:
        'Name of the account to set the avatar for. Defaults to a prompt when you have access to multiple accounts.',
    }),
  };

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { path: imagePath, account_name: accountName },
      flags,
    } = await this.parse(AccountAvatarSet);
    const nonInteractive = flags['non-interactive'];
    const {
      loggedIn: { graphqlClient, actor },
    } = await this.getContextAsync(AccountAvatarSet, { nonInteractive });

    await validateProfileImageAsync(imagePath);

    let targetAccount: { id: string; name: string };
    if (accountName) {
      const found = actor.accounts.find(account => account.name === accountName);
      if (found) {
        targetAccount = found;
      } else {
        const availableAccounts = actor.accounts.map(account => account.name).join(', ');
        throw new Error(
          `Account "${accountName}" not found or you don't have access. Available accounts: ${availableAccounts}`
        );
      }
    } else if (actor.accounts.length === 1) {
      targetAccount = actor.accounts[0];
    } else if (nonInteractive) {
      throw new Error(
        'ACCOUNT_NAME argument must be provided when running in `--non-interactive` mode.'
      );
    } else {
      targetAccount = await selectAsync(
        'Select account to set the avatar for:',
        actor.accounts.map(account => ({
          title: account.name,
          value: account,
        })),
        { initial: actor.accounts[0] }
      );
    }

    const accountSettingsUrl = new URL(
      `/accounts/${targetAccount.name}/settings`,
      getExpoWebsiteBaseUrl()
    ).toString();
    const previousProfileImageUrl = await AccountQuery.byIdProfileImageUrlAsync(
      graphqlClient,
      targetAccount.id
    );

    const spinner = ora('Uploading avatar').start();
    try {
      await uploadAccountScopedFileAtPathToGCSAsync(graphqlClient, {
        type: AccountUploadSessionType.ProfileImageUpload,
        accountId: targetAccount.id,
        path: imagePath,
      });

      spinner.text = 'Processing avatar';
      await pollForProfileImageChangeAsync({
        fetchProfileImageUrlAsync: async () =>
          await AccountQuery.byIdProfileImageUrlAsync(graphqlClient, targetAccount.id),
        previousProfileImageUrl,
        fallbackUrl: accountSettingsUrl,
      });
      spinner.succeed(`Set avatar for ${chalk.bold(targetAccount.name)}`);
      Log.withTick(`View it in the account settings: ${link(accountSettingsUrl)}`);
    } catch (error) {
      spinner.fail('Failed to set avatar');
      throw error;
    }
  }
}
