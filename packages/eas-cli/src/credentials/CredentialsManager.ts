import log from '../log';
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

export async function runStandaloneCredentialsManagerAsync(
  ctx: Context,
  startAction: Action
): Promise<void> {
  const manager = new CredentialsManagerImpl(ctx, startAction);
  await manager.runManagerAsync(true);
}

export async function runCredentialsManagerAsync(ctx: Context, startAction: Action): Promise<void> {
  const manager = new CredentialsManagerImpl(ctx, startAction);
  await manager.runManagerAsync(false);
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
    await new CredentialsManagerImpl(this.ctx, action).doRunManagerAsync(false);
  }

  public async runManagerAsync(isStandaloneManager: boolean): Promise<void> {
    try {
      await this.doRunManagerAsync(isStandaloneManager);
    } catch (error) {
      if (error instanceof QuitError) {
        return;
      }
      throw error;
    }
  }

  private async doRunManagerAsync(isStandaloneManager: boolean): Promise<void> {
    while (true) {
      try {
        const currentAction = this.popAction();
        if (!currentAction) {
          return;
        }
        await currentAction.runAsync(this, this.ctx);
      } catch (error) {
        if (!isStandaloneManager || error instanceof QuitError) {
          throw error;
        } else {
          log.error(error);
        }
      }
    }
  }
}
