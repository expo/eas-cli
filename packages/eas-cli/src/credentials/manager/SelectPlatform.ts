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

    if (platform === 'ios') {
      return await new ManageIos().runAsync(ctx);
    }
    return await manager.runActionAsync(new SelectAndroidApp());
  }
}
