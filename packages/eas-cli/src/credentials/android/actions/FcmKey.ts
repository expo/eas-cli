import log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';

export class UpdateFcmKey implements Action {
  constructor(private experienceName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const { fcmApiKey } = await promptAsync([
      {
        type: 'text',
        name: 'fcmApiKey',
        message: 'FCM API Key',
        validate: (value: string) => value.length > 0 || "FCM API Key can't be empty",
      },
    ]);

    await ctx.android.updateFcmKeyAsync(this.experienceName, fcmApiKey);
    log.succeed('Updated successfully');
  }
}
