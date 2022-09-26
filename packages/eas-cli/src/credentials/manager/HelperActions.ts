import Log from '../../log';
import { pressAnyKeyToContinueAsync } from '../../prompts';
import { Actor } from '../../user/User';
import { CredentialsContext } from '../context';

export interface Action<T = void> {
  actor: Actor;
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
