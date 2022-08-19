import { AndroidFcmFragment, AndroidFcmVersion } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { CredentialsContext } from '../../context';

export class CreateFcm {
  constructor(private account: Account) {}

  public async runAsync(ctx: CredentialsContext, fcmApiKey?: string): Promise<AndroidFcmFragment> {
    if (!fcmApiKey) {
      if (ctx.nonInteractive) {
        throw new Error('Must supply --api-key when in non-interactive mode');
      } else {
        const result = await promptAsync([
          {
            type: 'text',
            name: 'fcmApiKey',
            message: 'FCM API Key',
            validate: (value: string) => value.length > 0 || "FCM API Key can't be empty",
          },
        ]);
        fcmApiKey = result.fcmApiKey as string;
      }
    }
    const fcmFragment = await ctx.android.createFcmAsync(
      this.account,
      fcmApiKey,
      AndroidFcmVersion.Legacy
    );
    Log.succeed('Uploaded FCM API Key');
    return fcmFragment;
  }
}
