import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';

export class ManageIos implements Action {
  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    throw new Error('not implemented');
  }
}
