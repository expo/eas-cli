import { Action } from './CredentialsManager';
import { CredentialsManagerImpl } from './CredentialsManagerImpl';
import { Context } from './context';

export async function runCredentialsManagerStandaloneAsync(
  ctx: Context,
  startAction: Action
): Promise<void> {
  const manager = new CredentialsManagerImpl(ctx, startAction);
  await manager.runManagerAsync();
}

export async function runCredentialsManagerAsync(ctx: Context, startAction: Action): Promise<void> {
  const manager = new CredentialsManagerImpl(ctx, startAction);
  await manager.runManagerAsync();
}
