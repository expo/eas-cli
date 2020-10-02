import { promptAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { ManageIos } from './ManageIos';
import { SelectAndroidApp } from './SelectAndroidApp';

export class SelectPlatform implements Action {
  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const { platform } = await promptAsync({
      type: 'select',
      name: 'platform',
      message: 'Select platform',
      choices: [
        { value: 'android', title: 'Android' },
        { value: 'ios', title: 'iOS' },
      ],
    });
    const action = platform === 'ios' ? new ManageIos() : new SelectAndroidApp();
    manager.pushNextAction(action);
  }
}
