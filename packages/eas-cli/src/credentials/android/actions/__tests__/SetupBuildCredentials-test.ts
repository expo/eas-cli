import prompts from 'prompts';

import { Action } from '../../../CredentialsManager';
import { testKeystore } from '../../../__tests__/fixtures-android';
import { testExperienceName } from '../../../__tests__/fixtures-constants';
import { createCtxMock, createManagerMock } from '../../../__tests__/fixtures-context';
import { SetupBuildCredentials } from '../SetupBuildCredentials';
import { UpdateKeystore } from '../UpdateKeystore';

jest.mock('prompts');
jest.mock('../../utils/keystore');

const originalWarn = console.warn;
const originalLog = console.log;
beforeAll(() => {
  // console.warn = jest.fn();
  // console.log = jest.fn();
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

describe('run SetupBuildCredentials when www has valid credentials', () => {
  it('should fetch credentials and exit', async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystoreAsync: jest.fn(() => testKeystore),
      },
    });
    const manager = createManagerMock();

    await new SetupBuildCredentials(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateKeystoreAsync).not.toHaveBeenCalled();
  });

  it('should fetch credentials and exit in non-interactive mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      android: {
        fetchKeystoreAsync: jest.fn(() => testKeystore),
      },
    });
    const manager = createManagerMock();

    await new SetupBuildCredentials(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateKeystoreAsync).not.toHaveBeenCalled();
  });
});

describe('run SetupBuildCredentials when www has no credentials', () => {
  it('should try to fetch and launch UpdateKeystore', async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystoreAsync: jest.fn(() => null),
      },
    });
    const manager = createManagerMock();

    (manager.pushNextAction as any).mockImplementationOnce((action: Action) => {
      expect(action).toBeInstanceOf(UpdateKeystore);
    });
    await new SetupBuildCredentials(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).toHaveBeenCalledTimes(1);
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateKeystoreAsync).toHaveBeenCalledTimes(0); // will be called in UpdateKeystore
  });

  it('should fail if credentials are missing in non-interactive mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      android: {
        fetchKeystore: jest.fn(() => null),
      },
    });
    const manager = createManagerMock();

    try {
      await new SetupBuildCredentials(testExperienceName).runAsync(manager, ctx);
      throw new Error('SetupBuildCredentials.runAsync should throw an error');
    } catch (error) {
      expect(error.message).toMatch('Generating a new Keystore is not supported');
    }

    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
  });
});
