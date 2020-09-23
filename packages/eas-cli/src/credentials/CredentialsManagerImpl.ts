import log from '../log';
import { Action, CredentialsManager, QuitError } from './CredentialsManager';
import { Context } from './context';

export class CredentialsManagerImpl implements CredentialsManager {
  private ctx: Context;
  private actionStack: Action[] = [];

  constructor(ctx: Context, startAction: Action) {
    this.ctx = ctx;
    this.actionStack.push(startAction);
  }

  public pushNextAction(action: Action): void {
    this.actionStack.push(action);
  }

  public popAction(): Action | null {
    return this.actionStack.pop() ?? null;
  }

  public async runActionAsync(action: Action) {
    await new CredentialsManagerImpl(this.ctx, action).doRunManagerAsync();
  }

  public async runManagerAsync(): Promise<void> {
    try {
      await this.doRunManagerAsync();
    } catch (error) {
      if (error instanceof QuitError) {
        return;
      }
      throw error;
    }
  }

  private async doRunManagerAsync(): Promise<void> {
    while (true) {
      try {
        const currentAction = this.popAction();
        if (!currentAction) {
          return;
        }
        await currentAction.runAsync(this, this.ctx);
      } catch (error) {
        if (error instanceof QuitError) {
          throw error;
        }
        log(error);
      }
    }
  }
}
