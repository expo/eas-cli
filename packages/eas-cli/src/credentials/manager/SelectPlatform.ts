import { selectPlatformAsync } from '../../platform';
import { Actor } from '../../user/User';
import { ManageAndroid } from './ManageAndroid';
import { ManageIos } from './ManageIos';

export class SelectPlatform {
  constructor(public readonly actor: Actor, private readonly flagPlatform?: string) {}

  async runAsync(): Promise<void> {
    const platform = await selectPlatformAsync(this.flagPlatform);

    if (platform === 'ios') {
      return await new ManageIos(this, process.cwd()).runAsync();
    }
    return await new ManageAndroid(this, process.cwd()).runAsync();
  }
}
