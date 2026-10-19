import EasCommand from '../../commandUtils/EasCommand';
import { mockCommandContext } from './utils';

jest.mock('fs');

class TestCommand extends EasCommand {
  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Experimentation,
  };

  async runAsync(): Promise<void> {}
}

describe(mockCommandContext, () => {
  it('provides a disabled experimentation client that returns defaults', async () => {
    const ctx = mockCommandContext(TestCommand, {});
    const client = await ctx.experimentation.getClientAsync();
    expect(client.getUserNamespace('any').getParam('variant', 'control')).toBe('control');
    expect(client.getAccountNamespace('any', { accountId: 'a' }).getParam('enabled', true)).toBe(
      true
    );
    expect(client.getDeviceNamespace('any').getParam('count', 3)).toBe(3);
  });
});
