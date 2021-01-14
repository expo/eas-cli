import { Context } from './context';

export interface Action<T = void> {
  runAsync(manager: CredentialsManager, ctx: Context): Promise<T>;
}

export class CredentialsManager {
  constructor(private ctx: Context) {}

  public async runActionAsync<T>(action: Action<T>): Promise<T> {
    return await action.runAsync(this, this.ctx);
  }
}
