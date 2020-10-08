import fs from 'fs-extra';
import { vol } from 'memfs';
import prompts from 'prompts';

import { testKeystore } from '../../../__tests__/fixtures-android';
import { testExperienceName } from '../../../__tests__/fixtures-constants';
import { createCtxMock, createManagerMock } from '../../../__tests__/fixtures-context';
import { UpdateKeystore } from '../UpdateKeystore';

jest.mock('fs');
jest.mock('prompts');
jest.mock('../../utils/keystore');

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
  vol.reset();
  (prompts as any).mockReset();
  (prompts as any).mockImplementation(() => {
    throw new Error('Should not be called');
  });
});

describe('run UpdateKeystore when keystore exist on www', () => {
  it('should fetch old credentials and generate new ones', async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystoreAsync: jest.fn(() => testKeystore),
      },
    });
    const manager = createManagerMock();

    (prompts as any).mockImplementationOnce(() => ({ answer: false })); // promptForCredentials: let expo handle

    await new UpdateKeystore(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateKeystoreAsync).toHaveBeenCalledTimes(1);
  });

  it('should fetch old credentials and ask users to provide new ones', async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystoreAsync: jest.fn(() => testKeystore),
      },
    });
    const manager = createManagerMock();

    await fs.writeFile('/keystore.jks', testKeystore.keystore, 'base64');
    (prompts as any)
      .mockImplementationOnce(() => ({ answer: true })) // promptForCredentials: user specified
      .mockImplementationOnce(() => ({ input: '/keystore.jks' })) // keystore
      .mockImplementationOnce(() => ({ input: 'test' })) // keystore password
      .mockImplementationOnce(() => ({ input: 'test' })) // key alias
      .mockImplementationOnce(() => ({ input: 'test' })); // key password

    await new UpdateKeystore(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(prompts).toHaveBeenCalledTimes(5);
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateKeystoreAsync).toHaveBeenCalledTimes(1);
  });
});

describe('run UpdateKeystore when keystore deos not exist on www', () => {
  it('should fail to fetch credentials and generate new ones', async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystore: jest.fn(() => null),
      },
    });
    const manager = createManagerMock();

    (prompts as any).mockImplementationOnce(() => ({ answer: false })); // Let expo handle

    await new UpdateKeystore(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateKeystoreAsync).toHaveBeenCalledTimes(1);
  });

  it('should fail to fetch credentials and ask users to provide new ones', async () => {
    const ctx = createCtxMock({
      android: {
        fetchKeystore: jest.fn(() => null),
      },
    });
    const manager = createManagerMock();

    await fs.writeFile('/keystore.jks', testKeystore.keystore, 'base64');
    (prompts as any)
      .mockImplementationOnce(() => ({ answer: true })) // promptForCredentials: user specified
      .mockImplementationOnce(() => ({ input: '/keystore.jks' })) // keystore
      .mockImplementationOnce(() => ({ input: 'test' })) // keystore password
      .mockImplementationOnce(() => ({ input: 'test' })) // key alias
      .mockImplementationOnce(() => ({ input: 'test' })); // key password

    await new UpdateKeystore(testExperienceName).runAsync(manager, ctx);

    expect(manager.pushNextAction).not.toHaveBeenCalled();
    expect(prompts).toHaveBeenCalledTimes(5);
    expect(ctx.android.fetchKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.updateKeystoreAsync).toHaveBeenCalledTimes(1);
  });
});
