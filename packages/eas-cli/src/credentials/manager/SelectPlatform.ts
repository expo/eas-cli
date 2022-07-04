import { promptAsync } from '../../prompts.js';
import { ManageAndroid } from './ManageAndroid.js';
import { ManageIos } from './ManageIos.js';

export class SelectPlatform {
  async runAsync(): Promise<void> {
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
      return await new ManageIos(new SelectPlatform(), process.cwd()).runAsync();
    }
    return await new ManageAndroid(new SelectPlatform(), process.cwd()).runAsync();
  }
}
