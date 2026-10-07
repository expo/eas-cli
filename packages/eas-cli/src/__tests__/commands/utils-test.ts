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
  it('provides a disabled experimentation client that returns defaults', () => {
    const ctx = mockCommandContext(TestCommand, {});
    expect(ctx.experimentation.getUserNamespace('any').getParam('variant', 'control')).toBe(
      'control'
    );
    expect(ctx.experimentation.getAccountNamespace('any').getParam('enabled', true)).toBe(true);
    expect(ctx.experimentation.getDeviceNamespace('any').getParam('count', 3)).toBe(3);
  });
});
