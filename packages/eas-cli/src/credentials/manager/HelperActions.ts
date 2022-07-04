import Log from '../../log.js';
import { pressAnyKeyToContinueAsync } from '../../prompts.js';
import { CredentialsContext } from '../context.js';

export interface Action<T = void> {
  runAsync(ctx: CredentialsContext): Promise<T>;
}

export class PressAnyKeyToContinue {
  public async runAsync(): Promise<void> {
    Log.log('Press any key to continue...');
    await pressAnyKeyToContinueAsync();
    Log.newLine();
    Log.newLine();
  }
}
