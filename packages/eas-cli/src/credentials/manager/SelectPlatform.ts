import { promptAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { ManageAndroid } from './ManageAndroid';
import { ManageIos } from './ManageIos';

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
      return await new ManageIos(new SelectPlatform()).runAsync(ctx);
    }
    return await new ManageAndroid(new SelectPlatform()).runAsync(ctx);
  }
}
