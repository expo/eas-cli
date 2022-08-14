import { selectPlatformAsync } from '../../platform';
import { ManageAndroid } from './ManageAndroid';
import { ManageIos } from './ManageIos';

export class SelectPlatform {
  private readonly flagPlatform: string;

  constructor(platform: string) {
    this.flagPlatform = platform;
  }

  async runAsync(): Promise<void> {
    const platform = await selectPlatformAsync(this.flagPlatform);

    if (platform === 'ios') {
      return await new ManageIos(new SelectPlatform(platform), process.cwd()).runAsync();
    }
    return await new ManageAndroid(new SelectPlatform(platform), process.cwd()).runAsync();
  }
}
