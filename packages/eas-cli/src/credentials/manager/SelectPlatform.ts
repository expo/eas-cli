import { promptAsync } from '../../prompts';
import { CredentialsContext } from '../context';
import { ManageAndroid } from './ManageAndroid';
import { ManageIos } from './ManageIos';

export class SelectPlatform {
  async runAsync(ctx: CredentialsContext): Promise<void> {
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
