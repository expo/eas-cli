import Log from '../../log';
import { pressAnyKeyToContinueAsync } from '../../prompts';

export class PressAnyKeyToContinue {
  public async runAsync(): Promise<void> {
    Log.log('Press any key to continue...');
    await pressAnyKeyToContinueAsync();
    Log.newLine();
    Log.newLine();
  }
}
