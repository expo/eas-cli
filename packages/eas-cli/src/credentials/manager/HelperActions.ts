import Log from '../../log';
import { pressAnyKeyToContinueAsync } from '../../prompts';
import { CredentialsContext } from '../context';

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
