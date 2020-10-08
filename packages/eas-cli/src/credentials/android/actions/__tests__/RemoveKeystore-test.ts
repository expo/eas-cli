import prompts from 'prompts';

import { Action } from '../../../CredentialsManager';
import { testKeystore } from '../../../__tests__/fixtures-android';
import { testExperienceName } from '../../../__tests__/fixtures-constants';
import { createCtxMock, createManagerMock } from '../../../__tests__/fixtures-context';
import { BackupKeystore } from '../DownloadKeystore';
import { RemoveKeystore } from '../RemoveKeystore';

jest.mock('prompts');

const originalWarn = console.warn;
const originalLog = console.log;
beforeAll(() => {
  console.warn = jest.fn();
  console.log = jest.fn();
});
afterAll(() => {
  console.warn = originalWarn;
  console.log = originalLog;
});
beforeEach(() => {
  (prompts as any).mockReset();
  (prompts as any).mockImplementation(() => {
    throw new Error('Should not be called');
  });
});

describe('run RemoveKeystore when keystore does exist', () => {
  it('should display warning prompt and abort', async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystoreAsync: jest.fn(() => testKeystore),
      },
    });
    const manager = createManagerMock();
    (prompts as any).mockImplementationOnce(() => ({ value: false })); // prompt with warning message, false means abort

    await new RemoveKeystore(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.removeKeystoreAsync).not.toHaveBeenCalled();
  });

  it('should display warning prompt and continue', async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystoreAsync: jest.fn(() => testKeystore),
      },
    });
    const manager = createManagerMock();

    (manager.runActionAsync as any).mockImplementationOnce((action: Action) => {
      expect(action).toBeInstanceOf(BackupKeystore);
    });
    (prompts as any).mockImplementationOnce(() => ({ value: true })); // prompt with warning message, true means continue

    await new RemoveKeystore(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(manager.runActionAsync).toHaveBeenCalledTimes(1);
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.removeKeystoreAsync).toHaveBeenCalledTimes(1);
  });

  it('should not display a prompt in non-interactive mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      android: {
        fetchKeystoreAsync: jest.fn(() => testKeystore),
      },
    });
    const manager = createManagerMock();

    try {
      await new RemoveKeystore(testExperienceName).runAsync(manager, ctx);
      throw new Error('make sure expect in catch is called');
    } catch (e) {
      expect(e.message).toMatch('Deleting build credentials is a destructive operation');
    }

    expect(prompts).not.toHaveBeenCalled();
    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.removeKeystoreAsync).not.toHaveBeenCalled();
  });
});

describe('run RemoveKeystore when keystore does not exist', () => {
  it("shouldn't display warning prompt and finish", async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystoreAsync: jest.fn().mockImplementationOnce(() => null),
      },
    });
    const manager = createManagerMock();

    await new RemoveKeystore(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(prompts).not.toHaveBeenCalled();
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.removeKeystoreAsync).not.toHaveBeenCalled();
  });
  it("shouldn't display warning prompt and finish in non-interactive mode", async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystoreAsync: jest.fn().mockImplementationOnce(() => null),
      },
    });
    const manager = createManagerMock();

    await new RemoveKeystore(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(prompts).not.toHaveBeenCalled();
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.removeKeystoreAsync).not.toHaveBeenCalled();
  });
});
