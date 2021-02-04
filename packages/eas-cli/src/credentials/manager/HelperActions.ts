import Log from '../../log';
import { pressAnyKeyToContinueAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';

export class PressAnyKeyToContinue implements Action {
  public async runAsync(manager: CredentialsManager, context: Context): Promise<void> {
    Log.log('Press any key to continue...');
    await pressAnyKeyToContinueAsync();
    Log.newLine();
    Log.newLine();
  }
}
