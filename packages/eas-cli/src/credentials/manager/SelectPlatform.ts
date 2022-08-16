import { selectPlatformAsync } from '../../platform';
import { ManageAndroid } from './ManageAndroid';
import { ManageIos } from './ManageIos';

export class SelectPlatform {
  constructor(private readonly flagPlatform?: string) {
    this.flagPlatform = flagPlatform;
  }

  async runAsync(): Promise<void> {
    const platform = await selectPlatformAsync(this.flagPlatform);

    if (platform === 'ios') {
      return await new ManageIos(new SelectPlatform(platform), process.cwd()).runAsync();
    }
    return await new ManageAndroid(new SelectPlatform(platform), process.cwd()).runAsync();
  }
}
