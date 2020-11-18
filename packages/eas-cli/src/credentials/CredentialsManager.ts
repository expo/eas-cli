import { Context } from './context';

export interface CredentialsManager {
  runActionAsync(action: Action): Promise<void>;

  pushNextAction(action: Action): void;

  popAction(): Action | null;
}

export interface Action {
  runAsync(manager: CredentialsManager, ctx: Context): Promise<void>;
}

export class QuitError extends Error {}

export async function runCredentialsManagerAsync(ctx: Context, startAction: Action): Promise<void> {
  const manager = new CredentialsManagerImpl(ctx, startAction);
  await manager.runManagerAsync();
}

class CredentialsManagerImpl implements CredentialsManager {
  private actionStack: Action[] = [];

  constructor(private ctx: Context, startAction: Action) {
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
      const currentAction = this.popAction();
      if (!currentAction) {
        return;
      }
      await currentAction.runAsync(this, this.ctx);
    }
  }
}
