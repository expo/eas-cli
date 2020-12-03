import log from '../../log';
import { pressAnyKeyToContinueAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';

export class PressAnyKeyToContinue implements Action {
  public async runAsync(manager: CredentialsManager, context: Context): Promise<void> {
    log('Press any key to continue...');
    await pressAnyKeyToContinueAsync();
    log.newLine();
    log.newLine();
  }
}
