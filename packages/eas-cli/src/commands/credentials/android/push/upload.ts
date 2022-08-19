import { Flags } from '@oclif/core';

import EasCommand from '../../../../commandUtils/EasCommand';
import { AssignFcm } from '../../../../credentials/android/actions/AssignFcm';
import { getAppLookupParamsFromContextAsync } from '../../../../credentials/android/actions/BuildCredentialsUtils';
import { CreateFcm } from '../../../../credentials/android/actions/CreateFcm';
import { CredentialsContext } from '../../../../credentials/context';
import { getProjectAccountName } from '../../../../project/projectUtils';
import { findAccountByName } from '../../../../user/Account';
import { ensureActorHasUsername, ensureLoggedInAsync } from '../../../../user/actions';

export default class CredentialsAndroidPushUpload extends EasCommand {
  static description = 'upload ios push notification credentials';

  static flags = {
    'api-key': Flags.string({
      description: 'Server API key for FCM.',
      required: false,
    }),
    'non-interactive': Flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
  };

  async runAsync(): Promise<void> {
    const {
      flags: { 'api-key': fcmApiKey, 'non-interactive': nonInteractive },
    } = await this.parse(CredentialsAndroidPushUpload);

    const projectDir = process.cwd();
    const ctx = new CredentialsContext({
      nonInteractive,
      projectDir,
      user: await ensureLoggedInAsync({ nonInteractive }),
    });

    const accountName = ctx.hasProjectContext
      ? getProjectAccountName(ctx.exp, ctx.user)
      : ensureActorHasUsername(ctx.user);
    const account = findAccountByName(ctx.user.accounts, accountName);
    if (!account) {
      throw new Error(`You do not have access to account: ${accountName}`);
    }

    const androidFcmFragment = await new CreateFcm(account).runAsync(ctx, fcmApiKey);

    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    await new AssignFcm(appLookupParams).runAsync(ctx, androidFcmFragment);
  }
}
