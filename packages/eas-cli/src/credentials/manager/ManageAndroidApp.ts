import isEmpty from 'lodash/isEmpty';

import log from '../../log';
import { promptAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { DownloadKeystore } from '../android/actions/DownloadKeystore';
import { UpdateFcmKey } from '../android/actions/FcmKey';
import { RemoveKeystore } from '../android/actions/RemoveKeystore';
import { UpdateKeystore } from '../android/actions/UpdateKeystore';
import { printAndroidAppCredentials } from '../android/utils/printCredentials';
import { Context } from '../context';
import { PressAnyKeyToContinue } from './HelperActions';

export class ManageAndroidApp implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    manager.pushNextAction(this);
    const credentials = await ctx.android.fetchCredentialsAsync(this.projectFullName);

    if (isEmpty(credentials.keystore) && isEmpty(credentials.pushCredentials)) {
      log(`No credentials available for ${this.projectFullName}.\n`);
    } else {
      log.newLine();
      await printAndroidAppCredentials(credentials);
    }

    const { action } = await promptAsync([
      {
        type: 'select',
        name: 'action',
        message: 'What do you want to do?',
        choices: [
          { value: 'update-keystore', title: 'Update Keystore' },
          { value: 'remove-keystore', title: 'Remove Keystore' },
          { value: 'fetch-keystore', title: 'Download Keystore from the Expo servers' },
          { value: 'update-fcm-key', title: 'Update FCM API Key' },
          { value: 'go-back', title: 'Go back to project list' },
        ],
      },
    ]);

    if (action === 'go-back') {
      manager.popAction();
      return;
    }

    manager.pushNextAction(new PressAnyKeyToContinue());
    manager.pushNextAction(this.getAction(ctx, action));
  }

  private getAction(context: Context, selected: string): Action {
    switch (selected) {
      case 'update-keystore':
        return new UpdateKeystore(this.projectFullName);
      case 'remove-keystore':
        return new RemoveKeystore(this.projectFullName);
      case 'update-fcm-key':
        return new UpdateFcmKey(this.projectFullName);
      case 'fetch-keystore':
        return new DownloadKeystore(this.projectFullName);
      default:
        throw new Error('unknown action');
    }
  }
}
