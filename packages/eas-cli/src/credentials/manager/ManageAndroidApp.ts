import isEmpty from 'lodash/isEmpty';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { DownloadKeystore } from '../android/actions/DownloadKeystore';
import { UpdateFcmKey } from '../android/actions/FcmKey';
import { RemoveKeystore } from '../android/actions/RemoveKeystore';
import { SetupBuildCredentialsFromCredentialsJson } from '../android/actions/SetupBuildCredentials';
import { UpdateCredentialsJson } from '../android/actions/UpdateCredentialsJson';
import { UpdateKeystore } from '../android/actions/UpdateKeystore';
import { printAndroidAppCredentials } from '../android/utils/printCredentials';
import { Context } from '../context';
import { PressAnyKeyToContinue } from './HelperActions';

enum ActionType {
  UpdateCredentialsJson,
  SetupBuildCredentialsFromCredentialsJson,
  UpdateKeystore,
  RemoveKeystore,
  DownloadKeystore,
  UpdateFcmKey,
  GoBack,
}

export class ManageAndroidApp implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    while (true) {
      try {
        const credentials = await ctx.android.fetchCredentialsAsync(this.projectFullName);

        if (isEmpty(credentials.keystore) && isEmpty(credentials.pushCredentials)) {
          Log.log(`No credentials available for ${this.projectFullName}.\n`);
        } else {
          Log.newLine();
          await printAndroidAppCredentials(credentials);
        }

        const { action } = await promptAsync([
          {
            type: 'select',
            name: 'action',
            message: 'What do you want to do?',
            choices: [
              {
                value: ActionType.UpdateCredentialsJson,
                title: 'Update credentials.json with values from EAS servers',
              },
              {
                value: ActionType.SetupBuildCredentialsFromCredentialsJson,
                title: 'Update credentials on EAS servers with values from credentials.json',
              },
              { value: ActionType.UpdateKeystore, title: 'Update Keystore' },
              { value: ActionType.RemoveKeystore, title: 'Remove Keystore' },
              {
                value: ActionType.DownloadKeystore,
                title: 'Download Keystore from the EAS servers',
              },
              { value: ActionType.UpdateFcmKey, title: 'Update FCM API Key' },
              { value: ActionType.GoBack, title: 'Go back to project list' },
            ],
          },
        ]);

        if (action === ActionType.GoBack) {
          return;
        }

        try {
          await manager.runActionAsync(this.getAction(ctx, action));
        } catch (err) {
          Log.error(err);
        }
        await manager.runActionAsync(new PressAnyKeyToContinue());
      } catch (err) {
        Log.error(err);
        await manager.runActionAsync(new PressAnyKeyToContinue());
      }
    }
  }

  private getAction(context: Context, selected: ActionType): Action {
    switch (selected) {
      case ActionType.UpdateKeystore:
        return new UpdateKeystore(this.projectFullName);
      case ActionType.RemoveKeystore:
        return new RemoveKeystore(this.projectFullName);
      case ActionType.UpdateFcmKey:
        return new UpdateFcmKey(this.projectFullName);
      case ActionType.DownloadKeystore:
        return new DownloadKeystore(this.projectFullName);
      case ActionType.UpdateCredentialsJson: {
        return new UpdateCredentialsJson(this.projectFullName);
      }
      case ActionType.SetupBuildCredentialsFromCredentialsJson: {
        return new SetupBuildCredentialsFromCredentialsJson(this.projectFullName, {
          skipKeystoreValidation: false,
        });
      }
      default:
        throw new Error('unknown action');
    }
  }
}
